// TikTok: вход (каждый аккаунт в отдельном чистом окне — можно добавить сколько угодно аккаунтов),
// загрузка видео (публикация или отправка в черновики/входящие TikTok), статистика видео.
const fs = require('fs');
const crypto = require('crypto');
const { BrowserWindow } = require('electron');
const { jsonFetch, sendFile, pkce, sleep, oauthLoopback } = require('./util');

const API = 'https://open.tiktokapis.com/v2';
const SCOPES = 'user.info.basic,user.info.stats,video.list,video.publish,video.upload';

function creds(store) {
  const key = store.data.settings.tiktokClientKey;
  const secret = store.secret('tiktokClientSecret');
  const redirect = store.data.settings.tiktokRedirectUri;
  if (!key || !secret) throw new Error('Сначала впиши TikTok Client Key и Client Secret в «Настройках».');
  return { key, secret, redirect };
}

// Окно входа с отдельной «чистой» сессией браузера, чтобы каждый раз можно было войти в другой аккаунт.
function loginWindow(url, redirect, state) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 480, height: 760, title: 'Вход в TikTok', autoHideMenuBar: true,
      webPreferences: { partition: 'tt-login-' + crypto.randomBytes(6).toString('hex') },
    });
    let done = false;
    const check = (e, target) => {
      if (!target.startsWith(redirect.replace(/\/$/, ''))) return;
      e?.preventDefault?.();
      const u = new URL(target);
      const p = Object.fromEntries(u.searchParams);
      done = true;
      win.close();
      if (p.error) reject(new Error(p.error_description || p.error));
      else if (p.state !== state) reject(new Error('Неверный state'));
      else resolve(p);
    };
    win.webContents.on('will-redirect', check);
    win.webContents.on('will-navigate', check);
    win.on('closed', () => { if (!done) reject(new Error('Окно входа закрыто')); });
    win.loadURL(url);
  });
}

async function connect(store) {
  const { key, secret, redirect } = creds(store);
  const state = crypto.randomBytes(12).toString('hex');
  // В TikTok для десктопных приложений code_challenge = SHA256 в hex
  const { verifier, challenge } = pkce(true);
  const url = 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
    client_key: key, scope: SCOPES, response_type: 'code', redirect_uri: redirect, state,
    code_challenge: challenge, code_challenge_method: 'S256',
  });
  // Запасной вариант: если TikTok всё же откроет адрес возврата — его поймает локальный сервер
  let loop = null;
  try {
    const u = new URL(redirect);
    if (['localhost', '127.0.0.1'].includes(u.hostname) && u.port) loop = await oauthLoopback({ port: +u.port, host: 'localhost', state });
  } catch (_) { /* порт занят — не страшно */ }
  let params;
  try {
    params = await Promise.race([loginWindow(url, redirect, state), ...(loop ? [loop.result] : [])]);
  } finally {
    loop?.close();
  }
  const { data: tok } = await jsonFetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_key: key, client_secret: secret, code: decodeURIComponent(params.code),
      grant_type: 'authorization_code', redirect_uri: redirect, code_verifier: verifier,
    }),
  });
  if (tok.error) throw new Error(tok.error_description || tok.error);
  const tokens = {
    access: tok.access_token, refresh: tok.refresh_token,
    exp: Date.now() + (tok.expires_in - 120) * 1000,
    refreshExp: Date.now() + (tok.refresh_expires_in || 0) * 1000,
    scope: tok.scope,
  };
  const info = await userInfo(tokens.access);
  let acc = store.data.accounts.find((a) => a.platform === 'tiktok' && a.remoteId === tok.open_id);
  if (!acc) {
    acc = { id: store.id(), platform: 'tiktok', lang: '', group: '', createdAt: Date.now() };
    store.data.accounts.push(acc);
  }
  Object.assign(acc, {
    remoteId: tok.open_id, name: info.display_name || 'TikTok', avatar: info.avatar_url || '',
    followers: info.follower_count || 0, needsRelogin: false,
  });
  store.setTokens(acc, tokens);
  return acc;
}

async function userInfo(access) {
  const { data } = await jsonFetch(`${API}/user/info/?fields=open_id,display_name,avatar_url,follower_count,likes_count,video_count`, {
    headers: { Authorization: `Bearer ${access}` },
  });
  return data?.data?.user || {};
}

async function token(store, acc) {
  const t = store.tokens(acc);
  if (t.access && t.exp > Date.now()) return t.access;
  const { key, secret } = creds(store);
  try {
    const { data } = await jsonFetch(`${API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: key, client_secret: secret, grant_type: 'refresh_token', refresh_token: t.refresh || '' }),
    });
    if (data.error || !data.access_token) throw Object.assign(new Error(data.error_description || data.error), { status: 401 });
    store.setTokens(acc, { ...t, access: data.access_token, refresh: data.refresh_token || t.refresh, exp: Date.now() + (data.expires_in - 120) * 1000 });
    return data.access_token;
  } catch (e) {
    acc.needsRelogin = true;
    store.save();
    throw new Error(`TikTok «${acc.name}»: вход устарел, нажми «Войти заново» в настройках.`);
  }
}

async function post(store, acc, path, body) {
  const t = await token(store, acc);
  const { data } = await jsonFetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body || {}),
  });
  if (data?.error && data.error.code && data.error.code !== 'ok') {
    throw new Error(`TikTok: ${data.error.message || data.error.code}`);
  }
  return data?.data;
}

async function creatorInfo(store, acc) {
  return post(store, acc, '/post/publish/creator_info/query/', {});
}

function chunks(size) {
  const MB = 1024 * 1024;
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

// mode: 'direct' — опубликовать сразу; 'draft' — отправить во «Входящие» TikTok, дальше выложить с телефона
async function upload(store, acc, video, { onProgress }) {
  const size = fs.statSync(video.filePath).size;
  const { chunkSize, count } = chunks(size);
  const tt = video.tiktok || {};
  const mode = tt.mode || 'direct';
  const source = { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count };
  let init;
  if (mode === 'draft') {
    init = await post(store, acc, '/post/publish/inbox/video/init/', { source_info: source });
  } else {
    const info = await creatorInfo(store, acc);
    const options = info?.privacy_level_options || ['SELF_ONLY'];
    let privacy = tt.privacy || 'PUBLIC_TO_EVERYONE';
    if (!store.data.settings.tiktokAudited) privacy = 'SELF_ONLY';
    if (!options.includes(privacy)) privacy = options.includes('SELF_ONLY') ? 'SELF_ONLY' : options[0];
    const caption = [video.title, video.description, (video.tags || []).map((x) => '#' + x).join(' ')]
      .filter(Boolean).join('\n\n').slice(0, 2200);
    init = await post(store, acc, '/post/publish/video/init/', {
      post_info: {
        title: caption, privacy_level: privacy,
        disable_comment: !!tt.disableComment, disable_duet: false, disable_stitch: false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: source,
    });
  }
  const { publish_id: publishId, upload_url: uploadUrl } = init;
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
    await sendFile(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}` },
      file: video.filePath, start, end,
      onProgress: (sent) => onProgress?.(start + sent, size),
    });
  }
  // Ждём обработку
  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const st = await post(store, acc, '/post/publish/status/fetch/', { publish_id: publishId });
    if (st.status === 'FAILED') throw new Error('TikTok отклонил видео: ' + (st.fail_reason || 'неизвестная причина'));
    if (st.status === 'SEND_TO_USER_INBOX') return { remoteId: publishId, status: 'inbox', url: '' };
    if (st.status === 'PUBLISH_COMPLETE') {
      const postId = (st.publicaly_available_post_id || st.publicly_available_post_id || [])[0];
      return {
        remoteId: postId ? String(postId) : publishId,
        status: 'published',
        url: '', // ссылку подтянет обновление статистики
        private: !store.data.settings.tiktokAudited,
      };
    }
  }
  return { remoteId: publishId, status: 'processing', url: '' };
}

async function fetchStats(store, acc) {
  const t = await token(store, acc);
  try {
    const info = await userInfo(t);
    acc.followers = info.follower_count || acc.followers;
    acc.name = info.display_name || acc.name;
  } catch (_) { /* */ }
  const videos = [];
  let cursor;
  for (let i = 0; i < 5; i++) {
    const fields = 'id,title,video_description,create_time,cover_image_url,share_url,duration,view_count,like_count,comment_count,share_count';
    const { data } = await jsonFetch(`${API}/video/list/?fields=${fields}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ max_count: 20, ...(cursor ? { cursor } : {}) }),
    });
    const d = data?.data || {};
    for (const v of d.videos || []) {
      videos.push({
        id: v.id,
        title: v.title || (v.video_description || '').slice(0, 80) || '(без подписи)',
        description: (v.video_description || '').slice(0, 400),
        publishedAt: new Date(v.create_time * 1000).toISOString(),
        duration: v.duration || 0,
        thumb: v.cover_image_url,
        url: v.share_url,
        views: v.view_count || 0,
        likes: v.like_count || 0,
        comments: v.comment_count || 0,
        shares: v.share_count || 0,
      });
    }
    if (!d.has_more) break;
    cursor = d.cursor;
  }
  return { followers: acc.followers, videos };
}

module.exports = { connect, upload, fetchStats, creatorInfo };
