"""ClipApp engine: download, analyse, find moments, render vertical clips.

Everything here runs offline with ffmpeg + whisper.cpp; the optional Claude ranking lives in llm.py.
"""
import glob, hashlib, json, math, os, re, shutil, subprocess, sys, threading, time, wave

import numpy as np
from PIL import Image, ImageDraw

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(APP, "data")
WORK = os.path.join(DATA, "work")
CONFIG = os.path.join(APP, "config")
NOWIN = 0x08000000 if os.name == "nt" else 0          # CREATE_NO_WINDOW: no console flashes under pythonw
GRID = 180.0                                           # transcription chunk length, seconds

# --------------------------------------------------------------------------------------------- tools

def _first(paths):
    for p in paths:
        for q in glob.glob(p):
            if os.path.isfile(q):
                return q
    return None


def find_tools():
    cfg = {}
    try:
        cfg = json.load(open(os.path.join(CONFIG, "tools.json"), encoding="utf-8-sig"))
    except Exception:
        pass
    rt = os.path.join(APP, "runtime")
    la = os.environ.get("LOCALAPPDATA", "")
    t = {
        "ffmpeg": cfg.get("ffmpeg") or _first([rt + r"\ffmpeg\ffmpeg.exe", rt + r"\ffmpeg\bin\ffmpeg.exe",
                                               la + r"\lpvid\ffmpeg\*\bin\ffmpeg.exe", r"E:\tools\ffmpeg*\bin\ffmpeg.exe",
                                               r"E:\tools\ffmpeg*\*\bin\ffmpeg.exe"]) or shutil.which("ffmpeg"),
        "whisper": cfg.get("whisper") or _first([rt + r"\whisper\whisper-cli.exe", rt + r"\whisper\main.exe",
                                                 rt + r"\whisper\Release\whisper-cli.exe",
                                                 r"E:\tools\whisper\whisper-cli.exe", r"E:\tools\whisper\main.exe"]),
        "model": cfg.get("model") or _first([rt + r"\whisper\ggml-small.bin", r"E:\tools\whisper\ggml-small.bin",
                                             rt + r"\whisper\ggml-*.bin", r"E:\tools\whisper\ggml-*.bin"]),
        "node": cfg.get("node") or _first([rt + r"\node\node.exe", r"E:\tools\node*\node.exe"]) or shutil.which("node"),
        "deno": cfg.get("deno") or _first([rt + r"\deno\deno.exe"]) or shutil.which("deno"),
    }
    if t["ffmpeg"]:
        fp = os.path.join(os.path.dirname(t["ffmpeg"]), "ffprobe.exe")
        t["ffprobe"] = fp if os.path.isfile(fp) else shutil.which("ffprobe")
    else:
        t["ffprobe"] = None
    return t


TOOLS = find_tools()
_NVENC = None


def nvenc_ok():
    global _NVENC
    if _NVENC is None:
        try:
            r = subprocess.run([TOOLS["ffmpeg"], "-v", "error", "-f", "lavfi", "-i", "color=s=320x240:d=0.3", "-c:v",
                                "h264_nvenc", "-f", "null", "-"], capture_output=True, timeout=30, creationflags=NOWIN)
            _NVENC = r.returncode == 0
        except Exception:
            _NVENC = False
    return _NVENC

# ------------------------------------------------------------------------------------------ job ctx

class Cancelled(Exception):
    pass


class Ctx:
    """Progress/cancel holder shared between the worker thread and the HTTP server."""

    def __init__(self, kind):
        self.kind = kind
        self.lock = threading.Lock()
        self.cancel = False
        self.proc = None
        self.t0 = time.time()
        self.state = {"kind": kind, "running": True, "stage": "", "progress": 0.0, "eta": None,
                      "log": [], "error": None, "result": None}
        self._stage_t0 = time.time()
        self._weights = None

    # stages: list of (name, weight); progress in each stage 0..1 -> overall
    def plan(self, stages):
        self._weights = stages
        self._done_w = 0.0

    def stage(self, name, frac=0.0):
        self.check()
        with self.lock:
            if self.state["stage"] != name:
                if self._weights and self.state["stage"]:
                    for n, w in self._weights:
                        if n == self.state["stage"]:
                            self._done_w += w
                self.state["stage"] = name
                self._stage_t0 = time.time()
            self._set_frac(frac)

    def _set_frac(self, frac):
        frac = max(0.0, min(1.0, frac))
        total = sum(w for _, w in self._weights) if self._weights else 1.0
        cur_w = 1.0
        if self._weights:
            cur_w = next((w for n, w in self._weights if n == self.state["stage"]), 0.0)
        overall = ((self._done_w if self._weights else 0.0) + cur_w * frac) / total
        self.state["progress"] = round(min(overall, 0.999), 4)
        el = time.time() - self.t0
        self.state["eta"] = round(el / overall * (1 - overall)) if overall > 0.02 and el > 3 else None
        self.state["stage_frac"] = round(frac, 3)

    def frac(self, f):
        self.check()
        with self.lock:
            self._set_frac(f)

    def log(self, msg):
        with self.lock:
            self.state["log"].append(time.strftime("%H:%M:%S ") + str(msg))
            self.state["log"] = self.state["log"][-300:]

    def check(self):
        if self.cancel:
            raise Cancelled()

    def kill(self):
        self.cancel = True
        p = self.proc
        if p and p.poll() is None:
            try:
                p.kill()
            except Exception:
                pass

    def run(self, cmd, cwd=None, on_line=None):
        """Run a tool, stream merged stdout/stderr lines to on_line; raise with the output tail on failure."""
        self.check()
        p = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             creationflags=NOWIN)
        self.proc = p
        tail = []
        buf = b""
        while True:
            ch = p.stdout.read1(65536) if hasattr(p.stdout, "read1") else p.stdout.read(4096)
            if not ch:
                break
            buf += ch
            parts = re.split(rb"[\r\n]", buf)
            buf = parts.pop()
            for raw in parts:
                ln = raw.decode("utf-8", "replace").strip()
                if not ln:
                    continue
                tail.append(ln)
                tail = tail[-40:]
                if on_line:
                    try:
                        on_line(ln)
                    except Cancelled:
                        raise
                    except Exception:
                        pass
            if self.cancel:
                self.kill()
        rc = p.wait()
        self.proc = None
        self.check()
        if rc != 0:
            raise RuntimeError(f"{os.path.basename(cmd[0])} завершился с ошибкой {rc}:\n" + "\n".join(tail[-12:]))
        return tail

# ------------------------------------------------------------------------------------- source / io

URL_RE = re.compile(r"^https?://", re.I)


def is_url(s):
    return bool(URL_RE.match((s or "").strip()))


def src_key(path):
    st = os.stat(path)
    return hashlib.sha1(f"{os.path.abspath(path).lower()}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:14]


def workdir(path):
    d = os.path.join(WORK, src_key(path))
    os.makedirs(d, exist_ok=True)
    return d


def download(ctx, url, opts):
    """yt-dlp a video / VOD / live stream into data/downloads; returns the local file."""
    out_dir = os.path.join(DATA, "downloads")
    os.makedirs(out_dir, exist_ok=True)
    py = sys.executable.replace("pythonw.exe", "python.exe")
    q = int(opts.get("dl_quality", 1080) or 1080)
    cmd = [py, "-m", "yt_dlp", "--newline", "--no-playlist", "--no-part", "--restrict-filenames",
           "-f", f"bv*[height<={q}]+ba/b[height<={q}]/bv*+ba/b", "--merge-output-format", "mp4",
           "--ffmpeg-location", os.path.dirname(TOOLS["ffmpeg"]),
           "-o", os.path.join(out_dir, "%(title).80B [%(id)s].%(ext)s"),
           "--print", "after_move:filepath"]
    if TOOLS.get("deno"):                                 # YouTube needs a JS runtime for its signatures
        cmd += ["--js-runtimes", "deno:" + TOOLS["deno"]]
    elif TOOLS.get("node"):
        cmd += ["--js-runtimes", "node:" + TOOLS["node"]]
    live_min = float(opts.get("live_minutes", 0) or 0)
    if opts.get("live_from_start"):
        cmd += ["--live-from-start"]
    if live_min > 0:
        cmd += ["--download-sections", f"*0-{int(live_min * 60)}"]
    sec = (opts.get("dl_section") or "").strip()          # e.g. "1:00:00-1:30:00" to grab only part of a long VOD
    if sec:
        a, b = [parse_time(x) for x in sec.split("-", 1)]
        cmd += ["--download-sections", f"*{a}-{b}"]
    cmd.append(url.strip())
    result = {"path": None}

    def on_line(ln):
        m = re.search(r"\[download\]\s+([\d.]+)%.*?(?:ETA\s+(\S+))?$", ln)
        if m:
            ctx.frac(float(m.group(1)) / 100)
            return
        if re.match(r"^[A-Za-z]:\\", ln) and os.path.splitext(ln)[1]:
            result["path"] = ln
        elif "[download] Destination" in ln or "Merging formats" in ln or "ERROR" in ln or "WARNING" in ln:
            ctx.log(ln[:200])

    ctx.log("Скачиваю: " + url)
    ctx.run(cmd, on_line=on_line)
    p = result["path"]
    if not p or not os.path.isfile(p):
        files = sorted(glob.glob(os.path.join(out_dir, "*")), key=os.path.getmtime)
        p = files[-1] if files else None
    if not p:
        raise RuntimeError("Не удалось скачать видео по ссылке")
    ctx.log("Скачано: " + os.path.basename(p))
    return p


def probe(path):
    r = subprocess.run([TOOLS["ffprobe"], "-v", "error", "-show_format", "-show_streams", "-of", "json", path],
                       capture_output=True, creationflags=NOWIN)
    js = json.loads(r.stdout.decode("utf-8", "replace") or "{}")
    if not js.get("streams"):
        raise RuntimeError("Не получилось прочитать файл (это точно видео?)")
    v = next((s for s in js["streams"] if s.get("codec_type") == "video"
              and not (s.get("disposition") or {}).get("attached_pic")), None)
    auds = [s for s in js["streams"] if s.get("codec_type") == "audio"]
    dur = float(js.get("format", {}).get("duration") or (v or {}).get("duration") or 0)
    fps = 30.0
    if v:
        try:
            a, b = (v.get("avg_frame_rate") or v.get("r_frame_rate") or "30/1").split("/")
            fps = float(a) / float(b) if float(b) else 30.0
        except Exception:
            pass
        if not (5 < fps < 121):
            fps = 30.0
    w, h = (int(v["width"]), int(v["height"])) if v else (0, 0)
    rot = 0
    for sd in (v or {}).get("side_data_list", []) or []:
        if "rotation" in sd:
            rot = int(sd["rotation"])
    if abs(rot) in (90, 270):
        w, h = h, w
    return {"path": path, "duration": dur, "width": w, "height": h, "fps": fps, "has_video": bool(v),
            "audio_tracks": [{"index": i, "codec": s.get("codec_name"), "channels": s.get("channels"),
                              "title": (s.get("tags") or {}).get("title") or (s.get("tags") or {}).get("handler_name") or "",
                              "lang": (s.get("tags") or {}).get("language", "")} for i, s in enumerate(auds)],
            "size": os.path.getsize(path), "name": os.path.basename(path)}


def is_image(path):
    return os.path.splitext(path)[1].lower() in (".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif")


def fmt_time(t, ms=False):
    t = max(0.0, float(t))
    h, r = divmod(int(t), 3600)
    m, s = divmod(r, 60)
    base = f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"
    if ms:
        base += f".{int(round((t % 1) * 10)) % 10}"
    return base


def parse_time(s):
    s = str(s).strip().replace(",", ".")
    if not s:
        raise ValueError("пустое время")
    parts = s.split(":")
    v = 0.0
    for p in parts:
        v = v * 60 + float(p)
    return v

# ---------------------------------------------------------------------------------------- audio

def extract_audio(ctx, info, track, wd):
    wav = os.path.join(wd, f"audio_t{track}.wav")
    if os.path.isfile(wav) and os.path.getsize(wav) > 1000:
        return wav
    if not info["audio_tracks"]:
        return None
    tmp = wav + ".tmp.wav"
    dur = max(info["duration"], 1)

    def on_line(ln):
        if ln.startswith("out_time_ms="):
            try:
                ctx.frac(int(ln.split("=")[1]) / 1e6 / dur)
            except ValueError:
                pass

    ctx.run([TOOLS["ffmpeg"], "-y", "-v", "error", "-nostats", "-progress", "pipe:1", "-i", info["path"],
             "-map", f"0:a:{track}", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", tmp], on_line=on_line)
    os.replace(tmp, wav)
    return wav


def audio_features(wav, wd):
    """Per-0.25 s loudness (dB), excitement over local baseline and a laughter-rhythm score."""
    cache = os.path.splitext(wav)[0] + "_feat.npz"
    if os.path.isfile(cache):
        z = np.load(cache)
        return {k: z[k] for k in z.files}
    sr, hop = 16000, 400                                 # 25 ms envelope
    env = []
    with wave.open(wav, "rb") as w:
        while True:
            fr = w.readframes(sr * 60)
            if not fr:
                break
            a = np.frombuffer(fr, dtype=np.int16).astype(np.float32) / 32768.0
            n = len(a) // hop
            if n:
                env.append(np.sqrt(np.mean(a[:n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12))
    env = np.concatenate(env) if env else np.zeros(1, np.float32)
    k = 10                                               # 10 x 25 ms = 0.25 s
    n = len(env) // k
    q = env[:n * k].reshape(n, k)
    db = 20 * np.log10(np.sqrt(np.mean(q ** 2, axis=1)) + 1e-6)
    # local baseline: median over +-30 s, computed on 5 s blocks and interpolated
    blk = 20
    nb = max(1, int(math.ceil(n / blk)))
    meds = np.array([np.median(db[max(0, (i - 6) * blk):(i + 7) * blk]) for i in range(nb)])
    base = np.interp(np.arange(n), np.arange(nb) * blk + blk / 2, meds)
    exc = np.clip((db - base) / 15.0, 0, 1)
    # laughter / cheering: 3-7 Hz modulation of the 25 ms envelope over 1 s windows
    W = 40
    m = len(env) // W
    laugh = np.zeros(n, np.float32)
    if m:
        seg = env[:m * W].reshape(m, W)
        seg = seg - seg.mean(axis=1, keepdims=True)
        sp = np.abs(np.fft.rfft(seg, axis=1)) ** 2       # bin i = i Hz (40 samples at 40 Hz)
        ratio = sp[:, 3:8].sum(axis=1) / (sp[:, 1:].sum(axis=1) + 1e-9)
        loud = np.clip((20 * np.log10(np.sqrt(np.mean(env[:m * W].reshape(m, W) ** 2, axis=1)) + 1e-6) + 45) / 25, 0, 1)
        ls = np.clip((ratio - 0.35) / 0.4, 0, 1) * loud
        lo, hi = np.percentile(ls, 60), np.percentile(ls, 99.5)   # relative to this recording
        ls = np.clip((ls - lo) / max(1e-3, hi - lo), 0, 1)
        k3 = np.ones(3) / 3                                        # needs ~3 s of rhythm, not one blip
        ls = np.convolve(ls, k3, mode="same")
        laugh = np.repeat(ls, 4)[:n]
        laugh = np.pad(laugh, (0, n - len(laugh)))
    floor = float(np.percentile(db, 10)) if n else -60
    feats = {"db": db.astype(np.float32), "exc": exc.astype(np.float32), "laugh": laugh.astype(np.float32),
             "floor": np.array([floor], np.float32)}
    np.savez(cache, **feats)
    return feats


def feat_slice(arr, a, b):
    i, j = int(a * 4), max(int(a * 4) + 1, int(b * 4))
    s = arr[i:j]
    return s if len(s) else np.zeros(1, np.float32)

# ---------------------------------------------------------------------------------------- whisper

HALLU = ["продолжение следует", "субтитры", "редактор субтитров", "подписывайтесь на канал", "спасибо за просмотр",
         "thanks for watching", "subtitles by", "amara.org", "dimatorzok", "корректор"]


def _whisper_chunk(ctx, wav, wd, k, lang, on_frac):
    out = os.path.join(wd, f"w_{lang}_{k}.json")
    if os.path.isfile(out):
        return json.load(open(out, encoding="utf-8"))
    a = max(0.0, k * GRID - 1.0)
    dur = GRID + 2.0
    cw = os.path.join(wd, f"chunk_{k}.wav")
    subprocess.run([TOOLS["ffmpeg"], "-y", "-v", "error", "-ss", str(a), "-t", str(dur), "-i", wav, "-c", "copy", cw],
                   check=True, creationflags=NOWIN)
    base = os.path.join(wd, f"chunk_{k}")
    threads = max(2, min(8, (os.cpu_count() or 4) - 2))
    cmd = [TOOLS["whisper"], "-m", TOOLS["model"], "-f", cw, "-l", lang or "auto", "-ml", "1", "-sow", "-oj",
           "-of", base, "-pp", "-t", str(threads)]

    def on_line(ln):
        m = re.search(r"progress\s*=\s*(\d+)%", ln)
        if m:
            on_frac(int(m.group(1)) / 100)

    ctx.run(cmd, cwd=wd, on_line=on_line)
    js = json.load(open(base + ".json", encoding="utf-8", errors="replace"))
    words = []
    lo, hi = k * GRID, (k + 1) * GRID
    for seg in js.get("transcription", []):
        txt = seg.get("text", "")
        t0 = seg["offsets"]["from"] / 1000 + a
        t1 = seg["offsets"]["to"] / 1000 + a
        w = txt.strip()
        if not w:
            continue
        if not re.search(r"\w", w):                        # punctuation-only token -> glue to previous word
            if words:
                words[-1]["w"] += w
            continue
        if txt.startswith(" ") or not words or words[-1]["e"] < t0 - 0.05:
            words.append({"w": w, "t": round(t0, 3), "e": round(max(t1, t0 + 0.06), 3)})
        else:                                             # continuation of a split word
            words[-1]["w"] += w
            words[-1]["e"] = round(t1, 3)
    words = [w for w in words if lo <= (w["t"] + w["e"]) / 2 < hi]
    text = " ".join(w["w"] for w in words).lower()
    for h in HALLU:                                       # whisper hallucinations on silence
        if h in text and len(words) < 15:
            words = []
    json.dump(words, open(out, "w", encoding="utf-8"), ensure_ascii=False)
    for f in (cw, base + ".json"):
        try:
            os.remove(f)
        except OSError:
            pass
    return words


def transcribe(ctx, wav, wd, lang, ranges, duration):
    """Transcribe the GRID chunks covering `ranges` [(a,b)], with progress. Returns sorted words."""
    if not (TOOLS.get("whisper") and TOOLS.get("model")):
        ctx.log("whisper не найден — распознавание речи пропущено")
        return []
    ks = set()
    for a, b in ranges:
        for k in range(int(max(0, a) // GRID), int(min(duration, b) // GRID) + 1):
            if k * GRID < duration:
                ks.add(k)
    ks = sorted(ks)
    words = []
    lang = lang if lang in ("ru", "en") else "auto"
    for n, k in enumerate(ks):
        ctx.frac(n / max(1, len(ks)))
        words += _whisper_chunk(ctx, wav, wd, k, lang, lambda f, n=n: ctx.frac((n + f) / len(ks)))
        if n % 3 == 0:
            ctx.log(f"Распознано {n + 1}/{len(ks)} фрагментов")
    words.sort(key=lambda w: w["t"])
    return words


def sentences(words):
    out, cur = [], []
    for i, w in enumerate(words):
        cur.append(w)
        nxt = words[i + 1] if i + 1 < len(words) else None
        end_p = re.search(r"[.!?…]+[»\"')]*$", w["w"]) is not None
        gap = (nxt["t"] - w["e"]) if nxt else 99
        if end_p or gap > 1.0 or (cur[-1]["e"] - cur[0]["t"]) > 20 or not nxt:
            out.append({"t": cur[0]["t"], "e": cur[-1]["e"], "i0": i - len(cur) + 1, "i1": i,
                        "text": " ".join(x["w"] for x in cur), "closed": end_p})
            cur = []
    return out

# --------------------------------------------------------------------------------------- scoring

KW = {
    "ru": "смотри смотрите внимание никогда всегда самый самое самая главное секрет ошибка опасно страшно ужас жесть "
          "вау офигеть невероятно представь представьте почему как зачем что если правда серьёзно серьезно реально "
          "миллион тысяч умер погиб выжил выжить спасти катастрофа взрыв пожар цунами землетрясение помогите "
          "блин чёрт черт капец кошмар обалдеть боже стоп подожди нельзя внимательно факт",
    "en": "look watch never always most secret mistake dangerous scary insane crazy wow unbelievable imagine why how "
          "what if really seriously million thousand died survived survive save disaster explosion fire tsunami "
          "earthquake help omg stop wait fact actually literally",
}


def _norm(w):
    return re.sub(r"[^\w]", "", w.lower().replace("ё", "е"))


def score_moments(words, sents, feats, s, duration):
    mn, mx = float(s.get("min_len", 20)), float(s.get("max_len", 60))
    target = (mn + mx) / 2
    kws = set(_norm(x) for x in (KW["ru"] + " " + KW["en"]).split())
    user_kw = [_norm(x) for x in re.split(r"[,;\n]", s.get("keywords", "") or "") if _norm(x)]
    kws |= set(user_kw)
    exc, laugh = feats.get("exc") if feats else None, feats.get("laugh") if feats else None
    dens_all = len(words) / max(1.0, sum(x["e"] - x["t"] for x in sents) or 1.0)
    cands = []
    for i in range(len(sents)):
        for j in range(i, len(sents)):
            a, b = sents[i]["t"], sents[j]["e"]
            d = b - a
            if d > mx:
                break
            if d < mn:
                continue
            ws = words[sents[i]["i0"]:sents[j]["i1"] + 1]
            speech = sum(w["e"] - w["t"] for w in ws)
            silence = max(0.0, 1 - speech / d * 1.25)
            dens = len(ws) / d
            kwh = sum(1 for w in ws if _norm(w["w"]) in kws) + 2 * sum(1 for w in ws if _norm(w["w"]) in user_kw)
            kw = min(1.0, kwh / max(1.0, d / 6))
            first = sents[i]["text"]
            hook = (0.5 if re.search(r"[?!]", first) else 0) + (0.3 if sents[i]["e"] - sents[i]["t"] < 6 else 0) \
                + (0.2 if any(_norm(w) in kws for w in first.split()[:6]) else 0)
            closed = 1.0 if sents[j]["closed"] else 0.4
            loud = pk = lg = 0.0
            if exc is not None:
                e = feat_slice(exc, a, b)
                top = np.sort(e)[-max(1, len(e) // 4):]
                loud, pk = float(top.mean()), float(e.max())
                lg = float(np.percentile(feat_slice(laugh, a, b), 92))
            dn = float(np.clip(dens / max(0.5, dens_all) - 0.6, 0, 1))
            lenfit = 1 - min(1.0, abs(d - target) / max(1.0, mx - mn))
            sc = 0.26 * loud + 0.08 * pk + 0.14 * lg + 0.16 * dn + 0.14 * kw + 0.10 * hook + 0.06 * closed \
                + 0.06 * (1 - silence) + 0.04 * lenfit
            cands.append({"start": round(max(0, a - 0.15), 2), "end": round(min(duration, b + 0.35), 2), "score": sc,
                          "parts": {"громкость": round(loud, 2), "смех/крик": round(lg, 2), "темп речи": round(dn, 2),
                                    "ключевые слова": round(kw, 2), "зацепка": round(hook, 2)},
                          "text": " ".join(w["w"] for w in ws), "first": first})
    return cands


def audio_only_moments(feats, s, duration):
    mn, mx = float(s.get("min_len", 20)), float(s.get("max_len", 60))
    L = (mn + mx) / 2
    exc, laugh, db = feats["exc"], feats["laugh"], feats["db"]
    cands = []
    step = 2.0
    t = 0.0
    while t + L <= duration:
        e = feat_slice(exc, t, t + L)
        sc = 0.6 * float(np.sort(e)[-max(1, len(e) // 4):].mean()) + 0.4 * float(feat_slice(laugh, t, t + L).max())
        cands.append({"start": t, "end": t + L, "score": sc, "parts": {"громкость": round(sc, 2)}, "text": "", "first": ""})
        t += step
    # snap edges to the quietest quarter-second within +-1.5 s
    for c in cands:
        for key in ("start", "end"):
            a = max(0.0, c[key] - 1.5)
            seg = feat_slice(db, a, min(duration, c[key] + 1.5))
            c[key] = round(min(duration, a + float(np.argmin(seg)) / 4), 2)
    return cands


def pick(cands, n, gap=3.0):
    out = []
    for c in sorted(cands, key=lambda c: -c["score"]):
        if all(c["end"] + gap <= o["start"] or c["start"] >= o["end"] + gap for o in out):
            out.append(c)
            if len(out) >= n:
                break
    if out:
        top = max(o["score"] for o in out)
        for o in out:
            o["score100"] = int(round(100 * (0.55 + 0.45 * o["score"] / top) * min(1.0, top + 0.35)))
    out.sort(key=lambda c: c["start"])
    return out


def make_title(c):
    t = (c.get("first") or c.get("text") or "").strip()
    if len(t.split()) < 5 and c.get("text"):              # «Что?» is not a title: take the opening words instead
        t = c["text"].strip()
    t = re.sub(r"\s+", " ", t)
    if len(t) > 70:
        t = t[:70].rsplit(" ", 1)[0] + "…"
    return t or f"Момент {fmt_time(c['start'])}"


def active_ranges(feats, duration, frac):
    """For long streams: the loudest/most lively ~frac of 60 s windows (+neighbours) to transcribe first."""
    W = 60.0
    n = int(math.ceil(duration / W))
    sc = []
    for k in range(n):
        a, b = k * W, min(duration, (k + 1) * W)
        sc.append(float(feat_slice(feats["exc"], a, b).mean()) + 0.5 * float(feat_slice(feats["laugh"], a, b).max()))
    keep = set(np.argsort(sc)[::-1][:max(1, int(n * frac))].tolist())
    keep |= {k + 1 for k in keep if k + 1 < n}
    rs = []
    for k in sorted(keep):
        a, b = k * W, min(duration, (k + 1) * W)
        if rs and abs(rs[-1][1] - a) < 1e-6:
            rs[-1][1] = b
        else:
            rs.append([a, b])
    return [tuple(r) for r in rs]


def manual_moments(s, duration):
    out = []
    if s.get("manual_kind", "ranges") == "fixed":
        L = max(1.0, float(s.get("fixed_len", 30)))
        a = parse_time(s.get("fixed_from") or 0) if str(s.get("fixed_from") or "").strip() else 0.0
        b = parse_time(s.get("fixed_to")) if str(s.get("fixed_to") or "").strip() else duration
        b = min(b, duration)
        t = a
        while t < b - 0.5:
            e = min(b, t + L)
            if e - t >= min(L, 1.0):
                out.append({"start": round(t, 2), "end": round(e, 2)})
            t = e
    else:
        for ln in re.split(r"[\n;]+", s.get("ranges", "") or ""):
            ln = ln.strip()
            if not ln:
                continue
            m = re.match(r"^\s*([\d:.,]+)\s*(?:-|–|—|до|to)\s*([\d:.,]+)\s*(.*)$", ln)
            if not m:
                raise ValueError(f"Не понял строку диапазона: «{ln}». Пиши так: 1:05-1:40")
            a, b = parse_time(m.group(1)), parse_time(m.group(2))
            if b <= a:
                raise ValueError(f"Конец раньше начала: «{ln}»")
            out.append({"start": round(a, 2), "end": round(min(b, duration), 2), "title": m.group(3).strip()})
    for c in out:
        c.update({"score": 0, "score100": None, "parts": {}, "text": "", "first": ""})
    return out


def thumbnail(src, t, out, w=360):
    subprocess.run([TOOLS["ffmpeg"], "-y", "-v", "error", "-ss", str(max(0, t)), "-i", src, "-frames:v", "1",
                    "-vf", f"scale={w}:-2", "-q:v", "4", out], creationflags=NOWIN)
    return os.path.isfile(out)

# -------------------------------------------------------------------------------------- analysis

def analyse(ctx, source, s):
    """Download (if URL), probe, audio features, transcript, moments. Returns dict for the UI."""
    stream = s.get("source_type") == "stream"
    auto = s.get("cut_mode", "auto") == "auto"
    use_speech = s.get("use_speech", True)
    st = [("download", 3 if is_url(source) else 0), ("probe", 0.2), ("audio", 1), ("features", 0.5),
          ("speech", 6 if (auto and use_speech) else 0.1), ("score", 0.5), ("llm", 0.5), ("thumbs", 0.5)]
    ctx.plan(st)
    if is_url(source):
        ctx.stage("download")
        source = download(ctx, source, s)
    if not os.path.isfile(source):
        raise RuntimeError("Файл не найден: " + source)
    ctx.stage("probe")
    info = probe(source)
    ctx.log(f"{info['name']}: {fmt_time(info['duration'])}, {info['width']}×{info['height']}, "
            f"{info['fps']:.0f} к/с, аудиодорожек: {len(info['audio_tracks'])}")
    wd = workdir(source)
    track = min(int(s.get("audio_track", 0) or 0), max(0, len(info["audio_tracks"]) - 1))
    ctx.stage("audio")
    wav = extract_audio(ctx, info, track, wd) if info["audio_tracks"] else None
    feats = None
    if wav:
        ctx.stage("features")
        feats = audio_features(wav, wd)
    dur = info["duration"]
    words, moments = [], []
    if auto:
        if wav and use_speech:
            ctx.stage("speech")
            rngs = [(0, dur)]
            if stream and s.get("stream_scan", "active") == "active" and dur > 900 and feats is not None:
                rngs = active_ranges(feats, dur, float(s.get("active_share", 35)) / 100)
                ctx.log(f"Стрим: распознаю самые живые участки ({sum(b - a for a, b in rngs) / 60:.0f} из {dur / 60:.0f} мин)")
            else:
                ctx.log("Распознаю речь (whisper)…")
            words = transcribe(ctx, wav, wd, s.get("language", "auto"), rngs, dur)
            ctx.log(f"Слов распознано: {len(words)}")
        ctx.stage("score")
        sents = sentences(words)
        cands = score_moments(words, sents, feats, s, dur) if sents else []
        if not cands and feats is not None:
            ctx.log("Речи мало — ищу моменты по звуку")
            cands = audio_only_moments(feats, s, dur)
        if not cands:
            raise RuntimeError("Не нашёл подходящих моментов. Уменьши минимальную длину или выбери «Я выбираю».")
        n = int(s.get("clip_count", 5) or 5)
        pool = pick(cands, max(n * 3, 12) if s.get("use_llm") else n)
        if s.get("use_llm"):
            ctx.stage("llm")
            try:
                import llm
                pool = llm.rank(ctx, pool, n, s)
            except Exception as e:
                ctx.log(f"Claude недоступен ({e}) — использую локальную оценку")
                pool = pick(pool, n)
        moments = pool[:n] if len(pool) > n else pool
        moments.sort(key=lambda c: c["start"])
    else:
        moments = manual_moments(s, dur)
        if not moments:
            raise RuntimeError("Нет отрезков. Впиши диапазоны (например 1:05-1:40) или задай длину клипа.")
    ctx.stage("thumbs")
    tdir = os.path.join(wd, "thumbs")
    os.makedirs(tdir, exist_ok=True)
    for i, m in enumerate(moments):
        m["id"] = f"m{i}_{int(m['start'] * 10)}"
        m["title"] = m.get("title") or make_title(m)
        th = os.path.join(tdir, f"{int(m['start'] * 10)}.jpg")
        if info["has_video"] and not os.path.isfile(th):
            thumbnail(source, (m["start"] + m["end"]) / 2, th)
        m["thumb"] = th if os.path.isfile(th) else None
        m["checked"] = True
        ctx.frac((i + 1) / len(moments))
    return {"source": source, "info": info, "moments": moments, "track": track, "workdir": wd}

# ---------------------------------------------------------------------------------------- render

def face_focus(info, a, b):
    """Horizontal centre of skin-coloured pixels over a few frames (0..1). Cheap face-ish weighting."""
    W = 192
    H = max(2, int(round(info["height"] * W / max(1, info["width"]) / 2) * 2))
    xs = []
    for k in range(5):
        t = a + (b - a) * (k + 0.5) / 5
        r = subprocess.run([TOOLS["ffmpeg"], "-v", "error", "-ss", str(t), "-i", info["path"], "-frames:v", "1",
                            "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                           capture_output=True, creationflags=NOWIN)
        if len(r.stdout) != W * H * 3:
            continue
        im = np.frombuffer(r.stdout, np.uint8).reshape(H, W, 3).astype(np.float32)
        R, G, B = im[..., 0], im[..., 1], im[..., 2]
        Y = 0.299 * R + 0.587 * G + 0.114 * B
        Cb = 128 - 0.168736 * R - 0.331264 * G + 0.5 * B
        Cr = 128 + 0.5 * R - 0.418688 * G - 0.081312 * B
        m = (Cr > 135) & (Cr < 175) & (Cb > 85) & (Cb < 130) & (Y > 60)
        m[int(H * 0.75):] = False                          # faces live in the upper part
        wts = m.sum(axis=0).astype(np.float32)
        if wts.sum() > W * H * 0.004:
            xs.append(float((wts * np.arange(W)).sum() / wts.sum() / W))
    return float(np.median(xs)) if xs else 0.5


def out_size(info, s):
    if s.get("format", "crop") == "original":
        return info["width"] // 2 * 2, info["height"] // 2 * 2
    return 1080, 1920


def keep_segments(words, feats, a, b, s):
    """Jump cuts: speech intervals (relative to clip start) with pauses longer than the threshold removed."""
    thr = float(s.get("pause_thr", 0.5))
    pad = 0.12
    ivs = []
    ws = [w for w in words if w["e"] > a and w["t"] < b]
    if ws:
        ivs = [(max(a, w["t"] - pad), min(b, w["e"] + pad)) for w in ws]
    elif feats is not None:
        db = feat_slice(feats["db"], a, b)
        floor = float(feats["floor"][0])
        loud = db > floor + 8
        for i, v in enumerate(loud):
            if v:
                t = a + i / 4
                ivs.append((max(a, t - pad), min(b, t + 0.25 + pad)))
    if not ivs:
        return [(0.0, b - a)]
    merged = [list(ivs[0])]
    for x, y in ivs[1:]:
        if x - merged[-1][1] <= thr:
            merged[-1][1] = max(merged[-1][1], y)
        else:
            merged.append([x, y])
    merged[0][0] = a if merged[0][0] - a < thr else merged[0][0]
    merged[-1][1] = b if b - merged[-1][1] < thr else merged[-1][1]
    segs = [(round(x - a, 3), round(y - a, 3)) for x, y in merged if y - x > 0.08]
    return segs or [(0.0, b - a)]


def remap(t, segs):
    acc = 0.0
    for x, y in segs:
        if t < x:
            return acc
        if t <= y:
            return acc + t - x
        acc += y - x
    return acc


def hex_to_ass(h):
    h = (h or "#FFFFFF").lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    r, g, b = h[0:2], h[2:4], h[4:6]
    return f"&H00{b}{g}{r}".upper()


def build_ass(path, words, a, b, segs, W, H, s):
    sub = s.get("subs", {})
    size = int(float(sub.get("size", 92)) * H / 1920)
    pos = sub.get("position", "low")
    align = {"top": 8, "middle": 5, "low": 2, "bottom": 2}.get(pos, 2)
    mv = {"top": 0.16, "middle": 0, "low": 0.24, "bottom": 0.08}.get(pos, 0.24)
    mv = int(H * (float(sub.get("offset", mv * 100)) / 100 if sub.get("offset") not in (None, "") else mv))
    font = sub.get("font", "Impact") or "Impact"
    base = hex_to_ass(sub.get("color", "#FFFFFF"))
    act = hex_to_ass(sub.get("active", "#FFC446"))
    outline = max(0, int(float(sub.get("outline", 7)) * H / 1920))
    upper = sub.get("upper", True)
    maxw = max(1, int(sub.get("words", 3)))
    pop = sub.get("pop", True)
    ws = [dict(w) for w in words if w["e"] > a and w["t"] < b]
    for w in ws:
        w["t"] = remap(max(0.0, w["t"] - a), segs)
        w["e"] = remap(min(b - a, w["e"] - a), segs)
        if sub.get("censor", True) and MAT.search(w["w"]):
            w["w"] = mask_mat(w["w"])
        w["w"] = w["w"].upper() if upper else w["w"]
        w["w"] = w["w"].replace("{", "(").replace("}", ")")
    chunks, cur = [], []
    for i, w in enumerate(ws):
        cur.append(w)
        nxt = ws[i + 1] if i + 1 < len(ws) else None
        if (len(cur) >= maxw or not nxt or re.search(r"[.!?…,:;]$", w["w"]) or (nxt["t"] - w["e"] > 0.6)
                or sum(len(x["w"]) + 1 for x in cur) > 16):
            chunks.append(cur)
            cur = []

    def ts(t):
        t = max(0.0, t)
        return f"{int(t // 3600)}:{int(t % 3600 // 60):02d}:{t % 60:05.2f}"

    ev = []
    total = remap(b - a, segs)
    for ci, ch in enumerate(chunks):
        end_chunk = min(ch[-1]["e"] + 0.25, chunks[ci + 1][0]["t"] if ci + 1 < len(chunks) else total)
        for k, w in enumerate(ch):
            t0 = w["t"] if k else min(w["t"], ch[0]["t"])
            t1 = ch[k + 1]["t"] if k + 1 < len(ch) else end_chunk
            if t1 - t0 < 0.02:
                continue
            parts = []
            for m, x in enumerate(ch):
                word = x["w"]
                if m == k:
                    tag = "{\\c" + act + "&" + ("\\fscx112\\fscy112" if pop else "") + "}"
                    parts.append(tag + word + "{\\c" + base + "&\\fscx100\\fscy100}")
                else:
                    parts.append(word)
            ev.append(f"Dialogue: 0,{ts(t0)},{ts(t1)},Word,,0,0,0,,{' '.join(parts)}")
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Word,{font},{size},{base}&,{base}&,&H00000000&,&H64000000&,0,0,0,0,100,100,1,0,1,{outline},{max(0, outline // 3)},{align},{int(W * 0.06)},{int(W * 0.06)},{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    open(path, "w", encoding="utf-8-sig").write(head + "\n".join(ev) + "\n")
    return len(ev)


COLOR = {
    "none": "",
    "juicy": "eq=contrast=1.08:saturation=1.38:brightness=0.015,unsharp=5:5:0.5",
    "cinema": "colorbalance=rs=-0.04:gs=-0.01:bs=0.07:rh=0.07:gh=0.02:bh=-0.06,eq=contrast=1.12:saturation=1.08,vignette=angle=PI/5",
    "warm": "colorbalance=rs=0.05:bs=-0.05:rm=0.06:bm=-0.06,eq=saturation=1.15:gamma=1.03:contrast=1.04",
}


FONT_FILES = {
    "impact": ["impact.ttf"], "arial black": ["ariblk.ttf"], "segoe ui black": ["seguibl.ttf"],
    "arial": ["arialbd.ttf", "arial.ttf"], "segoe ui": ["segoeuib.ttf", "segoeui.ttf"], "verdana": ["verdanab.ttf"],
    "tahoma": ["tahomabd.ttf"], "calibri": ["calibrib.ttf"], "bahnschrift": ["bahnschrift.ttf"],
    "comic sans ms": ["comicbd.ttf"], "georgia": ["georgiab.ttf"], "trebuchet ms": ["trebucbd.ttf"],
}


def font_path(name):
    fd = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
    user_fd = os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Microsoft\Windows\Fonts")
    key = (name or "Impact").strip().lower()
    for f in FONT_FILES.get(key, []):
        for d in (fd, user_fd):
            if os.path.isfile(os.path.join(d, f)):
                return os.path.join(d, f)
    flat = key.replace(" ", "")
    for d in (fd, user_fd):
        for f in glob.glob(os.path.join(d, "*.tt[fc]")) + glob.glob(os.path.join(d, "*.otf")):
            b = os.path.splitext(os.path.basename(f))[0].lower().replace(" ", "").replace("-", "")
            if b.startswith(flat):
                return f
    return os.path.join(fd, "impact.ttf")


def _hex(h, default=(255, 255, 255)):
    h = (h or "").lstrip("#")
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    except Exception:
        return default


def headline_text(s, m):
    hl = s.get("headline", {})
    mode = hl.get("mode", "off")
    if mode == "custom":
        return hl.get("text", "")
    if mode == "title":
        return m.get("title", "")
    return ""


def headline_png(path, text, part, W, H, s, fmt="crop"):
    """Big title on top of the clip (Impact, white, [accent] words amber) + optional «ЧАСТЬ N» plate."""
    from PIL import ImageFont
    hl = s.get("headline", {})
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    k = H / 1920
    size = int(float(hl.get("size", 84)) * k)
    f = ImageFont.truetype(font_path(hl.get("font", "Impact")), size)
    col, acc = _hex(hl.get("color", "#FFFFFF")), _hex(hl.get("accent", "#FFC446"), (255, 196, 70))
    stroke = max(2, int(size * 0.09))
    text = (text or "").strip()
    if hl.get("upper", True):
        text = text.upper()
    toks = []                                             # (word, accented)
    for mm in re.finditer(r"\[([^\]]*)\]|(\S+)", text):
        if mm.group(1) is not None:
            toks += [(w, True) for w in mm.group(1).split()]
        else:
            toks.append((mm.group(2), False))
    maxw = W * 0.88
    lines, cur = [], []
    for w, a in toks:
        test = " ".join(x for x, _ in cur + [(w, a)])
        if cur and d.textlength(test, font=f) > maxw:
            lines.append(cur)
            cur = [(w, a)]
        else:
            cur.append((w, a))
    if cur:
        lines.append(cur)
    lh = int(size * 1.12)
    y = int(H * float(hl.get("y", 7 if fmt != "blur" else 13)) / 100)
    plate = hl.get("plate", False)
    if lines and plate:
        top = y - int(size * 0.25)
        bot = y + lh * len(lines) + int(size * 0.15)
        wmax = max(d.textlength(" ".join(x for x, _ in ln), font=f) for ln in lines)
        d.rounded_rectangle([(W - wmax) / 2 - size * 0.45, top, (W + wmax) / 2 + size * 0.45, bot],
                            radius=int(size * 0.3), fill=(0, 0, 0, 165))
    for ln in lines:
        x = (W - d.textlength(" ".join(w for w, _ in ln), font=f)) / 2
        for w, a in ln:
            d.text((x, y), w, font=f, fill=acc if a else col, stroke_width=stroke, stroke_fill=(10, 8, 14))
            x += d.textlength(w + " ", font=f)
        y += lh
    if part and hl.get("part_on", True):
        tpl = hl.get("part_tpl", "ЧАСТЬ {n}") or "ЧАСТЬ {n}"
        label = tpl.replace("{n}", str(part[0])).replace("{total}", str(part[1]))
        ps = int(float(hl.get("part_size", 58)) * k)
        pf = ImageFont.truetype(font_path(hl.get("font", "Impact")), ps)
        tw = d.textlength(label, font=pf)
        py = y + int(size * 0.38) if lines else int(H * float(hl.get("y", 7)) / 100)
        padx, pady = ps * 0.45, ps * 0.2
        d.rounded_rectangle([(W - tw) / 2 - padx, py - pady, (W + tw) / 2 + padx, py + ps * 1.08 + pady],
                            radius=int(ps * 0.28), fill=_hex(hl.get("part_bg", "#E53935")) + (240,))
        d.text(((W - tw) / 2, py), label, font=pf, fill=_hex(hl.get("part_color", "#FFFFFF")))
    img.save(path)
    return bool(lines) or bool(part and hl.get("part_on", True))


STOP = set("""это как так что все всё она они оно его ему ней них был была были быть будет есть если или чтобы потому
когда тогда тоже только очень просто вообще здесь там тут уже ещё еще можно нужно надо даже вот этот эта эти того
того который которая которые себя свой своя сейчас потом после перед через между более менее какой какая какие
the and that this with have from they what when there were your just like about would could should their them
then than been into some more very really going because which where while these those""".split())


_P = r"(?:на|по|ни|от|отъ|за|до|вы|рас|раз|разъ|с|у|о|при|про|под|подъ|об|объ|въ|съ|пере|недо|долбо|ах|ох)?"
MAT_WORD = re.compile(
    r"^(?:" +
    _P + r"ху[йеёяи][а-яё]*|" +            # хуй, нахуй, похуй, хуёво, хуйня
    _P + r"пизд[а-яё]*|" +                 # пизда, пиздец, спиздил, распиздяй
    r"бля[а-яё]*|" +                       # бля, блять, блядь
    _P + r"[её]б(?:а|у|л|н|ы|и|о|ё|т|ш|к|с|ь)[а-яё]*|" +   # ебать, заебал, уёбок, отъебись, ебанутый
    r"[её]б|" +
    r"сук(?:а|и|е|у|ой|ин|ины|ам|ами)|" +
    r"мудак[а-яё]*|мудил[а-яё]*|мудач[а-яё]*|пид[оа]р[а-яё]*|гандон[а-яё]*|шлюх[а-яё]*|залуп[а-яё]*|" +
    r"дроч[а-яё]*|манд[аеуыо]|" +
    r"fuck[a-z]*|motherfuck[a-z]*|shit[a-z]*|bullshit|bitch[a-z]*|asshole[s]?|dick(?:head)?|cunt[s]?"
    r")$")


class _Mat:
    """MAT.search(word) -> True if the (single) word is profanity."""
    @staticmethod
    def search(w):
        w = re.sub(r"[^a-zа-яё]", "", (w or "").lower())
        return bool(w) and bool(MAT_WORD.match(w))


MAT = _Mat()
VOWELS = set("аеёиоуыэюяaeiouy")


def mask_mat(word):
    """блять -> бл*ть, пиздец -> п*здец, нахуй -> нах*й, заебал -> заеб*л (first vowel inside the root)."""
    chars = list(word)
    low = word.lower()
    start = 1
    for root in ("пизд", "бля", "ху", "еб", "ёб", "сук", "муд", "пид", "гандон", "шлюх", "залуп", "дроч", "манд",
                 "fuck", "shit", "bitch", "cunt", "dick", "ass"):
        p = low.find(root)
        if p >= 0:
            start = p + 1
            break
    letters = [i for i, c in enumerate(chars) if c.isalpha()]
    for i in [i for i in letters if i >= start]:
        if chars[i].lower() in VOWELS:
            chars[i] = "*"
            return "".join(chars)
    if len(letters) > 1:
        chars[letters[1]] = "*"
    return "".join(chars)


def mat_intervals(words, a, b, segs):
    """Clip-relative (after jump cuts) time ranges of swear words, for the beep."""
    out = []
    for w in words:
        if w["e"] > a and w["t"] < b and MAT.search(w["w"]):
            x = remap(max(0.0, w["t"] - a - 0.04), segs)
            y = remap(min(b - a, w["e"] - a + 0.04), segs)
            if y - x > 0.03:
                out.append((x, y))
    return out


def make_meta(m, s, n, total):
    """Upload title, description and hashtags for one clip (offline)."""
    md = s.get("meta", {})
    hl = s.get("headline", {})
    base = re.sub(r"[\[\]]", "", hl.get("text", "")).strip() if hl.get("mode") == "custom" else ""
    title = m.get("title") or ""
    if base:
        title = f"{base} — часть {n}" if total > 1 else base
    text = m.get("text", "")
    words = re.findall(r"[A-Za-zА-Яа-яЁё][\w\-]{3,}", text)
    cnt = {}
    for i, w in enumerate(words):
        lw = w.lower()
        if lw in STOP or len(lw) < 5 or MAT.search(lw):
            continue
        cnt[lw] = cnt.get(lw, 0) + (3 if w[0].isupper() and i > 0 else 1)   # names / proper nouns first
    auto = [w for w, _ in sorted(cnt.items(), key=lambda x: -x[1])][:int(md.get("auto_tags", 4) or 0)]
    fixed = [t.strip().lstrip("#") for t in re.split(r"[\s,;]+", md.get("tags", "") or "") if t.strip().lstrip("#")]
    tags = []
    for t in fixed + ["shorts"] + auto:
        t = re.sub(r"[^\w]", "", t.lower())
        if t and t not in tags:
            tags.append(t)
    sent = re.split(r"(?<=[.!?…])\s+", text.strip())
    desc_body = " ".join(sent[:2])[:220] if text else ""
    tpl = md.get("desc_tpl") or "{title}\n\n{text}\n\n{tags}"
    desc = tpl.replace("{title}", title).replace("{text}", desc_body).replace("{n}", str(n)) \
        .replace("{tags}", " ".join("#" + t for t in tags))
    return {"title": title, "description": re.sub(r"\n{3,}", "\n\n", desc).strip(), "hashtags": ["#" + t for t in tags]}


def banner_times(bn, D):
    when = bn.get("when", "start")
    bdur = float(bn.get("duration") or 0) or float(bn.get("_len") or 4.0)
    if when == "whole":
        return [(0.0, D)]
    if when == "start":
        ts = [float(bn.get("delay", 0) or 0)]
    elif when == "end":
        ts = [max(0.0, D - bdur)]
    elif when == "at":
        ts = [float(bn.get("at", 5) or 0)]
    else:                                                 # every N seconds
        ev = max(1.0, float(bn.get("every", 15) or 15))
        t0 = float(bn.get("delay", 0) or 0)
        ts = [t0 + k * ev for k in range(int((D - t0) // ev) + 1)][:20]
    return [(t, min(bdur, D - t)) for t in ts if t < D - 0.2]


def banner_filter(idx, bn, W, H, T, dur, fps):
    """Filter chain for one banner appearance from input #idx -> keyed, scaled, faded, shifted to T."""
    f = []
    if bn.get("key", True):
        col = (bn.get("key_color") or "#00FF00").lstrip("#")
        sim = float(bn.get("similarity", 0.30))
        bl = float(bn.get("blend", 0.08))
        f.append(f"colorkey=0x{col}:{sim:.3f}:{bl:.3f}")
        if bn.get("despill", True) and col.upper() in ("00FF00", "00B140", "00FF40") or bn.get("despill_force"):
            f.append("despill=type=green:mix=0.5:expand=0")
    f.append("format=rgba")
    bw = max(16, int(W * float(bn.get("size", 35)) / 100) // 2 * 2)
    f.append(f"scale={bw}:-2")
    if bn.get("_image"):
        f.append(f"fps={fps:.3f}")
    fd = min(float(bn.get("fade", 0.3) or 0), dur / 2.5)
    if fd > 0:
        f.append(f"fade=t=in:st=0:d={fd:.2f}:alpha=1,fade=t=out:st={max(0, dur - fd):.2f}:d={fd:.2f}:alpha=1")
    f.append(f"setpts=PTS-STARTPTS+{T:.3f}/TB")
    return f"[{idx}:v]" + ",".join(f) + f"[bn{idx}]"


def banner_xy(bn, W, H):
    m = float(bn.get("margin", 4)) / 100
    pos = bn.get("pos", "br")
    mx, my = f"{W * m:.0f}", f"{H * m:.0f}"
    table = {
        "tl": (mx, my), "tr": (f"W-w-{mx}", my), "bl": (mx, f"H-h-{my}"), "br": (f"W-w-{mx}", f"H-h-{my}"),
        "c": ("(W-w)/2", "(H-h)/2"), "top": ("(W-w)/2", my), "bottom": ("(W-w)/2", f"H-h-{my}"),
    }
    if pos == "custom":
        return f"(W-w)*{float(bn.get('x', 50)) / 100:.3f}", f"(H-h)*{float(bn.get('y', 80)) / 100:.3f}"
    return table.get(pos, table["br"])


def _media_len(path):
    try:
        r = subprocess.run([TOOLS["ffprobe"], "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                           capture_output=True, text=True, creationflags=NOWIN)
        return float(r.stdout.strip())
    except Exception:
        return 0.0


def _has_audio(path):
    r = subprocess.run([TOOLS["ffprobe"], "-v", "error", "-select_streams", "a", "-show_entries", "stream=index",
                        "-of", "csv=p=0", path], capture_output=True, text=True, creationflags=NOWIN)
    return bool(r.stdout.strip())


def render(ctx, info, m, s, words, feats, out_path, preview=False, frac_cb=None, part=None):
    src = info["path"]
    a, b = float(m["start"]), float(m["end"])
    W, H = out_size(info, s)
    fps = min(60.0, round(info["fps"])) if info["fps"] else 30.0
    tmp = os.path.join(WORK, "_render_" + str(os.getpid()) + "_" + str(threading.get_ident()))
    os.makedirs(tmp, exist_ok=True)
    segs = keep_segments(words, feats, a, b, s) if s.get("jumpcut") else [(0.0, b - a)]
    D = sum(y - x for x, y in segs)
    inputs = ["-ss", f"{a:.3f}", "-t", f"{b - a:.3f}", "-i", src]
    vf = [f"[0:v]fps={fps:.3f}"]
    if s.get("jumpcut") and len(segs) > 1:
        expr = "+".join(f"between(t,{x:.3f},{y:.3f})" for x, y in segs)
        vf.append(f"select='{expr}',setpts=N/FRAME_RATE/TB")
    fmt = s.get("format", "crop")
    col = COLOR.get(s.get("color", "none"), "")
    chain = ",".join(vf)
    if fmt == "crop":
        fx = float(s.get("focus", 50)) / 100
        if s.get("crop_mode", "face") == "face":
            fx = face_focus(info, a, b)
        chain += f",scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H}:(iw-ow)*{fx:.3f}:(ih-oh)/2"
        if col:
            chain += "," + col
        chain += ",setsar=1[v0]"
    elif fmt == "blur":
        z = max(1.0, float(s.get("zoom", 1.0)))
        fx = float(s.get("focus", 50)) / 100
        chain += ",split=2[bga][fga];"
        chain += f"[bga]scale={W // 4}:{H // 4}:force_original_aspect_ratio=increase,crop={W // 4}:{H // 4},gblur=sigma=12," \
                 f"eq=brightness=-0.22:saturation=1.2,scale={W}:{H}[bg];"
        chain += f"[fga]crop=iw/{z:.3f}:ih:(iw-iw/{z:.3f})*{fx:.3f}:0,scale={W}:{H}:force_original_aspect_ratio=decrease[fg];"
        chain += f"[bg][fg]overlay=(W-w)/2:(H-h)/2" + ("," + col if col else "") + ",setsar=1[v0]"
    else:
        chain += f",scale={W}:{H}" + ("," + col if col else "") + ",setsar=1[v0]"
    fc = [chain]
    last = "v0"
    if s.get("subs", {}).get("on") and words:
        n = build_ass(os.path.join(tmp, "subs.ass"), words, a, b, segs, W, H, s)
        if n:
            fc.append(f"[{last}]ass=subs.ass[v1]")
            last = "v1"
    idx = 1
    hl = s.get("headline", {})
    if hl.get("mode", "off") != "off" or (part and hl.get("part_on") and part[1] > 0):
        if headline_png(os.path.join(tmp, "headline.png"), headline_text(s, m), part if hl.get("part_on") else None,
                        W, H, s, fmt):
            inputs += ["-loop", "1", "-framerate", f"{fps:.3f}", "-t", f"{D:.3f}", "-i", "headline.png"]
            secs = float(hl.get("secs", 0) or 0)
            en = f":enable='lte(t,{secs:.2f})'" if secs > 0 else ""
            fc.append(f"[{last}][{idx}:v]overlay=0:0:format=auto{en}[hl]")
            last = "hl"
            idx += 1
    # banners
    aud_extra = []
    for bn in s.get("banners", []) or []:
        p = bn.get("path")
        if not bn.get("on", True) or not p or not os.path.isfile(p):
            continue
        img = is_image(p)
        blen = 0.0 if img else _media_len(p)
        bnx = dict(bn, _image=img, _len=(blen or 4.0))
        for T, dur in banner_times(bnx, D):
            if dur <= 0.1:
                continue
            if img:
                inputs += ["-loop", "1", "-framerate", f"{fps:.3f}", "-t", f"{dur:.3f}", "-i", p]
            else:
                if blen and dur > blen + 0.05:
                    inputs += ["-stream_loop", "-1"]
                inputs += ["-t", f"{dur:.3f}", "-i", p]
            fc.append(banner_filter(idx, bnx, W, H, T, dur, fps))
            x, y = banner_xy(bn, W, H)
            fc.append(f"[{last}][bn{idx}]overlay=x={x}:y={y}:eof_action=pass:format=auto[o{idx}]")
            last = f"o{idx}"
            if bn.get("sound") and not img and _has_audio(p):
                vol = float(bn.get("volume", 80)) / 100
                fc.append(f"[{idx}:a]asetpts=PTS-STARTPTS,volume={vol:.2f},adelay={int(T * 1000)}:all=1,"
                          f"aformat=sample_rates=48000:channel_layouts=stereo[ba{idx}]")
                aud_extra.append(f"ba{idx}")
            idx += 1
    if preview:
        fc.append(f"[{last}]scale={W // 2 // 2 * 2}:{H // 2 // 2 * 2},format=yuv420p[vout]")
    else:
        fc.append(f"[{last}]format=yuv420p[vout]")
    has_a = bool(info["audio_tracks"])
    if has_a:
        tr = int(m.get("track", s.get("audio_track", 0)) or 0)
        tr = min(tr, len(info["audio_tracks"]) - 1)
        ach = f"[0:a:{tr}]aresample=48000"
        if s.get("jumpcut") and len(segs) > 1:
            expr = "+".join(f"between(t,{x:.3f},{y:.3f})" for x, y in segs)
            ach += f",aselect='{expr}',asetpts=N/SR/TB"
        if s.get("loudnorm", True):
            ach += ",loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000"
        ach += ",aformat=sample_rates=48000:channel_layouts=stereo"
        beeps = mat_intervals(words, a, b, segs) if (s.get("beep", True) and words) else []
        if beeps:
            ex = "+".join(f"between(t,{x:.3f},{y:.3f})" for x, y in beeps)
            ach += f",volume='if({ex},0,1)':eval=frame"
            fc.append(f"sine=frequency=1000:sample_rate=48000:duration={D:.3f},"
                      f"volume='if({ex},{1.4 * float(s.get('beep_volume', 100)) / 100:.2f},0)':eval=frame,aformat=sample_rates=48000:channel_layouts=stereo[beep]")
            aud_extra.append("beep")
        if aud_extra:
            fc.append(ach + "[am]")
            fc.append("[am]" + "".join(f"[{x}]" for x in aud_extra) +
                      f"amix=inputs={1 + len(aud_extra)}:duration=first:normalize=0[aout]")
        else:
            fc.append(ach + "[aout]")
    open(os.path.join(tmp, "fc.txt"), "w", encoding="utf-8").write(";\n".join(fc))
    if preview:
        venc = ["-c:v", "libx264", "-preset", "ultrafast", "-crf", "28"]
    elif s.get("encoder", "auto") in ("auto", "nvenc") and nvenc_ok():
        venc = ["-c:v", "h264_nvenc", "-preset", "p5", "-rc", "vbr", "-cq", "21", "-b:v", "0", "-maxrate", "14M",
                "-bufsize", "20M", "-profile:v", "high"]
    else:
        q = s.get("quality", "normal")
        venc = ["-c:v", "libx264", "-preset", {"fast": "veryfast", "best": "slow"}.get(q, "medium"), "-crf",
                {"fast": "23", "best": "18"}.get(q, "20")]
    cmd = [TOOLS["ffmpeg"], "-y", "-v", "error", "-nostats", "-progress", "pipe:1"] + inputs + \
          ["-/filter_complex", "fc.txt", "-map", "[vout]"] + (["-map", "[aout]", "-c:a", "aac", "-b:a", "192k"] if has_a else ["-an"]) + \
          venc + ["-pix_fmt", "yuv420p", "-r", f"{fps:.3f}", "-t", f"{D:.3f}", "-movflags", "+faststart", out_path + ".part.mp4"]

    def on_line(ln):
        if ln.startswith("out_time_ms=") and frac_cb:
            try:
                frac_cb(int(ln.split("=")[1]) / 1e6 / max(0.1, D))
            except ValueError:
                pass

    try:
        ctx.run(cmd, cwd=tmp, on_line=on_line)
        os.replace(out_path + ".part.mp4", out_path)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        if os.path.isfile(out_path + ".part.mp4"):
            try:
                os.remove(out_path + ".part.mp4")
            except OSError:
                pass
    return {"duration": D, "segments": len(segs)}


def safe_name(t, n=48):
    t = re.sub(r'[\\/:*?"<>|\n\r\t]+', " ", t or "")
    t = re.sub(r"\s+", "_", t.strip())[:n].strip("_.")
    return t or "clip"


def words_for(ctx, an, s, ranges):
    """Words covering `ranges` (transcribes missing chunks if subtitles / jump cuts need them)."""
    wd = an["workdir"]
    info = an["info"]
    wav = os.path.join(wd, f"audio_t{an['track']}.wav")
    if not os.path.isfile(wav):
        wav = extract_audio(ctx, info, an["track"], wd)
    if not wav:
        return []
    rs = [(max(0, a - 2), b + 2) for a, b in ranges]
    return transcribe(ctx, wav, wd, s.get("language", "auto"), rs, info["duration"])


def load_feats(an):
    fz = os.path.join(an["workdir"], f"audio_t{an['track']}_feat.npz")
    if os.path.isfile(fz):
        z = np.load(fz)
        return {k: z[k] for k in z.files}
    return None


def export(ctx, an, moments, s, out_dir):
    info = an["info"]
    need_words = s.get("subs", {}).get("on") or s.get("jumpcut")
    sel = [m for m in moments if m.get("checked", True)]
    if not sel:
        raise RuntimeError("Не выбрано ни одного клипа")
    ctx.plan([("speech", 2 if need_words else 0), ("render", 8), ("done", 0.1)])
    words = []
    feats = load_feats(an)
    if need_words and s.get("use_speech", True):
        ctx.stage("speech")
        ctx.log("Готовлю слова для субтитров / вырезания пауз…")
        words = words_for(ctx, an, s, [(m["start"], m["end"]) for m in sel])
    ctx.stage("render")
    base = safe_name(os.path.splitext(info["name"])[0], 40)
    folder = os.path.join(out_dir, f"{base}_{time.strftime('%Y-%m-%d_%H-%M')}")
    os.makedirs(folder, exist_ok=True)
    # clip text for descriptions (manual mode has no transcript yet)
    for m in sel:
        if not m.get("text") and words:
            m["text"] = " ".join(w["w"] for w in words if w["t"] >= m["start"] - 0.1 and w["e"] <= m["end"] + 0.1)
    p0 = int(s.get("headline", {}).get("part_start", 1) or 1)
    metas = [make_meta(m, s, p0 + i, len(sel)) for i, m in enumerate(sel)]
    if s.get("use_llm"):
        try:
            import llm
            if llm.available():
                metas = llm.describe(ctx, sel, metas, s)
        except Exception as e:
            ctx.log(f"Claude не написал описания ({e}) — оставляю локальные")
    lines, meta = [], []
    for i, m in enumerate(sel):
        md = metas[i]
        name = f"{i + 1:02d}_{safe_name(m.get('title'))}.mp4"
        ctx.log(f"Рендер {i + 1}/{len(sel)}: {name}")
        r = render(ctx, info, m, s, words, feats, os.path.join(folder, name),
                   frac_cb=lambda f, i=i: ctx.frac((i + min(1, f)) / len(sel)), part=(p0 + i, p0 + len(sel) - 1))
        open(os.path.join(folder, os.path.splitext(name)[0] + ".txt"), "w", encoding="utf-8-sig").write(
            f"НАЗВАНИЕ:\n{md['title']}\n\nОПИСАНИЕ:\n{md['description']}\n\nХЕШТЕГИ:\n{' '.join(md['hashtags'])}\n")
        lines.append(f"{i + 1:02d}. {md['title']}\n    файл: {name}\n    исходник: {fmt_time(m['start'], True)} – "
                     f"{fmt_time(m['end'], True)}  (длина клипа {r['duration']:.1f} с" +
                     (f", оценка {m['score100']}" if m.get("score100") else "") + ")\n" +
                     f"    описание: {md['description']}\n    хештеги: {' '.join(md['hashtags'])}\n" +
                     (f"    текст: {m['text'][:400]}\n" if m.get("text") else ""))
        meta.append({"file": name, "title": md["title"], "description": md["description"], "hashtags": md["hashtags"],
                     "start": m["start"], "end": m["end"], "part": p0 + i,
                     "duration": round(r["duration"], 2), "score": m.get("score100"), "text": m.get("text", "")})
    hdr = f"Источник: {info['path']}\nКлипов: {len(sel)}   ({time.strftime('%d.%m.%Y %H:%M')})\n\n"
    open(os.path.join(folder, "клипы.txt"), "w", encoding="utf-8-sig").write(hdr + "\n".join(lines))
    json.dump(meta, open(os.path.join(folder, "clips.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    ctx.stage("done", 1)
    return {"folder": folder, "count": len(sel)}


def preview_clip(ctx, an, m, s):
    info = an["info"]
    ctx.plan([("speech", 1), ("render", 3)])
    words = []
    feats = load_feats(an)
    if (s.get("subs", {}).get("on") or s.get("jumpcut")) and s.get("use_speech", True):
        ctx.stage("speech")
        words = words_for(ctx, an, s, [(m["start"], m["end"])])
    ctx.stage("render")
    d = os.path.join(an["workdir"], "preview")
    os.makedirs(d, exist_ok=True)
    out = os.path.join(d, f"{m.get('id', 'p')}_{int(time.time())}.mp4")
    for f in glob.glob(os.path.join(d, "*.mp4")):
        try:
            os.remove(f)
        except OSError:
            pass
    p0 = int(s.get("headline", {}).get("part_start", 1) or 1)
    render(ctx, info, m, s, words, feats, out, preview=True, frac_cb=ctx.frac,
           part=(p0 + int(m.get("_n", 0)), p0 + int(m.get("_total", 1)) - 1))
    return {"file": out}

# ------------------------------------------------------------------------------- banner preview

def banner_preview(bn, src=None, t=None, out=None):
    """PNG: the banner keyed and placed on a 1080x1920 frame from the source (or a checkerboard)."""
    W, H = 1080, 1920
    out = out or os.path.join(WORK, "banner_preview.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    p = bn.get("path")
    if not p or not os.path.isfile(p):
        raise RuntimeError("Нет файла баннера")
    img = is_image(p)
    bt = float(bn.get("preview_t", 0.5) or 0)
    if not img:
        L = _media_len(p)
        bt = min(bt, max(0, L - 0.05))
    inputs = []
    if src and os.path.isfile(src):
        info = probe(src)
        tt = t if t is not None else info["duration"] * 0.3
        inputs += ["-ss", f"{tt:.2f}", "-i", src]
        base = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1[bg]"
    else:
        inputs += ["-f", "lavfi", "-i", f"color=c=0x3a3f4a:s={W}x{H}"]
        base = f"[0:v]drawgrid=w=60:h=60:t=fill:c=0x2c3038,setsar=1[bg]"
    inputs += (["-i", p] if img else ["-ss", f"{bt:.2f}", "-i", p])
    bnx = dict(bn, _image=False)
    chain = banner_filter(1, dict(bnx, fade=0), W, H, 0, 10, 30).replace(",setpts=PTS-STARTPTS+0.000/TB", "")
    x, y = banner_xy(bn, W, H)
    fc = f"{base};{chain};[bg][bn1]overlay=x={x}:y={y}:format=auto,scale=540:960[o]"
    r = subprocess.run([TOOLS["ffmpeg"], "-y", "-v", "error"] + inputs + ["-filter_complex", fc, "-map", "[o]",
                                                                          "-frames:v", "1", out],
                       capture_output=True, creationflags=NOWIN)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace")[-400:])
    return out


def banner_frame_color(path, x, y, t=0.5):
    """Colour under the eyedropper at relative (x, y) of the raw banner frame -> '#RRGGBB'."""
    out = os.path.join(WORK, "banner_raw.png")
    os.makedirs(WORK, exist_ok=True)
    args = [TOOLS["ffmpeg"], "-y", "-v", "error"] + ([] if is_image(path) else ["-ss", str(t)]) + \
        ["-i", path, "-frames:v", "1", out]
    subprocess.run(args, creationflags=NOWIN)
    im = Image.open(out).convert("RGB")
    px = im.getpixel((min(im.width - 1, int(x * im.width)), min(im.height - 1, int(y * im.height))))
    return "#%02X%02X%02X" % px


def banner_raw_frame(path, t=0.5):
    out = os.path.join(WORK, "banner_raw.png")
    os.makedirs(WORK, exist_ok=True)
    args = [TOOLS["ffmpeg"], "-y", "-v", "error"] + ([] if is_image(path) else ["-ss", str(t)]) + \
        ["-i", path, "-frames:v", "1", "-vf", "scale='min(640,iw)':-2", out]
    subprocess.run(args, creationflags=NOWIN)
    return out
