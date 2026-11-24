// Google Gemini — бесплатный ИИ для анализа и помощника. Ключ: aistudio.google.com/apikey (без карты).
const API = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

let cachedModel = null;

async function call(key, url, body) {
  const res = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('Ключ Gemini неверный. Проверь его в «Настройках».');
    if (res.status === 429) throw new Error('Бесплатный лимит Gemini на сейчас исчерпан — подожди минуту (или до завтра, если кончился дневной).');
    throw Object.assign(new Error('Gemini: ' + msg), { status: res.status });
  }
  return data;
}

// Выбираем лучшую доступную «flash»-модель (бесплатная и быстрая)
async function pickModel(key, preferred) {
  if (preferred) return preferred;
  if (cachedModel) return cachedModel;
  try {
    const data = await call(key, `${API}/models?pageSize=200`);
    const names = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash$/.test(n) || n === 'gemini-flash-latest');
    const ver = (n) => parseFloat((/gemini-([\d.]+)/.exec(n) || [])[1] || '0');
    names.sort((a, b) => ver(b) - ver(a));
    cachedModel = names[0] || FALLBACK_MODELS[0];
  } catch (_) {
    cachedModel = FALLBACK_MODELS[0];
  }
  return cachedModel;
}

// messages: [{role:'user'|'assistant', text}]
async function chat(key, { system, messages, model, temperature = 0.8 }) {
  if (!key) throw new Error('Добавь бесплатный ключ Gemini в «Настройках», чтобы работал ИИ.');
  const m = await pickModel(key, model);
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: messages.map((x) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.text }] })),
    generationConfig: { temperature, maxOutputTokens: 8192 },
  };
  let data;
  try {
    data = await call(key, `${API}/models/${m}:generateContent`, body);
  } catch (e) {
    // модель могли убрать — пробуем запасные
    if (e.status === 404) {
      for (const alt of FALLBACK_MODELS.filter((x) => x !== m)) {
        try { data = await call(key, `${API}/models/${alt}:generateContent`, body); cachedModel = alt; break; } catch (_) { /* */ }
      }
    }
    if (!data) throw e;
  }
  const cand = data.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) {
    if (cand?.finishReason === 'SAFETY' || data.promptFeedback?.blockReason) throw new Error('Gemini отказался отвечать на этот запрос — переформулируй.');
    throw new Error('Gemini вернул пустой ответ, попробуй ещё раз.');
  }
  return text;
}

async function check(key) {
  const m = await pickModel(key);
  await chat(key, { messages: [{ role: 'user', text: 'Ответь одним словом: ок' }], model: m, temperature: 0 });
  return m;
}

module.exports = { chat, check, pickModel };
