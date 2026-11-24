/* VideoHub — интерфейс */
'use strict';

// ---------- Иконки ----------
const I = {
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="3"/><path d="m16 10 6-3v10l-6-3"/></svg>',
  send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/></svg>',
  brain: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.2 1 2V17h6v-.3c0-.8.4-1.5 1-2A7 7 0 0 0 12 2z"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8L20 10l-6.1 1.2L12 17l-1.9-5.8L4 10l6.1-1.2z"/><path d="M19 17l.8 2.2L22 20l-2.2.8L19 23l-.8-2.2L16 20l2.2-.8z"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/></svg>',
  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><path d="M7 2v20M17 2v20M2 12h20M2 7h5M2 17h5M17 17h5M17 7h5"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  yt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  tt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.6 3c.3 2.1 1.6 3.6 3.9 3.8v3.1c-1.4.1-2.7-.3-3.9-1v6.2c0 3.6-2.6 5.9-5.8 5.9-3.4 0-5.8-2.7-5.6-5.9.2-3 2.9-5.4 6.3-4.9v3.2c-1.6-.4-3.2.5-3.3 2-.1 1.4 1 2.5 2.5 2.5 1.6 0 2.6-1.1 2.6-2.8V3z"/></svg>',
};

// ---------- Утилиты ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n == null || isNaN(n) ? '—' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : Math.round(n).toLocaleString('ru-RU'));
const pct = (n) => (n == null || isNaN(n) ? '—' : `${Number(n).toFixed(0)}%`);
const dur = (s) => (!s && s !== 0 ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`);
const dt = (d) => (d ? new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dday = (d) => new Date(d).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'только что' : m < 60 ? `${m} мин назад` : m < 1440 ? `${Math.round(m / 60)} ч назад` : `${Math.round(m / 1440)} дн назад`; };
const fileUrl = (p) => 'file:///' + encodeURI(String(p).replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F');
const sizeMb = (b) => (b ? (b / 1048576).toFixed(1) + ' МБ' : '');
const toLocalInput = (d) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
const pf = (p) => `<span class="pf ${p}" title="${p === 'youtube' ? 'YouTube' : 'TikTok'}">${p === 'youtube' ? I.yt : I.tt}</span>`;
const langBadge = (l) => (l ? `<span class="badge ${l}">${l.toUpperCase()}</span>` : '');
const GROUPS = { stories: 'Истории', clips: 'Нарезки' };
const STATUS = {
  draft: 'Черновик', pending: 'В очереди', queued: 'Ждёт времени', uploading: 'Загружается', processing: 'Обрабатывается',
  scheduled: 'Запланировано', published: 'Опубликовано', inbox: 'Во «Входящих» TikTok', error: 'Ошибка',
};
const status = (s) => `<span class="status ${s}">${STATUS[s] || s}</span>`;

function toast(text, type = 'ok', ms = 4500) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type === 'err' ? 'err' : type === 'info' ? 'info' : '');
  el.textContent = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'err' ? 9000 : ms);
}

async function call(ch, ...args) {
  try { return await window.api.call(ch, ...args); } catch (e) { toast(e.message, 'err'); throw e; }
}

function md(src) {
  const lines = esc(src || '').split('\n');
  let out = '';
  let list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  const close = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const l of lines) {
    let m;
    if ((m = /^(#{1,3})\s+(.*)/.exec(l))) { close(); out += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; }
    else if ((m = /^\s*[-*•]\s+(.*)/.exec(l))) { if (list !== 'ul') { close(); out += '<ul>'; list = 'ul'; } out += `<li>${inline(m[1])}</li>`; }
    else if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== 'ol') { close(); out += '<ol>'; list = 'ol'; } out += `<li>${inline(m[1])}</li>`; }
    else if (!l.trim()) { close(); }
    else { close(); out += `<p>${inline(l)}</p>`; }
  }
  close();
  return out;
}

// ---------- Состояние ----------
let S = { settings: {}, accounts: [], videos: [], stats: {}, details: {}, analyses: [], templates: [] };
const ui = {
  page: localStorage.getItem('page') || 'videos',
  videoFilter: 'all',
  statsAcc: null,
  statsSel: null,
  statsSort: 'publishedAt',
  statsPeriod: 30,
  analysisSel: null,
  analysisRunning: false,
  analysisOpts: { days: 30, accountIds: [], question: '', weakCount: 5 },
  progress: {},
  refreshing: false,
};
const acc = (id) => S.accounts.find((a) => a.id === id);

const PAGES = [
  { id: 'videos', title: 'Видео', sub: 'Добавь ролики, впиши название и описание, выбери, куда выложить', icon: I.video },
  { id: 'published', title: 'Выложенные', sub: 'Что загружается, что запланировано и что уже вышло', icon: I.send },
  { id: 'stats', title: 'Статистика', sub: 'Цифры по каждому видео: просмотры, досмотр, где уходят зрители', icon: I.chart },
  { id: 'analysis', title: 'Анализ', sub: 'ИИ разбирает статистику и подсказывает, как улучшить видео', icon: I.brain },
  { id: 'calendar', title: 'Календарь', sub: 'Расписание публикаций по дням', icon: I.cal },
];
const PAGES2 = [{ id: 'settings', title: 'Аккаунты и настройки', sub: 'Каналы, TikTok-аккаунты, ключи доступа и инструкции', icon: I.gear }];

function renderNav() {
  const counts = {
    videos: S.videos.filter((v) => v.status === 'draft').length,
    published: S.videos.filter((v) => ['uploading', 'error'].includes(v.status)).length,
  };
  const btn = (p) => `<button class="${ui.page === p.id ? 'active' : ''}" data-page="${p.id}">${p.icon}<span>${p.title === 'Аккаунты и настройки' ? 'Настройки' : p.title}</span>${counts[p.id] ? `<span class="badge count">${counts[p.id]}</span>` : ''}</button>`;
  $('#nav').innerHTML = PAGES.map(btn).join('');
  $('#nav2').innerHTML = PAGES2.map(btn).join('');
  const yt = S.accounts.filter((a) => a.platform === 'youtube').length;
  const tt = S.accounts.filter((a) => a.platform === 'tiktok').length;
  $('#sideFoot').textContent = `${yt} YouTube · ${tt} TikTok`;
}

function render() {
  renderNav();
  const p = [...PAGES, ...PAGES2].find((x) => x.id === ui.page) || PAGES[0];
  $('#pageTitle').textContent = p.title;
  $('#pageSub').textContent = p.sub;
  const c = $('#content');
  const scroll = c.scrollTop;
  const fn = { videos: pageVideos, published: pagePublished, stats: pageStats, analysis: pageAnalysis, calendar: pageCalendar, settings: pageSettings }[p.id];
  const { html, actions = '' } = fn();
  $('#pageActions').innerHTML = actions;
  c.innerHTML = html;
  c.scrollTop = scroll;
  afterRender();
}

function afterRender() {
  // Превью: перемотать на 1-ю секунду, чтобы не было чёрного кадра
  document.querySelectorAll('video[data-preview]').forEach((v) => {
    v.addEventListener('loadedmetadata', () => { try { v.currentTime = Math.min(1, v.duration / 3); } catch (_) { /* */ } }, { once: true });
    v.addEventListener('error', () => { v.parentElement.innerHTML = `<div class="ph">${I.film}<span>Файл не найден</span></div>`; }, { once: true });
  });
}

function go(page) { ui.page = page; localStorage.setItem('page', page); document.querySelector('.content').scrollTop = 0; render(); }

// ---------- Страница «Видео» ----------
function targetChips(v) {
  return (v.accountIds || []).map((id) => {
    const a = acc(id);
    if (!a) return '';
    return `<span class="chip">${pf(a.platform)}${esc(a.name)} ${langBadge(a.lang)}</span>`;
  }).join('') || '<span class="dim small">Не выбрано, куда выкладывать</span>';
}

function pageVideos() {
  const drafts = S.videos.filter((v) => v.status === 'draft' && (ui.videoFilter === 'all' || v.kind === ui.videoFilter));
  const filter = `<div class="seg" id="vfilter">${[['all', 'Все'], ['stories', 'Истории'], ['clips', 'Нарезки']].map(([k, t]) => `<button data-vf="${k}" class="${ui.videoFilter === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const cards = drafts.map((v) => {
    const pair = v.pairId ? S.videos.find((x) => x.id !== v.id && (x.pairId === v.pairId || x.id === v.pairId)) : null;
    return `
    <div class="vcard" data-edit="${v.id}">
      <div class="thumb">
        ${v.filePath ? `<video data-preview muted preload="metadata" src="${fileUrl(v.filePath)}"></video>` : `<div class="ph">${I.film}<span>Видео не выбрано</span></div>`}
        <div class="corner">${langBadge(v.lang)}${v.kind ? `<span class="badge">${GROUPS[v.kind]}</span>` : ''}</div>
        ${v.durationSec ? `<span class="dur">${dur(v.durationSec)}</span>` : ''}
      </div>
      <div class="body">
        <div class="title">${esc(v.title || 'Без названия')}</div>
        <div class="targets">${targetChips(v)}</div>
        ${pair ? `<div class="small muted">🔗 Пара: ${esc(pair.title || 'без названия')} ${langBadge(pair.lang)}</div>` : ''}
        <div class="foot">
          <button class="btn sm green" data-publish="${v.id}">${I.send}Выложить</button>
          <button class="btn sm" data-schedule="${v.id}">${I.clock}На время</button>
          <span class="grow"></span>
          <button class="icon-btn" title="Сделать версию на другом языке" data-dup="${v.id}">${I.copy}</button>
          <button class="icon-btn" title="Удалить" data-del="${v.id}">${I.trash}</button>
        </div>
      </div>
    </div>`;
  }).join('');
  const noAcc = !S.accounts.length ? `<div class="info-box">Сначала добавь каналы YouTube и аккаунты TikTok во вкладке <b>«Настройки»</b> — там же пошаговая инструкция. <button class="btn sm violet" data-page="settings" style="margin-left:8px">Открыть настройки</button></div>` : '';
  return {
    actions: `${filter}<button class="btn primary" data-new>${I.plus}Новое видео</button>`,
    html: `${noAcc}<div class="grid cards">
      <div class="vcard new" data-new><div><div class="plus">${I.plus}</div><b>Добавить видео</b><div class="small">или перетащи файл в окно</div></div></div>
      ${cards}
    </div>
    ${!drafts.length ? '<div class="small dim" style="margin-top:14px">Здесь будут черновики. Опубликованные и запланированные видео — во вкладке «Выложенные».</div>' : ''}`,
  };
}

// ---------- Редактор видео ----------
function openEditor(id, preset = {}) {
  const src = S.videos.find((v) => v.id === id);
  const v = JSON.parse(JSON.stringify(src || {
    title: '', description: '', tags: [], accountIds: [], kind: 'stories', lang: '',
    youtube: { privacy: 'public', madeForKids: false, categoryId: '24' }, tiktok: { mode: 'direct', privacy: 'PUBLIC_TO_EVERYONE' },
  }));
  Object.assign(v, preset);
  v.youtube ||= { privacy: 'public', categoryId: '24' };
  v.tiktok ||= { mode: 'direct' };
  let aiText = '';
  let aiBusy = false;

  const root = $('#modalRoot');
  const draw = () => {
    const tagsStr = (v.tags || []).map((t) => '#' + t).join(' ');
    const others = S.videos.filter((x) => x.id !== v.id);
    const hasYt = v.accountIds.some((i) => acc(i)?.platform === 'youtube');
    const hasTt = v.accountIds.some((i) => acc(i)?.platform === 'tiktok');
    const accRow = (a) => `<label class="tgt ${v.accountIds.includes(a.id) ? 'on' : ''}">
        <input type="checkbox" data-acc="${a.id}" ${v.accountIds.includes(a.id) ? 'checked' : ''}>
        ${a.avatar ? `<img src="${esc(a.avatar)}">` : pf(a.platform)}
        <span class="grow">${esc(a.name)}</span>${langBadge(a.lang)}${a.group ? `<span class="badge">${GROUPS[a.group]}</span>` : ''}${pf(a.platform)}
      </label>`;
    root.innerHTML = `<div class="overlay"><div class="modal">
      <header><h2>${src ? 'Редактировать видео' : 'Новое видео'}</h2><span class="grow"></span><button class="icon-btn" data-close>${I.x}</button></header>
      <div class="mbody"><div class="editor">
        <div>
          <div class="drop" id="drop">
            ${v.filePath ? `<video controls src="${fileUrl(v.filePath)}" id="pv"></video><button class="btn sm change" id="pick">${I.folder}Заменить</button>`
              : `<div>${I.upload}<div style="margin-top:8px"><b>Выбери видео</b></div><div class="small">нажми или перетащи файл сюда</div></div>`}
          </div>
          ${v.filePath ? `<div class="small muted" style="margin-top:8px;word-break:break-all">${esc(v.fileName || v.filePath)} · ${sizeMb(v.fileSize)} ${v.durationSec ? '· ' + dur(v.durationSec) : ''}</div>` : ''}
          <div class="subcard" style="margin-top:14px">
            <h4>Тип и язык</h4>
            <div class="row wrap" style="margin-bottom:10px">
              <div class="seg">${[['stories', 'Истории'], ['clips', 'Нарезки']].map(([k, t]) => `<button data-kind="${k}" class="${v.kind === k ? 'on' : ''}">${t}</button>`).join('')}</div>
              <div class="seg">${[['ru', 'RU'], ['en', 'EN'], ['', '—']].map(([k, t]) => `<button data-lang="${k}" class="${(v.lang || '') === k ? 'on' : ''}">${t}</button>`).join('')}</div>
            </div>
            <div class="hint">Выбор языка и типа сам отметит подходящие каналы (язык и тип задаются у аккаунтов в настройках).</div>
          </div>
          <label class="field"><span>Пара (RU ↔ EN версия той же истории)</span>
            <select class="input" id="pair"><option value="">— нет —</option>
              ${others.map((x) => `<option value="${x.id}" ${(v.pairId && (x.id === v.pairId || x.pairId === v.pairId)) ? 'selected' : ''}>${esc((x.lang ? x.lang.toUpperCase() + ' · ' : '') + (x.title || 'Без названия'))}</option>`).join('')}
            </select>
          </label>
        </div>
        <div>
          ${S.templates.length ? `<label class="field"><span>Шаблон описания</span><select class="input" id="tpl"><option value="">— выбрать шаблон —</option>${S.templates.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label>` : ''}
          <label class="field"><span>Название <b class="counter ${(v.title || '').length > 100 ? 'over' : ''}" id="tcount">${(v.title || '').length}/100</b></span>
            <input class="input" id="title" value="${esc(v.title)}" placeholder="Например: Он нашёл в подвале письмо из 1953 года…"></label>
          <label class="field"><span>Описание</span>
            <textarea class="input" id="desc" rows="5" placeholder="О чём видео, призыв подписаться…">${esc(v.description)}</textarea></label>
          <label class="field"><span>Хэштеги</span>
            <input class="input" id="tags" value="${esc(tagsStr)}" placeholder="#истории #shorts #страшилки"></label>
          <div class="ai-box">
            <div class="row"><b>${I.spark.replace('<svg', '<svg width="16" height="16" style="vertical-align:-3px;color:var(--green)"')} Помощь ИИ</b><span class="grow"></span>
              <button class="btn sm violet" id="aiBtn" ${aiBusy ? 'disabled' : ''}>${aiBusy ? '<span class="spinner"></span>Думаю…' : 'Идеи названий, описание, хук'}</button></div>
            ${aiText ? `<div class="md small" style="margin-top:10px">${md(aiText)}</div>` : '<div class="hint">Claude предложит варианты названий, описание, хэштеги и идею для первых секунд.</div>'}
          </div>
          <div class="subcard">
            <h4>Куда выложить</h4>
            ${S.accounts.length ? `<div class="targets-box">${S.accounts.map(accRow).join('')}</div>` : '<div class="muted small">Нет аккаунтов — добавь их в «Настройках».</div>'}
          </div>
          ${hasYt ? `<div class="subcard"><h4>${pf('youtube')} Настройки YouTube</h4>
            <div class="row wrap">
              <label class="field grow" style="margin:0"><span>Доступ</span><select class="input" id="ytPriv">
                ${[['public', 'Открытый'], ['unlisted', 'По ссылке'], ['private', 'Скрытый']].map(([k, t]) => `<option value="${k}" ${v.youtube.privacy === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
              <label class="field grow" style="margin:0"><span>Категория</span><select class="input" id="ytCat">
                ${[['24', 'Развлечения'], ['22', 'Люди и блоги'], ['20', 'Игры'], ['1', 'Фильмы и анимация'], ['23', 'Юмор'], ['27', 'Образование']].map(([k, t]) => `<option value="${k}" ${v.youtube.categoryId === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
            </div>
            <label class="check"><input type="checkbox" id="ytKids" ${v.youtube.madeForKids ? 'checked' : ''}>Видео для детей</label>
            <div class="hint">При публикации «на время» видео загружается сразу как скрытое, и YouTube сам откроет его в нужный момент — компьютер можно выключить.</div>
          </div>` : ''}
          ${hasTt ? `<div class="subcard"><h4>${pf('tiktok')} Настройки TikTok</h4>
            <div class="seg" style="margin-bottom:8px">${[['direct', 'Опубликовать'], ['draft', 'В черновики TikTok']].map(([k, t]) => `<button data-ttmode="${k}" class="${v.tiktok.mode === k ? 'on' : ''}">${t}</button>`).join('')}</div>
            ${v.tiktok.mode === 'draft' ? '<div class="hint">Видео придёт во «Входящие» в приложении TikTok — останется добавить звук/подпись и опубликовать с телефона.</div>'
              : `${!S.settings.tiktokAudited ? '<div class="note-box" style="margin:8px 0 0">Пока TikTok не одобрил твоё приложение, видео публикуются как <b>приватные</b> («Только я»). После одобрения отметь это в настройках.</div>' : ''}
              <label class="check"><input type="checkbox" id="ttNoComm" ${v.tiktok.disableComment ? 'checked' : ''}>Отключить комментарии</label>`}
            <div class="hint">Публикация в TikTok «на время» сработает, только если VideoHub в этот момент запущен (можно свернуть в трей).</div>
          </div>` : ''}
        </div>
      </div></div>
      <footer>
        <button class="btn" data-save>Сохранить черновик</button>
        <span class="grow"></span>
        <input type="datetime-local" class="input" id="when" style="width:auto" value="${toLocalInput(v.plannedAt || Date.now() + 3600e3)}">
        <button class="btn violet" data-sched>${I.clock}Запланировать</button>
        <button class="btn green" data-now>${I.send}Выложить сейчас</button>
      </footer>
    </div></div>`;
    bind();
  };

  const collect = () => {
    v.title = $('#title').value.trim();
    v.description = $('#desc').value.trim();
    v.tags = $('#tags').value.split(/[\s,]+/).map((t) => t.replace(/^#/, '').trim()).filter(Boolean);
    if ($('#ytPriv')) { v.youtube.privacy = $('#ytPriv').value; v.youtube.categoryId = $('#ytCat').value; v.youtube.madeForKids = $('#ytKids').checked; }
    if ($('#ttNoComm')) v.tiktok.disableComment = $('#ttNoComm').checked;
    const pairSel = $('#pair').value;
    if (pairSel) {
      const other = S.videos.find((x) => x.id === pairSel);
      v.pairId = other?.pairId || pairSel;
    } else v.pairId = null;
    v.plannedAt = $('#when').value ? new Date($('#when').value).toISOString() : null;
  };

  const setFile = (info) => {
    if (!info) return;
    v.filePath = info.path; v.fileName = info.name; v.fileSize = info.size; v.durationSec = 0;
    if (!v.title) v.title = info.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    draw();
  };

  const save = async () => {
    collect();
    const newId = await call('video:save', v);
    v.id = newId;
    return newId;
  };

  const bind = () => {
    const close = () => { root.innerHTML = ''; };
    root.querySelector('[data-close]').onclick = close;
    root.querySelector('.overlay').onmousedown = (e) => { if (e.target.classList.contains('overlay')) { collect(); close(); } };
    const pv = $('#pv');
    if (pv) pv.addEventListener('loadedmetadata', () => { if (!v.durationSec) { v.durationSec = Math.round(pv.duration); } });
    const pick = async () => { collect(); setFile(await call('dialog:pickVideo')); };
    if (!v.filePath) $('#drop').onclick = pick;
    if ($('#pick')) $('#pick').onclick = (e) => { e.stopPropagation(); pick(); };
    const drop = $('#drop');
    drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const f = e.dataTransfer.files[0];
      if (!f) return;
      collect();
      setFile(await call('file:info', window.api.pathFor(f)));
    };
    $('#title').oninput = (e) => { const n = e.target.value.length; const c = $('#tcount'); c.textContent = `${n}/100`; c.classList.toggle('over', n > 100); };
    root.querySelectorAll('[data-acc]').forEach((cb) => { cb.onchange = () => { collect(); const id = cb.dataset.acc; v.accountIds = cb.checked ? [...new Set([...v.accountIds, id])] : v.accountIds.filter((x) => x !== id); draw(); }; });
    const autoPick = () => {
      const m = S.accounts.filter((a) => (!v.lang || !a.lang || a.lang === v.lang) && (!v.kind || !a.group || a.group === v.kind) && (a.lang || a.group));
      if (m.length) v.accountIds = m.map((a) => a.id);
    };
    root.querySelectorAll('[data-kind]').forEach((b) => { b.onclick = () => { collect(); v.kind = b.dataset.kind; autoPick(); draw(); }; });
    root.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => { collect(); v.lang = b.dataset.lang; autoPick(); draw(); }; });
    root.querySelectorAll('[data-ttmode]').forEach((b) => { b.onclick = () => { collect(); v.tiktok.mode = b.dataset.ttmode; draw(); }; });
    if ($('#tpl')) $('#tpl').onchange = (e) => {
      const t = S.templates.find((x) => x.id === e.target.value);
      if (!t) return;
      collect();
      if (t.description) v.description = v.description ? v.description + '\n\n' + t.description : t.description;
      if (t.tags) v.tags = [...new Set([...v.tags, ...t.tags.split(/[\s,]+/).map((x) => x.replace(/^#/, '')).filter(Boolean)])];
      draw();
    };
    $('#aiBtn').onclick = async () => {
      collect();
      aiBusy = true; draw();
      try { aiText = await call('ai:titles', { title: v.title, description: v.description, lang: v.lang, kind: v.kind }); } catch (_) { /* */ }
      aiBusy = false; draw();
    };
    root.querySelector('[data-save]').onclick = async () => { await save(); toast('Черновик сохранён'); close(); };
    root.querySelector('[data-now]').onclick = async () => {
      const vid = await save();
      try { await call('video:publishCheck', vid, null); } catch (_) { return; }
      await call('video:publish', vid, null);
      close(); toast('Загрузка началась — следи во вкладке «Выложенные»', 'info'); go('published');
    };
    root.querySelector('[data-sched]').onclick = async () => {
      const when = $('#when').value;
      if (!when) { toast('Выбери дату и время', 'err'); return; }
      const iso = new Date(when).toISOString();
      const vid = await save();
      try { await call('video:publishCheck', vid, iso); } catch (_) { return; }
      await call('video:publish', vid, iso);
      close(); toast(`Запланировано на ${dt(iso)}`, 'info'); go('published');
    };
  };
  draw();
}

function scheduleDialog(id) {
  const v = S.videos.find((x) => x.id === id);
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay"><div class="modal narrow">
    <header><h2>Выложить на время</h2><span class="grow"></span><button class="icon-btn" data-close>${I.x}</button></header>
    <div class="mbody">
      <div style="margin-bottom:12px"><b>${esc(v.title || 'Без названия')}</b></div>
      <label class="field"><span>Дата и время публикации</span><input type="datetime-local" class="input" id="when2" value="${toLocalInput(v.plannedAt || Date.now() + 3600e3)}"></label>
      <div class="row wrap" style="gap:6px;margin-bottom:12px">${[['Через час', 1], ['Через 3 ч', 3], ['Завтра 12:00', 'tm12'], ['Завтра 18:00', 'tm18']].map(([t, k]) => `<button class="btn sm" data-q="${k}">${t}</button>`).join('')}</div>
      <div class="hint">YouTube опубликует сам — компьютер можно выключить. TikTok выложится, если VideoHub будет запущен (хватит свернуть в трей).</div>
    </div>
    <footer><span class="grow"></span><button class="btn" data-close>Отмена</button><button class="btn violet" data-ok>${I.clock}Запланировать</button></footer>
  </div></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
  root.querySelectorAll('[data-q]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.q; const d = new Date();
      if (k.startsWith('tm')) { d.setDate(d.getDate() + 1); d.setHours(+k.slice(2), 0, 0, 0); } else d.setHours(d.getHours() + +k);
      $('#when2').value = toLocalInput(d);
    };
  });
  root.querySelector('[data-ok]').onclick = async () => {
    const iso = new Date($('#when2').value).toISOString();
    try { await call('video:publishCheck', id, iso); } catch (_) { return; }
    await call('video:publish', id, iso);
    close(); toast(`Запланировано на ${dt(iso)}`, 'info');
  };
}

// ---------- Страница «Выложенные» ----------
function pagePublished() {
  const list = S.videos.filter((v) => v.status !== 'draft');
  if (!list.length) return { html: `<div class="empty">${I.send}<h3>Пока ничего не выложено</h3><div>Добавь видео во вкладке «Видео» и нажми «Выложить».</div></div>` };
  const groups = [
    ['uploading', 'Загружаются сейчас'],
    ['error', 'С ошибками'],
    ['scheduled', 'Запланированы'],
    ['published', 'Выложены'],
  ];
  const row = (v) => `<div class="prow">
      <div class="info">
        <div class="row"><span class="title">${esc(v.title || 'Без названия')}</span>${langBadge(v.lang)}${status(v.status)}</div>
        <div class="small muted" style="margin-top:3px">${v.scheduleAt ? `${I.clock.replace('<svg', '<svg width="13" height="13" style="vertical-align:-2px"')} ${dt(v.scheduleAt)}${v.fileName ? ' · ' : ''}` : ''}${esc(v.fileName || '')}</div>
        <div class="targets">${(v.results || []).map((r) => {
          const a = acc(r.accountId);
          const p = ui.progress[v.id + ':' + r.accountId] ?? r.progress ?? 0;
          return `<div class="trow">${pf(r.platform || a?.platform)}<span class="name">${esc(a?.name || 'удалённый аккаунт')}</span>
            ${status(r.status)}
            ${r.status === 'uploading' ? `<div class="bar"><i style="width:${p}%"></i></div><span class="small muted">${p}%</span>` : ''}
            ${r.status === 'error' ? `<span class="err">${esc(r.error)}</span><button class="btn sm" data-retry="${v.id}|${r.accountId}">${I.refresh}Повторить</button>` : '<span class="grow"></span>'}
            ${r.private && r.status === 'published' ? '<span class="small dim">приватно</span>' : ''}
            ${r.url ? `<button class="btn sm ghost" data-open="${esc(r.url)}">${I.link}Открыть</button>` : ''}
          </div>`;
        }).join('')}</div>
      </div>
      <div class="row" style="gap:4px">
        ${(v.results || []).some((r) => r.status === 'queued') ? `<button class="btn sm" data-unsched="${v.id}">Отменить расписание TikTok</button>` : ''}
        <button class="icon-btn" title="Показать файл" data-showfile="${esc(v.filePath || '')}">${I.folder}</button>
        <button class="icon-btn" title="Удалить из списка" data-del="${v.id}">${I.trash}</button>
      </div>
    </div>`;
  const html = groups.map(([k, t]) => {
    const items = list.filter((v) => v.status === k).sort((a, b) => (k === 'scheduled' ? new Date(a.scheduleAt) - new Date(b.scheduleAt) : (b.createdAt || 0) - (a.createdAt || 0)));
    return items.length ? `<div class="section-title">${t} <span class="badge">${items.length}</span></div>${items.map(row).join('')}` : '';
  }).join('');
  return { html };
}

// ---------- Страница «Статистика» ----------
function retentionChart(ret, durationSec) {
  if (!ret?.length) return '<div class="muted small">Нет данных об удержании (их дают только для видео с достаточным числом просмотров).</div>';
  const W = 400; const H = 200; const pad = { l: 34, r: 10, t: 10, b: 24 };
  const maxY = Math.max(1, ...ret.map((r) => r[1])) * 1.05;
  const x = (v) => pad.l + v * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
  const line = ret.map((r, i) => `${i ? 'L' : 'M'}${x(r[0]).toFixed(1)},${y(r[1]).toFixed(1)}`).join('');
  const area = `${line}L${x(ret[ret.length - 1][0])},${y(0)}L${x(ret[0][0])},${y(0)}Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => `<line class="grid-line" x1="${x(0)}" x2="${x(1)}" y1="${y(t * maxY)}" y2="${y(t * maxY)}"/><text x="${pad.l - 6}" y="${y(t * maxY) + 4}" text-anchor="end">${Math.round(t * maxY * 100)}%</text>`).join('');
  const xt = [0, 0.25, 0.5, 0.75, 1].map((t) => `<text x="${x(t)}" y="${H - 6}" text-anchor="middle">${durationSec ? dur(t * durationSec) : Math.round(t * 100) + '%'}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="rg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9b6bff" stop-opacity=".45"/><stop offset="1" stop-color="#3ddc97" stop-opacity=".03"/></linearGradient></defs>
    ${ticks}${xt}<path d="${area}" fill="url(#rg)"/><path d="${line}" fill="none" stroke="#b28cff" stroke-width="2.2"/>
  </svg>`;
}

function sparkline(h) {
  if (!h || h.length < 2) return '<div class="muted small">История появится после нескольких обновлений статистики.</div>';
  const W = 400; const H = 90;
  const t0 = h[0][0]; const t1 = h[h.length - 1][0]; const v0 = Math.min(...h.map((x) => x[1])); const v1 = Math.max(...h.map((x) => x[1]));
  const x = (t) => 6 + ((t - t0) / Math.max(1, t1 - t0)) * (W - 12);
  const y = (v) => H - 8 - ((v - v0) / Math.max(1, v1 - v0)) * (H - 16);
  const d = h.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  return `<svg class="chart" style="height:90px" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><path d="${d}" fill="none" stroke="#3ddc97" stroke-width="2.2"/></svg>
    <div class="small muted">${fmt(h[0][1])} → ${fmt(h[h.length - 1][1])} просмотров с ${dt(t0)}</div>`;
}

const TRAFFIC = { SHORTS: 'Лента Shorts', YT_SEARCH: 'Поиск', SUBSCRIBER: 'Подписчики', RELATED_VIDEO: 'Рекомендации', BROWSE: 'Главная', EXT_URL: 'Внешние сайты', NOTIFICATION: 'Уведомления', YT_CHANNEL: 'Канал', PLAYLIST: 'Плейлисты', NO_LINK_OTHER: 'Прямые/другое', YT_OTHER_PAGE: 'Другие страницы YouTube', HASHTAGS: 'Хэштеги', SOUND_PAGE: 'Страница звука', END_SCREEN: 'Конечные заставки' };

function statsDetail(a, v) {
  const d = S.details[a.id + ':' + v.id];
  const likeRate = v.views ? ((v.likes / v.views) * 100).toFixed(1) : '—';
  const engagement = v.views ? (((v.likes + v.comments + (v.shares || 0)) / v.views) * 100).toFixed(1) : '—';
  let hook = '';
  if (d?.retention?.length && v.duration) {
    const at = (sec) => { const r = sec / v.duration; return d.retention.reduce((p, c) => (Math.abs(c[0] - r) < Math.abs(p[0] - r) ? c : p))[1]; };
    hook = `<div class="grid tiles" style="grid-template-columns:repeat(3,1fr);margin-top:10px">
      <div class="tile"><div class="k">Остались на 3 сек</div><div class="v">${pct(at(3) * 100)}</div></div>
      <div class="tile"><div class="k">На середине</div><div class="v">${pct(at(v.duration / 2) * 100)}</div></div>
      <div class="tile"><div class="k">До конца</div><div class="v">${pct(d.retention[d.retention.length - 1][1] * 100)}</div></div>
    </div>`;
  }
  const traffic = d?.traffic?.length ? (() => {
    const max = Math.max(...d.traffic.map((t) => t[1]));
    return d.traffic.slice(0, 6).map(([k, n]) => `<div class="hbar"><span>${TRAFFIC[k] || k}</span><div class="b"><i style="width:${(n / max) * 100}%"></i></div><span class="num">${fmt(n)}</span></div>`).join('');
  })() : '';
  return `<div class="card detail">
    <div class="row" style="align-items:flex-start">
      ${v.thumb ? `<img src="${esc(v.thumb)}" style="width:110px;border-radius:8px">` : ''}
      <div class="grow"><b>${esc(v.title)}</b><div class="small muted">${dt(v.publishedAt)} · ${dur(v.duration)}</div>
        ${v.url ? `<button class="btn sm ghost" style="margin-top:6px;padding-left:0" data-open="${esc(v.url)}">${I.link}Открыть видео</button>` : ''}</div>
    </div>
    <div class="grid tiles" style="grid-template-columns:repeat(3,1fr);margin-top:14px">
      <div class="tile accent"><div class="k">Просмотры</div><div class="v">${fmt(v.views)}</div></div>
      <div class="tile"><div class="k">Лайки</div><div class="v">${fmt(v.likes)}</div><div class="d muted">${likeRate}% от просм.</div></div>
      <div class="tile"><div class="k">Вовлечённость</div><div class="v">${engagement}%</div></div>
      ${a.platform === 'youtube' ? `
      <div class="tile"><div class="k">Средний досмотр</div><div class="v">${pct(v.avgViewPct)}</div></div>
      <div class="tile"><div class="k">Ср. время</div><div class="v">${dur(v.avgViewDur)}</div></div>
      <div class="tile"><div class="k">Подписки</div><div class="v">${fmt(v.subsGained)}</div></div>` : `
      <div class="tile"><div class="k">Комменты</div><div class="v">${fmt(v.comments)}</div></div>
      <div class="tile"><div class="k">Репосты</div><div class="v">${fmt(v.shares)}</div></div>`}
    </div>
    ${a.platform === 'youtube' ? `
      <div class="section-title">Удержание — где уходят зрители
        <span class="grow"></span><button class="btn sm" data-detail="${a.id}|${v.id}">${I.refresh}${d ? 'Обновить' : 'Загрузить'}</button></div>
      ${d ? retentionChart(d.retention, v.duration) + hook : '<div class="muted small">Нажми «Загрузить», чтобы получить кривую удержания и источники просмотров.</div>'}
      ${d?.retention?.length ? '<div class="hint">Значения выше 100% — зрители пересматривают (зацикливание Shorts). Резкий спад в самом начале — слабый хук.</div>' : ''}
      ${traffic ? `<div class="section-title">Откуда пришли зрители</div>${traffic}` : ''}`
    : '<div class="note-box" style="margin-top:14px">TikTok не даёт сторонним программам кривую удержания и данные о свайпах — их можно посмотреть только в TikTok Studio. Здесь — просмотры, лайки, комментарии и репосты.</div>'}
    <div class="section-title">Рост просмотров</div>
    ${sparkline(S.stats[a.id]?.history?.[v.id])}
  </div>`;
}

function pageStats() {
  if (!S.accounts.length) return { html: `<div class="empty">${I.chart}<h3>Нет аккаунтов</h3><div>Добавь каналы в «Настройках», и здесь появится статистика.</div></div>` };
  if (!ui.statsAcc || !acc(ui.statsAcc)) ui.statsAcc = S.accounts[0].id;
  const a = acc(ui.statsAcc);
  const st = S.stats[a.id];
  const tabs = `<div class="acc-tabs">${S.accounts.map((x) => `<span class="chip click ${x.id === a.id ? 'sel' : ''}" data-sacc="${x.id}">${pf(x.platform)}${esc(x.name)} ${langBadge(x.lang)}</span>`).join('')}</div>`;
  const actions = `<span class="small muted">${st ? 'Обновлено ' + ago(st.fetchedAt) : ''}</span>
    <div class="seg">${[7, 30, 90, 365].map((d) => `<button data-speriod="${d}" class="${ui.statsPeriod === d ? 'on' : ''}">${d === 365 ? 'Год' : d + ' дн'}</button>`).join('')}</div>
    <button class="btn primary" data-srefresh ${ui.refreshing ? 'disabled' : ''}>${ui.refreshing ? '<span class="spinner"></span>Обновляю…' : I.refresh + 'Обновить всё'}</button>`;
  if (!st) return { actions, html: `${tabs}<div class="empty">${I.chart}<h3>Статистика ещё не загружена</h3><button class="btn primary" data-srefresh>${I.refresh}Загрузить</button></div>` };
  const since = Date.now() - ui.statsPeriod * 864e5;
  const vids = st.videos.filter((v) => new Date(v.publishedAt).getTime() >= since && new Date(v.publishedAt).getTime() <= Date.now());
  const sum = (k) => vids.reduce((s, v) => s + (v[k] || 0), 0);
  const withPct = vids.filter((v) => v.avgViewPct != null);
  const avgPct = withPct.length ? withPct.reduce((s, v) => s + v.avgViewPct, 0) / withPct.length : null;
  const fh = st.followersHistory || [];
  const fPrev = fh.find((p) => p[0] >= since);
  const fDelta = fPrev ? st.followers - fPrev[1] : 0;
  const sortKey = ui.statsSort;
  const sorted = [...vids].sort((x, y) => (sortKey === 'publishedAt' ? new Date(y.publishedAt) - new Date(x.publishedAt) : (y[sortKey] || 0) - (x[sortKey] || 0)));
  const sel = sorted.find((v) => v.id === ui.statsSel) || sorted[0];
  const th = (k, t, num = true) => `<th class="${num ? 'num' : ''}" data-ssort="${k}">${t}${sortKey === k ? ' ▾' : ''}</th>`;
  const avgViews = vids.length ? sum('views') / vids.length : 0;
  const html = `${tabs}
    <div class="grid tiles" style="margin-bottom:16px">
      <div class="tile accent"><div class="k">Подписчики</div><div class="v">${fmt(st.followers)}</div><div class="d ${fDelta >= 0 ? 'up' : 'down'}">${fDelta ? (fDelta > 0 ? '+' : '') + fmt(fDelta) + ' за период' : '&nbsp;'}</div></div>
      <div class="tile"><div class="k">Видео за период</div><div class="v">${vids.length}</div></div>
      <div class="tile"><div class="k">Просмотры (этих видео)</div><div class="v">${fmt(sum('views'))}</div><div class="d muted">в среднем ${fmt(avgViews)} на видео</div></div>
      <div class="tile"><div class="k">Лайки</div><div class="v">${fmt(sum('likes'))}</div></div>
      ${a.platform === 'youtube' ? `<div class="tile"><div class="k">Средний досмотр</div><div class="v">${pct(avgPct)}</div></div>` : `<div class="tile"><div class="k">Репосты</div><div class="v">${fmt(sum('shares'))}</div></div>`}
    </div>
    ${vids.length ? `<div class="stats-layout">
      <div class="card" style="padding:6px 8px;overflow:auto">
        <table class="t"><thead><tr>${th('publishedAt', 'Видео', false)}${th('views', 'Просм.')}${th('likes', 'Лайки')}${th('comments', 'Комм.')}${a.platform === 'youtube' ? th('avgViewPct', 'Досмотр') + th('subsGained', 'Подп.') : th('shares', 'Репосты')}</tr></thead>
        <tbody>${sorted.map((v) => `<tr class="rowlink ${sel && v.id === sel.id ? 'sel' : ''}" data-ssel="${v.id}">
          <td><div class="vt">${v.thumb ? `<img src="${esc(v.thumb)}">` : ''}<div style="min-width:0"><div class="tt">${esc(v.title)}</div><div class="small dim">${dt(v.publishedAt)} · ${dur(v.duration)}</div></div></div></td>
          <td class="num"><b class="${v.views < avgViews * 0.5 ? 'down' : v.views > avgViews * 1.5 ? 'up' : ''}">${fmt(v.views)}</b></td><td class="num">${fmt(v.likes)}</td><td class="num">${fmt(v.comments)}</td>
          ${a.platform === 'youtube' ? `<td class="num">${pct(v.avgViewPct)}</td><td class="num">${fmt(v.subsGained)}</td>` : `<td class="num">${fmt(v.shares)}</td>`}
        </tr>`).join('')}</tbody></table>
      </div>
      ${sel ? statsDetail(a, sel) : ''}
    </div>` : `<div class="empty">${I.chart}<h3>За этот период видео нет</h3><div>Выбери период побольше.</div></div>`}`;
  return { actions, html };
}

// ---------- Страница «Анализ» ----------
function pageAnalysis() {
  const o = ui.analysisOpts;
  const cur = S.analyses.find((x) => x.id === ui.analysisSel) || S.analyses[0];
  const hist = S.analyses.map((x) => `<div class="hist-item ${cur && x.id === cur.id ? 'on' : ''}" data-asel="${x.id}">
      <div class="row"><b class="small">${dt(x.createdAt)}</b><span class="grow"></span><span class="badge">${x.days} дн</span></div>
      <div class="small muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.question || x.accounts.join(', '))}</div></div>`).join('');
  const html = `<div class="analysis-layout">
    <div>
      <div class="card">
        <h3>${I.spark.replace('<svg', '<svg width="18" height="18" style="color:var(--green)"')} Новый анализ</h3>
        <label class="field"><span>Период</span>
          <div class="seg">${[7, 14, 30, 90].map((d) => `<button data-aperiod="${d}" class="${o.days === d ? 'on' : ''}">${d} дн</button>`).join('')}</div></label>
        <label class="field"><span>Аккаунты <span class="dim">(ничего не выбрано = все)</span></span>
          <div class="row wrap" style="gap:6px">${S.accounts.map((x) => `<span class="chip click ${o.accountIds.includes(x.id) ? 'sel' : ''}" data-aacc="${x.id}">${pf(x.platform)}${esc(x.name)} ${langBadge(x.lang)}</span>`).join('') || '<span class="muted small">Нет аккаунтов</span>'}</div></label>
        <label class="field"><span>Сколько слабых видео разобрать</span>
          <select class="input" id="aweak">${[3, 5, 8, 10].map((n) => `<option ${o.weakCount === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Свой вопрос (необязательно)</span>
          <textarea class="input" id="aq" rows="3" placeholder="Например: что добавить в видео, чтобы досматривали до конца? Какое время публикации лучше?">${esc(o.question)}</textarea></label>
        <button class="btn primary" style="width:100%;justify-content:center" data-arun ${ui.analysisRunning || !S.settings.hasAnthropicKey ? 'disabled' : ''}>${ui.analysisRunning ? '<span class="spinner"></span>Анализирую…' : I.brain + 'Запустить анализ'}</button>
        ${!S.settings.hasAnthropicKey ? '<div class="hint">Для анализа нужен ключ Claude — добавь его в «Настройках».</div>' : '<div class="hint">Программа обновит статистику, найдёт видео, которые набрали меньше всего просмотров относительно твоих обычных, загрузит их удержание и попросит Claude сделать выводы.</div>'}
      </div>
      ${hist ? `<div class="section-title">История анализов</div><div class="card" style="padding:6px">${hist}</div>` : ''}
    </div>
    <div>
      ${ui.analysisRunning ? `<div class="card loading-card" style="margin-bottom:16px"><span class="spinner"></span><div><b>Собираю статистику и думаю…</b><div class="small muted">Обычно это занимает 30–90 секунд.</div></div></div>` : ''}
      ${cur ? `<div class="card">
        <div class="row"><h3 style="margin:0">Разбор за ${cur.days} дн</h3><span class="small muted">${dt(cur.createdAt)} · ${esc(cur.accounts.join(', '))}</span><span class="grow"></span>
          <button class="icon-btn" title="Копировать текст" data-acopy="${cur.id}">${I.copy}</button><button class="icon-btn" title="Удалить" data-adel="${cur.id}">${I.trash}</button></div>
        ${cur.question ? `<div class="info-box" style="margin-top:12px">Вопрос: ${esc(cur.question)}</div>` : ''}
        ${cur.weakest?.length ? `<div class="section-title">Меньше всего просмотров</div>${cur.weakest.map((w) => `<div class="weak">${pf(w.platform)}<span class="grow">${esc(w.title)}<span class="small dim"> · ${esc(w.account)}</span></span><b class="down">${fmt(w.views)}</b>
          ${w.url ? `<button class="icon-btn" data-open="${esc(w.url)}">${I.link}</button>` : ''}<button class="icon-btn" title="Статистика" data-gostat="${w.accountId}|${w.id}">${I.chart}</button></div>`).join('')}` : ''}
        <div class="md" style="margin-top:10px">${md(cur.text)}</div>
      </div>` : !ui.analysisRunning ? `<div class="empty">${I.brain}<h3>Анализов пока нет</h3><div>Выбери период слева и нажми «Запустить анализ».</div></div>` : ''}
    </div>
  </div>`;
  return { html };
}

// ---------- Страница «Календарь» ----------
function pageCalendar() {
  const items = [];
  for (const v of S.videos) {
    if (v.scheduleAt && v.status !== 'draft') items.push({ t: v.scheduleAt, v, kind: 'sched' });
    else if (v.status === 'draft' && v.plannedAt) items.push({ t: v.plannedAt, v, kind: 'plan' });
  }
  const future = items.filter((x) => new Date(x.t).getTime() > Date.now() - 864e5).sort((a, b) => new Date(a.t) - new Date(b.t));
  if (!future.length) return { html: `<div class="empty">${I.cal}<h3>Расписание пустое</h3><div>Запланируй видео — и оно появится здесь по дням.</div></div>` };
  const byDay = {};
  for (const x of future) (byDay[new Date(x.t).toDateString()] ||= []).push(x);
  const html = Object.entries(byDay).map(([d, list]) => `<div class="cal-day"><div class="d">${dday(d)}</div>
    ${list.map((x) => `<div class="trow" style="margin-bottom:6px;cursor:pointer" ${x.kind === 'plan' ? `data-edit="${x.v.id}"` : ''}>
      <b style="min-width:52px">${new Date(x.t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</b>
      <span class="grow">${esc(x.v.title || 'Без названия')}</span>${langBadge(x.v.lang)}
      ${(x.v.accountIds || []).map((id) => acc(id)).filter(Boolean).map((a) => pf(a.platform)).join('')}
      ${x.kind === 'plan' ? '<span class="status draft">Черновик (не запланирован)</span>' : status(x.v.status)}
    </div>`).join('')}</div>`).join('');
  return { html: `<div class="card">${html}</div>` };
}

// ---------- Страница «Настройки» ----------
function pageSettings() {
  const s = S.settings;
  const accRow = (a) => `<div class="acc-row">
    ${a.avatar ? `<img class="av" src="${esc(a.avatar)}">` : `<div class="av-ph">${pf(a.platform)}</div>`}
    <div class="grow"><div class="row" style="gap:8px">${pf(a.platform)}<b>${esc(a.name)}</b>${a.needsRelogin ? '<span class="status error">нужен вход</span>' : ''}</div>
      <div class="small muted">${fmt(a.followers)} подписчиков</div></div>
    <select class="input" data-alang="${a.id}" title="Язык">${[['', 'Язык —'], ['ru', 'RU'], ['en', 'EN']].map(([k, t]) => `<option value="${k}" ${(a.lang || '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <select class="input" data-agroup="${a.id}" title="Тип контента">${[['', 'Тип —'], ['stories', 'Истории'], ['clips', 'Нарезки']].map(([k, t]) => `<option value="${k}" ${(a.group || '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
    <button class="btn sm" data-relogin="${a.platform}">${I.refresh}Войти заново</button>
    <button class="icon-btn" data-arm="${a.id}" title="Удалить">${I.trash}</button>
  </div>`;
  const secret = (k, has, ph) => `<div class="keyline"><input class="input" type="password" id="${k}" placeholder="${has ? '•••••••• сохранено (впиши новый, чтобы заменить)' : ph}">${has ? `<span class="ok-dot">✓ сохранён</span>` : ''}</div>`;
  const html = `<div class="grid two" style="align-items:start">
    <div>
      <div class="card" style="margin-bottom:16px">
        <h3>Аккаунты <small>— задай язык и тип, тогда при добавлении видео нужные отметятся сами</small></h3>
        ${S.accounts.length ? S.accounts.map(accRow).join('') : '<div class="muted small" style="margin-bottom:10px">Пока нет аккаунтов.</div>'}
        <div class="row" style="margin-top:12px">
          <button class="btn" data-addacc="youtube">${pf('youtube')}Добавить YouTube-канал</button>
          <button class="btn" data-addacc="tiktok">${pf('tiktok')}Добавить TikTok</button>
        </div>
        <div class="hint">YouTube: вход откроется в браузере, выбери нужный канал. Каждый канал добавляется отдельно.<br>TikTok: каждый раз открывается чистое окно входа — можно добавить сколько угодно аккаунтов.</div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h3>Ключи доступа</h3>
        <div class="subcard"><h4>${pf('youtube')} Google (YouTube)</h4>
          <label class="field"><span>Client ID</span><input class="input" id="googleClientId" value="${esc(s.googleClientId)}" placeholder="xxxx.apps.googleusercontent.com"></label>
          <label class="field" style="margin:0"><span>Client Secret</span>${secret('googleClientSecret', s.hasGoogleSecret, 'GOCSPX-…')}</label>
        </div>
        <div class="subcard"><h4>${pf('tiktok')} TikTok</h4>
          <label class="field"><span>Client Key</span><input class="input" id="tiktokClientKey" value="${esc(s.tiktokClientKey)}"></label>
          <label class="field"><span>Client Secret</span>${secret('tiktokClientSecret', s.hasTiktokSecret, '')}</label>
          <label class="field" style="margin:0"><span>Redirect URI (должен совпадать с указанным в TikTok)</span><input class="input" id="tiktokRedirectUri" value="${esc(s.tiktokRedirectUri)}"></label>
          <label class="check"><input type="checkbox" id="tiktokAudited" ${s.tiktokAudited ? 'checked' : ''}>TikTok одобрил приложение (можно публиковать открыто)</label>
        </div>
        <div class="subcard" style="margin:0"><h4>${I.spark.replace('<svg', '<svg width="16" height="16" style="color:var(--green)"')} Claude (для анализа)</h4>
          <label class="field" style="margin:0"><span>API-ключ Anthropic</span>${secret('anthropicKey', s.hasAnthropicKey, 'sk-ant-…')}</label>
        </div>
        <div class="row" style="margin-top:14px"><button class="btn primary" data-savekeys>Сохранить ключи</button></div>
      </div>
      <div class="card">
        <h3>Программа</h3>
        <label class="check"><input type="checkbox" id="autostart" ${s.autostart ? 'checked' : ''}>Запускать вместе с Windows (свёрнутой в трей)</label>
        <label class="check"><input type="checkbox" id="keepInTray" ${s.keepInTray ? 'checked' : ''}>При закрытии окна сворачивать в трей (нужно для расписания TikTok)</label>
        <label class="field" style="margin-top:8px"><span>Автообновление статистики</span>
          <select class="input" id="statsAutoRefreshHours">${[[0, 'Выключено'], [3, 'Каждые 3 часа'], [6, 'Каждые 6 часов'], [12, 'Каждые 12 часов'], [24, 'Раз в сутки']].map(([k, t]) => `<option value="${k}" ${+s.statsAutoRefreshHours === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      </div>
    </div>
    <div>
      <div class="card" style="margin-bottom:16px">
        <h3>Шаблоны описаний и хэштегов</h3>
        ${S.templates.map((t) => `<div class="trow" style="margin-bottom:6px"><b class="grow">${esc(t.name)}</b><button class="icon-btn" data-tedit="${t.id}">${I.edit}</button><button class="icon-btn" data-tdel="${t.id}">${I.trash}</button></div>`).join('') || '<div class="muted small">Например: «RU истории» — с призывом подписаться и постоянными хэштегами.</div>'}
        <button class="btn sm" style="margin-top:10px" data-tnew>${I.plus}Новый шаблон</button>
      </div>
      <div class="card">
        <h3>Инструкции по подключению</h3>
        <details class="guide"><summary>1. YouTube — получить Client ID и Secret (≈10 минут, один раз)</summary><ol>
          <li>Открой <a href="#" data-open="https://console.cloud.google.com/projectcreate">console.cloud.google.com</a> и создай проект (например, «VideoHub»).</li>
          <li>Меню → «APIs &amp; Services» → «Library». Найди и включи <b>YouTube Data API v3</b> и <b>YouTube Analytics API</b>.</li>
          <li>«OAuth consent screen» (или «Google Auth Platform»): тип <b>External</b>, впиши название и свою почту.</li>
          <li>В разделе «Audience» нажми <b>Publish app</b> («В рабочем режиме»). Иначе Google будет выкидывать из аккаунта каждые 7 дней. Проверку проходить не нужно — при входе просто нажми «Дополнительно → Перейти».</li>
          <li>«Credentials» / «Clients» → «Create client» → тип <b>Desktop app</b>.</li>
          <li>Скопируй Client ID и Client Secret сюда, нажми «Сохранить ключи», затем «Добавить YouTube-канал».</li>
          <li>Лимит Google по умолчанию — около <b>6 загрузок в сутки</b> на проект. Если нужно больше — подай запрос на увеличение квоты в Google Cloud или сделай второй проект.</li>
        </ol></details>
        <details class="guide"><summary>2. TikTok — Client Key и Secret</summary><ol>
          <li>Зайди на <a href="#" data-open="https://developers.tiktok.com/">developers.tiktok.com</a> → «Manage apps» → «Connect an app».</li>
          <li>Платформа: <b>Desktop</b>. Заполни описание, ссылки на политику конфиденциальности и условия (можно простые страницы).</li>
          <li>Добавь продукты <b>Login Kit</b> и <b>Content Posting API</b> (включи «Direct Post»). Scopes: <code>user.info.basic</code>, <code>user.info.stats</code>, <code>video.list</code>, <code>video.publish</code>, <code>video.upload</code>.</li>
          <li>В Login Kit укажи Redirect URI: <code>${esc(s.tiktokRedirectUri)}</code></li>
          <li>Пока приложение не прошло проверку, добавь свои аккаунты в «Sandbox → Target users» — так можно входить и загружать (видео будут приватными, или отправляй в черновики).</li>
          <li>Отправь приложение на проверку (Submit for review). После одобрения поставь галочку «TikTok одобрил приложение» — видео будут выходить открыто.</li>
        </ol></details>
        <details class="guide"><summary>3. Claude — ключ для анализа</summary><ol>
          <li>Открой <a href="#" data-open="https://console.anthropic.com/settings/keys">console.anthropic.com</a>, войди и пополни баланс (хватит $5–10 надолго).</li>
          <li>«API Keys» → «Create Key», скопируй ключ <code>sk-ant-…</code> сюда.</li>
          <li>Один анализ стоит примерно несколько центов.</li>
        </ol></details>
        <details class="guide"><summary>Как работает расписание</summary><ol>
          <li><b>YouTube</b>: при нажатии «Запланировать» видео сразу загружается скрытым с датой публикации. Дальше YouTube сам его откроет — компьютер можно выключить.</li>
          <li><b>TikTok</b>: TikTok не умеет публиковать по времени через API, поэтому VideoHub выкладывает видео сам в нужный момент. Программа должна быть запущена (свёрнута в трей). Если компьютер был выключен, видео выйдет сразу после включения.</li>
        </ol></details>
      </div>
    </div>
  </div>`;
  return { html };
}

function templateDialog(id) {
  const t = S.templates.find((x) => x.id === id) || { name: '', description: '', tags: '' };
  const root = $('#modalRoot');
  root.innerHTML = `<div class="overlay"><div class="modal narrow">
    <header><h2>${id ? 'Шаблон' : 'Новый шаблон'}</h2><span class="grow"></span><button class="icon-btn" data-close>${I.x}</button></header>
    <div class="mbody">
      <label class="field"><span>Название шаблона</span><input class="input" id="tn" value="${esc(t.name)}" placeholder="RU истории"></label>
      <label class="field"><span>Текст, который добавится в описание</span><textarea class="input" id="td" rows="5" placeholder="Подписывайся, чтобы не пропустить новые истории!">${esc(t.description)}</textarea></label>
      <label class="field"><span>Хэштеги</span><input class="input" id="tg" value="${esc(t.tags)}" placeholder="#истории #shorts"></label>
    </div>
    <footer><span class="grow"></span><button class="btn" data-close>Отмена</button><button class="btn primary" data-ok>Сохранить</button></footer>
  </div></div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelectorAll('[data-close]').forEach((b) => { b.onclick = close; });
  root.querySelector('[data-ok]').onclick = async () => {
    const name = $('#tn').value.trim();
    if (!name) { toast('Впиши название шаблона', 'err'); return; }
    await call('templates:save', { ...(id ? { id } : {}), name, description: $('#td').value.trim(), tags: $('#tg').value.trim() });
    close();
  };
}

// ---------- События ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-page],[data-new],[data-edit],[data-publish],[data-schedule],[data-dup],[data-del],[data-vf],[data-retry],[data-open],[data-unsched],[data-showfile],[data-sacc],[data-speriod],[data-srefresh],[data-ssort],[data-ssel],[data-detail],[data-aperiod],[data-aacc],[data-arun],[data-asel],[data-adel],[data-acopy],[data-gostat],[data-addacc],[data-relogin],[data-arm],[data-savekeys],[data-tnew],[data-tedit],[data-tdel]');
  if (!t || t.closest('#modalRoot .modal') && !t.dataset.open) return;
  const d = t.dataset;
  if (d.open) { e.preventDefault(); call('shell:open', d.open); return; }
  if (d.page) return go(d.page);
  if ('new' in d) return openEditor(null);
  if (d.publish) {
    try { await call('video:publishCheck', d.publish, null); } catch (_) { return; }
    await call('video:publish', d.publish, null);
    toast('Загрузка началась', 'info');
    return;
  }
  if (d.schedule) return scheduleDialog(d.schedule);
  if (d.dup) {
    const src = S.videos.find((x) => x.id === d.dup);
    const id = await call('video:duplicate', d.dup);
    const lang = src.lang === 'ru' ? 'en' : src.lang === 'en' ? 'ru' : '';
    const ids = S.accounts.filter((a) => a.lang === lang && (!src.kind || !a.group || a.group === src.kind)).map((a) => a.id);
    return openEditor(id, { lang, ...(ids.length ? { accountIds: ids } : {}) });
  }
  if (d.del) { if (confirm('Удалить видео из программы? (файл на диске и видео на каналах останутся)')) await call('video:delete', d.del); return; }
  if (d.edit) return openEditor(d.edit);
  if (d.vf) { ui.videoFilter = d.vf; return render(); }
  if (d.retry) { const [v, a] = d.retry.split('|'); return call('video:retry', v, a); }
  if (d.unsched) return call('video:cancelSchedule', d.unsched);
  if ('showfile' in d) { if (d.showfile) call('shell:showFile', d.showfile); return; }
  if (d.sacc) { ui.statsAcc = d.sacc; ui.statsSel = null; return render(); }
  if (d.speriod) { ui.statsPeriod = +d.speriod; return render(); }
  if (d.ssort) { ui.statsSort = d.ssort; return render(); }
  if (d.ssel) { ui.statsSel = d.ssel; return render(); }
  if ('srefresh' in d) {
    ui.refreshing = true; render();
    try { await call('stats:refresh'); toast('Статистика обновлена'); } catch (_) { /* */ }
    ui.refreshing = false; render();
    return;
  }
  if (d.detail) {
    const [a, v] = d.detail.split('|');
    t.disabled = true; t.innerHTML = '<span class="spinner"></span>Загружаю…';
    try { await call('stats:detail', a, v); } catch (_) { render(); }
    return;
  }
  if (d.gostat) { const [a, v] = d.gostat.split('|'); ui.statsAcc = a; ui.statsSel = v; ui.statsPeriod = 365; return go('stats'); }
  if (d.aperiod) { ui.analysisOpts.question = $('#aq')?.value || ''; ui.analysisOpts.days = +d.aperiod; return render(); }
  if (d.aacc) {
    ui.analysisOpts.question = $('#aq')?.value || '';
    const l = ui.analysisOpts.accountIds;
    ui.analysisOpts.accountIds = l.includes(d.aacc) ? l.filter((x) => x !== d.aacc) : [...l, d.aacc];
    return render();
  }
  if ('arun' in d) {
    ui.analysisOpts.question = $('#aq').value.trim();
    ui.analysisOpts.weakCount = +$('#aweak').value;
    ui.analysisRunning = true; render();
    try { const r = await call('ai:analyze', ui.analysisOpts); ui.analysisSel = r.id; ui.analysisOpts.question = ''; } catch (_) { /* */ }
    ui.analysisRunning = false; render();
    return;
  }
  if (d.asel) { ui.analysisSel = d.asel; return render(); }
  if (d.adel) { if (confirm('Удалить этот анализ?')) await call('analysis:delete', d.adel); return; }
  if (d.acopy) { const a = S.analyses.find((x) => x.id === d.acopy); navigator.clipboard.writeText(a.text); toast('Скопировано'); return; }
  if (d.addacc || d.relogin) {
    const p = d.addacc || d.relogin;
    toast(p === 'youtube' ? 'Открываю вход Google в браузере…' : 'Открываю окно входа TikTok…', 'info');
    try { const r = await call('account:add', p); toast(`Подключено: ${r.name}`); } catch (_) { /* */ }
    return;
  }
  if (d.arm) { const a = acc(d.arm); if (confirm(`Отключить «${a.name}» от программы?`)) await call('account:remove', d.arm); return; }
  if ('savekeys' in d) {
    const patch = {
      googleClientId: $('#googleClientId').value, tiktokClientKey: $('#tiktokClientKey').value, tiktokRedirectUri: $('#tiktokRedirectUri').value,
      googleClientSecret: $('#googleClientSecret').value, tiktokClientSecret: $('#tiktokClientSecret').value, anthropicKey: $('#anthropicKey').value,
    };
    await call('settings:save', patch);
    toast('Ключи сохранены');
    return;
  }
  if ('tnew' in d) return templateDialog(null);
  if (d.tedit) return templateDialog(d.tedit);
  if (d.tdel) { if (confirm('Удалить шаблон?')) await call('templates:delete', d.tdel); }
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.closest('#modalRoot')) return;
  if (t.dataset.alang) return call('account:update', t.dataset.alang, { lang: t.value });
  if (t.dataset.agroup) return call('account:update', t.dataset.agroup, { group: t.value });
  if (['autostart', 'keepInTray', 'tiktokAudited'].includes(t.id)) return call('settings:save', { [t.id]: t.checked });
  if (t.id === 'statsAutoRefreshHours') return call('settings:save', { statsAutoRefreshHours: +t.value });
});

// Перетаскивание файла в окно — сразу новое видео
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  if ($('#modalRoot').innerHTML) return;
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const info = await call('file:info', window.api.pathFor(f));
  if (info) openEditor(null, { filePath: info.path, fileName: info.name, fileSize: info.size, title: info.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') });
});

window.api.on('state', (s) => {
  S = s;
  // не перерисовывать поверх активного ввода на странице настроек
  const a = document.activeElement;
  if (ui.page === 'settings' && a && a.closest('.content') && ['INPUT', 'TEXTAREA'].includes(a.tagName) && a.type !== 'checkbox') return renderNav();
  if (ui.page === 'analysis' && a?.id === 'aq') { ui.analysisOpts.question = a.value; }
  render();
});
window.api.on('progress', ({ videoId, accountId, pct: p }) => {
  ui.progress[videoId + ':' + accountId] = p;
  if (ui.page !== 'published' || ui._raf) return;
  ui._raf = setTimeout(() => { ui._raf = null; render(); }, 400);
});

(async () => {
  S = await call('state:get');
  render();
})();
