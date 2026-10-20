// Контекст расчёта для компании. Короткий кэш, чтобы движение ползунка не превращалось в поток запросов к источникам.
import { buildContext } from '../engine/scoring.js';

export function createContextService({ enrichment, ttlMs = 60_000 }) {
  const cache = new Map();
  async function raw(inn) {
    const hit = cache.get(inn);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await enrichment.loadAll(inn);
    cache.set(inn, { at: Date.now(), value });
    return value;
  }
  return {
    async get(inn, { declaredMonthlyRevenue = null } = {}) {
      const r = await raw(inn);
      return { ctx: buildContext(r.data, { declaredMonthlyRevenue }), data: r.data, meta: r.meta, degraded: r.degraded };
    },
    invalidate(inn) { cache.delete(inn); },
  };
}
