import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import { startStack } from './helpers.js';

// Спецификация и реальные маршруты не должны расходиться.
test('OpenAPI описывает ровно те маршруты, что есть в API', async () => {
  const s = await startStack();
  try {
    const spec = YAML.parse(fs.readFileSync(new URL('../../docs/openapi.yaml', import.meta.url), 'utf8'));
    const specRoutes = new Set();
    for (const [p, ops] of Object.entries(spec.paths)) {
      if (!p.startsWith('/api')) continue;
      for (const m of Object.keys(ops)) specRoutes.add(`${m.toUpperCase()} ${p.replace(/\{(\w+)\}/g, ':$1')}`);
    }
    const apiLayer = s.app._router.stack.find((l) => l.name === 'router' && l.handle.stack?.some((x) => x.route?.path === '/products'));
    assert.ok(apiLayer, 'роутер API найден');
    const real = new Set();
    for (const l of apiLayer.handle.stack) {
      if (!l.route) continue;
      for (const m of Object.keys(l.route.methods)) real.add(`${m.toUpperCase()} /api${l.route.path}`);
    }
    // В спецификации параметры названы по смыслу, в роутере — по коду: сравниваем по форме пути
    const norm = (x) => x.replace(/:\w+/g, ':p');
    const a = new Set([...real].map(norm)), b = new Set([...specRoutes].map(norm));
    assert.deepEqual([...a].filter((x) => !b.has(x)).sort(), [], 'есть маршруты без описания в OpenAPI');
    assert.deepEqual([...b].filter((x) => !a.has(x)).sort(), [], 'в OpenAPI есть несуществующие маршруты');
  } finally { await s.close(); }
});

test('Swagger UI и спецификация отдаются сервером', async () => {
  const s = await startStack();
  try {
    assert.equal((await fetch(`${s.base}/api-docs`)).status, 200);
    const j = await (await fetch(`${s.base}/openapi.json`)).json();
    assert.equal(j.openapi, '3.0.3');
    assert.equal((await fetch(`${s.base}/api-docs/swagger-ui-bundle.js`)).status, 200);
  } finally { await s.close(); }
});
