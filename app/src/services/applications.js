// Жизненный цикл заявки: черновик → проверка → решение → подпись → выдача.
// Один источник правды о переходах — таблица TRANSITIONS. Каждое изменение статуса пишется в журнал.
import { nowIso, json, parse, tx } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../util/errors.js';
import { PRODUCTS, ENGINE_VERSION } from '../engine/products.js';
import { buildContext, evaluate, CHANCE_LABEL } from '../engine/scoring.js';
import { decide, DEFAULT_POLICY, findAlternatives, explainFor } from '../engine/decision.js';
import { fmtRub } from '../util/money.js';
import { TRANSITIONS, TERMINAL, IN_PIPELINE, STATUS_VIEW, STAGES } from './statuses.js';
import { SOURCE_TITLES } from './enrichment.js';

const OFFER_TTL_DAYS = 7;
const DOC_KINDS = {
  'Паспорт руководителя': 'passport',
  'Согласие на запрос в БКИ': 'bki_consent',
  'Счёт или договор на покупку оборудования': 'purchase_contract',
};
const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export function createApplications({ db, config, enrichment, notifications, policy = DEFAULT_POLICY }) {
  const running = new Set();
  const stmt = {
    byId: db.prepare('SELECT * FROM applications WHERE id = ?'),
    insert: db.prepare(`INSERT INTO applications (user_id, inn, status, product, amount, term, collateral, purpose, declared_revenue, form, created_at, updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`),
    setNumber: db.prepare('UPDATE applications SET number = ? WHERE id = ?'),
    userHasInn: db.prepare('SELECT 1 FROM user_companies WHERE user_id = ? AND inn = ?'),
    event: db.prepare(`INSERT INTO application_events (application_id, ts, actor, type, from_status, to_status, public_text, internal_text, payload)
                       VALUES (?,?,?,?,?,?,?,?,?)`),
    events: db.prepare('SELECT * FROM application_events WHERE application_id = ? ORDER BY id'),
    docs: db.prepare('SELECT kind, title, status, file_name AS fileName, updated_at AS updatedAt FROM documents WHERE application_id = ? ORDER BY id'),
    insDoc: db.prepare('INSERT OR IGNORE INTO documents (application_id, kind, title, status, updated_at) VALUES (?,?,?,?,?)'),
    setDoc: db.prepare("UPDATE documents SET status = 'provided', file_name = ?, updated_at = ? WHERE application_id = ? AND kind = ?"),
    delDocs: db.prepare('DELETE FROM documents WHERE application_id = ?'),
    infos: db.prepare('SELECT * FROM info_requests WHERE application_id = ? ORDER BY id'),
    insInfo: db.prepare('INSERT INTO info_requests (application_id, kind, question, status, created_by, created_at) VALUES (?,?,?,?,?,?)'),
    answerInfo: db.prepare("UPDATE info_requests SET status = 'answered', answer = ?, answered_at = ? WHERE id = ?"),
    closeInfos: db.prepare("UPDATE info_requests SET status = 'closed' WHERE application_id = ? AND status = 'open'"),
    insDecision: db.prepare('INSERT INTO decisions (application_id, outcome, routing, score, engine_version, made_by, final, payload, comment, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)'),
    decisions: db.prepare('SELECT * FROM decisions WHERE application_id = ? ORDER BY id'),
    snaps: db.prepare('SELECT source, ok, degraded, payload, error, fetched_at FROM enrichment_snapshots WHERE application_id = ? ORDER BY id'),
    list: db.prepare('SELECT * FROM applications WHERE user_id = ? ORDER BY id DESC'),
    update: db.prepare(`UPDATE applications SET product=?, amount=?, term=?, collateral=?, purpose=?, declared_revenue=?, form=?, version=version+1, updated_at=? WHERE id=?`),
    setStatus: db.prepare('UPDATE applications SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?'),
    setSubmitted: db.prepare('UPDATE applications SET submitted_at = ? WHERE id = ?'),
    setDecided: db.prepare('UPDATE applications SET decided_at = ? WHERE id = ?'),
    setAccepted: db.prepare('UPDATE applications SET accepted_terms = ?, product = ?, amount = ?, term = ? WHERE id = ?'),
    setRevenue: db.prepare('UPDATE applications SET declared_revenue = ? WHERE id = ?'),
    pipelineApps: db.prepare(`SELECT id FROM applications WHERE status IN ('submitted','checking','enrichment','scoring')`),
    queue: db.prepare(`SELECT a.*, u.display_name AS client FROM applications a JOIN users u ON u.id = a.user_id WHERE a.status = 'manual_review' ORDER BY a.submitted_at`),
    recent: db.prepare(`SELECT a.*, u.display_name AS client FROM applications a JOIN users u ON u.id = a.user_id WHERE a.status != 'draft' ORDER BY a.updated_at DESC LIMIT 30`),
    company: db.prepare('SELECT 1 FROM user_companies WHERE user_id = ? AND inn = ?'),
    expirable: db.prepare(`SELECT id FROM applications WHERE status IN ('approved','counter_offer','signing')`),
  };

  // ---------- базовые операции ----------
  const row = (id) => {
    const r = stmt.byId.get(id);
    if (!r) throw notFound('Заявка не найдена');
    return r;
  };

  function addEvent(appId, { actor, type, from = null, to = null, publicText = null, internalText = null, payload = null }) {
    stmt.event.run(appId, nowIso(), actor, type, from, to, publicText, internalText, json(payload));
  }

  function transition(app, to, meta) {
    const from = app.status;
    if (!TRANSITIONS[from]?.includes(to)) throw conflict(`Переход ${from} → ${to} недопустим`, 'invalid_transition');
    stmt.setStatus.run(to, nowIso(), app.id);
    addEvent(app.id, { type: 'status', from, to, ...meta });
    app.status = to;
    return app;
  }

  function ownedApp(user, id) {
    const app = stmt.byId.get(Number(id));
    // Чужую заявку не отличаем от несуществующей: так нельзя перебирать номера
    if (!app || app.user_id !== user.id) throw notFound('Заявка не найдена');
    return app;
  }

  const notifyClient = (app, title, body) => notifications.push(app.user_id, app.id, title, body);

  function latestDecision(appId) {
    const all = stmt.decisions.all(appId);
    const d = all[all.length - 1];
    return d ? { ...d, payload: parse(d.payload), final: !!d.final } : null;
  }

  function snapshotData(appId) {
    const latest = {};
    for (const s of stmt.snaps.all(appId)) latest[s.source] = s;
    const data = {}, meta = {};
    for (const src of ['fns', 'bki', 'statement']) {
      const s = latest[src];
      const p = s?.ok ? parse(s.payload) : null;
      data[src] = p && !p.notFound ? p : null;
      meta[src] = s ? { title: SOURCE_TITLES[src], ok: !!s.ok, degraded: !!s.degraded, error: s.error, fetchedAt: s.fetched_at, empty: !data[src] } : null;
    }
    return { data, meta };
  }

  // ---------- черновик ----------
  function prefill(fns) {
    return {
      companyName: fns.name, legalForm: fns.legalForm, address: fns.address, director: fns.director?.fio,
      employees: fns.employees, taxRegime: fns.taxRegime, okved: fns.okved?.code,
      comment: '', consents: { personalData: false },
    };
  }

  function docsFor(appId, productId) {
    const t = nowIso();
    stmt.delDocs.run(appId);
    for (const title of PRODUCTS[productId].documents) stmt.insDoc.run(appId, DOC_KINDS[title] || title, title, 'required', t);
  }

  async function createDraft(user, { inn, request, purpose }) {
    if (!stmt.userHasInn.get(user.id, inn)) throw forbidden('Сначала подключите компанию по ИНН');
    const { data } = await enrichment.loadAll(inn);
    const t = nowIso();
    const id = tx(db, () => {
      const r = stmt.insert.run(user.id, inn, 'draft', request.product, request.amount, request.term, request.collateral ? 1 : 0,
        purpose || null, null, json(prefill(data.fns)), t, t);
      const appId = Number(r.lastInsertRowid);
      stmt.setNumber.run(`AK-${new Date().getUTCFullYear()}-${String(appId).padStart(6, '0')}`, appId);
      docsFor(appId, request.product);
      addEvent(appId, { actor: 'client', type: 'created', to: 'draft', publicText: 'Черновик заявки создан. Данные компании подставлены из реестра.' });
      return appId;
    });
    return view(user, id);
  }

  function updateDraft(user, id, patch) {
    const app = ownedApp(user, id);
    if (app.status !== 'draft') throw conflict('Изменять можно только черновик', 'not_draft');
    if (patch.version !== undefined && Number(patch.version) !== app.version)
      throw conflict('Заявка уже изменена в другом окне. Обновите страницу.', 'version_conflict', { version: app.version });
    const next = {
      product: app.product, amount: app.amount, term: app.term, collateral: !!app.collateral,
      purpose: app.purpose, declaredRevenue: app.declared_revenue, form: parse(app.form, {}),
    };
    if (patch.request) {
      const r = patch.request;
      next.product = r.product; next.amount = r.amount; next.term = r.term; next.collateral = !!r.collateral;
    }
    if (patch.purpose !== undefined) next.purpose = patch.purpose;
    if (patch.declaredRevenue !== undefined) {
      const v = patch.declaredRevenue === null || patch.declaredRevenue === '' ? null : Math.round(Number(patch.declaredRevenue));
      if (v !== null && (!(v > 0) || v > 1_000_000_000)) throw badRequest('Выручка — положительное число в рублях', { field: 'declaredRevenue' });
      next.declaredRevenue = v;
    }
    if (patch.form) {
      const f = patch.form;
      if (typeof f.comment === 'string') next.form.comment = f.comment.slice(0, 1000);
      if (f.employees !== undefined) {
        const n = Number(f.employees);
        if (!Number.isInteger(n) || n < 0 || n > 100000) throw badRequest('Число сотрудников — целое число от 0', { field: 'employees' });
        next.form.employees = n;
      }
      if (typeof f.address === 'string') next.form.address = f.address.slice(0, 300);
      if (f.consents && typeof f.consents.personalData === 'boolean') next.form.consents = { personalData: f.consents.personalData };
    }
    tx(db, () => {
      const productChanged = next.product !== app.product;
      stmt.update.run(next.product, next.amount, next.term, next.collateral ? 1 : 0, next.purpose, next.declaredRevenue, json(next.form), nowIso(), app.id);
      if (productChanged) docsFor(app.id, next.product);
    });
    return view(user, id);
  }

  function attachDocument(user, id, kind, fileName) {
    const app = ownedApp(user, id);
    if (!['draft', 'needs_info'].includes(app.status)) throw conflict('Документы можно прикладывать к черновику или по запросу банка', 'not_editable');
    const doc = stmt.docs.all(app.id).find((d) => d.kind === kind);
    if (!doc) throw notFound('Такого документа нет в списке');
    const name = String(fileName || '').trim().slice(0, 120);
    if (!name) throw badRequest('Укажите имя файла', { field: 'fileName' });
    stmt.setDoc.run(name, nowIso(), app.id, kind);
    addEvent(app.id, { actor: 'client', type: 'document', internalText: `Документ «${doc.title}» приложен: ${name}` });
    return view(user, id);
  }

  // ---------- отправка ----------
  function checkReadiness(app) {
    const problems = [];
    const form = parse(app.form, {});
    if (!form.consents?.personalData) problems.push({ field: 'consents', message: 'Подтвердите согласие на обработку данных' });
    for (const d of stmt.docs.all(app.id)) if (d.status !== 'provided') problems.push({ field: `doc:${d.kind}`, message: `Не приложено: ${d.title}` });
    return problems;
  }

  function submit(user, id) {
    const app = ownedApp(user, id);
    if (app.status !== 'draft') {
      // Повторная отправка той же заявки не создаёт дубликат и не перезапускает проверку
      return { application: view(user, id), replayed: true };
    }
    const problems = checkReadiness(app);
    if (problems.length) throw new AppError(422, 'not_ready', 'Заявка заполнена не полностью', problems);
    tx(db, () => {
      stmt.setSubmitted.run(nowIso(), app.id);
      transition(app, 'submitted', { actor: 'client', type: 'submitted', publicText: 'Заявка отправлена в банк.' });
    });
    notifyClient(app, 'Заявка принята', `Заявка ${app.number} отправлена. Следите за статусом здесь.`);
    kick(app.id);
    return { application: view(user, id), replayed: false };
  }

  function cancel(user, id) {
    const app = ownedApp(user, id);
    if (!TRANSITIONS[app.status].includes('cancelled')) throw conflict('На этом этапе заявку отменить нельзя', 'invalid_transition');
    tx(db, () => {
      stmt.closeInfos.run(app.id);
      transition(app, 'cancelled', { actor: 'client', type: 'cancelled', publicText: 'Вы отменили заявку.' });
    });
    return view(user, id);
  }

  // ---------- ответ на запрос информации ----------
  function respondInfo(user, id, infoId, body) {
    const app = ownedApp(user, id);
    if (app.status !== 'needs_info') throw conflict('Сейчас банк ничего не запрашивает', 'not_needs_info');
    const info = stmt.infos.all(app.id).find((r) => r.id === Number(infoId));
    if (!info || info.status !== 'open') throw notFound('Запрос не найден или уже закрыт');
    let answer = String(body?.answer || '').trim().slice(0, 2000);
    if (info.kind === 'revenue') {
      const v = Math.round(Number(body?.declaredRevenue));
      if (!(v > 0) || v > 1_000_000_000) throw badRequest('Укажите среднемесячную выручку в рублях', { field: 'declaredRevenue' });
      answer = `Среднемесячная выручка со слов клиента: ${fmtRub(v)}`;
      stmt.setRevenue.run(v, app.id);
    } else if (!answer) throw badRequest('Напишите ответ', { field: 'answer' });
    tx(db, () => {
      stmt.answerInfo.run(answer, nowIso(), info.id);
      addEvent(app.id, { actor: 'client', type: 'info_answered', publicText: 'Вы ответили на запрос банка.', internalText: answer });
      if (!stmt.infos.all(app.id).some((r) => r.status === 'open')) {
        transition(app, 'enrichment', { actor: 'system', type: 'resume', publicText: 'Спасибо, данные получены. Продолжаем проверку.' });
      }
    });
    if (app.status === 'enrichment') kick(app.id);
    return view(user, id);
  }

  // ---------- принятие условий и подпись ----------
  function termsFrom(app, ctx, req) {
    const ev = evaluate(ctx, req);
    return { product: ev.request.product, amount: ev.request.amount, term: ev.request.term, rate: ev.rate.value, payment: ev.metrics.payment, overpayment: ev.metrics.overpayment };
  }

  function accept(user, id, { altId } = {}) {
    const app = ownedApp(user, id);
    expireIfNeeded(app);
    if (!['approved', 'counter_offer'].includes(app.status)) throw conflict('Сейчас нечего принимать', 'invalid_transition');
    const dec = latestDecision(app.id);
    let terms;
    if (app.status === 'approved') {
      terms = dec.payload.terms;
    } else {
      const alt = (dec.payload.alternatives || []).find((a) => a.id === altId);
      if (!alt) throw badRequest('Выберите один из предложенных вариантов', { field: 'altId' });
      const { data } = snapshotData(app.id);
      // Пересчитываем тем же движком, чтобы условия в договоре не зависели от того, что пришло с клиента
      const ctx = buildContext(data, { declaredMonthlyRevenue: app.declared_revenue });
      terms = termsFrom(app, ctx, { product: alt.product, amount: alt.amount, term: alt.term, collateral: !!app.collateral });
    }
    tx(db, () => {
      stmt.setAccepted.run(json(terms), terms.product, terms.amount, terms.term, app.id);
      transition(app, 'signing', {
        actor: 'client', type: 'accepted',
        publicText: `Вы приняли условия: ${fmtRub(terms.amount)}, ${terms.term} мес., ставка ${String(terms.rate).replace('.', ',')}%.`,
        internalText: app.status === 'counter_offer' ? 'Клиент принял встречное предложение' : 'Клиент принял одобренные условия',
      });
    });
    notifyClient(app, 'Договор готов', `Подпишите договор по заявке ${app.number}.`);
    return view(user, id);
  }

  function sign(user, id, body) {
    const app = ownedApp(user, id);
    expireIfNeeded(app);
    if (app.status !== 'signing') throw conflict('Подписывать пока нечего', 'invalid_transition');
    if (!body?.confirm) throw badRequest('Подтвердите, что ознакомились с условиями', { field: 'confirm' });
    tx(db, () => {
      transition(app, 'disbursed', {
        actor: 'client', type: 'signed',
        publicText: 'Договор подписан. Деньги зачислены на расчётный счёт (имитация).',
        internalText: 'Подпись и выдача смоделированы',
      });
    });
    notifyClient(app, 'Деньги на счёте', `По заявке ${app.number} средства зачислены (имитация).`);
    return view(user, id);
  }

  function declineOffer(user, id) { return cancel(user, id); }

  // ---------- срок действия предложения ----------
  function expiresAtOf(app) {
    if (!['approved', 'counter_offer', 'signing'].includes(app.status)) return null;
    const d = latestDecision(app.id);
    return d?.payload?.expiresAt || null;
  }
  function expireIfNeeded(app) {
    const exp = expiresAtOf(app);
    if (exp && new Date(exp) < new Date()) {
      transition(app, 'expired', { actor: 'system', type: 'expired', publicText: 'Срок действия предложения истёк.' });
      notifyClient(app, 'Предложение истекло', `Срок предложения по заявке ${app.number} закончился.`);
      return true;
    }
    return false;
  }
  function sweepExpired() {
    let n = 0;
    for (const { id } of stmt.expirable.all()) if (expireIfNeeded(stmt.byId.get(id))) n++;
    return n;
  }

  // ---------- конвейер ----------
  function kick(id) {
    if (running.has(id)) return;
    running.add(id);
    runPipeline(id).catch((e) => console.error('[pipeline]', id, e)).finally(() => running.delete(id));
  }

  async function runPipeline(id) {
    for (let guard = 0; guard < 10; guard++) {
      const app = stmt.byId.get(id);
      if (!IN_PIPELINE.has(app.status)) return;
      await sleep(config.stageDelayMs);
      if (app.status === 'submitted') {
        transition(app, 'checking', { actor: 'system', type: 'stage', publicText: 'Проверяем документы и согласия.' });
      } else if (app.status === 'checking') {
        const problems = checkReadiness(app);
        addEvent(app.id, { actor: 'system', type: 'check', internalText: problems.length ? `Замечания: ${problems.map((p) => p.message).join('; ')}` : 'Комплект документов полный, согласия получены' });
        transition(app, 'enrichment', { actor: 'system', type: 'stage', publicText: 'Сверяем сведения о компании и кредитную историю.' });
      } else if (app.status === 'enrichment') {
        await stageEnrichment(app);
      } else if (app.status === 'scoring') {
        stageScoring(app);
      }
    }
  }

  async function stageEnrichment(app) {
    try {
      const r = await enrichment.loadAll(app.inn, app.id);
      const line = Object.entries(r.meta).map(([s, m]) => `${SOURCE_TITLES[s]}: ${m.notFound ? 'данных нет' : m.ok ? (m.fromCache ? 'из кэша (источник недоступен)' : 'получено') : 'недоступно'}`).join('; ');
      addEvent(app.id, { actor: 'system', type: 'enrichment', internalText: line, payload: { degraded: r.degraded } });
      transition(app, 'scoring', { actor: 'system', type: 'stage', publicText: 'Данные получены. Оцениваем заявку.' });
    } catch (e) {
      const reason = e instanceof AppError ? e.message : 'Источники данных недоступны';
      addEvent(app.id, { actor: 'system', type: 'enrichment_failed', internalText: reason });
      stmt.insDecision.run(app.id, 'pending', 'manual', null, ENGINE_VERSION, 'system', 0,
        json({ manualReasons: [`Не удалось получить данные: ${reason}. Повторите проверку позже.`], noData: true }), null, nowIso());
      transition(app, 'manual_review', { actor: 'system', type: 'stage', publicText: 'Проверка займёт чуть больше времени. Специалист банка посмотрит заявку.', internalText: reason });
    }
  }

  function stageScoring(app) {
    const { data, meta } = snapshotData(app.id);
    const ctx = buildContext(data, { declaredMonthlyRevenue: app.declared_revenue });
    const req = { product: app.product, amount: app.amount, term: app.term, collateral: !!app.collateral };
    const d = decide(ctx, req, policy);
    const degraded = Object.values(meta).some((m) => m?.degraded);
    const manualReasons = [...d.manualReasons];
    if (degraded && d.outcome !== 'need_info') manualReasons.push('Часть данных взята из кэша: источник был недоступен. Решение подтверждает сотрудник банка.');
    const manual = d.routing === 'manual' || (degraded && d.outcome !== 'need_info');
    const expiresAt = new Date(Date.now() + OFFER_TTL_DAYS * 86400000).toISOString();
    const clientView = clientDecision(d);
    const payload = {
      outcome: d.outcome, terms: d.terms || null, alternatives: d.alternatives, hardStop: !!d.hardStop,
      explain: d.explain, missing: d.missing || [], manualReasons, recommendation: d.recommendation || d.outcome,
      evaluation: slimEvaluation(d.evaluation), policy: d.policy, sourcesMeta: meta, degraded, expiresAt, clientView,
    };
    const finalNow = !manual;
    stmt.insDecision.run(app.id, d.outcome, manual ? 'manual' : 'auto', d.score, ENGINE_VERSION, finalNow ? 'engine' : 'engine (рекомендация)', finalNow ? 1 : 0, json(payload), null, nowIso());
    const audit = `Оценка ${d.score} при пороге ${d.threshold}; исход: ${d.outcome}; ${manual ? 'на ручную проверку' : 'автоматически'}`;
    if (manual) {
      transition(app, 'manual_review', { actor: 'system', type: 'scored', publicText: STATUS_VIEW.manual_review.text, internalText: `${audit}. Причины: ${manualReasons.join(' ')}` });
      notifyClient(app, 'Заявку проверяет специалист', `Заявка ${app.number} передана аналитику банка.`);
      return;
    }
    applyOutcome(app, d.outcome, { actor: 'engine', clientView, missing: d.missing, internalText: audit });
  }

  function applyOutcome(app, outcome, { actor, clientView, missing, internalText, question }) {
    stmt.setDecided.run(nowIso(), app.id);
    if (outcome === 'approve') {
      transition(app, 'approved', { actor, type: 'decision', publicText: 'Заявка одобрена. Проверьте условия и примите предложение.', internalText });
      notifyClient(app, 'Заявка одобрена', `По заявке ${app.number} есть решение: одобрено.`);
    } else if (outcome === 'counter_offer') {
      transition(app, 'counter_offer', { actor, type: 'decision', publicText: 'На запрошенных условиях одобрить не можем. Подобрали другие варианты.', internalText });
      notifyClient(app, 'Есть другое предложение', `По заявке ${app.number} подобраны альтернативные условия.`);
    } else if (outcome === 'decline') {
      transition(app, 'declined', { actor, type: 'decision', publicText: 'Одобрить заявку сейчас не можем. Причины и план действий — ниже.', internalText });
      notifyClient(app, 'Решение по заявке', `По заявке ${app.number} отказ. Причины — в карточке заявки.`);
    } else if (outcome === 'need_info') {
      const items = question ? [{ kind: 'text', question }] : (missing || []).map((m) => ({ kind: m.id === 'monthly_revenue' ? 'revenue' : 'text', question: `${m.label}. ${m.reason || ''}`.trim() }));
      for (const it of items) stmt.insInfo.run(app.id, it.kind, it.question, 'open', actor, nowIso());
      transition(app, 'needs_info', { actor, type: 'decision', publicText: 'Нам нужна дополнительная информация. Ответьте в карточке заявки.', internalText });
      notifyClient(app, 'Нужна информация', `По заявке ${app.number} банк задал вопрос.`);
    }
  }

  // Клиенту отдаём факторы и направление влияния, но не баллы, веса и пороги.
  function clientDecision(d) {
    return {
      outcome: d.outcome,
      chance: d.chance, chanceLabel: CHANCE_LABEL[d.chance] || null,
      terms: d.terms || null,
      alternatives: (d.alternatives || []).map(({ id, product, amount, term, rate, payment, load, rationale }) => ({ id, product, amount, term, rate, payment, load, rationale })),
      reasons: d.explain.reasons.slice(0, 5).map(({ title, message, direction }) => ({ title, message, direction })),
      strengths: d.explain.strengths.map(({ title, message, direction }) => ({ title, message, direction })),
      plan: d.explain.plan,
    };
  }
  function slimEvaluation(ev) {
    return {
      score: ev.score, threshold: ev.threshold, margin: ev.margin, chance: ev.chance, request: ev.request,
      rate: ev.rate, metrics: ev.metrics, factors: ev.factors, hardStops: ev.hardStops, violations: ev.violations, missing: ev.missing,
    };
  }

  // ---------- кабинет аналитика ----------
  function analystAct(analyst, id, body) {
    const app = row(Number(id));
    if (app.status !== 'manual_review') throw conflict('Заявка не на ручной проверке', 'not_in_review');
    const dec = latestDecision(app.id);
    const action = body?.action;
    const comment = String(body?.comment || '').trim().slice(0, 1000);
    const who = `analyst:${analyst.login}`;
    const p = dec?.payload || {};
    if (action === 'rerun') {
      tx(db, () => transition(app, 'enrichment', { actor: who, type: 'rerun', publicText: 'Повторяем проверку данных.', internalText: comment || 'Повторный запуск проверки' }));
      kick(app.id);
      return analystView(app.id);
    }
    if (p.noData && action !== 'decline' && action !== 'request_info') throw conflict('Данных нет: сначала повторите проверку', 'no_data');
    if (['approve', 'decline', 'counter_offer'].includes(action) && comment.length < 10) throw badRequest('Добавьте комментарий к решению (не короче 10 символов)', { field: 'comment' });
    const ev = p.evaluation;
    let outcome = action, override = false, alternatives = p.alternatives || [];
    if (action === 'approve') {
      if (p.hardStop || ev?.hardStops?.length) throw conflict('Есть жёсткий стоп-фактор: одобрить нельзя', 'hard_stop');
      override = !ev?.margin || ev.margin < 0;
      const { data } = snapshotData(app.id);
      const ctx = buildContext(data, { declaredMonthlyRevenue: app.declared_revenue });
      const terms = termsFrom(app, ctx, { product: app.product, amount: app.amount, term: app.term, collateral: !!app.collateral });
      p.terms = terms;
    } else if (action === 'counter_offer') {
      if (!alternatives.length) {
        const { data } = snapshotData(app.id);
        const ctx = buildContext(data, { declaredMonthlyRevenue: app.declared_revenue });
        alternatives = findAlternatives(ctx, { product: app.product, amount: app.amount, term: app.term, collateral: !!app.collateral });
      }
      if (body.altId) alternatives = alternatives.filter((a) => a.id === body.altId);
      if (!alternatives.length) throw conflict('Нет вариантов, которые проходят по условиям', 'no_alternatives');
    } else if (action === 'request_info') {
      if (comment.length < 5) throw badRequest('Сформулируйте вопрос клиенту', { field: 'comment' });
      outcome = 'need_info';
    } else if (action !== 'decline') throw badRequest('Неизвестное действие', { field: 'action' });

    const expiresAt = new Date(Date.now() + OFFER_TTL_DAYS * 86400000).toISOString();
    const clientView = {
      ...(p.clientView || {}), outcome: outcome === 'need_info' ? 'need_info' : outcome === 'approve' ? 'approve' : outcome,
      terms: action === 'approve' ? p.terms : null,
      alternatives: action === 'counter_offer' ? alternatives.map(({ id, product, amount, term, rate, payment, load, rationale }) => ({ id, product, amount, term, rate, payment, load, rationale })) : [],
    };
    if (action === 'decline' && !clientView.plan?.length && p.explain) { clientView.reasons = clientView.reasons || []; }
    const payload = { ...p, outcome, terms: p.terms || null, alternatives, expiresAt, clientView, analyst: { by: analyst.login, action, comment, override } };
    tx(db, () => {
      stmt.insDecision.run(app.id, outcome, 'manual', ev?.score ?? null, ENGINE_VERSION, who, 1, json(payload), comment, nowIso());
      applyOutcome(app, outcome, { actor: who, clientView, internalText: `${override ? 'Исключение из политики. ' : ''}${comment}`, question: action === 'request_info' ? comment : undefined });
    });
    return analystView(app.id);
  }

  function recover() {
    for (const { id } of stmt.pipelineApps.all()) kick(id);
  }

  // ---------- представления ----------
  function publicTimeline(appId) {
    return stmt.events.all(appId).filter((e) => e.public_text).map((e) => ({ ts: e.ts, text: e.public_text, status: e.to_status }));
  }

  function view(user, id) {
    const app = ownedApp(user, id);
    expireIfNeeded(app);
    return clientView(app);
  }

  function clientView(app) {
    const sv = STATUS_VIEW[app.status];
    const dec = latestDecision(app.id);
    const showDecision = dec && dec.final && ['approved', 'counter_offer', 'declined', 'signing', 'disbursed', 'expired', 'cancelled'].includes(app.status);
    const infos = stmt.infos.all(app.id).map((r) => ({ id: r.id, kind: r.kind, question: r.question, status: r.status, answer: r.answer, createdAt: r.created_at }));
    return {
      id: app.id, number: app.number, inn: app.inn, status: app.status,
      statusTitle: sv.title, statusText: sv.text, nextStep: sv.next, tone: sv.tone, stage: sv.stage, stages: STAGES,
      request: { product: app.product, productName: PRODUCTS[app.product].name, amount: app.amount, term: app.term, collateral: !!app.collateral },
      purpose: app.purpose, declaredRevenue: app.declared_revenue, form: parse(app.form, {}), version: app.version,
      createdAt: app.created_at, updatedAt: app.updated_at, submittedAt: app.submitted_at,
      documents: stmt.docs.all(app.id),
      readiness: app.status === 'draft' ? checkReadiness(app) : [],
      infoRequests: infos, openInfo: infos.filter((r) => r.status === 'open'),
      decision: showDecision ? { ...dec.payload.clientView, expiresAt: ['approved', 'counter_offer', 'signing'].includes(app.status) ? dec.payload.expiresAt : null, decidedAt: dec.created_at } : null,
      acceptedTerms: parse(app.accepted_terms),
      timeline: publicTimeline(app.id),
    };
  }

  function listFor(user) {
    return stmt.list.all(user.id).map((a) => {
      expireIfNeeded(a);
      const sv = STATUS_VIEW[a.status];
      return { id: a.id, number: a.number, inn: a.inn, status: a.status, statusTitle: sv.title, tone: sv.tone, stage: sv.stage,
        product: a.product, productName: PRODUCTS[a.product].name, amount: a.amount, term: a.term, updatedAt: a.updated_at };
    });
  }

  function queueRow(a) {
    const d = latestDecision(a.id);
    return {
      id: a.id, number: a.number, client: a.client, inn: a.inn, status: a.status, statusTitle: STATUS_VIEW[a.status].title,
      productName: PRODUCTS[a.product].name, amount: a.amount, term: a.term, submittedAt: a.submitted_at, updatedAt: a.updated_at,
      recommendation: d?.payload?.recommendation || null, score: d?.score ?? null, threshold: d?.payload?.evaluation?.threshold ?? null,
      reasons: d?.payload?.manualReasons || [], degraded: !!d?.payload?.degraded,
    };
  }
  const analystQueue = () => ({ queue: stmt.queue.all().map(queueRow), recent: stmt.recent.all().map(queueRow) });

  function analystView(id) {
    const app = row(Number(id));
    const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(app.user_id);
    const { data, meta } = snapshotData(app.id);
    const decisions = stmt.decisions.all(app.id).map((d) => ({ id: d.id, outcome: d.outcome, routing: d.routing, score: d.score, madeBy: d.made_by, final: !!d.final, comment: d.comment, createdAt: d.created_at, engineVersion: d.engine_version }));
    const dec = latestDecision(app.id);
    const ctx = data.fns ? buildContext(data, { declaredMonthlyRevenue: app.declared_revenue }) : null;
    return {
      application: { ...clientView(app), client: user.display_name },
      company: data.fns ? { ...data.fns } : null,
      context: ctx && { turnover: ctx.turnover, turnoverSource: ctx.turnoverSource, ageMonths: ctx.ageMonths, existingMonthly: ctx.bki.existingMonthly, bkiRating: ctx.bki.rating, cv: ctx.turnoverCv },
      sources: meta,
      credit: data.bki, statement: data.statement && { months: data.statement.months?.slice(-12) },
      decision: dec && { ...dec.payload, clientView: undefined, sourcesMeta: undefined },
      decisions,
      infoRequests: stmt.infos.all(app.id),
      audit: stmt.events.all(app.id).map((e) => ({ ts: e.ts, actor: e.actor, type: e.type, from: e.from_status, to: e.to_status, publicText: e.public_text, internalText: e.internal_text })),
      canAct: app.status === 'manual_review',
    };
  }

  return {
    createDraft, updateDraft, attachDocument, submit, cancel, respondInfo, accept, sign, declineOffer,
    view, listFor, analystQueue, analystView, analystAct, recover, sweepExpired, kick,
    isRunning: (id) => running.size > 0 && running.has(id),
    idle: async () => { while (running.size) await sleep(10); },
    ownedApp, _snapshotData: snapshotData,
  };
}
