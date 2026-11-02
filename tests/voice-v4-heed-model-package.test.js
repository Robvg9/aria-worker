const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const training = fs.readFileSync(
  path.join(root, 'voice-v4/heed-kws/heed_spanish_training_smoke.py'),
  'utf8'
);
const runtime = fs.readFileSync(
  path.join(root, 'voice-v4/heed-kws/onnx_runtime_bench.py'),
  'utf8'
);
const workflow = fs.readFileSync(
  path.join(root, '.github/workflows/aria-voice-v4-heed-kws.yml'),
  'utf8'
);
const readme = fs.readFileSync(
  path.join(root, 'voice-v4/heed-kws/README.md'),
  'utf8'
);

assert.match(training, /Path\(exported\.metadata_path\)/,
  'the ONNX export must keep the matching wake.json sidecar');
assert.match(training, /required_metadata\s*=\s*\{/,
  'the package gate must validate mandatory metadata keys');
assert.match(training, /metadata\["phrase"\]/,
  'the package gate must match the exported phrase');
assert.match(training, /metadata\["threshold"\]/,
  'the package gate must match the calibrated trigger threshold');
assert.match(training, /metadata\["sample_rate"\]/,
  'the package gate must validate sample rate');
assert.match(training, /metadata\["n_mels"\]/,
  'the package gate must validate the model feature width');
assert.match(training, /"highpass_filter",\s*"peak_normalize",\s*"log_mel",\s*"cmn"/,
  'the preprocessor chain and its order are part of the model contract');
assert.match(training, /if onnx_shortlisted:/,
  'a package is retained only after the ONNX runtime itself passes');
assert.match(training, /else:\s*result\["model_artifact"\]\s*=\s*\{/,
  'a rejected ONNX candidate must not be packaged as a shortlist');
assert.match(training, /metadata_sha256/,
  'the metadata sidecar must be integrity-hashed with the model');
assert.match(training, /metadata_preprocessing_ops/,
  'the aggregate report must identify the expected preprocessing operations');
assert.match(training, /synthetic-only-shortlist/,
  'the package must explicitly remain unapproved for production');
assert.match(runtime, /\/proc\/self\/status/,
  'runtime memory telemetry must read the isolated inference process RSS');
assert.match(runtime, /VmRSS:/,
  'runtime memory telemetry must capture resident memory');
assert.match(runtime, /VmHWM:/,
  'runtime memory telemetry must capture process high-water RSS');
assert.match(workflow, /shortlisted-models\/\*\.onnx/,
  'CI must upload the ONNX shortlist model');
assert.match(workflow, /shortlisted-models\/\*\.json/,
  'CI must upload the matching metadata sidecar');
assert.match(readme, /eSpeak-generated/,
  'the model evidence must disclose its synthetic TTS provenance');
assert.match(readme, /does NOT estimate a real-world false activation rate/i,
  'the synthetic metrics must not be presented as real-world activation rates');

console.log('ARIA Voice V4 Heed model package contract: PASS');
