/* ORPHEUS live room: one person hosts, others join with a code or link and hear the same music live.
   Audio travels peer-to-peer (WebRTC, via PeerJS; the free PeerJS cloud is only used to introduce the browsers).
   Host: whatever ORPHEUS plays (with EQ/effects) is streamed. Listeners: the stream plays in their browser. */
(function () {
  if (window.liveShow) return;
  const MAX = 8;
  const CO = matchMedia('(pointer:coarse)').matches, PQ = '(max-width:959px),(pointer:coarse) and (max-height:520px)', ph = () => matchMedia(PQ).matches;
  let link_ = '', gconn = null, chatWrap = null, chatLog = null, nick = '', rate = new WeakMap(), peer = null, role = '', conns = [], box = null, body = null, code = '', dst = null, np = {}, st = '', pre = '', err = '', joinTo = 0;
  const aud = new Audio(); aud.autoplay = true;
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  const BTN = 'padding:' + (CO ? '12px 16px' : '8px 14px') + ';border-radius:' + (CO ? '12px' : '8px') + ';border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;font:600 ' + (CO ? 14 : 13) + 'px system-ui,sans-serif;cursor:pointer;touch-action:manipulation';
  const INP = 'padding:' + (CO ? '12px' : '8px 10px') + ';border-radius:' + (CO ? '12px' : '8px') + ';border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.35);color:#fff;font:600 14px system-ui,sans-serif;width:100%;box-sizing:border-box';
  try { nick = localStorage.getItem('orpheus-nick') || ''; } catch {}
  if (!nick) nick = 'Guest' + (Math.random() * 900 + 100 | 0);
  const addMsg = (n, m, me) => {
    if (!chatLog) return;
    const d = el('div', 'margin:2px 0;word-break:break-word'); d.append(el('b', 'opacity:.75;color:' + (me ? '#8fd3ff' : '#fff'), n + ': '), document.createTextNode(m));
    chatLog.append(d); chatLog.scrollTop = chatLog.scrollHeight;
    if (!shown && !me && typeof flash == 'function') flash('💬 ' + n + ': ' + m.slice(0, 60));
  };
  const sendChat = m => {
    m = (m || '').trim().slice(0, 300); if (!m) return;
    const msg = { t: 'chat', n: nick, m };
    if (role == 'host') { addMsg(nick, m, 1); conns.forEach(c => { try { c.send(msg); } catch {} }); }
    else if (role == 'guest' && gconn) { try { gconn.send(msg); } catch {} }
  };
  /* Default TURN relay: every room (host and listeners) uses it unless the user enters their own relay under Advanced. */
  const DEFNET = { turn: 'turn:global.relay.metered.ca:80, turn:global.relay.metered.ca:80?transport=tcp, turns:global.relay.metered.ca:443?transport=tcp', user: '797d9323a4402473335e0af8', pass: 'p9S/xI/jlNQlDqDc' };
  const own = () => (typeof cfg != 'undefined' && cfg.liveNet) || {};
  const net = () => { const o = own(); return o.turn ? o : Object.assign({}, o, DEFNET); };
  const ice = () => {
    const l = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }, { urls: 'stun:stun.cloudflare.com:3478' }], n = net();
    if (n.turn) l.push({ urls: n.turn.split(/[\s,]+/).filter(Boolean), username: n.user || '', credential: n.pass || '' });
    return l;
  };
  const peerOpts = () => {
    const n = net(), o = { debug: 0, config: { iceServers: ice() } };
    if (n.srv) { const m = /^(?:https?:\/\/|wss?:\/\/)?([^:/]+)(?::(\d+))?(\/.*)?$/.exec(n.srv.trim()); if (m) { o.host = m[1]; o.port = +m[2] || 443; o.path = m[3] || '/'; o.secure = !/^(localhost|127\.|192\.168\.|10\.)/.test(m[1]); } }
    return Object.assign(o, window.PEER_OPTS || {});
  };
  const mk = id => new Promise((ok, no) => {
    const p = new Peer(id, peerOpts());
    p.on('open', () => ok(p)); p.on('error', e => no(e));
  });
  const NOP2P = 'The host is online, but a direct connection could not be made: one of the two networks (mobile data / strict router or firewall) blocks peer-to-peer. Open Advanced \u2192 "Use free public relay" on BOTH devices (or enter your own TURN), press Test connection, then try again.';
  const SIGMSG = 'Could not reach the connection service (PeerJS). It may be blocked on your network or country, or your internet is down. Try a VPN, or set your own server under Advanced.';
  /* connection test: signalling service + STUN (public address) + relay */
  async function diag(out) {
    const line = (ok, t) => { const d = el('div', 'margin:3px 0;color:' + (ok === 1 ? '#8fe3a0' : ok === 0 ? '#ff8a8a' : '#ffd479'), (ok === 1 ? '✓ ' : ok === 0 ? '✗ ' : '• ') + t); out.append(d); };
    out.textContent = ''; line(2, 'Testing…');
    let p = null; try { p = await Promise.race([mk(), new Promise((_, no) => setTimeout(() => no({ type: 'timeout' }), 10000))]); out.textContent = ''; line(1, 'Connection service reachable'); } catch (e) { out.textContent = ''; line(0, 'Connection service NOT reachable (' + (e.type || e.message || 'error') + ')'); }
    try { p && p.destroy(); } catch {}
    const types = new Set();
    try {
      const pc = new RTCPeerConnection({ iceServers: ice() }); pc.createDataChannel('t');
      pc.onicecandidate = e => { if (e.candidate) { const m = / typ (\w+)/.exec(e.candidate.candidate); if (m) types.add(m[1]); } };
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise(r => { const t = setTimeout(r, 6000); pc.onicegatheringstatechange = () => { if (pc.iceGatheringState == 'complete') { clearTimeout(t); r(); } }; });
      pc.close();
    } catch {}
    line(types.has('srflx') ? 1 : 0, types.has('srflx') ? 'Public address found (direct connections possible)' : 'No answer from STUN servers (they may be blocked): direct connections between different networks will probably fail');
    if (net().turn) line(types.has('relay') ? 1 : 0, types.has('relay') ? 'Relay (TURN) works' : 'Relay (TURN) did not respond: check URL, user and password');
    else line(2, 'No relay (TURN) set. If direct connections fail, add one under Advanced.');
  }
  const rnd = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[Math.random() * a.length | 0]; return s; };
  const isApp = () => (typeof APP !== 'undefined' && !!APP) || (typeof NATIVE !== 'undefined' && !!NATIVE);
  const link = () => { const b = isApp() ? (cfg.liveSite || '') : location.origin + location.pathname.replace(/index\.html$/, ''); return b ? b + '?room=' + code : code.toUpperCase(); };
  const npMsg = () => { const t = typeof tr == 'function' && Q[qi] ? tr(Q[qi]) : null; return { t: 'np', ti: t ? t.ti : '', ar: t ? t.ar : '', n: conns.length }; };
  const bcast = () => { const m = npMsg(); conns.forEach(c => { try { c.send(m); } catch {} }); };
  window.liveNP = () => { if (role == 'host') bcast(); };
  window.liveLabel = () => role == 'host' ? ' · hosting ' + conns.length : role == 'guest' ? ' · listening' : '';

  function stop() {
    clearTimeout(joinTo);
    conns.forEach(c => { try { c.close(); } catch {} });
    try { peer && peer.destroy(); } catch {}
    peer = null; gconn = null; role = ''; if (chatLog) chatLog.textContent = ''; conns = []; np = {}; st = ''; aud.pause(); aud.srcObject = null; chip();
  }
  function onConn(c) {
    c.on('open', () => {
      if (conns.length >= MAX) { try { c.send({ t: 'full' }); } catch {} setTimeout(() => c.close(), 400); return; }
      c._call = peer.call(c.peer, dst.stream); conns.push(c); c.send(npMsg()); bcast(); view();
      try { c._call.on('iceStateChanged', s => { c._ice = s; view(); }); } catch {}
    });
    c.on('close', () => { conns = conns.filter(x => x !== c); try { c._call && c._call.close(); } catch {} bcast(); view(); });
    c.on('data', d => {
      if (!d || d.t !== 'chat' || typeof d.m !== 'string') return;
      const now = Date.now(), r = (rate.get(c) || []).filter(x => now - x < 5000); if (r.length >= 5) return; r.push(now); rate.set(c, r);
      const msg = { t: 'chat', n: String(d.n || 'Guest').slice(0, 20), m: d.m.slice(0, 300) };
      addMsg(msg.n, msg.m, 0); conns.forEach(x => { try { x.send(msg); } catch {} });
    });
    c.on('error', () => {});
  }
  async function host() {
    err = ''; st = 'Starting…'; view();
    try {
      AC.resume();
      if (!dst) { dst = AC.createMediaStreamDestination(); comp.connect(dst); }
      for (let i = 0; i < 6 && !peer; i++) { code = rnd(); try { peer = await mk('orpheus-' + code); } catch (e) { peer = null; if (e.type !== 'unavailable-id') throw e; } }
      if (!peer) throw new Error('no free room code');
      role = 'host'; st = '';
      peer.on('connection', onConn);
      peer.on('disconnected', () => { try { peer.reconnect(); } catch {} });
      peer.on('error', e => { if (typeof flash == 'function') flash('LIVE ROOM: ' + e.type); });
    } catch (e) { stop(); err = (e && /network|server|socket|timeout/.test(e.type || '') ? SIGMSG : 'Could not start the room.') + ' (' + (e.type || e.message || e) + ')'; }
    view();
  }
  async function join(c) {
    c = (c || '').trim().toLowerCase();
    if (!/^[a-z0-9]{4,12}$/.test(c)) { err = 'Enter the room code (6 letters/numbers).'; return view(); }
    err = ''; link_ = ''; st = 'Connecting…'; view();
    try { peer = await mk(); } catch (e) { stop(); err = SIGMSG + ' (' + (e.type || e.message || e) + ')'; return view(); }
    role = 'guest'; code = c;
    try { E.forEach(e => e.pause()); } catch {}
    peer.on('call', call => { call.answer(); try { call.on('iceStateChanged', s => { link_ = s; if (s == 'failed' && st != 'listening') { stop(); err = NOP2P; view(); } else view(); }); } catch {} call.on('stream', s => { clearTimeout(joinTo); aud.srcObject = s; aud.play().catch(() => {}); st = 'listening'; view(); }); });
    peer.on('error', e => { if (e.type == 'peer-unavailable') { stop(); err = 'Room not found. Check the code, or the host may be offline.'; view(); } });
    const conn = gconn = peer.connect('orpheus-' + c, { reliable: true });
    try { conn.on('iceStateChanged', x => { link_ = x; if (x == 'failed' && st != 'listening') { stop(); err = NOP2P; } view(); }); } catch {}
    joinTo = setTimeout(() => { if (st != 'listening') { stop(); err = NOP2P + (link_ ? '' : ' (The host IS online, but no direct link could be started.)'); view(); } }, 20000);
    conn.on('data', d => { if (d && d.t == 'chat' && typeof d.m == 'string') addMsg(String(d.n || '').slice(0, 20), d.m.slice(0, 300), d.n === nick); if (d.t == 'np') { np = d; view(); } if (d.t == 'full') { stop(); err = 'This room is full (max ' + MAX + ' listeners).'; view(); } });
    conn.on('close', () => { if (role == 'guest') { stop(); err = 'The host closed the room.'; view(); } });
    view();
  }
  let bk = null, grab = null, shown = false;
  const chip = () => {
    const b = document.getElementById('lvb'); if (!b) return;
    if (!role) { b.style.display = 'none'; return; }
    b.style.display = ''; b.textContent = '\u25CF ' + (role == 'host' ? conns.length : 'LIVE');
    b.title = role == 'host' ? 'Live room: hosting ' + conns.length + ' listener(s). Tap to open.' : 'Live room: listening. Tap to open.';
  };
  const layout = () => {
    if (!box) return; const p = ph();
    box.style.cssText = p
      ? 'position:fixed;left:0;right:0;bottom:0;z-index:99998;max-height:88vh;max-height:88dvh;overflow-y:auto;overscroll-behavior:contain;box-sizing:border-box;padding:6px 18px calc(18px + env(safe-area-inset-bottom,0px));border-radius:20px 20px 0 0;background:#0b0b0b;color:#fff;font:15px/1.5 system-ui,sans-serif;border-top:1px solid #444;box-shadow:0 -10px 40px rgba(0,0,0,.6)'
      : 'position:fixed;right:16px;bottom:16px;z-index:99998;width:min(340px,calc(100vw - 32px));padding:14px;border-radius:14px;background:rgba(10,14,20,.95);color:#fff;font:13px/1.5 system-ui,sans-serif;border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 40px rgba(0,0,0,.5)';
    box.style.display = shown ? 'block' : 'none';
    if (bk) bk.style.display = shown && p ? 'block' : 'none';
    if (grab) grab.style.display = p ? 'block' : 'none';
    if (chatLog) chatLog.style.maxHeight = p ? '30vh' : '150px';
  };
  /* Android Back closes the sheet first (index.html's popstate handler calls liveHide(1)) */
  window.liveHide = fromPop => {
    if (!shown) return;
    if (!fromPop && ph() && typeof LY !== 'undefined' && LY[LY.length - 1] === 'live') { history.back(); return; }
    shown = false; layout();
  };
  function frame() {
    if (!box) {
      bk = el('div', 'position:fixed;inset:0;z-index:99997;background:rgba(0,0,0,.62);display:none'); bk.onclick = () => liveHide(); document.body.append(bk);
      box = el('div');
      grab = el('div', 'width:40px;height:4px;border-radius:2px;background:#444;margin:6px auto 12px');
      const h = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px');
      h.append(el('b', 'letter-spacing:.14em;font-size:12px', '\u25CF LIVE ROOM'));
      const x = el('button', BTN + ';padding:' + (CO ? '8px 16px' : '2px 9px'), '\u2715'); x.title = 'Hide (the room keeps running)'; x.onclick = () => liveHide(); h.append(x);
      body = el('div'); chatWrap = el('div', 'display:none;margin-top:12px;border-top:1px solid rgba(255,255,255,.15);padding-top:10px');
      chatLog = el('div', 'overflow-y:auto;font-size:' + (CO ? 14 : 12.5) + 'px;min-height:34px');
      const ci = el('input', INP + ';font-weight:400;font-size:' + (CO ? 16 : 13) + 'px;flex:1;min-width:0'); ci.placeholder = 'Message\u2026'; ci.maxLength = 300;
      const sb = el('button', BTN + ';padding:' + (CO ? '12px 18px' : '7px 12px'), 'Send'), go = () => { sendChat(ci.value); ci.value = ''; };
      sb.onclick = go; ci.onkeydown = e => { if (e.key == 'Enter') { e.stopPropagation(); go(); } e.stopPropagation(); }; ci.onkeyup = ci.onkeypress = e => e.stopPropagation();
      const ni = el('input', INP + ';font-weight:400;font-size:' + (CO ? 16 : 12) + 'px;width:130px'); ni.value = nick; ni.maxLength = 20; ni.title = 'Your name in the chat';
      ni.onchange = () => { nick = ni.value.trim().slice(0, 20) || nick; try { localStorage.setItem('orpheus-nick', nick); } catch {} }; ni.onkeydown = ni.onkeyup = ni.onkeypress = e => e.stopPropagation();
      const r1 = el('div', 'display:flex;gap:6px;margin-top:6px'), r2 = el('div', 'display:flex;gap:6px;margin-top:6px;align-items:center');
      r1.append(ci, sb); r2.append(el('span', 'opacity:.6;font-size:11px', 'Your name:'), ni);
      chatWrap.append(el('div', 'opacity:.7;font-size:11px;letter-spacing:.1em;margin-bottom:4px', 'CHAT'), chatLog, r1, r2);
      box.append(grab, h, body, chatWrap, el('div', 'opacity:.35;font-size:10px;margin-top:8px;text-align:right', 'live room v5')); document.body.append(box);
      addEventListener('resize', layout);
    }
    shown = true; layout();
    try { if (typeof LY !== 'undefined' && ph() && LY[LY.length - 1] !== 'live') { history.pushState({ l: 'live' }, ''); LY.push('live'); } } catch {}
  }
  function view() {
    if (!box || !body) return;
    body.textContent = ''; chatWrap.style.display = role ? 'block' : 'none'; chip();
    const row = (...k) => { const d = el('div', 'display:flex;gap:8px;align-items:center;margin-top:8px'); d.append(...k); return d; };
    if (err) body.append(el('div', 'color:#ff8a8a;margin-bottom:8px', err));
    if (role == 'host') {
      body.append(el('div', 'opacity:.7', 'Room code'), el('div', 'font:700 30px/1.2 ui-monospace,Consolas,monospace;letter-spacing:.2em', code.toUpperCase()));
      if (isApp()) {
        const si = el('input', INP + ';font-weight:400;font-size:12px'); si.placeholder = 'Your website address, e.g. https://name.github.io/orpheus/'; si.value = cfg.liveSite || '';
        si.onchange = () => { cfg.liveSite = si.value.trim(); sv(); view(); }; body.append(row(si));
      }
      const l = link(), li = el('input', INP + ';font-weight:400;font-size:12px'); li.readOnly = true; li.value = l; li.onclick = () => li.select();
      const cp = el('button', BTN, 'Copy'); cp.onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(l) : Promise.reject()).catch(() => { li.select(); document.execCommand('copy'); }); cp.textContent = 'Copied'; setTimeout(() => cp.textContent = 'Copy', 1500); };
      body.append(row(li, cp));
      if (isApp() && !cfg.liveSite) body.append(el('div', 'opacity:.65;font-size:12px;margin-top:6px', 'Tip: type your website address above so the copied link opens the room directly. Without it, just share the code.'));
      if (navigator.share) { const sh = el('button', BTN + ';margin-top:8px;width:100%', 'Share\u2026'); sh.onclick = () => navigator.share({ title: 'ORPHEUS live room', text: 'Listen with me on ORPHEUS. Room code: ' + code.toUpperCase() + (l.indexOf('http') == 0 ? '' : ''), url: l.indexOf('http') == 0 ? l : undefined }).catch(() => {}); body.append(sh); }
      body.append(el('div', 'margin-top:10px', 'Listeners: ' + conns.length + ' / ' + MAX));
      const bad = conns.filter(c => c._ice == 'failed' || c._ice == 'disconnected').length; if (bad) body.append(el('div', 'color:#ffd479;font-size:12px', bad + ' listener(s) have a poor/failed connection (their network may block peer-to-peer).'));
      body.append(el('div', 'opacity:.65;font-size:12px;margin-top:6px', 'Everyone hears what you play, with your EQ and effects. ' + (isApp() ? 'Keep the app open. ' : 'Keep this tab open. ') + 'Share the link or the code.'));
      const sb = el('button', BTN + ';margin-top:10px;width:100%', 'Stop room'); sb.onclick = () => { stop(); view(); }; body.append(sb);
    } else if (role == 'guest') {
      body.append(el('div', 'opacity:.7', 'Room ' + code.toUpperCase()));
      body.append(el('div', 'font-weight:700;margin-top:4px', st == 'listening' ? '🎧 Listening live' : 'Connecting…' + (link_ ? ' (' + link_ + ')' : ' (looking for the host)')));
      if (np.ti) body.append(el('div', 'margin-top:8px;font-size:15px;font-weight:700', np.ti), el('div', 'opacity:.7', np.ar || ''));
      if (np.n != null) body.append(el('div', 'opacity:.65;font-size:12px;margin-top:6px', np.n + ' listening'));
      const v = el('input', 'width:100%;margin-top:10px'); v.type = 'range'; v.min = 0; v.max = 1; v.step = .01; v.value = aud.volume; v.oninput = () => { aud.volume = +v.value; };
      body.append(v);
      const lb = el('button', BTN + ';margin-top:10px;width:100%', 'Leave room'); lb.onclick = () => { stop(); view(); }; body.append(lb);
    } else {
      if (st) body.append(el('div', '', st));
      const hb = el('button', BTN + ';width:100%', '🎙  Host a room (play music for others)'); hb.onclick = host;
      body.append(hb, el('div', 'opacity:.6;text-align:center;margin:10px 0 2px;font-size:12px', '— or join someone —'));
      const ci = el('input', INP + ';text-transform:uppercase;letter-spacing:.2em;text-align:center'); ci.placeholder = 'ROOM CODE'; ci.maxLength = 12; ci.value = (pre || '').toUpperCase();
      const jb = el('button', BTN, 'Join'); jb.onclick = () => join(ci.value); ci.onkeydown = e => { if (e.key == 'Enter') join(ci.value); };
      body.append(row(ci, jb));
      body.append(el('div', 'opacity:.55;font-size:11px;margin-top:10px', 'Peer-to-peer. Works best with up to ' + MAX + ' listeners.'));
      const ad = el('details', 'margin-top:8px;font-size:12px'), sm = el('summary', 'cursor:pointer;opacity:.8', 'Advanced / connection problems'); ad.append(sm);
      const fld = (ph, k) => { const i = el('input', INP + ';font-weight:400;font-size:12px;margin-top:6px'); i.placeholder = ph; i.value = own()[k] || ''; i.onchange = () => { cfg.liveNet = Object.assign({}, cfg.liveNet || {}, { [k]: i.value.trim() }); sv(); }; i.onkeydown = i.onkeyup = i.onkeypress = e => e.stopPropagation(); return i; };
      const res = el('div', 'margin-top:8px'), tb = el('button', BTN + ';margin-top:8px;width:100%', 'Test connection'); tb.onclick = () => diag(res);
      const pre2 = el('button', BTN + ';margin-top:8px;width:100%', 'Use free public relay (shared, may be slow)');
      pre2.onclick = () => { cfg.liveNet = Object.assign({}, cfg.liveNet || {}, { turn: 'turn:openrelay.metered.ca:80, turn:openrelay.metered.ca:443, turns:openrelay.metered.ca:443?transport=tcp', user: 'openrelayproject', pass: 'openrelayproject' }); sv(); view(); const d = body.querySelector('details'); if (d) d.open = true; };
      ad.append(pre2, fld('Own PeerJS server (optional), e.g. my.server.com:443', 'srv'), fld('TURN relay URL (optional), e.g. turn:host:3478', 'turn'), fld('TURN username', 'user'), fld('TURN password', 'pass'), tb, res,
        el('div', 'opacity:.6;margin-top:6px', 'A built-in TURN relay is used by default (leave the TURN fields empty). Host and listeners must use the same connection server.'));
      body.append(ad);
    }
  }
  window.liveShow = c => { frame(); if (c) pre = String(c).slice(0, 12); view(); };
})();
