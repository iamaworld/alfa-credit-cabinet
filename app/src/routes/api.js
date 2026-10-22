import express from 'express';
import { nowIso, json } from '../db.js';
import { requireAuth, requireRole, verifyPassword, signToken, setSession, clearSession, loginLimiter } from '../auth.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../util/errors.js';
import { parseInn, parseRequest } from '../util/validate.js';
import { PRODUCTS, PURPOSES, ENGINE_VERSION } from '../engine/products.js';
import { preview, preapprovedOffers, productFit, OFFER_VALID_DAYS } from '../engine/offer.js';
import { buildFeed } from '../services/feed.js';
import { forecastCashflow, simulateAutopilot, suggestAutopilot } from '../engine/cashflow.js';
import { evaluate } from '../engine/scoring.js';
import { briefFor } from '../services/brief.js';
import { DEFAULT_POLICY, decide } from '../engine/decision.js';
import { idempotent } from '../util/idempotency.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../seed.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApi({ db, config, apps, contexts, notifications, enrichment, llm, intent }) {
  const r = express.Router();
  const limiter = loginLimiter();
  const userByLogin = db.prepare('SELECT * FROM users WHERE login = ?');
  const linked = db.prepare('SELECT inn FROM user_companies WHERE user_id = ? ORDER BY added_at');
  const link = db.prepare('INSERT OR IGNORE INTO user_companies (user_id, inn, added_at) VALUES (?,?,?)');
  const isLinked = db.prepare('SELECT 1 FROM user_companies WHERE user_id = ? AND inn = ?');
  const offersFor = db.prepare('SELECT * FROM offers WHERE user_id = ? AND inn = ? AND expires_at > ? AND engine_version = ? ORDER BY id DESC');
  const insOffer = db.prepare('INSERT INTO offers (user_id, inn, product, amount, term, payload, created_at, expires_at, engine_version) VALUES (?,?,?,?,?,?,?,?,?)');

  const needInn = (req) => {
    const inn = parseInn(req.params.inn);
    if (!isLinked.get(req.user.id, inn)) throw forbidden('Компания не подключена к вашему кабинету');
    return inn;
  };

  // ----- вход -----
  r.get('/demo/accounts', (_req, res) => {
    if (!config.seed) return res.json({ enabled: false, accounts: [] });
    res.json({ enabled: true, password: DEMO_PASSWORD, accounts: DEMO_ACCOUNTS });
  });

  r.post('/auth/login', wrap(async (req, res) => {
    const login = String(req.body?.login || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const key = `${login}|${req.ip}`;
    limiter.check(key);
    const u = userByLogin.get(login);
    if (!u || !verifyPassword(password, u.password_hash)) {
      limiter.fail(key);
      throw new AppError(401, 'bad_credentials', 'Неверный логин или пароль');
    }
    limiter.reset(key);
    const token = signToken({ uid: u.id, role: u.role }, config.secret);
    setSession(res, token, config.secureCookies);
    res.json({ user: { id: u.id, login: u.login, role: u.role, name: u.display_name }, token });
  }));

  r.post('/auth/logout', (_req, res) => { clearSession(res); res.json({ ok: true }); });
  r.get('/auth/me', (req, res) => {
    if (!req.user) return res.json({ user: null, companies: [] });
    res.json({ user: req.user, companies: linked.all(req.user.id).map((x) => x.inn) });
  });

  // ----- справочник -----
  r.get('/products', (_req, res) => {
    res.json({ engineVersion: ENGINE_VERSION, autoDecisionLimit: DEFAULT_POLICY.autoDecisionLimit, purposes: PURPOSES, products: Object.values(PRODUCTS).map(({ id, name, short, description, min, max, minTerm, maxTerm, defaultTerm, securedByPurchase, documents }) => ({ id, name, short, description, min, max, minTerm, maxTerm, defaultTerm, securedByPurchase, documents })) });
  });

  // ----- компании -----
  r.use(requireAuth);
  const profile = (fns) => ({ inn: fns.inn, name: fns.name, shortName: fns.shortName, legalForm: fns.legalForm, status: fns.status, okved: fns.okved, region: fns.region, address: fns.address, director: fns.director?.fio, employees: fns.employees, taxRegime: fns.taxRegime, registrationDate: fns.registrationDate });

  r.post('/companies', requireRole('client'), wrap(async (req, res) => {
    const inn = parseInn(req.body?.inn);
    const { data } = await contexts.get(inn);
    link.run(req.user.id, inn, nowIso());
    res.status(201).json({ company: profile(data.fns) });
  }));

  r.get('/companies', requireRole('client'), wrap(async (req, res) => {
    const out = [];
    for (const { inn } of linked.all(req.user.id)) {
      try { out.push(profile((await contexts.get(inn)).data.fns)); } catch { out.push({ inn, unavailable: true }); }
    }
    res.json({ companies: out });
  }));

  r.get('/companies/:inn', requireRole('client'), wrap(async (req, res) => {
    const inn = needInn(req);
    const { data, meta, ctx, degraded } = await contexts.get(inn);
    res.json({
      company: profile(data.fns), degraded,
      sources: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, { ok: v.ok, degraded: v.degraded, fromCache: v.fromCache, empty: v.notFound, fetchedAt: v.fetchedAt }])),
      summary: { turnover: ctx.turnover, turnoverSource: ctx.turnoverSource, statementMonths: ctx.statementMonths, ageMonths: ctx.ageMonths, bkiRating: ctx.bki.rating, hasCurrentOverdue: ctx.bki.currentOverdue.length > 0 },
    });
  }));

  r.get('/companies/:inn/offers', requireRole('client'), wrap(async (req, res) => {
    const inn = needInn(req);
    const { ctx, degraded } = await contexts.get(inn);
    const now = new Date();
    let rows = offersFor.all(req.user.id, inn, now.toISOString(), ENGINE_VERSION);
    if (!rows.length) {
      const offers = preapprovedOffers(ctx, now);
      for (const o of offers) {
        if (!o.available) continue;
        insOffer.run(req.user.id, inn, o.product, o.amount, o.term, json(o), now.toISOString(), o.expiresAt, ENGINE_VERSION);
      }
      rows = offersFor.all(req.user.id, inn, now.toISOString(), ENGINE_VERSION);
      if (!rows.length) return res.json({ offers: offers.filter((o) => !o.available), degraded, validDays: OFFER_VALID_DAYS });
    }
    const have = new Map(rows.map((x) => [x.product, JSON.parse(x.payload)]));
    const offers = Object.keys(PRODUCTS).map((id) => have.get(id) || { product: id, available: false });
    res.json({ offers, degraded, validDays: OFFER_VALID_DAYS, turnoverKnown: ctx.turnover != null });
  }));

  r.get('/companies/:inn/feed', requireRole('client'), wrap(async (req, res) => {
    const inn = needInn(req);
    const { ctx, data } = await contexts.get(inn);
    const list = apps.listFor(req.user).filter((a) => a.inn === inn).map((a) => ({ ...a }));
    const ap = await autopilotView(req.user, inn);
    res.json(buildFeed({ ctx, fns: data.fns, applications: list, cashflow: forecastCashflow({ statement: data.statement?.months }), inn, autopilot: ap.available ? ap : null }));
  }));

  // ----- автопилот денег: копилка под крупный платёж и автозащита от разрыва -----
  const apGet = db.prepare('SELECT reserve_share AS reserveShare, protection_limit AS protectionLimit, protection_rate AS rate, updated_at AS updatedAt FROM autopilot WHERE user_id = ? AND inn = ?');
  const apPut = db.prepare(`INSERT INTO autopilot (user_id, inn, reserve_share, protection_limit, protection_rate, updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(user_id, inn) DO UPDATE SET reserve_share = excluded.reserve_share, protection_limit = excluded.protection_limit, protection_rate = excluded.protection_rate, updated_at = excluded.updated_at`);
  async function autopilotView(user, inn) {
    const { data } = await contexts.get(inn);
    const cf = forecastCashflow({ statement: data.statement?.months });
    if (!cf) return { available: false, reason: data.statement ? 'short_history' : 'no_statement' };
    const settings = apGet.get(user.id, inn) || { reserveShare: 0, protectionLimit: 0, rate: null };
    const maxReserveShare = Math.min(0.2, Math.ceil(Math.max(0, ...cf.forecast.map((f) => (f.owner || 0) / f.inflow)) * 100) / 100);
    const sim = simulateAutopilot(cf, { reserveShare: settings.reserveShare, protectionLimit: settings.protectionLimit, rate: settings.rate || 0 });
    const forecast = cf.forecast.map((f, i) => ({ ...f, balanceWithLoan: sim.months[i].balanceAuto, reserve: sim.months[i].reserve, protection: sim.months[i].protection }));
    return { available: true, settings, maxReserveShare, suggestion: suggestAutopilot(cf), result: sim, cashflow: { ...cf, forecast }, firstGap: cf.gaps[0]?.month || null };
  }
  r.get('/companies/:inn/autopilot', requireRole('client'), wrap(async (req, res) => res.json(await autopilotView(req.user, needInn(req)))));
  r.put('/companies/:inn/autopilot', requireRole('client'), wrap(async (req, res) => {
    const inn = needInn(req);
    const view = await autopilotView(req.user, inn);
    if (!view.available) throw badRequest('Автопилоту нужна выписка по счёту');
    const share = Math.round(Number(req.body?.reserveShare ?? 0) * 100) / 100;
    if (!(share >= 0 && share <= view.maxReserveShare)) throw badRequest(`Откладывать можно от 0 до ${Math.round(view.maxReserveShare * 100)} % — не больше, чем сейчас выводится из бизнеса`, { field: 'reserveShare' });
    const limit = Math.round(Number(req.body?.protectionLimit ?? 0) / 10_000) * 10_000;
    let rate = null;
    if (limit) {
      if (limit < PRODUCTS.overdraft.min || limit > PRODUCTS.overdraft.max) throw badRequest(`Лимит защиты — от ${PRODUCTS.overdraft.min.toLocaleString('ru-RU')} до ${PRODUCTS.overdraft.max.toLocaleString('ru-RU')} ₽`, { field: 'protectionLimit' });
      // Защита — это настоящий лимит: его одобряет тот же движок и та же политика, что и заявку
      const { ctx } = await contexts.get(inn);
      const d = decide(ctx, { product: 'overdraft', amount: limit, term: 12, collateral: false });
      if (d.outcome !== 'approve' || d.routing !== 'auto') {
        const why = d.explain?.reasons?.[0]?.message || 'лимит такого размера сейчас не одобряется автоматически';
        throw new AppError(422, 'protection_declined', `Банк не может включить защиту на ${limit.toLocaleString('ru-RU')} ₽: ${why.charAt(0).toLowerCase()}${why.slice(1)}`, { field: 'protectionLimit' });
      }
      rate = evaluate(ctx, { product: 'overdraft', amount: limit, term: 12, collateral: false }).rate.value;
    }
    apPut.run(req.user.id, inn, share, limit, rate, nowIso());
    res.json(await autopilotView(req.user, inn));
  }));

  // ----- денежный календарь: прогноз остатка на 12 месяцев по выписке -----
  r.get('/companies/:inn/cashflow', requireRole('client'), wrap(async (req, res) => {
    const inn = needInn(req);
    const { data } = await contexts.get(inn);
    const cf = forecastCashflow({ statement: data.statement?.months });
    res.json(cf ? { available: true, ...cf } : { available: false, reason: data.statement ? 'short_history' : 'no_statement' });
  }));

  // ----- ИИ-помощник: задача своими словами → параметры заявки -----
  r.get('/assistant/status', requireRole('client'), wrap(async (_req, res) => {
    const s = await llm.status();
    if (s.ready) intent.warmup(); // клиент открыл главную — пока он печатает, модель прогревается
    res.json(s);
  }));
  r.post('/assistant/parse', requireRole('client'), wrap(async (req, res) => {
    const text = String(req.body?.text || '');
    if (text.length > 600) throw badRequest('Опишите задачу короче — до 600 символов', { field: 'text' });
    res.json(await intent.parse(text));
  }));

  // ----- редактор оффера -----
  r.post('/offers/preview', requireRole('client'), wrap(async (req, res) => {
    const inn = parseInn(req.body?.inn);
    if (!isLinked.get(req.user.id, inn)) throw forbidden('Компания не подключена к вашему кабинету');
    const request = parseRequest(req.body.request);
    const declared = req.body.declaredRevenue ? Math.round(Number(req.body.declaredRevenue)) : null;
    if (declared !== null && !(declared > 0)) throw badRequest('Выручка — положительное число', { field: 'declaredRevenue' });
    const compareTo = req.body.compareTo ? parseRequest(req.body.compareTo) : null;
    const { ctx, data, degraded } = await contexts.get(inn, { declaredMonthlyRevenue: declared });
    const { result } = preview(ctx, request, compareTo);
    // Как платёж ляжет на деньги бизнеса: тот же прогноз остатка, но с поступлением кредита и платежами
    const cashflow = forecastCashflow({ statement: data.statement?.months, loan: { amount: request.amount, payment: result.payment, term: request.term, purchase: PRODUCTS[request.product].securedByPurchase, revolving: request.product === 'overdraft', rate: result.rate?.to } });
    res.json({ ...result, degraded, fit: req.body.purpose ? productFit(ctx, req.body.purpose) : undefined, cashflow });
  }));

  // ----- заявки (клиент) -----
  const client = requireRole('client');
  r.get('/applications', client, (req, res) => res.json({ applications: apps.listFor(req.user) }));
  r.post('/applications', client, wrap(async (req, res) => {
    const inn = parseInn(req.body?.inn);
    const request = parseRequest(req.body.request);
    const purpose = PURPOSES[req.body.purpose] ? req.body.purpose : null;
    res.status(201).json({ application: await apps.createDraft(req.user, { inn, request, purpose }) });
  }));
  r.get('/applications/:id', client, (req, res) => res.json({ application: apps.view(req.user, req.params.id) }));
  r.patch('/applications/:id', client, (req, res) => {
    const b = req.body || {};
    const patch = { version: b.version, purpose: b.purpose, declaredRevenue: b.declaredRevenue, form: b.form };
    if (b.request) patch.request = parseRequest(b.request);
    res.json({ application: apps.updateDraft(req.user, req.params.id, patch) });
  });
  r.put('/applications/:id/documents/:kind', client, (req, res) => res.json({ application: apps.attachDocument(req.user, req.params.id, req.params.kind, req.body?.fileName) }));
  r.post('/applications/:id/submit', client, idempotent(db, 'submit', (req, res) => {
    const out = apps.submit(req.user, req.params.id);
    res.status(out.replayed ? 200 : 202).json({ application: out.application, replayed: out.replayed });
  }));
  r.post('/applications/:id/cancel', client, (req, res) => res.json({ application: apps.cancel(req.user, req.params.id) }));
  r.post('/applications/:id/info/:infoId/answer', client, (req, res) => res.json({ application: apps.respondInfo(req.user, req.params.id, req.params.infoId, req.body) }));
  r.post('/applications/:id/accept', client, idempotent(db, 'accept', (req, res) => res.json({ application: apps.accept(req.user, req.params.id, req.body) })));
  r.post('/applications/:id/sign', client, idempotent(db, 'sign', (req, res) => res.json({ application: apps.sign(req.user, req.params.id, req.body) })));

  // ----- уведомления внутри кабинета -----
  r.get('/notifications', (req, res) => res.json(notifications.list(req.user.id)));
  r.post('/notifications/read', (req, res) => { notifications.readAll(req.user.id); res.json({ ok: true }); });

  // ----- аналитик -----
  const analyst = requireRole('analyst');
  r.get('/analyst/queue', analyst, (_req, res) => res.json(apps.analystQueue()));
  r.get('/analyst/applications/:id', analyst, (req, res) => res.json(apps.analystView(Number(req.params.id))));
  // Справка: факты с источниками, вывод, на что смотреть и вопросы клиенту
  r.get('/analyst/applications/:id/brief', analyst, (req, res) => res.json(briefFor(apps.analystView(Number(req.params.id)))));
  r.post('/analyst/applications/:id/decision', analyst, (req, res) => res.json(apps.analystAct(req.user, req.params.id, req.body)));

  r.use((_req, _res, next) => next(notFound('Метод не найден')));
  return r;
}
