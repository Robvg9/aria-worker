'use strict';
function addClaim(ledger=[],claim={}){if(!claim.id||!claim.statement)throw new Error('claim_invalid');if(ledger.some(c=>c.id===claim.id))return ledger;return[...ledger,{id:claim.id,statement:claim.statement,sources:[...(claim.sources||[])],confidence:Math.max(0,Math.min(1,Number(claim.confidence??0))),status:claim.status||'unverified'}];}
function verifyClaims(ledger=[]){return ledger.map(c=>({...c,status:c.sources?.length?'supported':'unverified'}));}
module.exports={addClaim,verifyClaims};
