"""Headless test: python selftest.py <video> <out_dir> [stream]"""
import json, os, sys, threading, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine, server

src, out = sys.argv[1], sys.argv[2]
s = server.load_settings()
s = server.merge({"source_type": "stream" if "stream" in sys.argv else "video", "cut_mode": "auto", "clip_count": 3,
                  "min_len": 30, "max_len": 120, "jumpcut": True, "color": "juicy", "format": "crop",
                  "headline": {"mode": "custom", "text": "ТЕСТ [НАРЕЗКИ] — ЧТО ПРОИЗОШЛО?", "part_on": True, "plate": False},
                  "meta": {"tags": "#тест #нарезка"},
                  "banners": [{"on": True, "path": os.path.join(engine.APP, "banners", "Подписаться_зелёный.mp4"),
                               "key": True, "key_color": "#00FF00", "similarity": 0.3, "blend": 0.08, "pos": "bottom",
                               "size": 60, "margin": 14, "when": "end", "duration": 0, "fade": 0.3, "sound": True, "volume": 80}]},
                 server.DEFAULTS)
ctx = engine.Ctx("analyze")


def watch():
    last = ""
    while ctx.state["running"]:
        st = ctx.state
        line = f"{st['stage']:8s} {st['progress'] * 100:5.1f}% eta={st['eta']}"
        if line != last:
            print(line, flush=True)
            last = line
        time.sleep(5)


threading.Thread(target=watch, daemon=True).start()
t0 = time.time()
an = engine.analyse(ctx, src, s)
print("ANALYSE", round(time.time() - t0), "s")
for m in an["moments"]:
    print(f"  {engine.fmt_time(m['start'])}-{engine.fmt_time(m['end'])} score={m['score100']} {m['parts']} | {m['title']}")
print("\n".join(ctx.state["log"][-8:]))
moms = an["moments"][:2]
ctx2 = engine.Ctx("export")
ctx = ctx2
threading.Thread(target=watch, daemon=True).start()
t0 = time.time()
r = engine.export(ctx2, an, moms, s, out)
print("EXPORT", round(time.time() - t0), "s", r)
print("\n".join(ctx2.state["log"][-6:]))
