'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync(require('node:path').join(__dirname, '..', 'supabase/functions/aria-planner-v11/index.ts'), 'utf8');

for (const marker of [
  "androidAutonomousPlan",
  "planner-v11-android-autonomous-v1",
  "operation:'computer.use'",
  "mode:'autonomous_test'",
  "target_package:targetPackage",
  "allow_any_app:true",
  "start_url:startUrl",
  "start_app:startApp",
  "physical_verification_required:true",
  "android-termux"
]) assert.ok(source.includes(marker), 'missing planner Android autonomy marker: ' + marker);

console.log('ANDROID AUTONOMOUS PLANNER CONTRACT: PASS');
