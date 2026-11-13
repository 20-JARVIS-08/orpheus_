/* Downloads the AI vocal-removal files that are too big to ship in the source zip:
     models/vocal.onnx (65 MB, best quality) + models/vocal-fast.onnx (29 MB, 3x faster); MDX-Net models from the UVR model repo
     vendor/ort/*                 (onnxruntime-web 1.22.0 engine from npm)
   Run once:  node setup-ai.js     (build.bat and the GitHub Pages workflow call it automatically) */
const fs = require('fs'), path = require('path'), os = require('os'), { execFileSync } = require('child_process');
const REPO = 'https://github.com/TRvlvr/model_repo/releases/download/all_public_uvr_models/';
const MODELS = [['vocal.onnx', 'UVR-MDX-NET-Inst_HQ_3.onnx', 60e6], ['vocal-fast.onnx', 'UVR_MDXNET_9482.onnx', 25e6]];
const ORT = 'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.22.0.tgz';
const FILES = ['ort.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm'];
const root = __dirname, mdl = path.join(root, 'models', 'vocal.onnx'), vend = path.join(root, 'vendor', 'ort');
async function get(url, dest) {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(url + ' -> HTTP ' + r.status);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
}
(async () => {
  for (const [name, remote, min] of MODELS) { const f = path.join(root, 'models', name); if (!fs.existsSync(f) || fs.statSync(f).size < min) { console.log('Downloading AI model ' + name + '...'); await get(REPO + remote, f); } }
  if (!FILES.every(f => fs.existsSync(path.join(vend, f)))) {
    console.log('Downloading AI engine...');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ort-')), tgz = path.join(tmp, 'ort.tgz');
    await get(ORT, tgz);
    execFileSync('tar', ['-xzf', tgz, '-C', tmp]);
    fs.mkdirSync(vend, { recursive: true });
    for (const f of FILES) fs.copyFileSync(path.join(tmp, 'package', 'dist', f), path.join(vend, f));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('AI files ready.');
})().catch(e => { console.error('setup-ai failed:', e.message); process.exit(1); });
