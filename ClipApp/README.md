# ClipApp

Windows desktop app (Russian UI) that cuts videos and stream recordings into vertical 9:16 clips:
auto highlight finding (whisper.cpp transcript + loudness/laughter + keywords) or manual ranges,
word-by-word subtitles, headline + «ЧАСТЬ N» plates, green-screen banners (chroma key), profanity
masking/beeping, loudness normalisation, colour presets, titles/descriptions/hashtags per clip,
links via yt-dlp. Optional Claude ranking if the user puts an API key in `config\claude_api_key.txt`.

## Layout
- `app/engine.py` — download, analysis, scoring, rendering (ffmpeg), export
- `app/server.py` — local HTTP server + app window (Edge `--app`), native file/folder dialogs
- `app/llm.py` — optional Claude ranking / descriptions
- `app/ui/` — interface (HTML/CSS/JS)
- `app/make_test_banner.py` — generates the starter green-screen «Подписаться» banner into `banners/`
- `_build/` — `Launcher.cs` (ClipApp.exe), `Setup.cs` (self-installing ClipApp_Setup.exe), `build.ps1`, `make_icon.py`
- `Как пользоваться.txt` — user guide

## Build
Needs a `runtime/` folder next to `app/` (portable Python 3.12 with numpy, pillow, yt-dlp[default], anthropic;
`runtime/ffmpeg/ffmpeg.exe`) — or just run a built `ClipApp_Setup.exe`, which downloads all of that.

```
runtime\python\python.exe app\make_test_banner.py
powershell -ExecutionPolicy Bypass -File _build\build.ps1
```

Not included in the repo: `runtime/`, `data/`, whisper models, videos, built `.exe` files.
