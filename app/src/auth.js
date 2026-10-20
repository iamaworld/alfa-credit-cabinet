import crypto from 'node:crypto';
import { unauthorized, forbidden, badRequest, AppError } from './util/errors.js';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

const b64 = (b) => Buffer.from(b).toString('base64url');

export function signToken(payload, secret, ttlSec = 8 * 3600) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec }));
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export const COOKIE = 'cabinet_session';

export function setSession(res, token, secure) {
  res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${8 * 3600}${secure ? '; Secure' : ''}`);
}
export function clearSession(res) {
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** Определяет пользователя по cookie или заголовку Authorization: Bearer (для коллекции запросов). */
export function authMiddleware(db, secret) {
  const getUser = db.prepare('SELECT id, login, role, display_name FROM users WHERE id = ?');
  return (req, _res, next) => {
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const p = verifyToken(readCookie(req, COOKIE) || bearer, secret);
    if (p) {
      const u = getUser.get(p.uid);
      if (u) req.user = { id: u.id, login: u.login, role: u.role, name: u.display_name };
    }
    next();
  };
}

export const requireAuth = (req, _res, next) => (req.user ? next() : next(unauthorized()));
export const requireRole = (role) => (req, _res, next) => {
  if (!req.user) return next(unauthorized());
  return req.user.role === role ? next() : next(forbidden('Раздел недоступен для вашей роли'));
};

// CSRF для cookie-сессий: изменяющие запросы должны идти с того же origin (или без Origin, например из curl с Bearer)
export function sameOriginGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return next(new AppError(403, 'csrf', 'Запрос с другого источника отклонён')); }
    catch { return next(badRequest('Некорректный Origin')); }
  }
  next();
}

// Простейший ограничитель попыток входа: 8 неудач за 10 минут на пару «логин + IP»
export function loginLimiter() {
  const hits = new Map();
  const WINDOW = 10 * 60 * 1000, MAX = 8;
  return {
    check(key) {
      const now = Date.now();
      const arr = (hits.get(key) || []).filter((t) => now - t < WINDOW);
      hits.set(key, arr);
      if (arr.length >= MAX) throw new AppError(429, 'too_many_attempts', 'Слишком много попыток входа. Подождите несколько минут.');
    },
    fail(key) { hits.set(key, [...(hits.get(key) || []), Date.now()]); },
    reset(key) { hits.delete(key); },
  };
}
