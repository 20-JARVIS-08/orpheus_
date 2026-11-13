/* ORPHEUS vocal remover (smart mode): short-time FFT that finds, bin by bin, what sits in the centre of the stereo
   image (where lead vocals live) and turns it down. Unlike a plain L-R subtraction it also catches vocals that are
   slightly off-centre or only partly in phase, and it leaves bass, wide instruments and stereo width alone.
   Params: k = strength 0..1, t = centre threshold (lower = also removes more off-centre sound). Latency ~46 ms. */
const N = 2048, H = 512, B = N / 2 + 1;
const win = new Float32Array(N), cs = new Float32Array(N / 2), sn = new Float32Array(N / 2), rev = new Uint16Array(N);
for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
for (let i = 0; i < N / 2; i++) { cs[i] = Math.cos(2 * Math.PI * i / N); sn[i] = -Math.sin(2 * Math.PI * i / N); }
for (let i = 0, b = Math.log2(N); i < N; i++) { let r = 0; for (let j = 0; j < b; j++) if (i & (1 << j)) r |= 1 << (b - 1 - j); rev[i] = r; }
function fft(re, im, inv) {
  for (let i = 0; i < N; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let s = 2; s <= N; s <<= 1) {
    const h = s >> 1, st = N / s;
    for (let a = 0; a < N; a += s) for (let k = 0, w = 0; k < h; k++, w += st) {
      const wr = cs[w], wi = inv ? -sn[w] : sn[w], p = a + k, q = p + h;
      const xr = re[q] * wr - im[q] * wi, xi = re[q] * wi + im[q] * wr;
      re[q] = re[p] - xr; im[q] = im[p] - xi; re[p] += xr; im[p] += xi;
    }
  }
}
class Vocal extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'k', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 't', defaultValue: 0.6, minValue: 0, maxValue: 0.99, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.inL = new Float32Array(N); this.inR = new Float32Array(N);
    this.accL = new Float32Array(N); this.accR = new Float32Array(N);
    this.re = new Float32Array(N); this.im = new Float32Array(N);
    this.m = new Float32Array(B); this.ms = new Float32Array(B).fill(0); this.g = new Float32Array(B);
    this.fifoL = new Float32Array(8192); this.fifoR = new Float32Array(8192);
    this.rp = 0; this.wp = H; this.cnt = 0; this.sr = sampleRate;
  }
  frame(k, t) {
    const { inL, inR, re, im, m, ms, g, accL, accR } = this;
    for (let i = 0; i < N; i++) { re[i] = inL[i] * win[i]; im[i] = inR[i] * win[i]; }
    fft(re, im, false);
    const lr = new Float32Array(B), li = new Float32Array(B), rr = new Float32Array(B), ri = new Float32Array(B);
    const binHz = this.sr / N, span = Math.max(1e-3, 1 - t);
    for (let b = 0; b < B; b++) {
      const c = (N - b) & (N - 1);
      const zr = re[b], zi = im[b], yr = re[c], yi = -im[c];       /* Z_b and conj(Z_{N-b}) */
      lr[b] = (zr + yr) / 2; li[b] = (zi + yi) / 2;                 /* L */
      rr[b] = (zi - yi) / 2; ri[b] = -(zr - yr) / 2;                /* R */
      const pl = lr[b] * lr[b] + li[b] * li[b], pr = rr[b] * rr[b] + ri[b] * ri[b];
      const psi = 2 * (lr[b] * rr[b] + li[b] * ri[b]) / (pl + pr + 1e-12);   /* 1 = same level and phase = centre */
      let x = (psi - t) / span; x = x < 0 ? 0 : x > 1 ? 1 : x; m[b] = x * x * (3 - 2 * x);
    }
    for (let b = 0; b < B; b++) {
      const a = m[b > 0 ? b - 1 : 0], c = m[b < B - 1 ? b + 1 : b];
      const f = (a + 2 * m[b] + c) / 4;
      ms[b] += (f - ms[b]) * (f > ms[b] ? 0.7 : 0.35);             /* fast to remove, a bit slower to let go */
      const hz = b * binHz;
      const lo = hz < 100 ? 0 : hz > 220 ? 1 : (hz - 100) / 120;   /* keep bass and kick */
      const hi = hz < 11000 ? 1 : hz > 16000 ? 0 : 1 - (hz - 11000) / 5000;
      g[b] = Math.max(0.015, 1 - k * ms[b] * lo * hi);
    }
    for (let b = 0; b < B; b++) { lr[b] *= g[b]; li[b] *= g[b]; rr[b] *= g[b]; ri[b] *= g[b]; }
    for (let b = 0; b < B; b++) {                                   /* Z' = L' + iR' (Hermitian halves rebuilt) */
      re[b] = lr[b] - ri[b]; im[b] = li[b] + rr[b];
      if (b > 0 && b < N / 2) { const c = N - b; re[c] = lr[b] + ri[b]; im[c] = -li[b] + rr[b]; }
    }
    fft(re, im, true);
    const sc = 1 / N / 1.5;
    for (let i = 0; i < N; i++) { accL[i] += re[i] * win[i] * sc; accR[i] += im[i] * win[i] * sc; }
    for (let i = 0; i < H; i++) { this.fifoL[(this.wp + i) & 8191] = accL[i]; this.fifoR[(this.wp + i) & 8191] = accR[i]; }
    this.wp += H;
    accL.copyWithin(0, H); accR.copyWithin(0, H); accL.fill(0, N - H); accR.fill(0, N - H);
    inL.copyWithin(0, H); inR.copyWithin(0, H);
  }
  process(ins, outs, p) {
    const i0 = ins[0], o = outs[0];
    if (!i0 || !i0.length) return true;
    const L = i0[0], R = i0[1] || i0[0], n = L.length, k = p.k[0], t = p.t[0];
    for (let i = 0; i < n; i++) {
      this.inL[N - H + this.cnt] = L[i]; this.inR[N - H + this.cnt] = R[i];
      if (++this.cnt == H) { this.cnt = 0; this.frame(k, t); }
      o[0][i] = this.fifoL[this.rp & 8191]; if (o[1]) o[1][i] = this.fifoR[this.rp & 8191]; this.rp++;
    }
    return true;
  }
}
registerProcessor('orpheus-vocal', Vocal);
