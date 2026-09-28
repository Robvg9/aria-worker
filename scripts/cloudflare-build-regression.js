const API = 'https://api.github.com';

function cloudflareConclusion(checkRuns) {
  const run = (checkRuns || []).find((r) => r?.name === 'Workers Builds: aria');
  return run?.conclusion || run?.status || 'missing';
}

function classifyCloudflareBuild(baseRuns, headRuns) {
  const base = cloudflareConclusion(baseRuns);
  const head = cloudflareConclusion(headRuns);

  if (head === 'failure' && base === 'failure') {
    return { status: 'preexisting_failure', base, head, regression: false };
  }

  if (head === 'failure' && base === 'success') {
    return { status: 'new_failure', base, head, regression: true };
  }

  if (head === 'success' && base === 'failure') {
    return { status: 'recovered', base, head, regression: false };
  }

  if (head === 'success' && base === 'success') {
    return { status: 'green', base, head, regression: false };
  }

  return { status: 'unknown', base, head, regression: false };
}

async function githubJson(url, token) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: token ? `Bearer ${token}` : undefined,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text);
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const baseSha = process.env.BASE_SHA;
  const headSha = process.env.HEAD_SHA;
  const token = process.env.GITHUB_TOKEN;

  if (!repository || !baseSha || !headSha) {
    throw new Error('Missing GITHUB_REPOSITORY, BASE_SHA, or HEAD_SHA.');
  }

  const [base, head] = await Promise.all([
    githubJson(`${API}/repos/${repository}/commits/${baseSha}/check-runs`, token),
    githubJson(`${API}/repos/${repository}/commits/${headSha}/check-runs`, token),
  ]);

  const result = classifyCloudflareBuild(base.check_runs, head.check_runs);
  console.log(`CLOUDFLARE_BASELINE=${result.status}`);
  console.log(`BASE_CLOUDFLARE=${result.base}`);
  console.log(`HEAD_CLOUDFLARE=${result.head}`);

  if (result.status === 'preexisting_failure') {
    console.log('Cloudflare failure is pre-existing on the base commit; this is not a new regression.');
    return;
  }

  if (result.status === 'new_failure') {
    console.error('Cloudflare Workers failure is new on the head commit.');
    process.exitCode = 1;
    return;
  }

  console.log(`Cloudflare baseline classification: ${result.status}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
  });
}

module.exports = { cloudflareConclusion, classifyCloudflareBuild };
