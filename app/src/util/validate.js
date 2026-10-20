import { badRequest } from './errors.js';
import { PRODUCTS } from '../engine/products.js';

// Контрольная сумма ИНН (10 цифр — юрлицо, 12 — ИП)
export function isValidInn(inn) {
  if (!/^\d{10}$|^\d{12}$/.test(inn)) return false;
  const d = inn.split('').map(Number);
  const calc = (w) => (w.reduce((s, k, i) => s + k * d[i], 0) % 11) % 10;
  if (d.length === 10) return calc([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  return calc([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10] && calc([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
}

export function parseInn(v) {
  const inn = String(v || '').replace(/\s/g, '');
  if (!/^\d{10}$|^\d{12}$/.test(inn)) throw badRequest('ИНН состоит из 10 цифр (организация) или 12 цифр (ИП)', { field: 'inn' });
  return inn;
}

export function parseRequest(body) {
  const product = PRODUCTS[body?.product];
  if (!product) throw badRequest('Выберите продукт', { field: 'product' });
  const amount = Math.round(Number(body.amount));
  const term = Math.round(Number(body.term));
  if (!Number.isFinite(amount) || amount < product.min || amount > product.max)
    throw badRequest(`Сумма для продукта «${product.name}»: от ${product.min.toLocaleString('ru-RU')} до ${product.max.toLocaleString('ru-RU')} ₽`, { field: 'amount' });
  if (!Number.isFinite(term) || term < product.minTerm || term > product.maxTerm)
    throw badRequest(`Срок для продукта «${product.name}»: от ${product.minTerm} до ${product.maxTerm} мес.`, { field: 'term' });
  return { product: product.id, amount, term, collateral: !!body.collateral };
}
