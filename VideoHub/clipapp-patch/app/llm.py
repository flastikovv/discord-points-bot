"""Optional: let an AI (free Google Gemini, or Claude) rank candidate moments and write titles.

Gemini: GEMINI_API_KEY env var (set by «Студия Монетизации») or config\\gemini_api_key.txt.
Claude: config\\claude_api_key.txt (or ANTHROPIC_API_KEY).
Any failure -> the caller falls back to local scoring, so the app never depends on it.
"""
import json, os, urllib.request, urllib.error

import engine

MODEL = "claude-opus-5-5"


def api_key():
    p = os.path.join(engine.CONFIG, "claude_api_key.txt")
    if os.path.isfile(p):
        for ln in open(p, encoding="utf-8-sig"):
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                return ln
    return os.environ.get("ANTHROPIC_API_KEY")


def gemini_key():
    p = os.path.join(engine.CONFIG, "gemini_api_key.txt")
    if os.path.isfile(p):
        for ln in open(p, encoding="utf-8-sig"):
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                return ln
    return os.environ.get("GEMINI_API_KEY")


GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"]


def _gemini(prompt):
    key = gemini_key()
    body = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt + "\n\nОтветь только JSON по описанной схеме, без пояснений."}]}],
        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.6},
    }).encode("utf-8")
    models = ([os.environ["GEMINI_MODEL"]] if os.environ.get("GEMINI_MODEL") else []) + GEMINI_MODELS
    last = None
    for m in models:
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent",
            data=body, headers={"Content-Type": "application/json", "x-goog-api-key": key}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = RuntimeError(f"Gemini HTTP {e.code}")
            if e.code == 404:
                continue
            raise last
        parts = (((data.get("candidates") or [{}])[0].get("content") or {}).get("parts") or [])
        text = "".join(p.get("text", "") for p in parts).strip()
        if text.startswith("```"):
            text = text.strip("`").split("\n", 1)[-1]
        return json.loads(text)
    raise last or RuntimeError("Gemini недоступен")


def engine_name():
    return "Gemini" if gemini_key() else "Claude"


def available():
    if gemini_key():
        return True
    try:
        import anthropic  # noqa: F401
    except Exception:
        return False
    return bool(api_key())


SCHEMA = {
    "type": "object",
    "properties": {
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "score": {"type": "integer"},
                    "title": {"type": "string"},
                },
                "required": ["index", "score", "title"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["picks"],
    "additionalProperties": False,
}


META_SCHEMA = {
    "type": "object",
    "properties": {
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "hashtags": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["index", "title", "description", "hashtags"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["clips"],
    "additionalProperties": False,
}


def _call(prompt, schema):
    if gemini_key():
        return _gemini(prompt + "\n\nСхема ответа (JSON Schema): " + json.dumps(schema, ensure_ascii=False))
    import anthropic
    client = anthropic.Anthropic(api_key=api_key(), timeout=180.0)
    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"format": {"type": "json_schema", "schema": schema}},
        messages=[{"role": "user", "content": prompt}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("Claude отказался обрабатывать этот фрагмент")
    return json.loads("".join(b.text for b in resp.content if b.type == "text"))


def describe(ctx, clips, metas, s):
    """Upload title / description / hashtags for each clip. `metas` are the offline versions (kept on failure)."""
    hl = s.get("headline", {})
    md = s.get("meta", {})
    lang = s.get("language", "auto")
    tl = {"ru": "на русском", "en": "in English"}.get(lang, "на языке фрагмента")
    series = hl.get("text", "").replace("[", "").replace("]", "") if hl.get("mode") == "custom" else ""
    items = [f"[{i}] часть {i + 1}: {c.get('text', '')[:1200]}" for i, c in enumerate(clips)]
    prompt = (
        "Это нарезки одного видео для YouTube Shorts / TikTok / Reels. Для каждой напиши " + tl + ":\n"
        "- title: цепкое название до 70 символов" + (f" (серия называется «{series}», добавь «часть N»)" if series else "") + ";\n"
        "- description: 1–3 коротких предложения, о чём фрагмент, без спойлера концовки, с призывом досмотреть/подписаться;\n"
        f"- hashtags: 6–10 хештегов (с #), первым #shorts" +
        (f", обязательно включи: {md.get('tags')}" if md.get("tags") else "") + ".\n\n" + "\n".join(items))
    ctx.log(f"{engine_name()} пишет названия, описания и хештеги…")
    out = [dict(m) for m in metas]
    for c in _call(prompt, META_SCHEMA)["clips"]:
        i = c.get("index")
        if isinstance(i, int) and 0 <= i < len(out):
            tags = [t if t.startswith("#") else "#" + t for t in c.get("hashtags", []) if t.strip()]
            out[i] = {"title": c.get("title") or out[i]["title"], "description": c.get("description") or out[i]["description"],
                      "hashtags": tags or out[i]["hashtags"]}
            out[i]["description"] += "\n\n" + " ".join(out[i]["hashtags"])
    return out


def rank(ctx, pool, n, s):
    if not gemini_key() and not api_key():
        raise RuntimeError("нет ключа ИИ (Gemini или Claude)")
    lang = s.get("language", "auto")
    tl = {"ru": "на русском", "en": "in English"}.get(lang, "на языке фрагмента")
    items = []
    for i, c in enumerate(pool):
        items.append(f"[{i}] {engine.fmt_time(c['start'])}–{engine.fmt_time(c['end'])} "
                     f"({c['end'] - c['start']:.0f} с, локальная оценка {c.get('score100', 0)}): {c['text'][:900]}")
    prompt = (
        "Ты помогаешь нарезать длинное видео/стрим на вертикальные шортсы (YouTube Shorts, TikTok, Reels).\n"
        f"Ниже {len(pool)} кандидатов с расшифровкой речи. Выбери {n} лучших — тех, что смотрятся самостоятельно, "
        "с сильной зацепкой в первые секунды, законченной мыслью, эмоцией, шуткой или неожиданным фактом. "
        "Не бери повторяющиеся по смыслу фрагменты.\n"
        f"Для каждого выбранного дай score 0–100 и цепкий заголовок {tl} (до 60 символов, без хэштегов и кавычек).\n\n"
        + "\n".join(items)
    )
    ctx.log(f"Спрашиваю {engine_name()} о {len(pool)} кандидатах…")
    picks = _call(prompt, SCHEMA)["picks"]
    out = []
    for p in picks:
        i = p.get("index")
        if isinstance(i, int) and 0 <= i < len(pool) and pool[i] not in out:
            c = dict(pool[i])
            c["title"] = p.get("title") or None
            c["score100"] = max(0, min(100, int(p.get("score", 0))))
            c["parts"] = dict(c.get("parts", {}), **{engine_name(): round(c["score100"] / 100, 2)})
            out.append(c)
    if not out:
        raise RuntimeError("пустой ответ")
    ctx.log(f"{engine_name()} выбрал {len(out)} моментов")
    return out[:n]
