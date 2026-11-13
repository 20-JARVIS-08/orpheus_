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

### Live room: if two devices cannot connect
Live room → *Advanced / connection problems* → **Test connection** (run it on both devices). It checks (1) the PeerJS connection service, (2) STUN (public address) and (3) an optional TURN relay. If (1) fails, the service is blocked on that network: use a VPN or run your own PeerJS server and enter it under *Own PeerJS server* (host and listeners must use the same one). If (2) fails or the link says "failed", add a TURN relay (URL, user, password) on the host and/or listeners.

## Android
Best experience: open the site in Chrome on Android → menu ⋮ → **Install app** (or the ⬇ button in ORPHEUS's ⋯ menu). Then it opens fullscreen like a normal app.
- Bottom navigation (Library / Now Playing / Settings), mini player, full-screen Now Playing (swipe down to close), landscape layout with a side navigation rail.
- The Android **Back** button closes the open menu first, then Now Playing, then goes from Settings back to Library.
- Lock-screen / notification controls with a seek bar (Media Session), cover art or the app icon.
- **Share to ORPHEUS:** in any file manager or app, share audio files → ORPHEUS (works once the app is installed). They are added to the library and start playing.
- Typing in the search box hides the bottom bars; pull-to-refresh is disabled so swiping down on Now Playing never reloads the page.
- Android browsers have no folder picker, so only "Add songs" is shown on phones. Songs are stored inside the app's browser storage.


## Android app (reads the songs already on the phone)

The Android build wraps this same web UI in Capacitor and lists music straight from Android's
MediaStore (the index the stock music app uses), so there is nothing to pick or upload and new
songs appear by themselves. Songs are never copied.

- **Easiest:** push a tag like `v1.0.2` (or run *Build Android APK* from the Actions tab). The APK is
  attached to the Release / the run's artifacts. Install it and allow the music permission.
- **Locally:** `npm install --no-save @capacitor/core@7 @capacitor/cli@7 @capacitor/android@7`,
  `python scripts/android-prepare.py`, then `cd android && ./gradlew assembleDebug`
  (needs JDK 21 and the Android SDK).

Native code lives in `android-overlay/` and is copied into the generated `android/` project by the script.

## Vocal remover and Live room on the phone
Both features are in the Android app (and the installed website) with a phone layout:
- **Karaoke** button on the Now Playing screen toggles *Remove vocals*; the same switch, *Strength / Width / Extra mid cut*, *AI*, *Fast AI*, *Gentle* and **Process queue** are in Settings → Audio → *Vocal remover*. Long-press a song (or ⋯) → *Make instrumental (AI)*.
- AI progress shows in a small pill above the mini player (tap to hide). The screen is kept awake while the model works; one song takes a few minutes on a phone (Fast AI is on by default) and the finished instrumental is stored in the app (about 10 MB per minute of music).
- **Live room**: menu ⋯ → *Live room…* opens a bottom sheet (Android Back closes it, the room keeps running). While a room is active a red **● LIVE** chip appears in the top bar to reopen it. Type your website address once in the sheet so the copied link opens the room; without it just share the 6-character code.
- In the Android app the AI engine and both models are bundled inside the APK (about 120 MB, no download on first use). `MainActivity` adds cross-origin-isolation headers to the app's own files so the AI engine can use several CPU threads (see the comment in `android-overlay/MainActivity.java`).
- `scripts/android-prepare.py` runs `node setup-ai.js` automatically if `models/` and `vendor/` are missing. To make the APK smaller you can leave out the 65 MB "best" model: remove the `vocal.onnx` entries from `setup-ai.js` and `scripts/android-prepare.py` and keep *Fast AI* switched on in the app (switching it off needs that model).
