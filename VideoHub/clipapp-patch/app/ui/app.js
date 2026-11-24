"use strict";
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
let S = {};            // settings
let AN = null;         // analysis {source, info, moments, ...}
let polling = null, lastJobKind = null, lastExport = null;

const FONTS = ["Impact", "Arial Black", "Segoe UI Black", "Bahnschrift", "Arial", "Verdana", "Tahoma", "Calibri",
  "Trebuchet MS", "Georgia", "Comic Sans MS", "Montserrat", "Roboto", "Oswald", "Bebas Neue"];

async function api(path, body) {
  const r = await fetch("/api/" + path, body === undefined ? {} : {
    method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j;
}
function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, err ? 7000 : 3500);
}
const media = p => "/media?p=" + encodeURIComponent(p) + "&t=" + Date.now();
function fmt(t, frac) {
  t = Math.max(0, +t || 0);
  const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60);
  let r = (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  if (frac) r += "." + Math.floor((t % 1) * 10);
  return r;
}
function parseT(s) {
  s = String(s).trim().replace(",", "."); if (!s) return NaN;
  return s.split(":").reduce((a, p) => a * 60 + parseFloat(p), 0);
}

// ------------------------------------------------------------------ settings binding (data-k="a.b")
function getK(k) { return k.split(".").reduce((o, p) => o == null ? undefined : o[p], S); }
function setK(k, v) {
  const ps = k.split("."); let o = S;
  ps.slice(0, -1).forEach(p => { if (typeof o[p] !== "object" || o[p] === null) o[p] = {}; o = o[p]; });
  o[ps.at(-1)] = v;
}
let saveT = null;
function saveSoon() { clearTimeout(saveT); saveT = setTimeout(() => api("settings", {settings: S}).catch(() => {}), 500); }

function fillFonts() {
  $$("select.fontsel").forEach(sel => {
    sel.innerHTML = FONTS.map(f => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join("");
  });
}
function renderSettings() {
  $$("[data-k]").forEach(el => {
    const k = el.dataset.k, v = getK(k);
    if (el.classList.contains("seg") || el.classList.contains("swatches")) {
      $$("button", el).forEach(b => b.classList.toggle("on", String(v) === b.dataset.v));
    } else if (el.type === "checkbox") el.checked = !!v;
    else if (el.tagName === "SELECT" && v !== undefined && ![...el.options].some(o => o.value === String(v))) {
      el.add(new Option(String(v), String(v))); el.value = String(v);
    } else if (v !== undefined && document.activeElement !== el) el.value = v;
  });
  $$("output[data-o]").forEach(o => o.textContent = getK(o.dataset.o) + (o.dataset.suf || ""));
  applyShow(); drawSubPrev(); drawHlPrev();
}
function bindSettings() {
  $$("[data-k]").forEach(el => {
    const k = el.dataset.k;
    if (el.classList.contains("seg") || el.classList.contains("swatches")) {
      $$("button", el).forEach(b => b.onclick = () => { setK(k, b.dataset.v); renderSettings(); saveSoon(); });
      return;
    }
    const ev = (el.type === "range" || el.type === "text" || el.tagName === "TEXTAREA" || el.type === "color") ? "input" : "change";
    el.addEventListener(ev, () => {
      let v = el.type === "checkbox" ? el.checked : el.value;
      if (el.type === "range" || el.type === "number" || "num" in el.dataset) v = v === "" ? 0 : +v;
      if (k === "min_len" && v > S.max_len) S.max_len = v;
      if (k === "max_len" && v < S.min_len) S.min_len = v;
      setK(k, v); renderSettings(); saveSoon();
    });
  });
}
function applyShow() {
  $$("[data-show]").forEach(el => {
    const ok = el.dataset.show.split("|").some(alt => alt.split("&").every(c => {
      let m;
      if ((m = c.match(/^(.+?)!=(.*)$/))) return String(getK(m[1])) !== m[2];
      if ((m = c.match(/^(.+?)=(.*)$/))) return String(getK(m[1])) === m[2];
      return !!getK(c);
    }));
    el.hidden = !ok;
  });
}
function drawSubPrev() {
  const sb = S.subs || {}; const el = $("#subSample"); if (!el) return;
  const words = ["ЭТО", "БЫЛО", "НЕВЕРОЯТНО"].slice(0, Math.max(1, sb.words || 3));
  el.innerHTML = words.map((w, i) => `<span style="color:${i === 1 ? sb.active : sb.color};${i === 1 && sb.pop ? "font-size:112%" : ""}">${sb.upper ? w : w.toLowerCase()}</span>`).join(" ");
  const k = 240 / 1920;
  el.style.fontFamily = `'${sb.font}'`; el.style.fontSize = (sb.size * k) + "px";
  el.style.webkitTextStroke = `${Math.max(0, sb.outline * k * 1.4)}px #000`; el.style.paintOrder = "stroke fill";
  el.style.top = el.style.bottom = "";
  const pos = sb.position;
  if (pos === "top") el.style.top = "16%"; else if (pos === "middle") el.style.top = "46%";
  else if (pos === "bottom") el.style.bottom = "8%"; else el.style.bottom = "24%";
}
function drawHlPrev() {
  const h = S.headline || {}; const box = $("#hlBox"); if (!box) return;
  const k = 240 / 1920;
  let txt = h.mode === "custom" ? (h.text || "ТВОЙ ТЕКСТ [ЗДЕСЬ]") : h.mode === "title" ? "название клипа" : "";
  if (h.upper) txt = txt.toUpperCase();
  const esc = s => s.replace(/[&<>]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;"}[c]));
  const html = esc(txt).replace(/\[([^\]]*)\]/g, `<span style="color:${h.accent}">$1</span>`);
  const part = h.part_on ? `<div><span class="pt" style="background:${h.part_bg};color:${h.part_color};font-size:${h.part_size * k}px">${esc((h.part_tpl || "ЧАСТЬ {n}").replace("{n}", h.part_start || 1).replace("{total}", "5"))}</span></div>` : "";
  box.innerHTML = `<div style="${h.plate ? "background:#000a;border-radius:4px;padding:2px" : ""}">${html}</div>${part}`;
  box.style.top = h.y + "%"; box.style.fontFamily = `'${h.font}'`; box.style.fontSize = (h.size * k) + "px";
  box.style.color = h.color; box.style.webkitTextStroke = `${h.size * k * 0.09}px #000`; box.style.paintOrder = "stroke fill";
}

// ------------------------------------------------------------------------------------ presets
async function refreshPresets(list) {
  const sel = $("#presetSel"); const cur = sel.value;
  sel.innerHTML = `<option value="">— выбери —</option>` + list.map(n => `<option>${n.replace(/</g, "&lt;")}</option>`).join("");
  if (list.includes(cur)) sel.value = cur;
}
$("#presetSel").onchange = async e => {
  if (!e.target.value) return;
  const r = await api("preset_load", {name: e.target.value}); S = r.settings; renderSettings(); renderBanners();
  toast("Пресет «" + e.target.value + "» загружен");
};
$("#presetSave").onclick = async () => {
  const name = prompt("Название пресета (например: «Литвин гонки» или «Стрим Twitch»):", $("#presetSel").value || "");
  if (!name) return;
  const r = await api("preset_save", {name, settings: S}); await refreshPresets(r.presets); $("#presetSel").value = name;
  toast("Пресет сохранён");
};
$("#presetDel").onclick = async () => {
  const n = $("#presetSel").value; if (!n || !confirm("Удалить пресет «" + n + "»?")) return;
  const r = await api("preset_delete", {name: n}); refreshPresets(r.presets);
};

// ------------------------------------------------------------------------------------- source
async function setSource(p) {
  $("#source").value = p;
  $("#trackRow").hidden = true;
  if (!p) return;
  if (/^https?:\/\//i.test(p)) { $("#srcInfo").innerHTML = "Ссылка: видео скачается при старте."; return; }
  try {
    const r = await api("probe", {path: p}); const i = r.info;
    $("#srcInfo").innerHTML = `<b>${i.name}</b> · ${fmt(i.duration)} · ${i.width}×${i.height} · ${Math.round(i.fps)} к/с · ${(i.size / 1048576).toFixed(0)} МБ`;
    if (i.duration > 1800 && S.source_type !== "stream") toast("Длинная запись — переключил на «Стрим»"), setK("source_type", "stream"), renderSettings(), saveSoon();
    const ts = $("#trackSel");
    ts.innerHTML = i.audio_tracks.map((t, n) => `<option value="${n}">${n + 1}: ${t.title || t.lang || t.codec} (${t.channels || "?"} кан.)</option>`).join("");
    $("#trackRow").hidden = i.audio_tracks.length < 2;
    if (S.audio_track >= i.audio_tracks.length) S.audio_track = 0;
    ts.value = S.audio_track;
  } catch (e) { $("#srcInfo").textContent = e.message; }
}
$("#source").addEventListener("change", e => setSource(e.target.value.trim().replace(/^"|"$/g, "")));
$("#source").addEventListener("paste", () => setTimeout(() => setSource($("#source").value.trim()), 50));
async function pick(kind, initial) {
  const r = await api("pick", {kind, initial: initial || ""});
  if (r.busy) { toast("Окно выбора уже открыто — посмотри на панели задач, оно могло оказаться за другими окнами", true); return ""; }
  return r.path || "";
}
$("#pickVideo").onclick = async () => { const p = await pick("video"); if (p) setSource(p); };

async function resolveDropped(file, onProgress) {
  const f = await api("find_dropped", {name: file.name, size: file.size});
  if (f.path) return f.path;
  // not found on disk -> copy it in
  return await new Promise((res, rej) => {
    const x = new XMLHttpRequest(); x.open("POST", "/api/upload");
    x.setRequestHeader("X-Name", encodeURIComponent(file.name));
    x.upload.onprogress = e => onProgress && onProgress(e.loaded / e.total);
    x.onload = () => { try { const j = JSON.parse(x.responseText); j.error ? rej(new Error(j.error)) : res(j.path); } catch (e) { rej(e); } };
    x.onerror = () => rej(new Error("Не удалось скопировать файл")); x.send(file);
  });
}
function dropTarget(el, handler) {
  el.addEventListener("dragover", e => { e.preventDefault(); e.stopPropagation(); el.classList.add("drag"); });
  el.addEventListener("dragleave", () => el.classList.remove("drag"));
  el.addEventListener("drop", async e => {
    e.preventDefault(); e.stopPropagation(); el.classList.remove("drag");
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (e.dataTransfer.files.length) {
      const file = e.dataTransfer.files[0]; toast("Ищу файл «" + file.name + "»…");
      try { handler(await resolveDropped(file, p => toast("Копирую файл… " + Math.round(p * 100) + "%"))); }
      catch (err) { toast(err.message, true); }
    } else if (url) handler(url.trim().split("\n")[0]);
  });
}
dropTarget($("#dropZone"), setSource);
document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => e.preventDefault());

// ------------------------------------------------------------------------------------- jobs
function showProgress(on) {
  $("#progress").hidden = !on; $("#stopBtn").hidden = !on;
  $("#startBtn").disabled = on; $("#exportBtn").disabled = on;
}
const STAGES = {download: "Скачиваю по ссылке", probe: "Читаю файл", audio: "Достаю звук", features: "Слушаю громкость и смех",
  speech: "Распознаю речь", score: "Ищу лучшие моменты", llm: "Спрашиваю ИИ", thumbs: "Делаю превью",
  render: "Рендерю клипы", done: "Готово"};
function poll() {
  clearInterval(polling);
  polling = setInterval(async () => {
    let j; try { j = (await api("job")).job; } catch { return; }
    if (!j) return;
    $("#barFill").style.width = (j.progress * 100).toFixed(1) + "%";
    $("#pStage").textContent = (STAGES[j.stage] || j.stage || "…") + " — " + Math.round(j.progress * 100) + "%";
    $("#pEta").textContent = j.eta != null && j.running ? "осталось ≈ " + fmtEta(j.eta) : "";
    $("#log").textContent = j.log.join("\n"); $("#log").scrollTop = 1e9;
    if (!j.running) { clearInterval(polling); showProgress(false); finished(j); }
  }, 700);
}
function fmtEta(s) { return s < 60 ? s + " с" : s < 3600 ? Math.round(s / 60) + " мин" : (s / 3600).toFixed(1) + " ч"; }
async function finished(j) {
  if (j.error) { toast(j.error, true); return; }
  if (j.kind === "analyze") {
    const st = await api("state"); AN = st.analysis; renderMoments();
    toast("Найдено моментов: " + AN.moments.length);
    if ($("#autoExport").checked) doExport();
  } else if (j.kind === "preview") {
    $("#pv").src = media(j.result.file); $("#modal").hidden = false;
  } else if (j.kind === "export") {
    lastExport = j.result.folder; $("#openOut").hidden = false;
    toast(`Готово! ${j.result.count} клип(ов) в папке ${j.result.folder}`);
  }
}
$("#startBtn").onclick = async () => {
  const src = $("#source").value.trim().replace(/^"|"$/g, "");
  if (!src) return toast("Сначала выбери видео или вставь ссылку", true);
  try { await api("analyze", {source: src, settings: S}); showProgress(true); poll(); } catch (e) { toast(e.message, true); }
};
$("#stopBtn").onclick = () => api("cancel", {});

// ------------------------------------------------------------------------------------- moments
function renderMoments() {
  const box = $("#moments"); box.innerHTML = "";
  const has = AN && AN.moments && AN.moments.length;
  $("#empty").hidden = !!has; $("#momHead").hidden = !has; $("#exportBar").hidden = !has;
  if (!has) return;
  const sel = AN.moments.filter(m => m.checked).length;
  $("#momCount").textContent = `(${AN.moments.length}, выбрано ${sel})`;
  $("#exportBtn").textContent = `⬇ Экспорт выбранных (${sel})`;
  AN.moments.forEach((m, i) => {
    const el = document.createElement("div"); el.className = "mom" + (m.checked ? "" : " off");
    const parts = Object.entries(m.parts || {}).map(([k, v]) => `<span>${k} ${Math.round(v * 100)}</span>`).join("");
    el.innerHTML = `
      <div class="th" style="background-image:url('${m.thumb ? media(m.thumb) : ""}')">
        <span class="num">#${i + 1}</span>${m.score100 != null ? `<span class="score">${m.score100}</span>` : ""}
        <span class="dur">${(m.end - m.start).toFixed(1)} с</span><div class="play" title="Черновой просмотр с настройками">▶</div></div>
      <div class="body">
        <div class="times"><button data-a="s-">−1</button><input data-f="start" value="${fmt(m.start, true)}"><button data-a="s+">+1</button>
          <span>–</span><button data-a="e-">−1</button><input data-f="end" value="${fmt(m.end, true)}"><button data-a="e+">+1</button></div>
        <input type="text" class="title" data-f="title" value="${(m.title || "").replace(/"/g, "&quot;")}" placeholder="Название клипа">
        ${m.text ? `<div class="txt" title="${m.text.replace(/"/g, "&quot;")}">${m.text.replace(/</g, "&lt;")}</div>` : ""}
        ${parts ? `<div class="parts">${parts}</div>` : ""}
        <div class="foot"><label class="chk"><input type="checkbox" ${m.checked ? "checked" : ""} data-f="checked"> в экспорт</label>
          <button class="ghost" data-a="del" title="Убрать из списка">Убрать</button></div>
      </div>`;
    const upd = () => { syncMoments(); };
    $(".play", el).onclick = () => preview(i);
    $$("input[data-f]", el).forEach(inp => inp.addEventListener("change", async () => {
      const f = inp.dataset.f;
      if (f === "checked") { m.checked = inp.checked; renderMoments(); return upd(); }
      if (f === "title") { m.title = inp.value; return upd(); }
      const v = parseT(inp.value); if (isNaN(v)) return toast("Время пишется так: 1:05 или 1:05.5", true);
      m[f] = v; if (m.end <= m.start) m.end = m.start + 1;
      await retime(m); renderMoments();
    }));
    $$("button[data-a]", el).forEach(b => b.onclick = async () => {
      const a = b.dataset.a;
      if (a === "del") { AN.moments.splice(i, 1); renderMoments(); return upd(); }
      const d = a.endsWith("+") ? 1 : -1;
      if (a[0] === "s") m.start = Math.max(0, m.start + d); else m.end = Math.min(AN.info.duration, m.end + d);
      if (m.end <= m.start + 0.5) m.end = m.start + 1;
      await retime(m); renderMoments();
    });
    box.appendChild(el);
  });
}
async function retime(m) {
  try { const r = await api("thumb", {id: m.id, start: m.start, end: m.end}); if (r.thumb) m.thumb = r.thumb; } catch {}
  syncMoments();
}
function syncMoments() { if (AN) api("moments", {moments: AN.moments}).catch(() => {}); }
$("#selAll").onclick = () => { AN.moments.forEach(m => m.checked = true); renderMoments(); syncMoments(); };
$("#selNone").onclick = () => { AN.moments.forEach(m => m.checked = false); renderMoments(); syncMoments(); };
$("#addBtn").onclick = async () => {
  try { const r = await api("add_moment", {start: $("#addA").value, end: $("#addB").value}); AN = r.analysis; renderMoments(); }
  catch (e) { toast(e.message, true); }
};
async function preview(i) {
  const m = Object.assign({}, AN.moments[i], {_n: AN.moments.filter((x, k) => x.checked && k < i).length,
    _total: AN.moments.filter(x => x.checked).length});
  try { await api("preview", {moment: m, settings: S}); showProgress(true); poll(); } catch (e) { toast(e.message, true); }
}
$("#modalX").onclick = () => { $("#modal").hidden = true; $("#pv").pause(); $("#pv").removeAttribute("src"); };

// -------------------------------------------------------------------------------------- export
$("#pickOut").onclick = async () => {
  try {
    const p = await pick("folder", S.out_dir);
    if (p) { S.out_dir = p; renderSettings(); saveSoon(); toast("Клипы будут сохраняться в " + p); }
  } catch (e) { toast(e.message, true); }
};
async function doExport() {
  S.out_dir = ($("#outDir").value || "").trim().replace(/^"|"$/g, "");
  if (!S.out_dir) { await $("#pickOut").onclick(); if (!S.out_dir) return; }
  try { await api("export", {moments: AN.moments, settings: S}); showProgress(true); poll(); } catch (e) { toast(e.message, true); }
}
$("#exportBtn").onclick = doExport;
$("#openOut").onclick = () => lastExport && api("open", {path: lastExport});

// -------------------------------------------------------------------------------------- banners
const POS = [["tl", "↖"], ["top", "↑"], ["tr", "↗"], ["c", "•"], ["custom", "✎"], ["", ""], ["bl", "↙"], ["bottom", "↓"], ["br", "↘"]];
function newBanner(path) {
  return {on: true, path, key: true, key_color: "#00FF00", similarity: 0.3, blend: 0.08, despill: true, pos: "br",
    x: 50, y: 80, size: 40, margin: 4, when: "end", at: 5, every: 15, delay: 0, duration: 0, fade: 0.3,
    sound: true, volume: 80, preview_t: 0.8};
}
async function addBanner(p) {
  if (!p) return;
  S.banners = S.banners || []; S.banners.push(newBanner(p)); renderBanners(); saveSoon();
}
$("#bnAdd").onclick = async () => { const p = await pick("banner"); if (p) addBanner(p); };
dropTarget($("#bnDrop"), addBanner);

function renderBanners() {
  const box = $("#banners"); box.innerHTML = "";
  (S.banners || []).forEach((b, i) => {
    const el = document.createElement("div"); el.className = "bn";
    const name = b.path.split(/[\\/]/).pop();
    const isImg = /\.(png|jpe?g|webp|bmp|gif)$/i.test(b.path);
    el.innerHTML = `
      <div class="bhead"><input type="checkbox" data-b="on" ${b.on ? "checked" : ""} title="Включён"><b title="${b.path}">${name}</b>
        <button class="ghost" data-act="del">✕</button></div>
      <div class="pv"><figure><img class="raw" title="Кликни по фону — пипетка возьмёт этот цвет"><figcaption>исходник · клик = пипетка</figcaption></figure>
        <figure><img class="vert"><figcaption><label><input type="checkbox" data-pvv ${b._pvv ? "checked" : ""}> на кадре видео</label></figcaption></figure></div>
      ${isImg ? "" : `<div class="row"><span class="lbl">Кадр для просмотра</span><input type="range" min="0" max="${b._len || 5}" step="0.1" data-b="preview_t"></div>`}
      <label class="chk"><input type="checkbox" data-b="key"> Убирать фон (хромакей)</label>
      <div class="keyopts">
        <div class="row"><span class="lbl">Цвет фона</span><input type="color" data-b="key_color"><label class="chk"><input type="checkbox" data-b="despill"> убрать зелёную кайму</label></div>
        <div class="row"><span class="lbl">Похожесть (similarity)</span><input type="range" min="0.01" max="0.8" step="0.01" data-b="similarity"><output data-bo="similarity"></output></div>
        <div class="row"><span class="lbl">Мягкость края (blend)</span><input type="range" min="0" max="0.5" step="0.01" data-b="blend"><output data-bo="blend"></output></div>
      </div>
      <div class="row"><span class="lbl">Где</span><div class="posgrid">${POS.map(([v, t]) => v ? `<button data-pos="${v}" class="${b.pos === v ? "on" : ""}">${t}</button>` : "<span></span>").join("")}</div></div>
      <div class="row custom" ${b.pos === "custom" ? "" : "hidden"}><span class="lbl">X / Y, %</span><input type="range" min="0" max="100" data-b="x"><input type="range" min="0" max="100" data-b="y"></div>
      <div class="row"><span class="lbl">Размер (% ширины)</span><input type="range" min="5" max="100" data-b="size"><output data-bo="size" data-suf="%"></output></div>
      <div class="row"><span class="lbl">Отступ от края</span><input type="range" min="0" max="30" data-b="margin"><output data-bo="margin" data-suf="%"></output></div>
      <div class="row"><span class="lbl">Когда</span><select data-b="when">
        <option value="start">В начале</option><option value="end">В конце</option><option value="at">На N-й секунде</option>
        <option value="every">Каждые N секунд</option><option value="whole">Весь клип</option></select></div>
      <div class="row" data-w="at"><span class="lbl">На секунде</span><input type="number" class="num" min="0" step="0.5" data-b="at"></div>
      <div class="row" data-w="every"><span class="lbl">Каждые, с / первый раз на</span><input type="number" class="num" min="1" data-b="every"><input type="number" class="num" min="0" data-b="delay"></div>
      <div class="row" data-w="start"><span class="lbl">Задержка, с</span><input type="number" class="num" min="0" step="0.5" data-b="delay"></div>
      <div class="row" data-w="nowhole"><span class="lbl">Длительность, с</span><input type="number" class="num" min="0" step="0.5" data-b="duration"><span class="unit">0 = ${isImg ? "4 с" : "длина ролика"}</span></div>
      <div class="row"><span class="lbl">Плавное появление, с</span><input type="range" min="0" max="1.5" step="0.1" data-b="fade"><output data-bo="fade"></output></div>
      ${isImg ? "" : `<div class="row"><label class="chk"><input type="checkbox" data-b="sound"> Звук баннера</label><input type="range" min="0" max="150" data-b="volume"><output data-bo="volume" data-suf="%"></output></div>`}`;
    const refreshVis = () => {
      $(".keyopts", el).hidden = !b.key;
      $$("[data-w]", el).forEach(r => r.hidden = r.dataset.w === "nowhole" ? b.when === "whole" : r.dataset.w !== b.when);
      $$("output[data-bo]", el).forEach(o => o.textContent = b[o.dataset.bo] + (o.dataset.suf || ""));
    };
    $$("[data-b]", el).forEach(inp => {
      const k = inp.dataset.b;
      if (inp.type === "checkbox") inp.checked = !!b[k]; else inp.value = b[k];
      inp.addEventListener(inp.type === "checkbox" || inp.tagName === "SELECT" ? "change" : "input", () => {
        b[k] = inp.type === "checkbox" ? inp.checked : (inp.type === "range" || inp.type === "number") ? +inp.value : inp.value;
        refreshVis(); saveSoon(); bannerPreview(b, el, k === "preview_t");
      });
    });
    $$("[data-pos]", el).forEach(btn => btn.onclick = () => {
      b.pos = btn.dataset.pos; $$("[data-pos]", el).forEach(x => x.classList.toggle("on", x === btn));
      $(".custom", el).hidden = b.pos !== "custom"; saveSoon(); bannerPreview(b, el);
    });
    $("[data-act=del]", el).onclick = () => { S.banners.splice(i, 1); renderBanners(); saveSoon(); };
    $("[data-pvv]", el).onchange = e => { b._pvv = e.target.checked; bannerPreview(b, el); };
    $(".raw", el).onclick = async e => {
      const r = e.target.getBoundingClientRect();
      try {
        const c = await api("banner_pick_color", {path: b.path, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, t: b.preview_t});
        b.key_color = c.color; $("[data-b=key_color]", el).value = c.color; saveSoon(); bannerPreview(b, el);
        toast("Цвет фона: " + c.color);
      } catch (err) { toast(err.message, true); }
    };
    refreshVis(); box.appendChild(el); bannerPreview(b, el, true);
  });
}
const bpTimers = new WeakMap(), bpBusy = new WeakMap();
function bannerPreview(b, el, raw) {
  clearTimeout(bpTimers.get(el));
  bpTimers.set(el, setTimeout(async () => {
    if (bpBusy.get(el)) return bannerPreview(b, el, raw);
    bpBusy.set(el, true);
    try {
      if (raw || !$(".raw", el).src) {
        const r = await api("banner_raw", {path: b.path, t: b.preview_t});
        $(".raw", el).src = media(r.png);
        if (r.duration && !b._len) { b._len = r.duration; const rg = $("[data-b=preview_t]", el); if (rg) rg.max = r.duration; }
      }
      const p = await api("banner_preview", {banner: b, on_video: !!b._pvv});
      $(".vert", el).src = media(p.png);
    } catch (e) { toast(e.message, true); }
    bpBusy.set(el, false);
  }, 180));
}

// ------------------------------------------------------------------------------------- startup
async function init() {
  fillFonts(); bindSettings();
  const st = await api("state");
  S = st.settings; AN = st.analysis;
  refreshPresets(st.presets); renderSettings(); renderBanners(); renderMoments();
  const t = st.tools;
  $("#chips").innerHTML = [["ffmpeg", t.ffmpeg], ["речь (whisper)", t.whisper], ["видеокарта", t.nvenc], ["ИИ", t.llm]]
    .map(([n, ok]) => `<span class="chip ${ok ? "ok" : "no"}" title="${ok ? "есть" : "не найдено"}">${n} ${ok ? "✓" : "—"}</span>`).join("");
  if (!t.llm) { $("#llmChk").classList.add("disabled"); $("[data-k=use_llm]").disabled = true; if (S.use_llm) { S.use_llm = false; renderSettings(); } }
  $("#llmChk").title = t.llm ? "Ключ найден" : "Добавь бесплатный ключ Gemini в «Студии Монетизации» (Настройки) — или ключ Claude в config\\claude_api_key.txt";
  $("#llmKey").onclick = e => { e.preventDefault(); api("llm_key", {}); toast("Вставь ключ в открывшийся файл, сохрани и перезапусти программу"); };
  if (AN) { $("#source").value = AN.source; setSource(AN.source); }
  if (st.job && st.job.running) { showProgress(true); poll(); }
  setInterval(() => api("beat", {}).catch(() => {}), 5000); api("beat", {});
}
init().catch(e => toast(e.message, true));
