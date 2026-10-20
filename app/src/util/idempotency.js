import crypto from 'node:crypto';
import { nowIso } from '../db.js';
import { AppError } from './errors.js';

// Обёртка для изменяющих запросов: тот же Idempotency-Key возвращает сохранённый ответ,
// тот же ключ с другим телом отклоняется.
export function idempotent(db, scope, handler) {
  const get = db.prepare('SELECT request_hash, response, status FROM idempotency WHERE key = ? AND user_id = ? AND scope = ?');
  const put = db.prepare('INSERT OR IGNORE INTO idempotency (key, user_id, scope, request_hash, response, status, created_at) VALUES (?,?,?,?,?,?,?)');
  return async (req, res, next) => {
    try {
      const key = req.get('Idempotency-Key');
      if (!key) return await handler(req, res, next);
      if (key.length > 120) throw new AppError(400, 'bad_key', 'Idempotency-Key слишком длинный');
      const scopeKey = `${scope}:${req.params.id || ''}`;
      const hash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
      const prev = get.get(key, req.user.id, scopeKey);
      if (prev) {
        if (prev.request_hash !== hash) throw new AppError(422, 'idempotency_mismatch', 'Этот ключ уже использован с другими данными');
        res.set('Idempotent-Replay', 'true');
        return res.status(prev.status).json(JSON.parse(prev.response));
      }
      let captured;
      const origJson = res.json.bind(res);
      res.json = (body) => { captured = body; return origJson(body); };
      await handler(req, res, next);
      if (captured !== undefined && res.statusCode < 500) put.run(key, req.user.id, scopeKey, hash, JSON.stringify(captured), res.statusCode, nowIso());
    } catch (e) { next(e); }
  };
}
