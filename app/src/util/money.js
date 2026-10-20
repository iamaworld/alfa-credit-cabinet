// Денежная арифметика. Суммы хранятся целыми рублями.
export function annuityPayment(principal, annualRatePct, termMonths) {
  const r = annualRatePct / 1200;
  if (r === 0) return Math.round(principal / termMonths);
  return Math.round((principal * r) / (1 - Math.pow(1 + r, -termMonths)));
}

export function maxPrincipalForPayment(payment, annualRatePct, termMonths) {
  const r = annualRatePct / 1200;
  if (payment <= 0) return 0;
  if (r === 0) return Math.round(payment * termMonths);
  return Math.round((payment * (1 - Math.pow(1 + r, -termMonths))) / r);
}

export function overpayment(principal, payment, termMonths) {
  return Math.max(0, payment * termMonths - principal);
}

export const floorTo = (n, step) => Math.floor(n / step) * step;
export const round1 = (n) => Math.round(n * 10) / 10;
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function fmtRub(n) {
  if (n == null || Number.isNaN(n)) return '—';
  return `${new Intl.NumberFormat('ru-RU').format(Math.round(n)).replace(/ /g, ' ')} ₽`;
}

export function monthsBetween(isoDate, now = new Date()) {
  const d = new Date(isoDate);
  return (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth()) - (now.getUTCDate() < d.getUTCDate() ? 1 : 0);
}
