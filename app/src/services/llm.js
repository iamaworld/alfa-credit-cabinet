// Клиент локальной языковой модели с открытыми весами по OpenAI-совместимому API
// (llama.cpp server в поставке; так же работают Ollama и vLLM — модель меняется без переписывания кода).
// Модель ничего не решает: она только переводит текст в структуру, которую дальше проверяет код.
// Любой сбой (нет сервиса, модель грузится, таймаут, ответ не по схеме) возвращает { ok: false } — вызывающий переходит на правила.

export function createLlm({ config, fetchImpl = fetch }) {
  const { enabled, url, model, timeoutMs } = config.llm;
  let cached = null; // { at, value } — результат проверки готовности

  async function call(path, body, ms) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetchImpl(url + path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl.signal,
      });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
      return await res.json();
    } finally { clearTimeout(t); }
  }

  /** Готова ли модель отвечать. Результат кэшируется на 30 секунд. */
  async function status() {
    if (!enabled) return { enabled: false, ready: false, model };
    if (cached && Date.now() - cached.at < 30_000) return cached.value;
    let value;
    try {
      await call('/health', null, 2000); // llama.cpp отвечает 503, пока загружает модель
      value = { enabled: true, ready: true, model };
    } catch (e) {
      value = { enabled: true, ready: false, model, reason: e.status === 503 ? 'loading' : e.name === 'AbortError' ? 'timeout' : 'unavailable' };
    }
    cached = { at: Date.now(), value };
    return value;
  }

  /**
   * Запрос с ответом строго по JSON-схеме (грамматика на стороне сервера не даёт выйти за схему).
   * @returns {Promise<{ok: true, data: object, ms: number} | {ok: false, error: string, ms: number}>}
   */
  async function chatJson({ system, user, schema, examples = [] }) {
    const started = Date.now();
    if (!enabled) return { ok: false, error: 'disabled', ms: 0 };
    const messages = [{ role: 'system', content: system }];
    for (const ex of examples) messages.push({ role: 'user', content: ex.user }, { role: 'assistant', content: JSON.stringify(ex.answer) });
    messages.push({ role: 'user', content: user });
    try {
      const out = await call('/v1/chat/completions', {
        model, messages, temperature: 0, max_tokens: 200, // ответ — короткий JSON
        response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: true, schema } },
        chat_template_kwargs: { enable_thinking: false }, // рассуждения Qwen3 отнимают секунды и не нужны для извлечения полей
      }, timeoutMs);
      const text = String(out.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      cached = { at: Date.now(), value: { enabled: true, ready: true, model } };
      return { ok: true, data: JSON.parse(text), ms: Date.now() - started };
    } catch (e) {
      return { ok: false, error: e.name === 'AbortError' ? 'timeout' : String(e.message || e), ms: Date.now() - started };
    }
  }

  return { status, chatJson, model, enabled };
}
