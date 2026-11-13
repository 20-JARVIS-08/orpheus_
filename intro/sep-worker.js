/* ORPHEUS AI vocal removal. Runs the MDX-Net "Inst_HQ_3" model (models/vocal.onnx, trained to output the instrumental)
   with onnxruntime-web (WebAssembly) inside this worker, so the page stays responsive.
   in:  {type:'run', L:Float32Array, R:Float32Array}  (44.1 kHz)   out: {type:'progress', p}, {type:'done', L, R}, {type:'error', msg} */
importScripts('vendor/ort/ort.min.js');
const NF = 6144, HOP = 1024, DT = 256, NB = NF / 2 + 1, TRIM = NF / 2, CHUNK = HOP * (DT - 1), GEN = CHUNK - 2 * TRIM;
/* two models: 'best' outputs the instrumental directly; 'fast' (3x quicker) outputs the vocals, which are subtracted from the song */
const MODELS = { best: { file: 'vocal.onnx', df: 3072, comp: 1.03, vocals: false }, fast: { file: 'vocal-fast.onnx', df: 2048, comp: 1.035, vocals: true } };
let DF = 3072, COMP = 1.03, VOC = false;
const base = new URL('.', self.location.href).href;
ort.env.wasm.wasmPaths = base + 'vendor/ort/';
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, self.navigator.hardwareConcurrency || 2) : 1;
ort.env.wasm.proxy = false;

/* ---- FFT of size 6144 = 3 x 2048 (radix-2 inside, one radix-3 step on top) ---- */
const M = 2048, tw2 = new Float64Array(M), tw2i = new Float64Array(M), rev = new Uint16Array(M), twr = new Float64Array(NF), twi = new Float64Array(NF);
for (let i = 0; i < M / 2; i++) { tw2[i] = Math.cos(2 * Math.PI * i / M); tw2i[i] = -Math.sin(2 * Math.PI * i / M); }
for (let i = 0; i < M; i++) { let r = 0; for (let j = 0; j < 11; j++) if (i & (1 << j)) r |= 1 << (10 - j); rev[i] = r; }
for (let i = 0; i < NF; i++) { twr[i] = Math.cos(2 * Math.PI * i / NF); twi[i] = -Math.sin(2 * Math.PI * i / NF); }
function fft2048(re, im, inv) {
  for (let i = 0; i < M; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let s = 2; s <= M; s <<= 1) {
    const h = s >> 1, st = M / s;
    for (let a = 0; a < M; a += s) for (let k = 0, w = 0; k < h; k++, w += st) {
      const wr = tw2[w], wi = inv ? -tw2i[w] : tw2i[w], p = a + k, q = p + h;
      const xr = re[q] * wr - im[q] * wi, xi = re[q] * wi + im[q] * wr;
      re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi;
    }
  }
}
const sr_ = [new Float64Array(M), new Float64Array(M), new Float64Array(M)], si_ = [new Float64Array(M), new Float64Array(M), new Float64Array(M)];
function fft6144(re, im, inv) {
  for (let r = 0; r < 3; r++) { const a = sr_[r], b = si_[r]; for (let m = 0; m < M; m++) { a[m] = re[3 * m + r]; b[m] = im[3 * m + r]; } fft2048(a, b, inv); }
  for (let k = 0; k < M; k++) for (let j = 0; j < 3; j++) {
    const n1 = k + M * j, n2 = (2 * n1) % NF;
    const w1r = twr[n1], w1i = inv ? -twi[n1] : twi[n1], w2r = twr[n2], w2i = inv ? -twi[n2] : twi[n2];
    re[n1] = sr_[0][k] + sr_[1][k] * w1r - si_[1][k] * w1i + sr_[2][k] * w2r - si_[2][k] * w2i;
    im[n1] = si_[0][k] + sr_[1][k] * w1i + si_[1][k] * w1r + sr_[2][k] * w2i + si_[2][k] * w2r;
  }
}
const win = new Float64Array(NF); for (let i = 0; i < NF; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / NF);
const fr = new Float64Array(NF), fi = new Float64Array(NF);

/* seg: Float32Array(CHUNK) -> writes real/imag of bins 0..DF-1 for DT frames into X (layout [c][f][t]) */
function stft(seg, X, cRe, cIm) {
  const pl = new Float32Array(CHUNK + NF);
  for (let i = 0; i < TRIM; i++) pl[i] = seg[TRIM - i];                       /* reflect padding (center=True) */
  pl.set(seg, TRIM);
  for (let i = 0; i < TRIM; i++) pl[TRIM + CHUNK + i] = seg[CHUNK - 2 - i];
  for (let t = 0; t < DT; t++) {
    const o = t * HOP;
    for (let i = 0; i < NF; i++) { fr[i] = pl[o + i] * win[i]; fi[i] = 0; }
    fft6144(fr, fi, false);
    for (let f = 0; f < DF; f++) { X[(cRe * DF + f) * DT + t] = fr[f]; X[(cIm * DF + f) * DT + t] = fi[f]; }
  }
}
function istft(Y, cRe, cIm, out) {      /* out: Float32Array(CHUNK) */
  const acc = new Float32Array(CHUNK + NF), wn = new Float32Array(CHUNK + NF);
  for (let t = 0; t < DT; t++) {
    for (let f = 0; f < NF; f++) { fr[f] = 0; fi[f] = 0; }
    for (let f = 0; f < DF; f++) {
      const a = Y[(cRe * DF + f) * DT + t], b = Y[(cIm * DF + f) * DT + t];
      fr[f] = a; fi[f] = b;
      if (f > 0) { fr[NF - f] = a; fi[NF - f] = -b; }
    }
    fft6144(fr, fi, true);
    const o = t * HOP;
    for (let i = 0; i < NF; i++) { const w = win[i]; acc[o + i] += fr[i] / NF * w; wn[o + i] += w * w; }
  }
  for (let i = 0; i < CHUNK; i++) { const d = wn[TRIM + i]; out[i] = acc[TRIM + i] / (d > 1e-8 ? d : 1e-8); }
}

let sess = null, modelBuf = null, ep = 'wasm', curKind = '';
const FORCE = new URL(self.location.href).searchParams.get('ep');
async function getModel(kind, low) {
  const M = MODELS[kind]; DF = M.df; COMP = M.comp; VOC = M.vocals;
  if (sess && curKind == kind) return sess;
  if (sess) { try { await sess.release(); } catch {} sess = null; }
  curKind = kind;
  ort.env.wasm.numThreads = self.crossOriginIsolated && !low ? Math.min(4, self.navigator.hardwareConcurrency || 2) : 1;
  const url = base + 'models/' + M.file;
  let buf = null;
  try { const c = await caches.open('orpheus-model'); let r = await c.match(url); if (!r) { r = await fetch(url); if (!r.ok) throw new Error('model file missing (' + r.status + ')'); await c.put(url, r.clone()); } buf = await r.arrayBuffer(); }
  catch (e) { if (e && /model file missing/.test(e.message)) throw e; const r = await fetch(url); if (!r.ok) throw new Error('model file missing (' + r.status + ')'); buf = await r.arrayBuffer(); }
  modelBuf = buf;
  /* GPU first (much faster), with automatic fall back to CPU/WebAssembly if it is missing or gives bad numbers */
  if (FORCE != 'wasm' && self.navigator && navigator.gpu) {
    try { const a = await navigator.gpu.requestAdapter(); if (a && !a.isFallbackAdapter) { sess = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' }); ep = 'webgpu'; } } catch (e) { sess = null; }
  }
  if (!sess) { sess = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); ep = 'wasm'; }
  postMessage({ type: 'info', ep });
  return sess;
}
async function toWasm() { try { await sess.release(); } catch {} sess = await ort.InferenceSession.create(modelBuf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }); ep = 'wasm'; postMessage({ type: 'info', ep }); }
function sane(X, Y) { let a = 0, b = 0; for (let i = 0; i < Y.length; i += 7) { const y = Y[i]; if (!isFinite(y)) return false; b += y * y; const x = X[i]; a += x * x; } return a < 1e-6 || (b / a > 1e-4 && b / a < 4); }

async function run(L, R, kind, low) {
  await getModel(kind, low); const n = L.length, nCh = Math.ceil(n / GEN), total = (nCh - 1) * GEN + CHUNK + 0;
  const mL = new Float32Array(total + TRIM * 2), mR = new Float32Array(total + TRIM * 2);
  mL.set(L, TRIM); mR.set(R, TRIM);
  const sleep = ms => new Promise(r => setTimeout(r, ms)), oL = new Float32Array(nCh * GEN), oR = new Float32Array(nCh * GEN), X = new Float32Array(4 * DF * DT), seg = [new Float32Array(CHUNK), new Float32Array(CHUNK)], tmp = new Float32Array(CHUNK);
  for (let k = 0; k < nCh; k++) {
    const st = k * GEN, tk0 = Date.now();
    seg[0].set(mL.subarray(st, st + CHUNK)); seg[1].set(mR.subarray(st, st + CHUNK));
    stft(seg[0], X, 0, 1); stft(seg[1], X, 2, 3);
    let Y;
    for (let tryN = 0; tryN < 2; tryN++) {
      try { const job = sess.run({ input: new ort.Tensor('float32', X, [1, 4, DF, DT]) }); const res = ep == 'wasm' || k > 0 ? await job : await Promise.race([job, new Promise((_, no) => setTimeout(() => no(new Error('gpu too slow')), 60000))]); Y = res[Object.keys(res)[0]].data; if (ep == 'wasm' || sane(X, Y)) break; } catch (e) { if (ep == 'wasm') throw e; }
      await toWasm();
    }
    istft(Y, 0, 1, tmp); for (let i = 0; i < GEN; i++) oL[st + i] = VOC ? mL[st + TRIM + i] - tmp[TRIM + i] * COMP : tmp[TRIM + i] * COMP;
    istft(Y, 2, 3, tmp); for (let i = 0; i < GEN; i++) oR[st + i] = VOC ? mR[st + TRIM + i] - tmp[TRIM + i] * COMP : tmp[TRIM + i] * COMP;
    postMessage({ type: 'progress', p: (k + 1) / nCh });
    if (low) await sleep((Date.now() - tk0) * 0.6);   /* gentle mode: rest between chunks so the computer stays responsive */
  }
  return [oL.slice(0, n), oR.slice(0, n)];
}
onmessage = async e => {
  const d = e.data;
  if (d.type != 'run') return;
  try { const [a, b] = await run(d.L, d.R, d.kind || 'fast', !!d.low); postMessage({ type: 'done', L: a, R: b }, [a.buffer, b.buffer]); }
  catch (er) { postMessage({ type: 'error', msg: String(er && er.message || er) }); }
};
