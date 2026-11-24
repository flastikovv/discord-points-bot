// Студия Монетизации — главный процесс: окно, трей, расписание публикаций, связь с интерфейсом.
const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, Notification, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Store } = require('./src/store');
const youtube = require('./src/youtube');
const tiktok = require('./src/tiktok');
const ai = require('./src/ai');
const { analyzeLocal } = require('./src/insights');
const { TelegramBot, mdToTg } = require('./src/telegram');

// Своя папка для данных: %APPDATA%\\MonetizationStudio
app.setPath('userData', path.join(app.getPath('appData'), 'MonetizationStudio'));
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.setAppUserModelId('com.monetization.studio');
const APP_NAME = 'Студия Монетизации';

let store;
let win;
let tray;
let tg;
let quitting = false;
const busy = new Set(); // идущие загрузки videoId:accountId

const PLATFORM = { youtube, tiktok };
const ICON = path.join(__dirname, 'assets', 'icon.png');

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
function pushState() { send('state', store.publicState()); }
// Уведомление на рабочем столе (по желанию) — основное уведомление идёт в Telegram
function notify(title, body) {
  if (!store?.data.settings.desktopNotify) return;
  try { new Notification({ title, body, icon: ICON }).show(); } catch (_) { /* */ }
}
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (x) => (x == null ? '—' : x >= 1e6 ? (x / 1e6).toFixed(1).replace('.0', '') + 'M' : x >= 1e4 ? (x / 1e3).toFixed(1).replace('.0', '') + 'K' : Math.round(x).toLocaleString('ru-RU'));
const pfIcon = (p) => (p === 'youtube' ? '🟥 YouTube' : '⬛ TikTok');

function createWindow(hidden) {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 1050, minHeight: 680,
    backgroundColor: '#0f0d17', title: APP_NAME, icon: ICON, show: !hidden,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.on('close', (e) => {
    if (!quitting && store.data.settings.keepInTray) {
      e.preventDefault();
      win.hide();
      if (!store.data._trayHint) {
        store.data._trayHint = true; store.save();
        try { new Notification({ title: APP_NAME + ' работает в фоне', body: 'Программа свёрнута в трей: выложит запланированные видео и пришлёт уведомления в Telegram.', icon: ICON }).show(); } catch (_) { /* */ }
      }
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }));
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть ' + APP_NAME, click: () => { win.show(); win.focus(); } },
    { type: 'separator' },
    { label: 'Выход', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { win.show(); win.focus(); });
}

function applyAutostart() {
  if (process.platform !== 'win32' || !app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: !!store.data.settings.autostart, args: ['--hidden'] });
}

// ---------- Публикация ----------

function videoStatus(v) {
  const r = v.results || [];
  if (!r.length) return 'draft';
  if (r.some((x) => x.status === 'uploading')) return 'uploading';
  if (r.some((x) => x.status === 'error')) return 'error';
  if (r.some((x) => x.status === 'queued' || x.status === 'pending')) return 'scheduled';
  if (r.every((x) => ['published', 'inbox', 'processing'].includes(x.status))) return 'published';
  return 'scheduled';
}

async function runTarget(video, result) {
  const key = video.id + ':' + result.accountId;
  if (busy.has(key)) return;
  const acc = store.account(result.accountId);
  if (!acc) { Object.assign(result, { status: 'error', error: 'Аккаунт удалён' }); return; }
  if (!fs.existsSync(video.filePath)) {
    Object.assign(result, { status: 'error', error: 'Файл видео не найден: ' + video.filePath });
    video.status = videoStatus(video); store.save(); pushState();
    return;
  }
  busy.add(key);
  Object.assign(result, { status: 'uploading', error: '', progress: 0 });
  video.status = videoStatus(video); store.save(); pushState();
  let lastPct = -1;
  try {
    const scheduleAt = acc.platform === 'youtube' && video.scheduleAt && new Date(video.scheduleAt) > new Date() ? video.scheduleAt : null;
    const out = await PLATFORM[acc.platform].upload(store, acc, video, {
      scheduleAt,
      onProgress: (sent, total) => {
        const pct = Math.floor((sent / total) * 100);
        if (pct !== lastPct) { lastPct = pct; result.progress = pct; send('progress', { videoId: video.id, accountId: acc.id, pct }); }
      },
    });
    Object.assign(result, out, { progress: 100, doneAt: Date.now() });
    const label = { published: 'опубликовано', scheduled: 'запланировано на YouTube', inbox: 'отправлено во «Входящие» TikTok', processing: 'обрабатывается' }[out.status] || out.status;
    notify(`✅ ${acc.name}`, `«${video.title}» — ${label}`);
    if (out.status === 'published' || out.status === 'inbox') result.tgNotified = true;
    tg?.notify('published', {
      text: `${out.status === 'scheduled' ? '🕒' : '✅'} <b>${h(video.title)}</b>\n${pfIcon(acc.platform)} · ${h(acc.name)}\n${h(label)}${out.status === 'scheduled' ? ' — выйдет ' + new Date(video.scheduleAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : ''}${out.private ? '\n🔒 приватно (TikTok ещё не одобрил приложение)' : ''}`,
      buttons: out.url ? [[{ text: 'Открыть видео', url: out.url }]] : undefined,
    });
  } catch (e) {
    Object.assign(result, { status: 'error', error: e.message });
    notify(`❌ Ошибка: ${acc.name}`, `«${video.title}»: ${e.message}`);
    tg?.notify('errors', { text: `❌ <b>Не удалось выложить</b> «${h(video.title)}»\n${pfIcon(acc.platform)} · ${h(acc.name)}\n${h(e.message)}`, buttons: [[{ text: '🔁 Повторить', data: `retry:${video.id}:${acc.id}` }]] });
  } finally {
    busy.delete(key);
    video.status = videoStatus(video);
    store.save(); pushState();
  }
}

async function publish(videoId, scheduleAt) {
  const video = store.data.videos.find((v) => v.id === videoId);
  if (!video) throw new Error('Видео не найдено');
  if (!video.accountIds?.length) throw new Error('Выбери хотя бы один канал/аккаунт');
  if (!video.filePath || !fs.existsSync(video.filePath)) throw new Error('Файл видео не найден');
  if (scheduleAt && new Date(scheduleAt) <= new Date()) throw new Error('Время публикации уже прошло');
  video.scheduleAt = scheduleAt || null;
  video.results = video.accountIds.map((accountId) => {
    const old = (video.results || []).find((r) => r.accountId === accountId);
    if (old && ['published', 'scheduled', 'inbox', 'processing'].includes(old.status)) return old; // не дублируем
    const acc = store.account(accountId);
    const waitLocal = scheduleAt && acc?.platform === 'tiktok';
    return { accountId, platform: acc?.platform, status: waitLocal ? 'queued' : 'pending', error: '' };
  });
  video.status = videoStatus(video);
  store.save(); pushState();
  for (const r of video.results) {
    if (r.status === 'pending') await runTarget(video, r);
  }
  return true;
}

// Раз в 30 секунд: TikTok по расписанию + перезапуск зависших
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const now = Date.now();
    for (const v of store.data.videos) {
      for (const r of v.results || []) {
        if (r.status === 'queued' && v.scheduleAt && new Date(v.scheduleAt).getTime() <= now) await runTarget(v, r);
      }
    }
    // YouTube сам открыл запланированное видео — сообщаем, что вышло
    for (const v of store.data.videos) {
      if (!v.scheduleAt || new Date(v.scheduleAt).getTime() > now) continue;
      for (const r of v.results || []) {
        if (r.status !== 'scheduled') continue;
        r.status = 'published';
        r.tgNotified = true;
        const a = store.account(r.accountId);
        tg?.notify('published', { text: `🎬 <b>Вышло:</b> ${h(v.title)}\n${pfIcon(a?.platform)} · ${h(a?.name)}`, buttons: r.url ? [[{ text: 'Открыть видео', url: r.url }]] : undefined });
        v.status = videoStatus(v);
        store.save(); pushState();
      }
    }
    // Сводка дня
    const tcfg = store.data.settings.telegram || {};
    const d = new Date();
    const dayKey = d.toDateString();
    if (tcfg.chatId && d.getHours() === +tcfg.dailyHour && store.data._lastDaily !== dayKey) {
      store.data._lastDaily = dayKey; store.save();
      refreshStats().catch(() => {}).finally(() => tg?.notify('daily', '🌙 <b>Итоги дня</b>\n\n' + summaryText(1)));
    }
    const hours = store.data.settings.statsAutoRefreshHours || 0;
    if (hours > 0 && now - (store.data._lastAutoStats || 0) > hours * 3600e3 && store.data.accounts.length) {
      store.data._lastAutoStats = now;
      refreshStats().catch(() => {});
    }
  } finally {
    ticking = false;
  }
}

// ---------- Статистика ----------

async function refreshStats(accountId) {
  const accs = store.data.accounts.filter((a) => !accountId || a.id === accountId);
  const errors = [];
  for (const acc of accs) {
    try {
      const res = await PLATFORM[acc.platform].fetchStats(store, acc);
      const prev = store.data.stats[acc.id] || {};
      const history = prev.history || {};
      const t = Date.now();
      for (const v of res.videos) {
        const h = history[v.id] || [];
        if (!h.length || t - h[h.length - 1][0] > 30 * 60e3) h.push([t, v.views]);
        history[v.id] = h.slice(-120);
      }
      checkMilestones(acc, prev, res);
      let monetization = prev.monetization;
      if (acc.platform === 'youtube') {
        try { monetization = await youtube.fetchMonetization(store, acc); } catch (_) { /* */ }
      }
      const fh = prev.followersHistory || [];
      fh.push([t, res.followers || 0]);
      store.data.stats[acc.id] = { fetchedAt: t, followers: res.followers, videos: res.videos, history, followersHistory: fh.slice(-200), monetization };
      // ссылки на опубликованные из программы видео
      for (const vid of store.data.videos) {
        for (const r of vid.results || []) {
          if (r.accountId !== acc.id || r.url) continue;
          const m = res.videos.find((x) => x.id === r.remoteId);
          if (m) r.url = m.url;
        }
      }
    } catch (e) {
      errors.push(`${acc.name}: ${e.message}`);
    }
  }
  store.save(); pushState();
  if (errors.length) throw new Error(errors.join('\n'));
  return true;
}

const parseList = (str) => String(str || '').split(/[\s,;]+/).map(Number).filter((x) => x > 0).sort((a, b) => a - b);

// Рубежи просмотров и подписчиков → сообщение в Telegram (один раз на рубеж)
function checkMilestones(acc, prev, res) {
  const cfg = store.data.settings.telegram || {};
  const marks = parseList(cfg.milestones);
  const ms = store.data.milestones;
  const first = !prev.fetchedAt; // при первом подключении не засыпаем уведомлениями
  for (const v of res.videos) {
    const key = acc.id + ':' + v.id;
    const reached = marks.filter((m) => v.views >= m).pop() || 0;
    if (ms[key] == null || first) { ms[key] = reached; continue; }
    if (reached > ms[key]) {
      ms[key] = reached;
      tg?.notify('milestones', {
        text: `🔥 <b>${n(reached)} просмотров!</b>\n«${h(v.title)}»\n${pfIcon(acc.platform)} · ${h(acc.name)}\nСейчас: ${n(v.views)} 👁 · ${n(v.likes)} ❤️`,
        buttons: v.url ? [[{ text: 'Открыть видео', url: v.url }]] : undefined,
      });
    }
  }
  const fm = parseList(cfg.followerMilestones);
  const fkey = acc.id + ':followers';
  const fr = fm.filter((m) => (res.followers || 0) >= m).pop() || 0;
  if (ms[fkey] == null || first) ms[fkey] = fr;
  else if (fr > ms[fkey]) {
    ms[fkey] = fr;
    tg?.notify('followers', `🎉 <b>${h(acc.name)}</b>: ${n(fr)} подписчиков!\n${pfIcon(acc.platform)}`);
  }
}

function periodVideos(days) {
  const since = Date.now() - days * 864e5;
  const out = [];
  for (const a of store.data.accounts) {
    for (const v of store.data.stats[a.id]?.videos || []) {
      const t = new Date(v.publishedAt).getTime();
      if (t >= since && t <= Date.now()) out.push({ a, v });
    }
  }
  return out;
}

function summaryText(days = 7) {
  if (!store.data.accounts.length) return 'Аккаунтов пока нет.';
  const lines = store.data.accounts.map((a) => {
    const st = store.data.stats[a.id];
    if (!st) return `${pfIcon(a.platform)} <b>${h(a.name)}</b> — нет данных`;
    const since = Date.now() - days * 864e5;
    const vids = st.videos.filter((v) => new Date(v.publishedAt).getTime() >= since && new Date(v.publishedAt).getTime() <= Date.now());
    const views = vids.reduce((s, v) => s + v.views, 0);
    const fh = st.followersHistory || [];
    const old = fh.find((p) => p[0] >= since);
    const delta = old ? st.followers - old[1] : 0;
    return `${pfIcon(a.platform)} <b>${h(a.name)}</b>${a.lang ? ' ' + a.lang.toUpperCase() : ''}\n   👥 ${n(st.followers)}${delta ? ` (${delta > 0 ? '+' : ''}${n(delta)})` : ''} · 🎬 ${vids.length} видео · 👁 ${n(views)}`;
  });
  const all = periodVideos(days).sort((x, y) => y.v.views - x.v.views);
  const best = all[0];
  return `${lines.join('\n')}${best ? `\n\n🏆 Лучшее за ${days === 1 ? 'день' : days + ' дн'}: «${h(best.v.title)}» — ${n(best.v.views)} 👁 (${h(best.a.name)})` : ''}`;
}

function monetizationText() {
  const lines = store.data.accounts.map((a) => {
    const st = store.data.stats[a.id];
    if (!st) return `${pfIcon(a.platform)} <b>${h(a.name)}</b> — нет данных`;
    if (a.platform === 'youtube') {
      const m = st.monetization || {};
      const p = (x, max) => Math.min(100, Math.round(((x || 0) / max) * 100));
      return `🟥 <b>${h(a.name)}</b>\n   Подписчики: ${n(st.followers)}/1000 (${p(st.followers, 1000)}%)\n   Shorts за 90 дн: ${n(m.shortsViews90)}/10M (${p(m.shortsViews90, 1e7)}%)\n   Часы длинных за год: ${n(m.watchHours365)}/4000 (${p(m.watchHours365, 4000)}%)`;
    }
    const views30 = st.videos.filter((v) => Date.now() - new Date(v.publishedAt).getTime() < 30 * 864e5).reduce((s, v) => s + v.views, 0);
    return `⬛ <b>${h(a.name)}</b>\n   Подписчики: ${n(st.followers)}/10K (${Math.min(100, Math.round((st.followers / 1e4) * 100))}%)\n   Просмотры за 30 дн: ~${n(views30)}/100K (${Math.min(100, Math.round((views30 / 1e5) * 100))}%)`;
  });
  return '💰 <b>Прогресс монетизации</b>\n\n' + lines.join('\n\n');
}

function initTelegram() {
  tg = new TelegramBot(store, {
    onLinked: () => pushState(),
    commands: {
      stats: async () => '📊 <b>За 7 дней</b>\n\n' + summaryText(7),
      top: async () => {
        const list = periodVideos(7).sort((x, y) => y.v.views - x.v.views).slice(0, 8);
        if (!list.length) return 'За 7 дней видео нет.';
        return '🏆 <b>Лучшие за 7 дней</b>\n\n' + list.map((x, i) => `${i + 1}. «${h(x.v.title)}»\n   ${n(x.v.views)} 👁 · ${n(x.v.likes)} ❤️${x.v.avgViewPct ? ' · досмотр ' + Math.round(x.v.avgViewPct) + '%' : ''} — ${h(x.a.name)}`).join('\n');
      },
      weak: async () => {
        const list = periodVideos(7).filter((x) => Date.now() - new Date(x.v.publishedAt).getTime() > 864e5).sort((x, y) => x.v.views - y.v.views).slice(0, 6);
        if (!list.length) return 'Нет видео старше суток за последние 7 дней.';
        return '📉 <b>Меньше всего просмотров (7 дн)</b>\n\n' + list.map((x) => `• «${h(x.v.title)}» — ${n(x.v.views)} 👁${x.v.avgViewPct ? ', досмотр ' + Math.round(x.v.avgViewPct) + '%' : ''} (${h(x.a.name)})`).join('\n') + '\n\nПодробный разбор: /analyze';
      },
      queue: async () => {
        const items = [];
        for (const v of store.data.videos) for (const r of v.results || []) {
          if (['queued', 'scheduled'].includes(r.status)) items.push({ v, r, a: store.account(r.accountId) });
        }
        if (!items.length) return 'Ничего не запланировано.';
        items.sort((x, y) => new Date(x.v.scheduleAt) - new Date(y.v.scheduleAt));
        return '🗓 <b>Запланировано</b>\n\n' + items.map((x) => `• ${new Date(x.v.scheduleAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} — «${h(x.v.title)}» → ${h(x.a?.name)}`).join('\n');
      },
      drafts: async () => {
        const list = store.data.videos.filter((v) => v.status === 'draft').slice(0, 10);
        if (!list.length) return 'Черновиков нет.';
        return {
          text: '📝 <b>Черновики</b>\nНажми, чтобы выложить сейчас:\n\n' + list.map((v) => `• «${h(v.title || 'Без названия')}» → ${(v.accountIds || []).map((id) => h(store.account(id)?.name)).join(', ') || 'аккаунты не выбраны'}`).join('\n'),
          buttons: list.map((v) => [{ text: `🚀 ${(v.title || 'Без названия').slice(0, 40)}`, data: `pub:${v.id}` }]),
        };
      },
      money: async () => monetizationText(),
      refresh: async () => { await refreshStats().catch(() => {}); return '🔄 Статистика обновлена.\n\n' + summaryText(7); },
      analyze: async () => {
        await tg.send('🧠 Запускаю анализ, это займёт около минуты…');
        const r = await analyze({ days: 30 });
        return '🧠 <b>Разбор за 30 дней</b>\n\n' + mdToTg(r.text);
      },
    },
    callback: async (data) => {
      const [kind, id, accId] = data.split(':');
      if (kind === 'pub') {
        const v = store.data.videos.find((x) => x.id === id);
        if (!v) return 'Видео не найдено.';
        if (v.status !== 'draft') return 'Это видео уже выложено или в очереди.';
        publish(id, null).catch((e) => tg.send('❌ ' + h(e.message)));
        return `🚀 Начинаю загрузку «${h(v.title)}». Сообщу, когда выйдет.`;
      }
      if (kind === 'retry') {
        const v = store.data.videos.find((x) => x.id === id);
        const r = v?.results?.find((x) => x.accountId === accId);
        if (!r) return 'Нечего повторять.';
        runTarget(v, r);
        return '🔁 Пробую ещё раз…';
      }
      return null;
    },
  });
  tg.start();
}

async function videoDetail(accountId, videoId) {
  const acc = store.account(accountId);
  if (!acc) throw new Error('Аккаунт не найден');
  if (acc.platform !== 'youtube') return null;
  const v = store.data.stats[accountId]?.videos?.find((x) => x.id === videoId);
  const d = await youtube.fetchDetail(store, acc, videoId, v?.publishedAt);
  store.data.details[accountId + ':' + videoId] = d;
  store.save(); pushState();
  return d;
}

// ---------- Анализ ----------

function sampleRetention(ret) {
  if (!ret?.length) return undefined;
  const pts = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 0.95];
  return Object.fromEntries(pts.map((p) => {
    const row = ret.reduce((a, b) => (Math.abs(b[0] - p) < Math.abs(a[0] - p) ? b : a));
    return [`${Math.round(p * 100)}%`, +row[1].toFixed(2)];
  }));
}

// mode: 'auto' (Claude по API, если есть ключ, иначе бесплатно), 'local', 'claude', 'prompt' (только текст запроса)
async function analyze({ days = 30, accountIds = [], question = '', weakCount = 5, mode = 'auto' }) {
  const key = store.secret('anthropicKey');
  const since = Date.now() - days * 864e5;
  const accs = store.data.accounts.filter((a) => !accountIds.length || accountIds.includes(a.id));
  if (!accs.length) throw new Error('Нет аккаунтов для анализа');
  const missing = accs.filter((a) => !store.data.stats[a.id]);
  if (missing.length) await refreshStats().catch(() => {});
  const pairOf = {};
  for (const v of store.data.videos) for (const r of v.results || []) if (r.remoteId) pairOf[r.remoteId] = { pair: v.pairId || v.id, appTitle: v.title };
  const all = [];
  for (const acc of accs) {
    const st = store.data.stats[acc.id];
    for (const v of st?.videos || []) {
      if (new Date(v.publishedAt).getTime() < since) continue;
      if (new Date(v.publishedAt).getTime() > Date.now()) continue;
      all.push({ acc, v });
    }
  }
  if (!all.length) throw new Error(`За последние ${days} дн. нет опубликованных видео в выбранных аккаунтах. Обнови статистику или увеличь период.`);
  // Относительная оценка: просмотры с поправкой на возраст видео и средние по аккаунту
  const byAcc = {};
  for (const x of all) (byAcc[x.acc.id] ||= []).push(x.v.views);
  const median = (arr) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 1; };
  for (const x of all) x.score = x.v.views / Math.max(1, median(byAcc[x.acc.id]));
  const sorted = [...all].sort((a, b) => a.score - b.score);
  const weakest = sorted.slice(0, Math.min(weakCount, Math.max(1, Math.floor(all.length / 2))));
  const best = sorted.slice(-3).reverse();
  // Догружаем удержание для слабых и лучших (YouTube)
  for (const x of [...weakest, ...best]) {
    if (x.acc.platform !== 'youtube') continue;
    const k = x.acc.id + ':' + x.v.id;
    if (!store.data.details[k] || Date.now() - store.data.details[k].fetchedAt > 12 * 3600e3) {
      try { store.data.details[k] = await youtube.fetchDetail(store, x.acc, x.v.id, x.v.publishedAt); } catch (_) { /* */ }
    }
  }
  const row = (x) => {
    const d = store.data.details[x.acc.id + ':' + x.v.id];
    const ageDays = Math.max(0.1, (Date.now() - new Date(x.v.publishedAt).getTime()) / 864e5);
    return {
      platform: x.acc.platform, account: x.acc.name, lang: x.acc.lang || undefined, group: x.acc.group || undefined,
      title: x.v.title, description: x.v.description?.slice(0, 200), published: x.v.publishedAt,
      weekdayHour: new Date(x.v.publishedAt).toLocaleString('ru-RU', { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
      ageDays: +ageDays.toFixed(1), durationSec: x.v.duration, views: x.v.views, likes: x.v.likes, comments: x.v.comments,
      shares: x.v.shares, avgViewPct: x.v.avgViewPct, avgViewSec: x.v.avgViewDur, subsGained: x.v.subsGained,
      likeRate: x.v.views ? +((x.v.likes / x.v.views) * 100).toFixed(2) : 0,
      vsAccountMedian: +x.score.toFixed(2),
      retention: sampleRetention(d?.retention),
      traffic: d?.traffic?.slice(0, 4),
      pair: pairOf[x.v.id]?.pair,
    };
  };
  const payload = {
    days,
    accounts: accs.map((a) => ({ name: a.name, platform: a.platform, lang: a.lang, group: a.group, followers: a.followers })),
    totals: { videos: all.length, views: all.reduce((s, x) => s + x.v.views, 0) },
    weakest: weakest.map(row),
    best: best.map(row),
    all: all.length <= 60 ? all.map(row).map(({ retention, traffic, ...r }) => r) : undefined,
  };
  const prompt = ai.analysisPrompt(payload, question);
  if (mode === 'prompt') return { prompt: ai.SYSTEM + '\n\n' + prompt };
  const useClaude = mode === 'claude' || (mode === 'auto' && key);
  const text = useClaude ? await ai.ask(key, prompt) : analyzeLocal({ days, rows: all.map(row), weakest: weakest.map(row), best: best.map(row), accounts: accs });
  const entry = {
    id: store.id(), createdAt: Date.now(), days, question, source: useClaude ? 'claude-api' : 'local',
    accounts: accs.map((a) => a.name), text,
    weakest: weakest.map((x) => ({ accountId: x.acc.id, id: x.v.id, title: x.v.title, views: x.v.views, platform: x.acc.platform, account: x.acc.name, url: x.v.url })),
  };
  store.data.analyses.unshift(entry);
  store.data.analyses = store.data.analyses.slice(0, 50);
  store.save(); pushState();
  return entry;
}

function tgStatus() {
  return { status: tg?.status || 'off', botName: tg?.botName || '', error: tg?.lastError || '' };
}
function pushStatus() { send('tg', tgStatus()); }

// ---------- IPC ----------

function handle(name, fn) {
  ipcMain.handle(name, async (_e, ...args) => {
    try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: e.message || String(e) }; }
  });
}

function registerIpc() {
  handle('state:get', () => store.publicState());

  handle('settings:save', (patch) => {
    const s = store.data.settings;
    for (const [k, v] of Object.entries(patch)) {
      if (['googleClientSecret', 'tiktokClientSecret', 'anthropicKey'].includes(k)) { if (v) s[k] = store.enc(v.trim()); }
      else if (k in s) s[k] = typeof v === 'string' ? v.trim() : v;
    }
    store.save(); applyAutostart(); pushState();
  });
  handle('settings:clearSecret', (k) => { store.data.settings[k] = ''; store.save(); pushState(); });

  handle('dialog:pickVideo', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выбери видео', properties: ['openFile'],
      filters: [{ name: 'Видео', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const p = r.filePaths[0];
    return { path: p, size: fs.statSync(p).size, name: path.basename(p) };
  });
  handle('file:info', (p) => (fs.existsSync(p) ? { path: p, size: fs.statSync(p).size, name: path.basename(p) } : null));

  handle('account:add', async (platform) => {
    const acc = await PLATFORM[platform].connect(store);
    store.save(); pushState();
    refreshStats(acc.id).catch(() => {});
    return { id: acc.id, name: acc.name };
  });
  handle('account:update', (id, patch) => {
    const acc = store.account(id);
    if (!acc) throw new Error('Нет такого аккаунта');
    for (const k of ['lang', 'group', 'label', 'color', 'templateId']) if (k in patch) acc[k] = patch[k];
    store.save(); pushState();
  });
  handle('account:remove', (id) => {
    store.data.accounts = store.data.accounts.filter((a) => a.id !== id);
    delete store.data.stats[id];
    for (const v of store.data.videos) v.accountIds = (v.accountIds || []).filter((x) => x !== id);
    store.save(); pushState();
  });

  handle('video:save', (video) => {
    const list = store.data.videos;
    let v = list.find((x) => x.id === video.id);
    if (!v) { v = { id: store.id(), createdAt: Date.now(), status: 'draft', results: [] }; list.unshift(v); }
    for (const k of ['filePath', 'fileName', 'fileSize', 'durationSec', 'title', 'description', 'tags', 'accountIds', 'youtube', 'tiktok', 'pairId', 'lang', 'kind', 'note', 'plannedAt']) {
      if (k in video) v[k] = video[k];
    }
    store.save(); pushState();
    return v.id;
  });
  handle('video:delete', (id) => {
    if ([...busy].some((k) => k.startsWith(id + ':'))) throw new Error('Видео сейчас загружается');
    store.data.videos = store.data.videos.filter((v) => v.id !== id);
    store.save(); pushState();
  });
  handle('video:duplicate', (id) => {
    const v = store.data.videos.find((x) => x.id === id);
    if (!v) return null;
    const copy = { ...JSON.parse(JSON.stringify(v)), id: store.id(), createdAt: Date.now(), status: 'draft', results: [], scheduleAt: null, filePath: '', fileName: '', fileSize: 0, pairId: v.pairId || v.id };
    if (!v.pairId) v.pairId = v.id;
    store.data.videos.unshift(copy);
    store.save(); pushState();
    return copy.id;
  });
  handle('video:publish', (id, scheduleAt) => { publish(id, scheduleAt).catch((e) => notify('Ошибка', e.message)); return true; });
  handle('video:publishCheck', (id, scheduleAt) => {
    const v = store.data.videos.find((x) => x.id === id);
    if (!v) throw new Error('Видео не найдено');
    if (!v.accountIds?.length) throw new Error('Выбери хотя бы один канал/аккаунт');
    if (!v.filePath || !fs.existsSync(v.filePath)) throw new Error('Файл видео не найден — выбери файл заново');
    if (!v.title?.trim()) throw new Error('Впиши название');
    if (scheduleAt && new Date(scheduleAt) <= new Date()) throw new Error('Время публикации уже прошло');
    return true;
  });
  handle('video:retry', async (id, accountId) => {
    const v = store.data.videos.find((x) => x.id === id);
    const r = v?.results?.find((x) => x.accountId === accountId);
    if (!r) throw new Error('Нечего повторять');
    runTarget(v, r);
  });
  handle('video:cancelSchedule', (id) => {
    const v = store.data.videos.find((x) => x.id === id);
    if (!v) return;
    v.results = (v.results || []).filter((r) => r.status !== 'queued');
    if (!v.results.length) v.scheduleAt = null;
    v.status = videoStatus(v);
    store.save(); pushState();
  });

  handle('stats:refresh', (accountId) => refreshStats(accountId));
  handle('stats:detail', (accountId, videoId) => videoDetail(accountId, videoId));

  handle('ai:analyze', (opts) => analyze(opts));
  handle('analysis:import', ({ text, days, question, accountIds = [] }) => {
    if (!text || !text.trim()) throw new Error('Вставь ответ Claude');
    const names = store.data.accounts.filter((a) => !accountIds.length || accountIds.includes(a.id)).map((a) => a.name);
    const last = store.data.analyses.find((a) => a.days === days && a.weakest);
    const entry = { id: store.id(), createdAt: Date.now(), days, question, source: 'claude-chat', accounts: names, text: text.trim(), weakest: last?.weakest || [] };
    store.data.analyses.unshift(entry);
    store.data.analyses = store.data.analyses.slice(0, 50);
    store.save(); pushState();
    return entry;
  });
  handle('ai:titles', (opts) => ai.ask(store.secret('anthropicKey'), ai.titlesPrompt(opts), { effort: 'medium', maxTokens: 4000 }));
  handle('ai:ask', (q) => ai.ask(store.secret('anthropicKey'), q, { effort: 'medium', maxTokens: 8000 }));
  handle('analysis:delete', (id) => { store.data.analyses = store.data.analyses.filter((a) => a.id !== id); store.save(); pushState(); });

  handle('templates:save', (t) => {
    const list = store.data.templates;
    const ex = list.find((x) => x.id === t.id);
    if (ex) Object.assign(ex, t); else list.push({ ...t, id: store.id() });
    store.save(); pushState();
  });
  handle('templates:delete', (id) => { store.data.templates = store.data.templates.filter((x) => x.id !== id); store.save(); pushState(); });

  handle('tg:save', async (patch) => {
    const s = store.data.settings;
    if (patch.token) s.telegramToken = store.enc(patch.token.trim());
    s.telegram = { ...s.telegram, ...(patch.telegram || {}), notify: { ...s.telegram.notify, ...(patch.telegram?.notify || {}) } };
    if (!s.telegram.pairCode) s.telegram.pairCode = String(Math.floor(100000 + Math.random() * 900000));
    store.save();
    if (patch.token) await tg.start();
    pushState();
    return tgStatus();
  });
  handle('tg:status', () => tgStatus());
  handle('tg:test', async () => {
    if (!store.data.settings.telegram.chatId) throw new Error('Бот ещё не привязан — отправь ему /start КОД');
    await tg.send(`👋 Проверка связи. «${APP_NAME}» на связи!\n\n` + summaryText(7));
    return true;
  });
  handle('tg:unlink', () => { Object.assign(store.data.settings.telegram, { chatId: null, chatName: '', pairCode: String(Math.floor(100000 + Math.random() * 900000)) }); store.save(); pushState(); });
  handle('tg:removeToken', () => { tg.stop(); store.data.settings.telegramToken = ''; store.data.settings.telegram.chatId = null; store.save(); pushState(); });

  handle('shell:open', (url) => shell.openExternal(url));
  handle('shell:showFile', (p) => shell.showItemInFolder(p));
  handle('app:version', () => app.getVersion());
}

app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.on('before-quit', () => { quitting = true; try { store.saveNow(); } catch (_) { /* */ } });
app.on('window-all-closed', () => { if (!store?.data.settings.keepInTray) app.quit(); });

app.whenReady().then(() => {
  store = new Store();
  // если программа была закрыта во время загрузки — пометить как ошибку, чтобы можно было повторить
  for (const v of store.data.videos) {
    for (const r of v.results || []) if (r.status === 'uploading' || r.status === 'pending') Object.assign(r, { status: 'error', error: 'Загрузка прервалась (программа была закрыта)' });
    if (v.results?.length) v.status = videoStatus(v);
  }
  registerIpc();
  createWindow(process.argv.includes('--hidden'));
  createTray();
  applyAutostart();
  if (!store.data.settings.telegram.pairCode) { store.data.settings.telegram.pairCode = String(Math.floor(100000 + Math.random() * 900000)); store.save(); }
  initTelegram();
  setInterval(() => pushStatus(), 15e3);
  setInterval(tick, 30e3);
  setTimeout(tick, 5000);
});
