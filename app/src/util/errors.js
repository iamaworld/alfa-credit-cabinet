export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const badRequest = (m, d) => new AppError(400, 'bad_request', m, d);
export const unauthorized = (m = 'Нужно войти в кабинет') => new AppError(401, 'unauthorized', m);
export const forbidden = (m = 'Недостаточно прав') => new AppError(403, 'forbidden', m);
export const notFound = (m = 'Не найдено') => new AppError(404, 'not_found', m);
export const conflict = (m, code = 'conflict', d) => new AppError(409, code, m, d);

export function errorHandler(err, req, res, _next) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'bad_json', message: 'Некорректный JSON' } });
  }
  console.error('[error]', err);
  res.status(500).json({ error: { code: 'internal', message: 'Внутренняя ошибка. Попробуйте ещё раз.' } });
}
