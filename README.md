# ORPHEUS

One codebase, three ways to use it:
- Website / PWA: upload `site/` contents (index.html, manifest.webmanifest, sw.js, fonts/, icons/, downloads/) to any HTTPS host.
- Windows app: run `build.bat` (needs Node.js). Output is in `dist/`.
- Test the app without building: `start.bat`.

## Your own icon
1. Put your logo next to `make-icons.py` as `icon-source.png` (square, 1024x1024 recommended, transparent is fine).
2. Run `pip install pillow numpy` once, then `python make-icons.py` (optional: `python make-icons.py my-logo.png "#101010"` for a flat background colour instead of the dark gradient).
3. It rewrites everything in `icons/` (favicon, PWA, iPhone) and `build/icon.png` (Windows app).
4. Re-upload `icons/`, and raise VERSION in `sw.js` (e.g. orpheus-v2) so visitors get the new icons.

## Windows downloads on the website
Copy the built installers into `downloads/` as `ORPHEUS-Setup.exe` and `ORPHEUS-portable.exe`.

## Publishing on GitHub Pages (website + Windows downloads)
1. Create a GitHub repo and push the contents of this folder to the `main` branch.
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site goes live at `https://USER.github.io/REPO/` (the `pages.yml` workflow redeploys on every push).
3. For the Windows download buttons: push a tag, e.g. `git tag v1.0.0 && git push origin v1.0.0`. The `release.yml` workflow builds the installer and portable exe on GitHub and attaches them to a Release. On `github.io` the site links to the latest Release automatically (`ORPHEUS-Setup.exe`, `ORPHEUS-portable.exe`).
4. New version later: raise `version` in `package.json` and in `DL.version` in `index.html`, push, then push a new tag.
Using a custom domain? Then edit `ghBase` in `index.html` to your `https://github.com/USER/REPO/releases/latest/download/` URL.

## Intro (logo motion)
Plays every time the site or the Windows app opens (also on refresh). The name slides across while the lyre takes its place, the strings are plucked and settle, then the page fades in. Sound is synthesized in the browser (no audio files).
- Browsers block sound until the visitor taps/clicks once, so a "Tap for sound" button appears; tapping it replays the intro with sound.
- `index.html?nointro` skips it. It is also skipped when the system has animations turned off (Windows "Show animations" / Reduce motion).
- Timings are the constants at the top of the intro script near the end of `index.html` (`TP` = pluck times, `TAU` = how fast the strings settle, `T_SW0/T_SW1` = swap, `NAME` = text).
- The lyre is traced from `intro/lyre-source.png` by `intro/trace.py` (needs `pip install potracer numpy pillow`).

## AI vocal removal (real voice separation)
Audio tab → Vocal remover → **Remove vocals** + **AI (best)**. A neural model (MDX-Net "Inst_HQ_3", `models/vocal.onnx`, 65 MB) runs inside the app with onnxruntime-web (`sep-worker.js`, `vendor/ort/`). Each song is processed once, saved in the app's storage and then plays instantly as an instrumental. While it is being made, the live filter (`vocal-worklet.js`) plays instead.
- Uses the GPU (WebGPU) when available, otherwise the CPU; several CPU threads are used when the page is cross-origin isolated (always in the Windows app; on the website from the 2nd visit, via `sw.js`).
- Right-click a song → *Make instrumental (AI)*; the **Process queue** button does the whole queue in the background.
- `models/` and `vendor/` are not in the source zip (too big): run `node setup-ai.js` once (build.bat and both GitHub workflows do it automatically). Keep them next to `index.html` when uploading the website.

## Live room (listen together)
Includes a text chat between everyone in the room. Menu (right-click / ⋯) → **Live room…** → *Host a room* gives a code and a link (`?room=CODE`); others open the link or type the code and hear the host's music live (up to 8 listeners). Peer-to-peer WebRTC via PeerJS (`lib/peerjs.min.js`, `live.js`); the free PeerJS cloud only introduces the browsers. The host streams the app's output (with EQ/effects). In the Windows app, type your website address in the panel so the share link points to your GitHub Pages site.
