const assert = require('node:assert/strict');
const { classifyCloudflareBuild } = require('../scripts/cloudflare-build-regression');

const runs = (conclusion) => [{ name: 'Workers Builds: aria', conclusion }];

assert.deepEqual(
  classifyCloudflareBuild(runs('failure'), runs('failure')),
  { status: 'preexisting_failure', base: 'failure', head: 'failure', regression: false }
);

assert.deepEqual(
  classifyCloudflareBuild(runs('success'), runs('failure')),
  { status: 'new_failure', base: 'success', head: 'failure', regression: true }
);

assert.deepEqual(
  classifyCloudflareBuild(runs('failure'), runs('success')),
  { status: 'recovered', base: 'failure', head: 'success', regression: false }
);

assert.deepEqual(
  classifyCloudflareBuild(runs('success'), runs('success')),
  { status: 'green', base: 'success', head: 'success', regression: false }
);

assert.equal(
  classifyCloudflareBuild([], runs('failure')).status,
  'unknown'
);

console.log('CLOUDFLARE_BUILD_REGRESSION_TEST=PASS');
