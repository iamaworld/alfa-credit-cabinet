import express from 'express';
import { nowIso, json } from '../db.js';
import { requireAuth, requireRole, verifyPassword, signToken, setSession, clearSession, loginLimiter } from '../auth.js';
import { AppError, badRequest, forbidden, notFound, unauthorized } from '../util/errors.js';
import { parseInn, parseRequest } from '../util/validate.js';
import { PRODUCTS, PURPOSES, ENGINE_VERSION } from '../engine/products.js';
import { preview, preapprovedOffers, productFit, OFFER_VALID_DAYS } from '../engine/offer.js';
import { buildFeed } from '../services/feed.js';
import { idempotent } from '../util/idempotency.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD } from '../seed.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function createApi({ db, config, apps, contexts, notifications, enrichment }) {
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
    res.json({ engineVersion: ENGINE_VERSION, purposes: PURPOSES, products: Object.values(PRODUCTS).map(({ id, name, short, description, min, max, minTerm, maxTerm, defaultTerm, securedByPurchase, documents }) => ({ id, name, short, description, min, max, minTerm, maxTerm, defaultTerm, securedByPurchase, documents })) });
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
    res.json(buildFeed({ ctx, fns: data.fns, applications: list }));
  }));

  // ----- редактор оффера -----
  r.post('/offers/preview', requireRole('client'), wrap(async (req, res) => {
    const inn = parseInn(req.body?.inn);
    if (!isLinked.get(req.user.id, inn)) throw forbidden('Компания не подключена к вашему кабинету');
    const request = parseRequest(req.body.request);
    const declared = req.body.declaredRevenue ? Math.round(Number(req.body.declaredRevenue)) : null;
    if (declared !== null && !(declared > 0)) throw badRequest('Выручка — положительное число', { field: 'declaredRevenue' });
    const compareTo = req.body.compareTo ? parseRequest(req.body.compareTo) : null;
    const { ctx, degraded } = await contexts.get(inn, { declaredMonthlyRevenue: declared });
    const { result } = preview(ctx, request, compareTo);
    res.json({ ...result, degraded, fit: req.body.purpose ? productFit(ctx, req.body.purpose) : undefined });
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
  r.post('/analyst/applications/:id/decision', analyst, (req, res) => res.json(apps.analystAct(req.user, req.params.id, req.body)));

  r.use((_req, _res, next) => next(notFound('Метод не найден')));
  return r;
}
