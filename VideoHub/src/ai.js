// ИИ-анализ статистики через Claude (Anthropic API). Нужен ключ из console.anthropic.com.
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-opus-5-5';

const SYSTEM = `Ты — опытный продюсер коротких видео (YouTube Shorts, TikTok) и аналитик.
Автор ведёт несколько каналов: сторителлинг-видео (истории) на русском и английском, а также нарезки ютуберов и стримеров.
Твоя задача — по цифрам понять, что работает, а что нет, и дать конкретные, применимые советы.
Правила:
- Пиши по-русски, простым языком, без воды. Используй заголовки (##), списки и **жирный** для главного.
- Опирайся на цифры из данных; если делаешь вывод, укажи, на каких видео/метриках он основан.
- Удержание: audienceWatchRatio на доле видео 0..1; значения >1 в Shorts означают повторные просмотры. Резкое падение в первые 5–10% — слабый хук.
- Если данных мало, честно скажи об этом и дай советы, что проверить.
- Не выдумывай метрики, которых нет в данных.`;

function client(key) {
  if (!key) throw new Error('Добавь ключ Claude (Anthropic) в «Настройках», чтобы работал анализ.');
  return new Anthropic({ apiKey: key });
}

async function ask(key, prompt, { effort = 'high', maxTokens = 32000 } = {}) {
  const c = client(key);
  const stream = c.beta.messages.stream({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort },
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  });
  let msg;
  try {
    msg = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Ключ Claude неверный. Проверь его в «Настройках».');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Слишком много запросов к Claude, попробуй через минуту.');
    if (e instanceof Anthropic.APIError) throw new Error(`Ошибка Claude API (${e.status}): ${e.message}`);
    throw e;
  }
  if (msg.stop_reason === 'refusal') throw new Error('Claude отказался отвечать на этот запрос.');
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

function analysisPrompt(payload, question) {
  return `Вот статистика моих видео за последние ${payload.days} дн. (JSON):

${JSON.stringify(payload, null, 1)}

Сделай разбор:
## Коротко
3–5 главных выводов.
## Что заходит
Общие черты лучших видео (темы, названия, длина, удержание, время публикации).
## Почему просели слабые
По каждому видео из "weakest": вероятная причина (хук, длина, название, тема, удержание) и что конкретно поменять.
## RU и EN
Сравни языковые версии одних и тех же историй (поле pair/lang), если есть.
## Платформы
YouTube и TikTok: где что лучше работает.
## План на следующие видео
Конкретный чек-лист: что добавить в видео, какой хук, длина, формат названия, лучшее время.
${question ? `\nОтдельно ответь на мой вопрос: «${question}»` : ''}`;
}

function titlesPrompt({ title, description, lang, kind }) {
  const l = lang === 'en' ? 'английском' : 'русском';
  return `Я выкладываю ${kind === 'clips' ? 'нарезку ютубера/стримера' : 'видео-историю'} в YouTube Shorts и TikTok.
Текущее название: «${title || '-'}»
Описание: «${description || '-'}»

Предложи на ${l} языке:
1. 6 вариантов цепляющего названия (до 70 символов, без кликбейта, который обманывает).
2. Короткое описание (2–3 предложения).
3. 8–12 хэштегов.
4. Идею для первых 2 секунд видео (хук), чтобы зрители не свайпали.
Ответ — коротко, списками.`;
}

module.exports = { ask, analysisPrompt, titlesPrompt, MODEL, SYSTEM };
