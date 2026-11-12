const { app, BrowserWindow, Menu, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Readable } = require('stream');

app.setName('ORPHEUS');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
protocol.registerSchemesAsPrivileged([
  { scheme: 'orpheus', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);

const AUDIO = /\.(mp3|flac|m4a|wav|ogg|opus|aac|webm)$/i;
const LRC = /\.lrc$/i;
const WIN = process.platform === 'win32';
const norm = (p) => path.normalize(p);
const key = (p) => (WIN ? p.toLowerCase() : p);

/* ---------------- config: watched folders, loose files, hidden tracks ---------------- */
let cfg = { folders: [], files: [], ignored: [] };
let cfgFile = '';
let cfgT;
function loadCfg() {
  cfgFile = path.join(app.getPath('userData'), 'library.json');
  try {
    const j = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
    cfg = { folders: j.folders || [], files: j.files || [], ignored: j.ignored || [] };
  } catch {}
}
function saveCfg() {
  clearTimeout(cfgT);
  cfgT = setTimeout(() => fs.promises.writeFile(cfgFile, JSON.stringify(cfg)).catch(() => {}), 300);
}

/* ---------------- library state ---------------- */
const lib = new Map(); // path -> {p,size,mt,lrc,src}
const ignored = () => new Set(cfg.ignored.map(key));
let win = null;
let libReady = false; // renderer has fetched the initial state and listens for updates
let uiReady = false;
const pendingOpen = [];
const send = (ch, d) => { if (win && !win.isDestroyed() && libReady) win.webContents.send(ch, d); };
const pub = (e) => ({ p: e.p, size: e.size, mt: e.mt, lrc: e.lrc });

async function walk(dir, out, depth = 0) {
  let ents;
  try { ents = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return depth === 0 ? null : undefined; }
  const subs = [];
  for (const d of ents) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) { if (depth < 12) subs.push(walk(p, out, depth + 1)); }
    else if (d.isFile() && (AUDIO.test(d.name) || LRC.test(d.name))) out.push(p);
  }
  await Promise.all(subs);
  return out;
}

async function statEntry(p) {
  try { const s = await fs.promises.stat(p); return { size: s.size, mt: Math.round(s.mtimeMs) }; } catch { return null; }
}

const retry = new Map();
function scheduleRescan(dir, ms = 2000) {
  clearTimeout(retry.get(dir));
  retry.set(dir, setTimeout(() => scanFolder(dir), ms));
}

/* Scan one folder and diff against what we already know. */
async function scanFolder(dir) {
  const all = await walk(dir, []);
  if (all === null || all === undefined) return; // folder unavailable (unplugged drive...): keep what we have
  const hide = ignored();
  const lrcs = new Set(all.filter((p) => LRC.test(p)).map(key));
  const seen = new Set();
  const add = [];
  let unstable = false;
  const stats = await Promise.all(all.filter((p) => AUDIO.test(p) && !hide.has(key(p))).map(async (p) => [p, await statEntry(p)]));
  for (const [p, s] of stats) {
    if (!s) continue;
    if (Date.now() - s.mt < 1500) { unstable = true; continue; } // still being copied
    const lp = p.replace(/\.[^.\\/]+$/, '.lrc');
    const lrc = lrcs.has(key(lp)) ? lp : null;
    seen.add(key(p));
    const old = lib.get(p);
    const e = { p, size: s.size, mt: s.mt, lrc, src: dir };
    if (!old || old.size !== e.size || old.mt !== e.mt || old.lrc !== e.lrc) { lib.set(p, e); add.push(pub(e)); }
  }
  const remove = [];
  for (const [p, e] of lib) {
    if (e.src === dir && !seen.has(key(p)) && !(unstable && fs.existsSync(p))) { lib.delete(p); remove.push(p); }
  }
  if (add.length || remove.length) send('lib:update', { add, remove, folders: cfg.folders });
  if (unstable) scheduleRescan(dir);
}

/* ---------------- watchers ---------------- */
const watchers = new Map();
const deb = new Map();
function watch(dir) {
  if (watchers.has(dir)) return;
  try {
    const w = fs.watch(dir, { recursive: true, persistent: false }, () => {
      clearTimeout(deb.get(dir));
      deb.set(dir, setTimeout(() => scanFolder(dir), 800));
    });
    w.on('error', () => {});
    watchers.set(dir, w);
  } catch {}
}
function unwatch(dir) {
  const w = watchers.get(dir);
  if (w) { try { w.close(); } catch {} watchers.delete(dir); }
  clearTimeout(deb.get(dir)); clearTimeout(retry.get(dir));
}

async function addLoose(p) {
  const s = await statEntry(p);
  if (!s) return null;
  const lp = p.replace(/\.[^.\\/]+$/, '.lrc');
  const e = { p, size: s.size, mt: s.mt, lrc: fs.existsSync(lp) ? lp : null, src: '' };
  lib.set(p, e);
  return pub(e);
}

/* Add dropped / picked / opened paths. Folders become watched folders, files are kept individually. */
async function addPaths(paths) {
  const add = [];
  for (let p of paths) {
    if (typeof p !== 'string') continue;
    p = norm(p);
    let st;
    try { st = await fs.promises.stat(p); } catch { continue; }
    cfg.ignored = cfg.ignored.filter((x) => key(x) !== key(p));
    if (st.isDirectory()) {
      if (!cfg.folders.some((d) => key(d) === key(p))) cfg.folders.push(p);
      watch(p);
      await scanFolder(p);
    } else if (AUDIO.test(p)) {
      const inFolder = cfg.folders.some((d) => key(p).startsWith(key(d) + path.sep));
      if (!inFolder && !cfg.files.some((f) => key(f) === key(p))) cfg.files.push(p);
      const e = await addLoose(p);
      if (e) add.push(e);
    }
  }
  saveCfg();
  send('lib:update', { add, remove: [], folders: cfg.folders });
}

function removeFolder(dir) {
  cfg.folders = cfg.folders.filter((d) => key(d) !== key(dir));
  unwatch(dir);
  const remove = [];
  for (const [p, e] of lib) if (e.src === dir) { lib.delete(p); remove.push(p); }
  saveCfg();
  send('lib:update', { add: [], remove, folders: cfg.folders });
}

/* Is the renderer allowed to read this path? Only music/lyrics inside watched folders or added files. */
function allowed(p) {
  if (!(AUDIO.test(p) || LRC.test(p))) return false;
  const k = key(path.resolve(p));
  if (cfg.files.some((f) => key(path.resolve(f)) === k || key(path.resolve(f).replace(/\.[^.\\/]+$/, '.lrc')) === k)) return true;
  return cfg.folders.some((d) => k.startsWith(key(path.resolve(d)) + path.sep));
}

/* ---------------- window ---------------- */
function toggleFullscreen() { if (win) win.setFullScreen(!win.isFullScreen()); }

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    fullscreen: true, show: false, backgroundColor: '#000000', autoHideMenuBar: true, title: 'ORPHEUS',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      backgroundThrottling: false, spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => win.show());
  win.loadURL('orpheus://app/index.html');
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('enter-full-screen', () => win.webContents.send('fs', true));
  win.on('leave-full-screen', () => win.webContents.send('fs', false));
  win.on('closed', () => { win = null; libReady = false; uiReady = false; });
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
    else if (i.control && i.key.toLowerCase() === 'q') { e.preventDefault(); app.quit(); }
  });
}

const argFiles = (argv) => argv.slice(app.isPackaged ? 1 : 2).filter((p) => !p.startsWith('-') && fs.existsSync(p));

async function openPaths(paths) {
  if (!paths.length) return;
  await addPaths(paths);
  if (win && uiReady) win.webContents.send('open', paths);
  else pendingOpen.push(...paths);
}

/* Audio files with HTTP Range support. Without it Chromium cannot seek (clicking the progress bar restarts the song). */
const MIME = { '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.webm': 'audio/webm' };
async function serveMedia(req, p) {
  let st;
  try { st = await fs.promises.stat(p); } catch { return new Response('not found', { status: 404 }); }
  const size = st.size;
  const h = { 'Content-Type': MIME[path.extname(p).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
  if (size === 0) return new Response(null, { status: 200, headers: { ...h, 'Content-Length': '0' } });
  let start = 0, end = size - 1, status = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec((req.headers.get('range') || '').trim());
  if (m && (m[1] !== '' || m[2] !== '')) {
    if (m[1] === '') start = Math.max(0, size - parseInt(m[2], 10));
    else { start = parseInt(m[1], 10); if (m[2] !== '') end = Math.min(parseInt(m[2], 10), size - 1); }
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    status = 206;
    h['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  h['Content-Length'] = String(end - start + 1);
  return new Response(Readable.toWeb(fs.createReadStream(p, { start, end })), { status, headers: h });
}

/* orpheus://app/index.html, /fonts/*, and /_m/<encoded absolute path> for media */
function registerProtocol() {
  protocol.handle('orpheus', (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/_m/')) {
      let p;
      try { p = norm(decodeURIComponent(u.pathname.slice(4))); } catch { return new Response('bad', { status: 400 }); }
      if (!allowed(p)) return new Response('forbidden', { status: 403 });
      return serveMedia(req, p);
    }
    const rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    if (!/^(index\.html|fonts\/[\w.-]+|icons\/[\w.-]+|manifest\.webmanifest)$/.test(rel)) return new Response('not found', { status: 404 });
    return net.fetch(pathToFileURL(path.join(__dirname, rel)).toString(), { bypassCustomProtocolHandlers: true });
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
    openPaths(argFiles(argv));
  });

  let initial;
  ipcMain.handle('lib:get', async () => {
    await Promise.race([initial, new Promise((r) => setTimeout(r, 15000))]);
    libReady = true;
    return { files: [...lib.values()].map(pub), folders: cfg.folders };
  });
  ipcMain.on('ui:ready', () => { uiReady = true; if (pendingOpen.length) win.webContents.send('open', pendingOpen.splice(0)); });
  ipcMain.handle('lib:pickFolder', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Choose your music folder(s)', properties: ['openDirectory', 'multiSelections'] });
    if (!r.canceled) await addPaths(r.filePaths);
  });
  ipcMain.handle('lib:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add songs', properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'm4a', 'wav', 'ogg', 'opus', 'aac', 'webm'] }],
    });
    if (!r.canceled) await addPaths(r.filePaths);
  });
  ipcMain.handle('lib:addPaths', (_e, paths) => addPaths(Array.isArray(paths) ? paths : []));
  ipcMain.on('lib:removeFolder', (_e, d) => { if (typeof d === 'string') removeFolder(d); });
  ipcMain.on('lib:ignore', (_e, p) => {
    if (typeof p !== 'string' || !lib.has(p)) return;
    cfg.ignored.push(p); cfg.files = cfg.files.filter((f) => key(f) !== key(p));
    lib.delete(p); saveCfg(); send('lib:update', { add: [], remove: [p], folders: cfg.folders });
  });
  ipcMain.handle('lib:restore', async () => {
    cfg.ignored = []; saveCfg();
    await Promise.all(cfg.folders.map(scanFolder));
    for (const f of cfg.files) { const e = await addLoose(f); if (e) send('lib:update', { add: [e], remove: [], folders: cfg.folders }); }
  });
  ipcMain.handle('lib:rescan', () => Promise.all(cfg.folders.map(scanFolder)));
  ipcMain.on('lib:reveal', (_e, p) => { if (typeof p === 'string' && lib.has(p)) shell.showItemInFolder(p); });
  ipcMain.handle('win:fs', () => { toggleFullscreen(); return win ? win.isFullScreen() : false; });
  ipcMain.handle('win:isfs', () => (win ? win.isFullScreen() : false));
  ipcMain.on('win:min', () => win && win.minimize());
  ipcMain.on('win:close', () => app.quit());

  app.whenReady().then(() => {
    loadCfg();
    registerProtocol();
    initial = (async () => {
      const keep = [];
      for (const f of cfg.files) { if (fs.existsSync(f) && !ignored().has(key(f))) { await addLoose(f); keep.push(f); } }
      await Promise.all(cfg.folders.map(async (d) => { watch(d); await scanFolder(d); }));
    })();
    // files given on the command line (Open With) are added after the initial scan
    initial.then(() => openPaths(argFiles(process.argv)));
    createWindow();
    // safety net for network drives / watchers that miss events
    setInterval(() => cfg.folders.forEach(scanFolder), 60000).unref();
  });
  app.on('window-all-closed', () => app.quit());
}
