// Google Gemini — бесплатный ИИ для анализа и помощника. Ключ: aistudio.google.com/apikey (без карты).
// При перегрузке серверов Google повторяем запрос и переключаемся на другие бесплатные модели.
const API = 'https://generativelanguage.googleapis.com/v1beta';
const FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest'];

let cachedModels = null;
let lastGood = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(key, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw Object.assign(new Error('Нет связи с Gemini — проверь интернет.'), { status: 0, retry: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw Object.assign(new Error('Ключ Gemini неверный. Проверь его в «Настройках».'), { status: 400, fatal: true });
    if (res.status === 403) throw Object.assign(new Error('Gemini: доступ запрещён для этого ключа. Создай новый ключ на aistudio.google.com/apikey.'), { status: 403, fatal: true });
    const busy = res.status === 503 || res.status === 500 || /overloaded|high demand|unavailable/i.test(msg);
    const quota = res.status === 429;
    throw Object.assign(new Error('Gemini: ' + msg), { status: res.status, busy, quota, retry: busy || quota });
  }
  return data;
}

// Список подходящих моделей: сначала выбранная/последняя рабочая, затем «flash» по убыванию версии, затем «lite»
async function modelList(key, preferred) {
  if (!cachedModels) {
    try {
      const data = await call(key, `${API}/models?pageSize=200`);
      const names = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, ''))
        .filter((n) => /^gemini-[\d.]+-flash(-lite)?$/.test(n) || /^gemini-flash(-lite)?-latest$/.test(n));
      const ver = (n) => parseFloat((/gemini-([\d.]+)/.exec(n) || [])[1] || '0');
      const lite = (n) => (/lite/.test(n) ? 1 : 0);
      names.sort((a, b) => lite(a) - lite(b) || ver(b) - ver(a));
      cachedModels = names.length ? names : FALLBACK_MODELS;
    } catch (e) {
      if (e.fatal) throw e;
      cachedModels = FALLBACK_MODELS;
    }
  }
  return [...new Set([preferred, lastGood, ...cachedModels, ...FALLBACK_MODELS].filter(Boolean))];
}

// messages: [{role:'user'|'assistant', text}]
async function chat(key, { system, messages, model, temperature = 0.8, onModel }) {
  if (!key) throw new Error('Добавь бесплатный ключ Gemini в «Настройках», чтобы работал ИИ.');
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: messages.map((x) => ({ role: x.role === 'assistant' ? 'model' : 'user', parts: [{ text: x.text }] })),
    generationConfig: { temperature, maxOutputTokens: 8192 },
  };
  const models = (await modelList(key, model)).slice(0, 6);
  let lastErr = null;
  let busyCount = 0;
  let quotaCount = 0;
  for (const m of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const data = await call(key, `${API}/models/${m}:generateContent`, body);
        const cand = data.candidates?.[0];
        const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
        if (!text) {
          if (cand?.finishReason === 'SAFETY' || data.promptFeedback?.blockReason) throw Object.assign(new Error('Gemini отказался отвечать на этот запрос — переформулируй.'), { fatal: true });
          throw Object.assign(new Error('Gemini вернул пустой ответ.'), { retry: true });
        }
        lastGood = m;
        onModel?.(m);
        return text;
      } catch (e) {
        lastErr = e;
        if (e.fatal) throw e;
        if (e.status === 404) break; // такой модели нет — следующая
        if (e.busy) busyCount++;
        if (e.quota) { quotaCount++; break; } // лимит этой модели — пробуем другую
        if (!e.retry) break;
        if (attempt === 0) await sleep(1500 + Math.random() * 1500);
      }
    }
  }
  if (quotaCount && !busyCount) throw new Error('Бесплатный лимит Gemini на сейчас исчерпан. Подожди минуту, а если не поможет — лимит обновится завтра.');
  if (busyCount) throw new Error('Серверы Google Gemini сейчас перегружены (это у них, не у тебя). Попробуй ещё раз через минуту.');
  throw lastErr || new Error('Gemini не ответил, попробуй ещё раз.');
}

async function check(key) {
  let used = null;
  await chat(key, { messages: [{ role: 'user', text: 'Ответь одним словом: ок' }], temperature: 0, onModel: (m) => { used = m; } });
  return used;
}

module.exports = { chat, check };
