// YouTube: вход через Google, загрузка видео (сразу или по расписанию на стороне YouTube),
// статистика канала и видео, удержание аудитории.
const fs = require('fs');
const crypto = require('crypto');
const { shell } = require('electron');
const { jsonFetch, sendFile, pkce, oauthLoopback } = require('./util');

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
].join(' ');

const API = 'https://www.googleapis.com/youtube/v3';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2/reports';

function creds(store) {
  const id = store.data.settings.googleClientId;
  const secret = store.secret('googleClientSecret');
  if (!id || !secret) throw new Error('Сначала впиши Google Client ID и Client Secret в «Настройках».');
  return { id, secret };
}

async function connect(store) {
  const { id, secret } = creds(store);
  const state = crypto.randomBytes(12).toString('hex');
  const { verifier, challenge } = pkce();
  const loop = await oauthLoopback({ state });
  const redirect = `http://127.0.0.1:${loop.port}`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'true',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  await shell.openExternal(url);
  const { code } = await loop.result;
  const { data: tok } = await jsonFetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: id, client_secret: secret, redirect_uri: redirect,
      grant_type: 'authorization_code', code_verifier: verifier,
    }),
  });
  const tokens = { access: tok.access_token, refresh: tok.refresh_token, exp: Date.now() + (tok.expires_in - 60) * 1000 };
  const { data } = await jsonFetch(`${API}/channels?part=snippet,statistics,contentDetails&mine=true`, {
    headers: { Authorization: `Bearer ${tokens.access}` },
  });
  const ch = data.items?.[0];
  if (!ch) throw new Error('У этого Google-аккаунта нет YouTube-канала.');
  let acc = store.data.accounts.find((a) => a.platform === 'youtube' && a.remoteId === ch.id);
  if (!acc) {
    acc = { id: store.id(), platform: 'youtube', lang: '', group: '', createdAt: Date.now() };
    store.data.accounts.push(acc);
  }
  Object.assign(acc, {
    remoteId: ch.id,
    name: ch.snippet.title,
    avatar: ch.snippet.thumbnails?.default?.url || '',
    uploadsPlaylist: ch.contentDetails?.relatedPlaylists?.uploads,
    followers: Number(ch.statistics?.subscriberCount || 0),
    needsRelogin: false,
  });
  store.setTokens(acc, tokens);
  return acc;
}

async function token(store, acc) {
  const t = store.tokens(acc);
  if (t.access && t.exp > Date.now()) return t.access;
  if (!t.refresh) throw new Error(`Канал «${acc.name}»: нужен повторный вход.`);
  const { id, secret } = creds(store);
  try {
    const { data } = await jsonFetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, refresh_token: t.refresh, grant_type: 'refresh_token' }),
    });
    store.setTokens(acc, { ...t, access: data.access_token, exp: Date.now() + (data.expires_in - 60) * 1000 });
    return data.access_token;
  } catch (e) {
    if (e.status === 400 || e.status === 401) {
      acc.needsRelogin = true;
      store.save();
      throw new Error(`Канал «${acc.name}»: вход устарел, нажми «Войти заново» в настройках.`);
    }
    throw e;
  }
}

async function get(store, acc, url) {
  const t = await token(store, acc);
  const { data } = await jsonFetch(url, { headers: { Authorization: `Bearer ${t}` } });
  return data;
}

// Загрузка. scheduleAt — ISO-время; YouTube сам опубликует видео, компьютер может быть выключен.
async function upload(store, acc, video, { scheduleAt, onProgress, signal }) {
  const t = await token(store, acc);
  const size = fs.statSync(video.filePath).size;
  const yt = video.youtube || {};
  const lang = acc.lang || undefined;
  const meta = {
    snippet: {
      title: (video.title || 'Без названия').slice(0, 100),
      description: [video.description || '', (video.tags || []).map((x) => '#' + x).join(' ')].filter(Boolean).join('\n\n').slice(0, 5000),
      tags: video.tags || [],
      categoryId: yt.categoryId || '24',
      ...(lang ? { defaultLanguage: lang, defaultAudioLanguage: lang } : {}),
    },
    status: {
      privacyStatus: scheduleAt ? 'private' : (yt.privacy || 'public'),
      selfDeclaredMadeForKids: !!yt.madeForKids,
      ...(scheduleAt ? { publishAt: new Date(scheduleAt).toISOString() } : {}),
    },
  };
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${t}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': 'video/*',
    },
    body: JSON.stringify(meta),
    signal,
  });
  if (!init.ok) {
    const txt = await init.text();
    let msg = txt;
    try { msg = JSON.parse(txt).error.message; } catch (_) { /* */ }
    if (/quota/i.test(msg)) msg = 'Закончилась дневная квота YouTube API (≈6 загрузок в сутки на проект). Попробуй завтра или запроси увеличение квоты в Google Cloud.';
    throw new Error(msg);
  }
  const location = init.headers.get('location');
  const { data } = await sendFile(location, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/*' },
    file: video.filePath,
    start: 0,
    end: size - 1,
    onProgress,
    signal,
  });
  const isShort = (video.durationSec || 0) > 0 && video.durationSec <= 180;
  return {
    remoteId: data.id,
    url: isShort ? `https://youtube.com/shorts/${data.id}` : `https://youtu.be/${data.id}`,
    status: scheduleAt ? 'scheduled' : 'published',
  };
}

const isoDur = (s) => {
  const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(s || '') || [];
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
};
const today = () => new Date().toISOString().slice(0, 10);

// Статистика: последние ~100 видео канала + средний досмотр из YouTube Analytics
async function fetchStats(store, acc) {
  const ch = await get(store, acc, `${API}/channels?part=statistics,contentDetails&id=${acc.remoteId}`);
  const c = ch.items?.[0];
  acc.followers = Number(c?.statistics?.subscriberCount || 0);
  const uploads = acc.uploadsPlaylist || c?.contentDetails?.relatedPlaylists?.uploads;
  const ids = [];
  let pageToken = '';
  for (let i = 0; i < 2 && uploads; i++) {
    const pl = await get(store, acc, `${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}${pageToken ? '&pageToken=' + pageToken : ''}`);
    ids.push(...(pl.items || []).map((x) => x.contentDetails.videoId));
    pageToken = pl.nextPageToken;
    if (!pageToken) break;
  }
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const v = await get(store, acc, `${API}/videos?part=snippet,statistics,contentDetails,status&id=${ids.slice(i, i + 50).join(',')}`);
    for (const it of v.items || []) {
      const dur = isoDur(it.contentDetails?.duration);
      videos.push({
        id: it.id,
        title: it.snippet.title,
        description: (it.snippet.description || '').slice(0, 400),
        publishedAt: it.status?.publishAt || it.snippet.publishedAt,
        privacy: it.status?.privacyStatus,
        duration: dur,
        thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url,
        url: dur <= 180 ? `https://youtube.com/shorts/${it.id}` : `https://youtu.be/${it.id}`,
        views: Number(it.statistics?.viewCount || 0),
        likes: Number(it.statistics?.likeCount || 0),
        comments: Number(it.statistics?.commentCount || 0),
      });
    }
  }
  // Аналитика по всем видео одним запросом
  try {
    const rep = await get(store, acc, `${ANALYTICS}?` + new URLSearchParams({
      ids: 'channel==MINE', startDate: '2005-01-01', endDate: today(),
      metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,shares',
      dimensions: 'video', sort: '-views', maxResults: '200',
    }));
    const idx = Object.fromEntries((rep.columnHeaders || []).map((h, i) => [h.name, i]));
    const byId = Object.fromEntries((rep.rows || []).map((r) => [r[idx.video], r]));
    for (const v of videos) {
      const r = byId[v.id];
      if (!r) continue;
      v.avgViewDur = r[idx.averageViewDuration];
      v.avgViewPct = r[idx.averageViewPercentage];
      v.subsGained = r[idx.subscribersGained];
      v.shares = r[idx.shares];
      v.watchMinutes = r[idx.estimatedMinutesWatched];
    }
  } catch (e) {
    console.warn('analytics', e.message);
  }
  return { followers: acc.followers, videos };
}

// Подробно по одному видео: кривая удержания и источники трафика
async function fetchDetail(store, acc, videoId, publishedAt) {
  const start = (publishedAt ? new Date(publishedAt) : new Date(Date.now() - 365 * 864e5)).toISOString().slice(0, 10);
  const base = { ids: 'channel==MINE', startDate: start, endDate: today(), filters: `video==${videoId}` };
  const out = { fetchedAt: Date.now(), retention: [], traffic: [], daily: [] };
  try {
    const r = await get(store, acc, `${ANALYTICS}?` + new URLSearchParams({
      ...base, metrics: 'audienceWatchRatio,relativeRetentionPerformance', dimensions: 'elapsedVideoTimeRatio',
    }));
    out.retention = (r.rows || []).map(([x, w, rel]) => [x, w, rel]);
  } catch (e) { out.retentionError = e.message; }
  try {
    const r = await get(store, acc, `${ANALYTICS}?` + new URLSearchParams({
      ...base, metrics: 'views', dimensions: 'insightTrafficSourceType', sort: '-views',
    }));
    out.traffic = r.rows || [];
  } catch (e) { /* */ }
  try {
    const r = await get(store, acc, `${ANALYTICS}?` + new URLSearchParams({
      ...base, metrics: 'views,averageViewPercentage,subscribersGained', dimensions: 'day', sort: 'day',
    }));
    out.daily = r.rows || [];
  } catch (e) { /* */ }
  return out;
}

// Прогресс к Партнёрской программе YouTube:
// 1000 подписчиков + (10 млн просмотров Shorts за 90 дней ИЛИ 4000 часов просмотра длинных видео за 365 дней)
async function fetchMonetization(store, acc) {
  const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
  const out = { fetchedAt: Date.now(), subs: acc.followers || 0 };
  const byType = async (days) => {
    try {
      const r = await get(store, acc, `${ANALYTICS}?` + new URLSearchParams({
        ids: 'channel==MINE', startDate: daysAgo(days), endDate: today(),
        metrics: 'views,estimatedMinutesWatched', dimensions: 'creatorContentType',
      }));
      const rows = r.rows || [];
      const shorts = rows.filter((x) => String(x[0]).toUpperCase() === 'SHORTS');
      const longs = rows.filter((x) => String(x[0]).toUpperCase() !== 'SHORTS');
      return {
        shortsViews: shorts.reduce((s, x) => s + x[1], 0),
        longMinutes: longs.reduce((s, x) => s + x[2], 0),
        exact: true,
      };
    } catch (_) {
      const r = await get(store, acc, `${ANALYTICS}?` + new URLSearchParams({
        ids: 'channel==MINE', startDate: daysAgo(days), endDate: today(), metrics: 'views,estimatedMinutesWatched',
      }));
      const row = r.rows?.[0] || [0, 0];
      return { shortsViews: row[0], longMinutes: row[1], exact: false };
    }
  };
  const d90 = await byType(90);
  const d365 = await byType(365);
  out.shortsViews90 = d90.shortsViews;
  out.watchHours365 = Math.round(d365.longMinutes / 60);
  out.exact = d90.exact && d365.exact;
  return out;
}

// Сменить время публикации уже загруженного видео (iso) или открыть его сразу (iso = null)
async function setSchedule(store, acc, videoId, iso, madeForKids = false) {
  const t = await token(store, acc);
  const status = iso
    ? { privacyStatus: 'private', publishAt: new Date(iso).toISOString(), selfDeclaredMadeForKids: !!madeForKids }
    : { privacyStatus: 'public', selfDeclaredMadeForKids: !!madeForKids };
  await jsonFetch(`${API}/videos?part=status`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ id: videoId, status }),
  });
}

module.exports = { connect, upload, fetchStats, fetchDetail, fetchMonetization, setSchedule };
