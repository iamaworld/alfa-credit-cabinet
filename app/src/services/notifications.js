import { nowIso } from '../db.js';

export function createNotifications(db) {
  const ins = db.prepare('INSERT INTO notifications (user_id, application_id, title, body, read, created_at) VALUES (?,?,?,?,0,?)');
  const list = db.prepare('SELECT id, application_id AS applicationId, title, body, read, created_at AS createdAt FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50');
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read = 0');
  const markAll = db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?');
  const markOne = db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?');
  return {
    push(userId, applicationId, title, body) { ins.run(userId, applicationId ?? null, title, body, nowIso()); },
    list(userId) { return { unread: unread.get(userId).n, items: list.all(userId).map((r) => ({ ...r, read: !!r.read })) }; },
    readAll(userId) { markAll.run(userId); },
    readOne(userId, id) { markOne.run(id, userId); },
  };
}
