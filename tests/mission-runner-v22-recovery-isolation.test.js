const fs=require("fs");const p=require("path");const s=fs.readFileSync(p.join(__dirname,"..","supabase/functions/aria-mission-runner-v22/index.ts"),"utf8");for(const x of ["staleRecovery","schema cache|retrying|statement timeout|timeout","throw recoveryError"]){if(!s.includes(x))throw new Error("missing recovery isolation contract: "+x)}console.log("recovery isolation contract: PASS");
if(!s.includes('governed_existing_sandbox_recovery'))throw new Error('missing BattleCruiser sandbox recovery verification');
if(!s.includes('recovered_existing_branch===true'))throw new Error('missing existing sandbox branch evidence guard');
console.log("BattleCruiser sandbox recovery contract: PASS");
