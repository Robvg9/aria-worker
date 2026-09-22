import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

const root = process.cwd();
const wranglerToml = fs.readFileSync(path.join(root, "wrangler.toml"), "utf8");
const wranglerJson = fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8");

assert.ok(!wranglerToml.includes('crons = ["* * * * *"]'), "Cloudflare must not schedule a duplicate mission cron");
assert.ok(!wranglerJson.includes('"crons": ["* * * * *"]'), "Cloudflare JSON config must not schedule a duplicate mission cron");
assert.match(wranglerToml, /name\s*=\s*"aria"/);
assert.match(wranglerJson, /"name"\s*:\s*"aria"/);

console.log("DUPLICATE MISSION CRON CONTRACT: PASS");
