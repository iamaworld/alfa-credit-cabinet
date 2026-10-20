export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || 'Не удалось выполнить запрос');
    this.status = status;
    this.code = body?.error?.code;
    this.details = body?.error?.details;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export async function api(method, path, body, headers = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method, credentials: 'same-origin',
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, { error: { code: 'network', message: 'Нет связи с сервером. Проверьте соединение и повторите.' } });
  }
  let data = null;
  try { data = await res.json(); } catch { /* пустой ответ */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && path !== '/auth/login') onUnauthorized();
    throw err;
  }
  return data;
}
export const get = (p) => api('GET', p);
export const post = (p, b = {}, h) => api('POST', p, b, h);
export const patch = (p, b) => api('PATCH', p, b);
export const put = (p, b) => api('PUT', p, b);

let productsCache;
export async function products() {
  if (!productsCache) productsCache = await get('/products');
  return productsCache;
}
