// Бесплатный анализ без ИИ: выводы по статистике по встроенным правилам.
// На вход — строки видео (как в анализе для Claude), на выходе — текст в markdown.

const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const nums = (rows, k) => rows.map((r) => r[k]).filter((x) => typeof x === 'number' && !isNaN(x));
const fmt = (n) => (n == null ? '—' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1) + 'K' : Math.round(n).toLocaleString('ru-RU'));
const pct = (x) => (x == null ? '—' : Math.round(x) + '%');
const ret = (r, key) => (r.retention ? r.retention[key] : undefined);
const slotName = (h) => (h < 6 ? 'ночью (0–6)' : h < 10 ? 'утром (6–10)' : h < 13 ? 'днём (10–13)' : h < 16 ? 'днём (13–16)' : h < 19 ? 'вечером (16–19)' : h < 22 ? 'вечером (19–22)' : 'поздно вечером (22–24)');

function hookOf(r) {
  // доля зрителей, оставшихся на ~5% длины (у Shorts это первые 2–4 секунды)
  const v = ret(r, '5%') ?? ret(r, '1%');
  return typeof v === 'number' ? v : null;
}

function reasonsFor(r, ctx) {
  const out = [];
  if (r.ageDays < 2) out.push(`видео вышло меньше 2 дней назад (${r.ageDays} дн) — ещё рано делать выводы`);
  const hook = hookOf(r);
  if (hook != null && ctx.bestHook != null && hook < ctx.bestHook - 0.1) {
    out.push(`**слабый хук**: к первым секундам осталось ${pct(hook * 100)} зрителей, а у лучших видео ${pct(ctx.bestHook * 100)} — начни с самого странного или пугающего момента истории`);
  } else if (hook != null && hook < 0.7) {
    out.push(`**в начале уходит много зрителей** (осталось ${pct(hook * 100)}) — первые 2 секунды должны сразу цеплять`);
  }
  if (r.avgViewPct != null && ctx.bestPct != null && r.avgViewPct < ctx.bestPct - 15) {
    out.push(`**досматривают хуже**: ${pct(r.avgViewPct)} против ${pct(ctx.bestPct)} у лучших — сократи затянутые места в середине`);
  }
  const mid = ret(r, '50%');
  if (typeof mid === 'number' && hook != null && hook - mid > 0.35) out.push('сильный спад к середине — сюжет провисает, добавь поворот или интригу ближе к середине');
  if (r.durationSec && ctx.bestDur && r.durationSec > ctx.bestDur * 1.35) out.push(`видео длиннее лучших (${r.durationSec} с против ~${Math.round(ctx.bestDur)} с) — попробуй ужать`);
  if (r.likeRate != null && ctx.bestLike != null && r.likeRate < ctx.bestLike * 0.6) out.push(`мало лайков (${r.likeRate}% от просмотров против ${ctx.bestLike.toFixed(1)}% у лучших) — тема зашла слабее, проверь название и обложку`);
  if (ctx.titleDigitsHelp && !/\d/.test(r.title || '')) out.push('в названии нет цифры или конкретной детали, а у твоих лучших видео они есть');
  const h = new Date(r.published).getHours();
  if (ctx.bestHours.length && !ctx.bestHours.includes(h) && ctx.worstHours.includes(h)) out.push(`выложено ${slotName(h)} — в это время твои видео обычно набирают меньше`);
  if (r.platform === 'tiktok' && r.durationSec && r.durationSec < 60) out.push('короче 1 минуты — в TikTok такие видео не приносят денег в Creator Rewards');
  if (!out.length) out.push('явной причины по цифрам нет — возможно, не зашла сама тема; сравни с похожими успешными видео');
  return out;
}

function analyzeLocal(data) {
  const { days, rows, weakest, best, accounts } = data;
  const L = [];
  const bestHook = avg(best.map(hookOf).filter((x) => x != null));
  const bestPct = avg(nums(best, 'avgViewPct'));
  const bestDur = avg(nums(best, 'durationSec'));
  const bestLike = avg(nums(best, 'likeRate'));
  const digits = (list) => (list.length ? list.filter((r) => /\d/.test(r.title || '')).length / list.length : 0);
  const titleDigitsHelp = digits(best) >= 0.6 && digits(weakest) <= 0.4;

  // Время публикации: средняя «сила» (просмотры относительно обычных для аккаунта) по часу
  const byHour = {};
  for (const r of rows) {
    if (r.ageDays < 2) continue;
    const h = new Date(r.published).getHours();
    (byHour[h] ||= []).push(r.vsAccountMedian);
  }
  const hours = Object.entries(byHour).filter(([, a]) => a.length >= 2).map(([h, a]) => [+h, avg(a)]).sort((a, b) => b[1] - a[1]);
  const bestHours = hours.slice(0, 2).filter((x) => x[1] >= 1).map((x) => x[0]);
  const worstHours = hours.slice(-2).filter((x) => x[1] < 1).map((x) => x[0]);
  const ctx = { bestHook, bestPct, bestDur, bestLike, titleDigitsHelp, bestHours, worstHours };

  // ---- Коротко
  L.push('## Коротко');
  const total = rows.reduce((s, r) => s + (r.views || 0), 0);
  L.push(`- За ${days} дн: **${rows.length} видео**, всего **${fmt(total)} просмотров**.`);
  if (best[0]) L.push(`- Лучшее: «${best[0].title}» — ${fmt(best[0].views)} просмотров (в ${best[0].vsAccountMedian.toFixed(1)} раза больше обычного для «${best[0].account}»).`);
  if (bestHook != null) {
    const weakHook = avg(weakest.map(hookOf).filter((x) => x != null));
    if (weakHook != null && bestHook - weakHook > 0.08) L.push(`- **Главная разница — первые секунды**: у лучших видео к началу остаётся ${pct(bestHook * 100)} зрителей, у слабых ${pct(weakHook * 100)}.`);
  }
  if (bestPct != null) {
    const weakPct = avg(nums(weakest, 'avgViewPct'));
    if (weakPct != null) L.push(`- Средний досмотр: лучшие ${pct(bestPct)}, слабые ${pct(weakPct)}.`);
  }
  if (titleDigitsHelp) L.push('- В названиях лучших видео есть **цифры и конкретные детали** (годы, количество, сроки) — у слабых их нет.');

  // ---- Что заходит
  L.push('', '## Что заходит');
  for (const r of best) {
    const bits = [`${fmt(r.views)} просм.`];
    if (r.avgViewPct != null) bits.push(`досмотр ${pct(r.avgViewPct)}`);
    if (hookOf(r) != null) bits.push(`после начала осталось ${pct(hookOf(r) * 100)}`);
    if (r.durationSec) bits.push(`${r.durationSec} с`);
    L.push(`- **«${r.title}»** (${r.account}) — ${bits.join(', ')}`);
  }
  if (bestDur) L.push(`- Средняя длина лучших видео — **${Math.round(bestDur)} секунд**.`);

  // ---- Почему просели слабые
  L.push('', '## Почему просели слабые');
  weakest.forEach((r, i) => {
    L.push('', `**${i + 1}. «${r.title}»** (${r.account}) — ${fmt(r.views)} просм., это ${Math.round(r.vsAccountMedian * 100)}% от обычного`);
    for (const why of reasonsFor(r, ctx)) L.push(`- ${why}`);
  });

  // ---- RU и EN
  const ru = rows.filter((r) => r.lang === 'ru');
  const en = rows.filter((r) => r.lang === 'en');
  if (ru.length && en.length) {
    L.push('', '## RU и EN');
    L.push(`- RU: ${ru.length} видео, в среднем ${fmt(avg(nums(ru, 'views')))} просмотров${avg(nums(ru, 'avgViewPct')) != null ? `, досмотр ${pct(avg(nums(ru, 'avgViewPct')))}` : ''}.`);
    L.push(`- EN: ${en.length} видео, в среднем ${fmt(avg(nums(en, 'views')))} просмотров${avg(nums(en, 'avgViewPct')) != null ? `, досмотр ${pct(avg(nums(en, 'avgViewPct')))}` : ''}.`);
    const pairs = {};
    for (const r of rows) if (r.pair) (pairs[r.pair] ||= []).push(r);
    const both = Object.values(pairs).filter((p) => p.some((r) => r.lang === 'ru') && p.some((r) => r.lang === 'en'));
    if (both.length) {
      const ruWins = both.filter((p) => avg(p.filter((r) => r.lang === 'ru').map((r) => r.vsAccountMedian)) > avg(p.filter((r) => r.lang === 'en').map((r) => r.vsAccountMedian))).length;
      L.push(`- В парах одной истории RU-версия зашла лучше в ${ruWins} из ${both.length} случаев (с учётом размера каналов).`);
    }
  }

  // ---- Платформы
  const yt = rows.filter((r) => r.platform === 'youtube');
  const tt = rows.filter((r) => r.platform === 'tiktok');
  if (yt.length && tt.length) {
    L.push('', '## YouTube и TikTok');
    L.push(`- YouTube: в среднем ${fmt(avg(nums(yt, 'views')))} просмотров на видео, ${(avg(nums(yt, 'likeRate')) || 0).toFixed(1)}% лайков.`);
    L.push(`- TikTok: в среднем ${fmt(avg(nums(tt, 'views')))} просмотров на видео, ${(avg(nums(tt, 'likeRate')) || 0).toFixed(1)}% лайков.`);
    const shortTt = tt.filter((r) => r.durationSec && r.durationSec < 60).length;
    if (shortTt) L.push(`- В TikTok ${shortTt} из ${tt.length} видео короче минуты — за них не платят в Creator Rewards.`);
  }

  // ---- Время
  if (hours.length) {
    L.push('', '## Время публикации');
    if (bestHours.length) L.push(`- Лучше всего заходят видео, выложенные ${[...new Set(bestHours.map(slotName))].join(' и ')}.`);
    if (worstHours.length) L.push(`- Хуже всего — ${[...new Set(worstHours.map(slotName))].join(' и ')}.`);
    const byDay = {};
    for (const r of rows) if (r.ageDays >= 2) (byDay[new Date(r.published).getDay()] ||= []).push(r.vsAccountMedian);
    const dayList = Object.entries(byDay).filter(([, a]) => a.length >= 2).map(([d, a]) => [+d, avg(a)]).sort((a, b) => b[1] - a[1]);
    if (dayList.length >= 2) L.push(`- Сильнее всего день: **${DAYS[dayList[0][0]]}**, слабее всего: ${DAYS[dayList[dayList.length - 1][0]]}.`);
    L.push('- Подробная карта — во вкладке «Статистика» → «Лучшее время».');
  }

  // ---- План
  L.push('', '## План на следующие видео');
  if (bestHook != null) L.push('- Первые 2 секунды — самый странный, пугающий или неожиданный момент истории, без вступлений.');
  if (bestDur) L.push(`- Держи длину около **${Math.round(bestDur)} секунд** — как у лучших видео.`);
  if (titleDigitsHelp) L.push('- В названии — цифра или конкретная деталь: год, срок, количество.');
  if (bestHours.length) L.push(`- Выкладывай ${[...new Set(bestHours.map(slotName))].join(' или ')}.`);
  if (tt.some((r) => r.durationSec && r.durationSec < 60)) L.push('- Для TikTok делай видео от 61 секунды.');
  L.push('- Через 2–3 дня после выхода снова запусти анализ и сравни.');
  if (!rows.some((r) => r.retention)) L.push('', '_Удержание по секундам есть только у YouTube и только для видео с достаточным числом просмотров. Без него выводы о хуке менее точные._');
  if (accounts.length && rows.length < 6) L.push('', '_Видео пока мало — выводы будут точнее, когда их станет больше._');
  return L.join('\n');
}

module.exports = { analyzeLocal };
