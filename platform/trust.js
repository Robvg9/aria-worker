'use strict';
function trustScore({verified=0,successRate=0,failures=0,ageDays=0}={}){const v=Math.max(0,Math.min(1,Number(verified)));const s=Math.max(0,Math.min(1,Number(successRate)));const f=Math.max(0,Math.min(1,Number(failures)/10));const a=Math.max(0,Math.min(1,Number(ageDays)/30));return Number((v*.4+s*.4+(1-f)*.15+a*.05).toFixed(6));}
function assessExtension(evidence={}){const score=trustScore(evidence);return {score,level:score>=.85?'trusted':score>=.6?'conditional':'untrusted',publishable:score>=.85&&evidence.security_passed===true&&evidence.tests_passed===true};}
module.exports={trustScore,assessExtension};
