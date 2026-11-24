"""ClipApp local server + app window (Edge in app mode). Start: pythonw server.py"""
import base64, json, mimetypes, os, re, socket, subprocess, sys, threading, time, traceback, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine  # noqa: E402

APP = engine.APP
UI = os.path.join(APP, "app", "ui")
DATA = engine.DATA
SETTINGS = os.path.join(DATA, "settings.json")
PRESETS = os.path.join(DATA, "presets")
PORTF = os.path.join(DATA, "port.txt")
LOGF = os.path.join(DATA, "app.log")
os.makedirs(PRESETS, exist_ok=True)
os.makedirs(engine.WORK, exist_ok=True)

DEFAULTS = {
    "source_type": "video", "cut_mode": "auto", "clip_count": 5, "min_len": 20, "max_len": 60,
    "keywords": "", "use_speech": True, "language": "auto", "use_llm": False,
    "stream_scan": "active", "active_share": 35, "audio_track": 0,
    "manual_kind": "ranges", "ranges": "", "fixed_len": 30, "fixed_from": "", "fixed_to": "",
    "format": "crop", "crop_mode": "face", "focus": 50, "zoom": 1.25,
    "jumpcut": False, "pause_thr": 0.5, "loudnorm": True, "color": "none",
    "encoder": "auto", "quality": "normal",
    "subs": {"on": True, "font": "Impact", "size": 92, "color": "#FFFFFF", "active": "#FFC446", "outline": 7,
             "position": "low", "offset": "", "words": 3, "upper": True, "pop": True, "censor": True},
    "beep": True,
    "banners": [],
    "headline": {"mode": "off", "text": "", "font": "Impact", "size": 84, "color": "#FFFFFF", "accent": "#FFC446",
                 "upper": True, "plate": False, "y": 7, "secs": 0, "part_on": False, "part_tpl": "ЧАСТЬ {n}",
                 "part_start": 1, "part_size": 58, "part_bg": "#E53935", "part_color": "#FFFFFF"},
    "meta": {"tags": "", "auto_tags": 4, "desc_tpl": "{title}\n\n{text}\n\n{tags}"},
    "out_dir": "", "dl_quality": 1080, "live_minutes": 0, "live_from_start": False, "dl_section": "",
}

STATE = {"job": None, "analysis": None, "last_beat": time.time(), "port": None}
LOCK = threading.Lock()


def log(msg):
    try:
        with open(LOGF, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S ") + msg + "\n")
    except Exception:
        pass


def merge(d, base):
    out = json.loads(json.dumps(base))
    for k, v in (d or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(v, out[k])
        else:
            out[k] = v
    return out


def load_settings():
    try:
        return merge(json.load(open(SETTINGS, encoding="utf-8")), DEFAULTS)
    except Exception:
        return json.loads(json.dumps(DEFAULTS))


def save_settings(s):
    tmp = SETTINGS + ".tmp"
    json.dump(s, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, SETTINGS)


def preset_path(name):
    return os.path.join(PRESETS, re.sub(r'[\\/:*?"<>|]+', "_", name.strip())[:60] + ".json")


def list_presets():
    return sorted(os.path.splitext(f)[0] for f in os.listdir(PRESETS) if f.endswith(".json"))


DIALOG_HOST = r"""Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
$filters = @{
  'video'  = 'Видео|*.mp4;*.mkv;*.mov;*.webm;*.avi;*.flv;*.ts;*.m4v;*.wmv|Все файлы|*.*';
  'banner' = 'Видео и картинки|*.mp4;*.mov;*.webm;*.mkv;*.avi;*.png;*.jpg;*.jpeg;*.webp;*.gif|Все файлы|*.*' }
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine(); if ($line -eq $null) { break }
  $p = $line.Split('|'); $kind = $p[0]
  $init = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p[1]))
  $f = New-Object System.Windows.Forms.Form
  $f.TopMost = $true; $f.ShowInTaskbar = $false; $f.FormBorderStyle = 'None'; $f.Opacity = 0
  $f.StartPosition = 'CenterScreen'; $f.Size = New-Object System.Drawing.Size(1,1)
  $f.Show(); $f.Activate(); $f.BringToFront()
  if ($kind -eq 'folder') {
    $d = New-Object System.Windows.Forms.FolderBrowserDialog
    $d.Description = 'Куда сохранять готовые клипы'; $d.ShowNewFolderButton = $true
    if ($init -and (Test-Path $init)) { $d.SelectedPath = $init }
  } else {
    $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = $filters[$kind]
    if ($init -and (Test-Path $init)) { $d.InitialDirectory = $init }
  }
  $r = $d.ShowDialog($f); $f.Close(); $f.Dispose()
  if ($r -eq [System.Windows.Forms.DialogResult]::OK) {
    if ($kind -eq 'folder') { $v = $d.SelectedPath } else { $v = $d.FileName }
    [Console]::Out.WriteLine('B64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($v)))
  } else { [Console]::Out.WriteLine('NONE') }
  $d.Dispose(); [Console]::Out.Flush()
}
"""


class DialogHost:
    """One long-lived PowerShell with WinForms already loaded, so file/folder dialogs open instantly."""

    def __init__(self):
        self.p = None
        self.lock = threading.Lock()
        self.busy = False

    def _start(self):
        enc = base64.b64encode(DIALOG_HOST.encode("utf-16-le")).decode()
        self.p = subprocess.Popen(["powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                  creationflags=engine.NOWIN)
        while True:
            ln = self.p.stdout.readline()
            if not ln:
                raise RuntimeError("не удалось открыть окно выбора")
            if ln.strip() == b"READY":
                return

    def warm(self):
        with self.lock:
            if not self.p or self.p.poll() is not None:
                self._start()

    def ask(self, kind, initial=""):
        if self.busy:
            return None                                    # a dialog is already open
        with self.lock:
            self.busy = True
            try:
                for attempt in (1, 2):
                    try:
                        if not self.p or self.p.poll() is not None:
                            self._start()
                        b = base64.b64encode((initial or "").encode("utf-8")).decode()
                        self.p.stdin.write(f"{kind}|{b}\n".encode("ascii"))
                        self.p.stdin.flush()
                        ln = self.p.stdout.readline().decode("ascii", "replace").strip()
                        if not ln:
                            raise RuntimeError("dialog host died")
                        return base64.b64decode(ln[4:]).decode("utf-8") if ln.startswith("B64:") else ""
                    except Exception as e:
                        log(f"dialog host error: {e}")
                        try:
                            self.p.kill()
                        except Exception:
                            pass
                        self.p = None
                return ""
            finally:
                self.busy = False


DIALOGS = DialogHost()


def ps_dialog(kind, initial=""):
    return DIALOGS.ask(kind, initial)


def ps_dialog_oneshot(kind, initial=""):
    """Native Windows open-file / folder dialog through PowerShell (works from pythonw)."""
    # an invisible, top-most, activated owner window keeps the dialog in front of the app window;
    # the answer comes back base64-encoded so Cyrillic paths survive any console code page
    owner = r"""Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$f = New-Object System.Windows.Forms.Form
$f.TopMost = $true; $f.ShowInTaskbar = $false; $f.FormBorderStyle = 'None'; $f.Opacity = 0
$f.StartPosition = 'CenterScreen'; $f.Size = New-Object System.Drawing.Size(1,1)
$f.Show(); $f.Activate(); $f.BringToFront()
"""
    tail = r"""
$r = $d.ShowDialog($f); $f.Close()
if ($r -eq [System.Windows.Forms.DialogResult]::OK) { 'B64:' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(%s)) }"""
    if kind == "folder":
        script = owner + r"""$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = 'Куда сохранять готовые клипы'; $d.ShowNewFolderButton = $true
if ($env:CA_INIT -and (Test-Path $env:CA_INIT)) { $d.SelectedPath = $env:CA_INIT }""" + tail % "$d.SelectedPath"
    else:
        flt = ("Видео и картинки|*.mp4;*.mov;*.webm;*.mkv;*.avi;*.png;*.jpg;*.jpeg;*.webp;*.gif|Все файлы|*.*" if kind == "banner"
               else "Видео|*.mp4;*.mkv;*.mov;*.webm;*.avi;*.flv;*.ts;*.m4v;*.wmv|Все файлы|*.*")
        script = owner + r"""$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Filter = '%s'
if ($env:CA_INIT -and (Test-Path $env:CA_INIT)) { $d.InitialDirectory = $env:CA_INIT }""" % flt + tail % "$d.FileName"
    env = dict(os.environ, CA_INIT=initial or "")
    enc = base64.b64encode(script.encode("utf-16-le")).decode()
    r = subprocess.run(["powershell", "-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-EncodedCommand", enc],
                       capture_output=True, env=env, creationflags=engine.NOWIN)
    out = r.stdout.decode("ascii", "replace")
    if r.returncode != 0 or r.stderr.strip():
        log("dialog: rc=%s err=%s" % (r.returncode, r.stderr.decode("cp866", "replace")[-500:]))
    for ln in out.splitlines():
        if ln.startswith("B64:"):
            return base64.b64decode(ln[4:]).decode("utf-8")
    return ""


def find_dropped(name, size):
    """A file dropped into the window only gives us its name+size: look for it in the usual places."""
    home = os.path.expanduser("~")
    roots = [os.path.join(home, x) for x in ("Desktop", "Downloads", "Videos", "Documents", "OneDrive\\Desktop")] + \
            [r"E:\videos", "E:\\", r"D:\\"]
    seen = 0
    for root in roots:
        if not os.path.isdir(root):
            continue
        for dp, dns, fns in os.walk(root):
            dns[:] = [d for d in dns if not d.startswith(("$", ".")) and d not in ("ClipApp", "Windows", "node_modules")]
            seen += 1
            if name in fns:
                p = os.path.join(dp, name)
                try:
                    if os.path.getsize(p) == size:
                        return p
                except OSError:
                    pass
            if seen > 20000:
                return None
    return None


def start_job(kind, fn):
    with LOCK:
        j = STATE["job"]
        if j and j.state["running"]:
            raise RuntimeError("Уже идёт обработка — дождись или нажми «Стоп»")
        ctx = engine.Ctx(kind)
        STATE["job"] = ctx

    def run():
        try:
            res = fn(ctx)
            ctx.state["result"] = res
            ctx.state["progress"] = 1.0
            ctx.state["eta"] = 0
        except engine.Cancelled:
            ctx.state["error"] = "Остановлено"
            ctx.log("Остановлено пользователем")
        except Exception as e:
            ctx.state["error"] = str(e)
            ctx.log("Ошибка: " + str(e))
            log(traceback.format_exc())
        finally:
            ctx.state["running"] = False
    threading.Thread(target=run, daemon=True).start()
    return ctx


def media_ok(p):
    p = os.path.abspath(p).lower()
    return p.startswith(os.path.abspath(engine.WORK).lower())


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _json(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n).decode("utf-8") or "{}") if n else {}

    def _file(self, path):
        size = os.path.getsize(path)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        a, b = 0, size - 1
        code = 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    a = int(m.group(1))
                    b = int(m.group(2)) if m.group(2) else size - 1
                else:
                    a = size - int(m.group(2))
                code = 206
        b = min(b, size - 1)
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(b - a + 1))
        self.send_header("Cache-Control", "no-store")
        if code == 206:
            self.send_header("Content-Range", f"bytes {a}-{b}/{size}")
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(a)
            left = b - a + 1
            while left > 0:
                ch = f.read(min(1 << 20, left))
                if not ch:
                    break
                try:
                    self.wfile.write(ch)
                except (ConnectionError, OSError):
                    return
                left -= len(ch)

    def do_GET(self):
        u = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html"):
                return self._file(os.path.join(UI, "index.html"))
            if u.path.startswith("/ui/"):
                p = os.path.normpath(os.path.join(UI, u.path[4:]))
                if p.startswith(UI) and os.path.isfile(p):
                    return self._file(p)
                return self._send(404, {"error": "нет"})
            if u.path == "/media":
                p = q.get("p", [""])[0]
                if p and media_ok(p) and os.path.isfile(p):
                    return self._file(p)
                return self._send(404, {"error": "нет файла"})
            if u.path == "/api/state":
                return self._send(200, self.state())
            if u.path == "/api/job":
                return self._send(200, self.job())
            return self._send(404, {"error": "нет"})
        except (ConnectionError, OSError):
            pass

    def job(self):
        j = STATE["job"]
        if not j:
            return {"job": None}
        st = dict(j.state)
        st["log"] = st["log"][-60:]
        return {"job": st}

    def state(self):
        import llm
        t = engine.TOOLS
        return {"settings": load_settings(), "presets": list_presets(), "analysis": STATE["analysis"],
                "tools": {"ffmpeg": bool(t.get("ffmpeg")), "whisper": bool(t.get("whisper") and t.get("model")),
                          "nvenc": engine.nvenc_ok(), "llm": llm.available()},
                **self.job()}

    def do_POST(self):
        u = urllib.parse.urlparse(self.path)
        try:
            if u.path == "/api/upload":
                return self._send(200, self.upload())
            d = self._json()
            fn = getattr(self, "api_" + u.path.rsplit("/", 1)[-1], None)
            if not fn:
                return self._send(404, {"error": "нет такого действия"})
            return self._send(200, fn(d) or {"ok": True})
        except Exception as e:
            log(traceback.format_exc())
            try:
                return self._send(200, {"error": str(e)})
            except OSError:
                pass

    # ---- API
    def api_beat(self, d):
        STATE["last_beat"] = time.time()
        return {"ok": True}

    def api_settings(self, d):
        save_settings(merge(d.get("settings"), DEFAULTS))
        return {"ok": True}

    def api_preset_save(self, d):
        name = (d.get("name") or "").strip()
        if not name:
            raise RuntimeError("Введи название пресета")
        s = merge(d.get("settings"), DEFAULTS)
        json.dump(s, open(preset_path(name), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        return {"presets": list_presets()}

    def api_preset_load(self, d):
        s = merge(json.load(open(preset_path(d["name"]), encoding="utf-8")), DEFAULTS)
        cur = load_settings()
        s["out_dir"] = s.get("out_dir") or cur.get("out_dir", "")
        save_settings(s)
        return {"settings": s}

    def api_preset_delete(self, d):
        p = preset_path(d["name"])
        if os.path.isfile(p):
            os.remove(p)
        return {"presets": list_presets()}

    def api_pick(self, d):
        kind = d.get("kind", "video")
        init = d.get("initial", "")
        path = ps_dialog(kind, init)
        if path is None:
            return {"path": "", "busy": True}
        return {"path": path}

    def api_find_dropped(self, d):
        return {"path": find_dropped(d.get("name", ""), int(d.get("size", -1)))}

    def upload(self):
        name = urllib.parse.unquote(self.headers.get("X-Name", "file.bin"))
        name = re.sub(r'[\\/:*?"<>|]+', "_", os.path.basename(name))
        n = int(self.headers.get("Content-Length") or 0)
        d = os.path.join(DATA, "uploads")
        os.makedirs(d, exist_ok=True)
        p = os.path.join(d, name)
        with open(p, "wb") as f:
            left = n
            while left > 0:
                ch = self.rfile.read(min(1 << 20, left))
                if not ch:
                    break
                f.write(ch)
                left -= len(ch)
        return {"path": p}

    def api_probe(self, d):
        p = d.get("path", "")
        if engine.is_url(p):
            return {"url": True}
        return {"info": engine.probe(p)}

    def api_analyze(self, d):
        s = merge(d.get("settings"), DEFAULTS)
        save_settings(s)
        src = (d.get("source") or "").strip().strip('"')
        if not src:
            raise RuntimeError("Сначала выбери видео или вставь ссылку")

        def fn(ctx):
            res = engine.analyse(ctx, src, s)
            STATE["analysis"] = res
            return {"analysis": True}
        start_job("analyze", fn)
        return {"ok": True}

    def api_moments(self, d):
        if STATE["analysis"]:
            STATE["analysis"]["moments"] = d.get("moments", [])
        return {"ok": True}

    def api_add_moment(self, d):
        an = STATE["analysis"]
        if not an:
            raise RuntimeError("Сначала загрузи видео")
        a, b = engine.parse_time(d["start"]), engine.parse_time(d["end"])
        if b <= a:
            raise RuntimeError("Конец раньше начала")
        m = {"start": a, "end": min(b, an["info"]["duration"]), "score": 0, "score100": None, "parts": {}, "text": "",
             "first": "", "checked": True, "id": f"u{int(time.time() * 10)}", "title": d.get("title") or f"Клип {engine.fmt_time(a)}"}
        th = os.path.join(an["workdir"], "thumbs", f"{int(a * 10)}.jpg")
        os.makedirs(os.path.dirname(th), exist_ok=True)
        if an["info"]["has_video"] and not os.path.isfile(th):
            engine.thumbnail(an["info"]["path"], (a + b) / 2, th)
        m["thumb"] = th if os.path.isfile(th) else None
        an["moments"].append(m)
        an["moments"].sort(key=lambda x: x["start"])
        return {"analysis": an}

    def api_thumb(self, d):
        an = STATE["analysis"]
        m = next((x for x in an["moments"] if x["id"] == d["id"]), None)
        if not m:
            return {}
        m["start"], m["end"] = float(d["start"]), float(d["end"])
        th = os.path.join(an["workdir"], "thumbs", f"{int(m['start'] * 10)}_{int(m['end'] * 10)}.jpg")
        if an["info"]["has_video"] and not os.path.isfile(th):
            engine.thumbnail(an["info"]["path"], (m["start"] + m["end"]) / 2, th)
        m["thumb"] = th if os.path.isfile(th) else m.get("thumb")
        return {"thumb": m["thumb"]}

    def api_preview(self, d):
        an = STATE["analysis"]
        if not an:
            raise RuntimeError("Сначала найди моменты")
        s = merge(d.get("settings"), DEFAULTS)
        m = d["moment"]
        start_job("preview", lambda ctx: engine.preview_clip(ctx, an, m, s))
        return {"ok": True}

    def api_export(self, d):
        an = STATE["analysis"]
        if not an:
            raise RuntimeError("Сначала найди моменты")
        s = merge(d.get("settings"), DEFAULTS)
        out = (s.get("out_dir") or "").strip()
        if not out:
            raise RuntimeError("Выбери папку для готовых клипов (кнопка «Папка экспорта»)")
        os.makedirs(out, exist_ok=True)
        save_settings(s)
        moments = d.get("moments") or an["moments"]
        start_job("export", lambda ctx: engine.export(ctx, an, moments, s, out))
        return {"ok": True}

    def api_cancel(self, d):
        j = STATE["job"]
        if j:
            j.kill()
        return {"ok": True}

    def api_open(self, d):
        p = d.get("path", "")
        if os.path.exists(p):
            os.startfile(p)
        return {"ok": True}

    def api_banner_preview(self, d):
        bn = d.get("banner") or {}
        src = None
        an = STATE["analysis"]
        if d.get("on_video") and an:
            src = an["info"]["path"]
        out = os.path.join(engine.WORK, f"bp_{int(time.time() * 1000) % 100000}.png")
        for f in os.listdir(engine.WORK):
            if f.startswith("bp_") and f.endswith(".png"):
                try:
                    os.remove(os.path.join(engine.WORK, f))
                except OSError:
                    pass
        engine.banner_preview(bn, src, None if not an else an["info"]["duration"] * 0.3, out)
        return {"png": out}

    def api_banner_raw(self, d):
        p = d.get("path")
        out = engine.banner_raw_frame(p, float(d.get("t", 0.5) or 0.5))
        info = {}
        if not engine.is_image(p):
            info["duration"] = engine._media_len(p)
        return {"png": out, **info}

    def api_banner_pick_color(self, d):
        return {"color": engine.banner_frame_color(d["path"], float(d["x"]), float(d["y"]), float(d.get("t", 0.5) or 0.5))}

    def api_llm_key(self, d):
        p = os.path.join(engine.CONFIG, "claude_api_key.txt")
        if not os.path.isfile(p):
            os.makedirs(engine.CONFIG, exist_ok=True)
            open(p, "w", encoding="utf-8").write("# Вставь сюда свой ключ Claude API (sk-ant-...) отдельной строкой и сохрани файл.\n")
        subprocess.Popen(["notepad.exe", p])
        return {"ok": True}


def find_edge():
    for p in [os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
              os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
              os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
              os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
              os.path.expandvars(r"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe")]:
        if os.path.isfile(p):
            return p
    return None


def open_window(port):
    url = f"http://127.0.0.1:{port}/"
    exe = find_edge()
    if exe:
        prof = os.path.join(DATA, "window-profile")
        subprocess.Popen([exe, f"--app={url}", f"--user-data-dir={prof}", "--window-size=1480,940",
                          "--no-first-run", "--no-default-browser-check", "--disable-features=Translate"])
    else:
        os.startfile(url)


def existing_port():
    try:
        p = int(open(PORTF).read().strip())
        with socket.create_connection(("127.0.0.1", p), timeout=0.5):
            return p
    except Exception:
        return None


def watchdog(srv):
    """Close the server a while after the window is gone (no heartbeats) and nothing is running."""
    while True:
        time.sleep(5)
        j = STATE["job"]
        busy = j and j.state["running"]
        if not busy and time.time() - STATE["last_beat"] > 25:
            log("window closed -> exit")
            srv.shutdown()
            break


def main():
    port = existing_port()
    if port and "--server-only" not in sys.argv:
        open_window(port)
        return
    srv = ThreadingHTTPServer(("127.0.0.1", 0 if not port else 0), H)
    srv.daemon_threads = True
    port = srv.server_address[1]
    open(PORTF, "w").write(str(port))
    log(f"start on {port}; tools: {json.dumps(engine.TOOLS)}")
    STATE["last_beat"] = time.time() + 30                  # give the window time to open

    def warm():                                            # slow first-time checks off the UI path
        try:
            DIALOGS.warm()
        except Exception as e:
            log(f"dialog warm failed: {e}")
        engine.nvenc_ok()
        try:
            import llm  # noqa: F401
            llm.available()
        except Exception:
            pass
    threading.Thread(target=warm, daemon=True).start()
    if "--server-only" not in sys.argv:
        open_window(port)
        threading.Thread(target=watchdog, args=(srv,), daemon=True).start()
    else:
        print(port, flush=True)
    srv.serve_forever()
    try:
        os.remove(PORTF)
    except OSError:
        pass


if __name__ == "__main__":
    try:
        main()
    except Exception:
        log("FATAL\n" + traceback.format_exc())
        raise
