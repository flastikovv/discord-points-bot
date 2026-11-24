// Общие помощники: HTTP-запросы, загрузка файла с прогрессом, OAuth-петля.
const http = require('http');
const https = require('https');
const fs = require('fs');
const crypto = require('crypto');

async function jsonFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || data?.error?.code
      || (typeof data?.error === 'string' ? data.error : '') || text.slice(0, 300);
    const err = new Error(`HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return { data, res };
}

// PUT/POST куска файла с отслеживанием прогресса
function sendFile(url, { method = 'PUT', headers = {}, file, start = 0, end, onProgress }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const length = end - start + 1;
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { ...headers, 'Content-Length': length },
    }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let data = null;
        try { data = body ? JSON.parse(body) : null; } catch (_) { data = { raw: body }; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ status: res.statusCode, data });
        else reject(new Error(`Загрузка: HTTP ${res.statusCode} ${data?.error?.message || body.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    let sent = 0;
    const stream = fs.createReadStream(file, { start, end });
    stream.on('data', (chunk) => {
      sent += chunk.length;
      if (onProgress) onProgress(sent, length);
    });
    stream.on('error', reject);
    stream.pipe(req);
  });
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function pkce(hex = false) {
  const verifier = b64url(crypto.randomBytes(48)).replace(/[^A-Za-z0-9]/g, '').slice(0, 64);
  const hash = crypto.createHash('sha256').update(verifier).digest();
  return { verifier, challenge: hex ? hash.toString('hex') : b64url(hash) };
}

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>VideoHub</title>
<body style="font-family:Segoe UI,sans-serif;background:#0f0d17;color:#e9e4ff;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><div style="font-size:48px">✅</div><h2>Готово!</h2><p>Можно закрыть эту вкладку и вернуться в VideoHub.</p></div>`;

// Локальный сервер, который ловит ответ OAuth (?code=...)
function oauthLoopback({ port = 0, host = '127.0.0.1', state }) {
  return new Promise((resolveStart, rejectStart) => {
    let finish;
    let fail;
    const result = new Promise((a, b) => { finish = a; fail = b; });
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://localhost');
      const p = Object.fromEntries(u.searchParams);
      if (!p.code && !p.error) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(DONE_PAGE);
      if (state && p.state !== state) fail(new Error('Неверный state в ответе авторизации'));
      else if (p.error) fail(new Error(p.error_description || p.error));
      else finish(p);
    });
    server.on('error', rejectStart);
    server.listen(port, host, () => {
      const timer = setTimeout(() => fail(new Error('Время ожидания входа истекло (5 минут)')), 5 * 60 * 1000);
      result.finally(() => { clearTimeout(timer); server.close(); }).catch(() => {});
      resolveStart({ port: server.address().port, result, close: () => { clearTimeout(timer); server.close(); fail(new Error('Отменено')); } });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { jsonFetch, sendFile, pkce, oauthLoopback, sleep, b64url, DONE_PAGE };
