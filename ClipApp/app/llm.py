"""Optional: let Claude rank candidate moments and write titles.

Works only if the user put their own API key into config\\claude_api_key.txt (or set ANTHROPIC_API_KEY).
Any failure -> the caller falls back to local scoring, so the app never depends on it.
"""
import json, os

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


def available():
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
    ctx.log("Claude пишет названия, описания и хештеги…")
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
    import anthropic

    key = api_key()
    if not key:
        raise RuntimeError("нет ключа в config\\claude_api_key.txt")
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
    ctx.log(f"Спрашиваю Claude ({MODEL}) о {len(pool)} кандидатах…")
    client = anthropic.Anthropic(api_key=key, timeout=180.0)
    resp = client.beta.messages.create(
        model=MODEL,
        max_tokens=16000,
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
        output_config={"format": {"type": "json_schema", "schema": SCHEMA}},
        messages=[{"role": "user", "content": prompt}],
    )
    if resp.stop_reason == "refusal":
        raise RuntimeError("Claude отказался оценивать этот фрагмент")
    text = "".join(b.text for b in resp.content if b.type == "text")
    picks = json.loads(text)["picks"]
    out = []
    for p in picks:
        i = p.get("index")
        if isinstance(i, int) and 0 <= i < len(pool) and pool[i] not in out:
            c = dict(pool[i])
            c["title"] = p.get("title") or None
            c["score100"] = max(0, min(100, int(p.get("score", 0))))
            c["parts"] = dict(c.get("parts", {}), Claude=round(c["score100"] / 100, 2))
            out.append(c)
    if not out:
        raise RuntimeError("пустой ответ")
    ctx.log(f"Claude выбрал {len(out)} моментов")
    return out[:n]
