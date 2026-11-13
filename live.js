/* ORPHEUS live room: one person hosts, others join with a code or link and hear the same music live.
   Audio travels peer-to-peer (WebRTC, via PeerJS; the free PeerJS cloud is only used to introduce the browsers).
   Host: whatever ORPHEUS plays (with EQ/effects) is streamed. Listeners: the stream plays in their browser. */
(function () {
  if (window.liveShow) return;
  const MAX = 8;
  let gconn = null, chatWrap = null, chatLog = null, nick = '', rate = new WeakMap(), peer = null, role = '', conns = [], box = null, body = null, code = '', dst = null, np = {}, st = '', pre = '', err = '', joinTo = 0;
  const aud = new Audio(); aud.autoplay = true;
  const el = (t, css, txt) => { const e = document.createElement(t); if (css) e.style.cssText = css; if (txt != null) e.textContent = txt; return e; };
  const BTN = 'padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer';
  const INP = 'padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.35);color:#fff;font:600 14px system-ui,sans-serif;width:100%;box-sizing:border-box';
  try { nick = localStorage.getItem('orpheus-nick') || ''; } catch {}
  if (!nick) nick = 'Guest' + (Math.random() * 900 + 100 | 0);
  const addMsg = (n, m, me) => {
    if (!chatLog) return;
    const d = el('div', 'margin:2px 0;word-break:break-word'); d.append(el('b', 'opacity:.75;color:' + (me ? '#8fd3ff' : '#fff'), n + ': '), document.createTextNode(m));
    chatLog.append(d); chatLog.scrollTop = chatLog.scrollHeight;
    if (box && box.style.display == 'none' && !me && typeof flash == 'function') flash('💬 ' + n + ': ' + m.slice(0, 60));
  };
  const sendChat = m => {
    m = (m || '').trim().slice(0, 300); if (!m) return;
    const msg = { t: 'chat', n: nick, m };
    if (role == 'host') { addMsg(nick, m, 1); conns.forEach(c => { try { c.send(msg); } catch {} }); }
    else if (role == 'guest' && gconn) { try { gconn.send(msg); } catch {} }
  };
  const mk = id => new Promise((ok, no) => {
    const p = new Peer(id, Object.assign({ debug: 0, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] } }, window.PEER_OPTS || {}));
    p.on('open', () => ok(p)); p.on('error', e => no(e));
  });
  const rnd = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[Math.random() * a.length | 0]; return s; };
  const isApp = () => typeof APP !== 'undefined' && !!APP;
  const link = () => (isApp() ? (cfg.liveSite || '') : location.origin + location.pathname.replace(/index\.html$/, '')) + '?room=' + code;
  const npMsg = () => { const t = typeof tr == 'function' && Q[qi] ? tr(Q[qi]) : null; return { t: 'np', ti: t ? t.ti : '', ar: t ? t.ar : '', n: conns.length }; };
  const bcast = () => { const m = npMsg(); conns.forEach(c => { try { c.send(m); } catch {} }); };
  window.liveNP = () => { if (role == 'host') bcast(); };
  window.liveLabel = () => role == 'host' ? ' · hosting ' + conns.length : role == 'guest' ? ' · listening' : '';

  function stop() {
    clearTimeout(joinTo);
    conns.forEach(c => { try { c.close(); } catch {} });
    try { peer && peer.destroy(); } catch {}
    peer = null; gconn = null; role = ''; if (chatLog) chatLog.textContent = ''; conns = []; np = {}; st = ''; aud.pause(); aud.srcObject = null;
  }
  function onConn(c) {
    c.on('open', () => {
      if (conns.length >= MAX) { try { c.send({ t: 'full' }); } catch {} setTimeout(() => c.close(), 400); return; }
      c._call = peer.call(c.peer, dst.stream); conns.push(c); c.send(npMsg()); bcast(); view();
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
    } catch (e) { stop(); err = 'Could not start the room (' + (e.type || e.message || e) + '). Check your internet connection.'; }
    view();
  }
  async function join(c) {
    c = (c || '').trim().toLowerCase();
    if (!/^[a-z0-9]{4,12}$/.test(c)) { err = 'Enter the room code (6 letters/numbers).'; return view(); }
    err = ''; st = 'Connecting…'; view();
    try { peer = await mk(); } catch (e) { stop(); err = 'Could not reach the connection service (' + (e.type || e.message || e) + ').'; return view(); }
    role = 'guest'; code = c;
    try { E.forEach(e => e.pause()); } catch {}
    peer.on('call', call => { call.answer(); call.on('stream', s => { clearTimeout(joinTo); aud.srcObject = s; aud.play().catch(() => {}); st = 'listening'; view(); }); });
    peer.on('error', e => { if (e.type == 'peer-unavailable') { stop(); err = 'Room not found. Check the code, or the host may be offline.'; view(); } });
    const conn = gconn = peer.connect('orpheus-' + c, { reliable: true });
    joinTo = setTimeout(() => { if (st != 'listening') { stop(); err = 'Could not connect to the room (host offline, or a firewall is blocking direct connections).'; view(); } }, 20000);
    conn.on('data', d => { if (d && d.t == 'chat' && typeof d.m == 'string') addMsg(String(d.n || '').slice(0, 20), d.m.slice(0, 300), d.n === nick); if (d.t == 'np') { np = d; view(); } if (d.t == 'full') { stop(); err = 'This room is full (max ' + MAX + ' listeners).'; view(); } });
    conn.on('close', () => { if (role == 'guest') { stop(); err = 'The host closed the room.'; view(); } });
    view();
  }
  function frame() {
    if (box) { box.style.display = 'block'; return; }
    box = el('div', 'position:fixed;right:16px;bottom:16px;z-index:99998;width:min(340px,calc(100vw - 32px));padding:14px;border-radius:14px;background:rgba(10,14,20,.95);color:#fff;font:13px/1.5 system-ui,sans-serif;border:1px solid rgba(255,255,255,.2);box-shadow:0 10px 40px rgba(0,0,0,.5)');
    const h = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px');
    h.append(el('b', 'letter-spacing:.14em;font-size:12px', '● LIVE ROOM'));
    const x = el('button', BTN + ';padding:2px 9px', '✕'); x.title = 'Hide (the room keeps running)'; x.onclick = () => { box.style.display = 'none'; }; h.append(x);
    body = el('div'); chatWrap = el('div', 'display:none;margin-top:12px;border-top:1px solid rgba(255,255,255,.15);padding-top:10px');
    chatLog = el('div', 'max-height:150px;overflow-y:auto;font-size:12.5px;min-height:34px');
    const ci = el('input', INP + ';font-weight:400;font-size:13px;flex:1'); ci.placeholder = 'Message…'; ci.maxLength = 300;
    const sb = el('button', BTN + ';padding:7px 12px', 'Send'), go = () => { sendChat(ci.value); ci.value = ''; };
    sb.onclick = go; ci.onkeydown = e => { if (e.key == 'Enter') { e.stopPropagation(); go(); } e.stopPropagation(); }; ci.onkeyup = ci.onkeypress = e => e.stopPropagation();
    const ni = el('input', INP + ';font-weight:400;font-size:12px;width:110px'); ni.value = nick; ni.maxLength = 20; ni.title = 'Your name in the chat';
    ni.onchange = () => { nick = ni.value.trim().slice(0, 20) || nick; try { localStorage.setItem('orpheus-nick', nick); } catch {} }; ni.onkeydown = ni.onkeyup = ni.onkeypress = e => e.stopPropagation();
    const r1 = el('div', 'display:flex;gap:6px;margin-top:6px'), r2 = el('div', 'display:flex;gap:6px;margin-top:6px;align-items:center');
    r1.append(ci, sb); r2.append(el('span', 'opacity:.6;font-size:11px', 'Your name:'), ni);
    chatWrap.append(el('div', 'opacity:.7;font-size:11px;letter-spacing:.1em;margin-bottom:4px', 'CHAT'), chatLog, r1, r2);
    box.append(h, body, chatWrap); document.body.append(box);
  }
  function view() {
    if (!box || !body) return;
    body.textContent = ''; chatWrap.style.display = role ? 'block' : 'none';
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
      body.append(el('div', 'margin-top:10px', 'Listeners: ' + conns.length + ' / ' + MAX));
      body.append(el('div', 'opacity:.65;font-size:12px;margin-top:6px', 'Everyone hears what you play, with your EQ and effects. Keep this tab open. Share the link or the code.'));
      const sb = el('button', BTN + ';margin-top:10px;width:100%', 'Stop room'); sb.onclick = () => { stop(); view(); }; body.append(sb);
    } else if (role == 'guest') {
      body.append(el('div', 'opacity:.7', 'Room ' + code.toUpperCase()));
      body.append(el('div', 'font-weight:700;margin-top:4px', st == 'listening' ? '🎧 Listening live' : 'Connecting…'));
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
    }
  }
  window.liveShow = c => { frame(); if (c) pre = String(c).slice(0, 12); view(); };
})();
