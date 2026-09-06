const assert=require("node:assert/strict");
const test=require("node:test");
test("GitHub App runtime exports governed operations",async()=>{const m=await import("../supabase/functions/_shared/github-app.mjs");for(const name of ["githubInstallation","githubRead","githubCreateBranch","githubWrite","githubPr","githubAppHealth"])assert.equal(typeof m[name],"function",name);});
test("runtime source contract does not expose private key or installation token",async()=>{const fs=require("node:fs");const s=fs.readFileSync("supabase/functions/_shared/github-app.mjs","utf8");assert.match(s,/ARIA_GITHUB_APP_PRIVATE_KEY/);assert.match(s,/access_tokens/);assert.doesNotMatch(s,/console\.log\(.*(?:private|token)/i);});
