"""Generates a starter green-screen «ПОДПИСАТЬСЯ» banner (mp4 with sound + png) into ClipApp\\banners."""
import os, shutil, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine

OUT = os.path.join(engine.APP, "banners")
os.makedirs(OUT, exist_ok=True)
W, H, FPS, N = 900, 360, 30, 75
GREEN = (0, 255, 0)
f = ImageFont.truetype(engine.font_path("Arial Black"), 64)


def frame(k):
    im = Image.new("RGB", (W, H), GREEN)
    d = ImageDraw.Draw(im)
    t = k / FPS
    sc = min(1.0, t / 0.35) if t < 0.35 else (1.0 + 0.06 * (1 - abs((t - 1.3) / 0.15)) if 1.15 < t < 1.45 else 1.0)
    clicked = t > 1.3
    bw, bh = int(640 * sc), int(150 * sc)
    x0, y0 = (W - bw) // 2, (H - bh) // 2
    d.rounded_rectangle([x0 + 8, y0 + 10, x0 + bw + 8, y0 + bh + 10], radius=int(30 * sc), fill=(20, 20, 20))
    d.rounded_rectangle([x0, y0, x0 + bw, y0 + bh], radius=int(30 * sc), fill=(120, 120, 120) if clicked else (229, 31, 31))
    label = "ВЫ ПОДПИСАНЫ" if clicked else "ПОДПИСАТЬСЯ"
    if sc > 0.5:
        ff = ImageFont.truetype(engine.font_path("Arial Black"), max(10, int(56 * sc)))
        tw = d.textlength(label, font=ff)
        d.text(((W - tw) / 2, y0 + bh / 2 - 36 * sc), label, font=ff, fill=(255, 255, 255))
    if 0.9 < t < 1.6:                                       # cursor
        cx, cy = int(W / 2 + 140 - (t - 0.9) * 60), int(H / 2 + 60 - (t - 0.9) * 50)
        d.polygon([(cx, cy), (cx, cy + 56), (cx + 15, cy + 42), (cx + 27, cy + 66), (cx + 36, cy + 61), (cx + 24, cy + 38), (cx + 42, cy + 38)],
                  fill=(255, 255, 255), outline=(0, 0, 0))
    return im


tmp = tempfile.mkdtemp()
for k in range(N):
    frame(k).save(os.path.join(tmp, f"f{k:03d}.png"))
frame(20).save(os.path.join(OUT, "Подписаться_зелёный.png"))
ff = engine.TOOLS["ffmpeg"]
subprocess.run([ff, "-y", "-v", "error", "-framerate", str(FPS), "-i", os.path.join(tmp, "f%03d.png"),
                "-f", "lavfi", "-i", "sine=f=1320:d=0.12,afade=t=out:st=0.02:d=0.1,adelay=1300:all=1,apad=pad_dur=2",
                "-t", str(N / FPS), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "16", "-c:a", "aac",
                os.path.join(OUT, "Подписаться_зелёный.mp4")], check=True)
shutil.rmtree(tmp, ignore_errors=True)
print("ok", OUT)
