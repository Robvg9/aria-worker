const fs = require("fs");
const path = require("path");
const file = path.join(__dirname, "..", "supabase", "functions", "aria-mission-runner-v22", "index.ts");
const source = fs.readFileSync(file, "utf8");
for (const fragment of [
  "statement timeout|canceling statement|query canceled|timeout",
  "persisted: false",
  "deferred: true",
  "throw error"
]) {
  if (!source.includes(fragment)) throw new Error("missing event persistence resilience contract: " + fragment);
}
console.log("mission event persistence timeout resilience contract: PASS");
