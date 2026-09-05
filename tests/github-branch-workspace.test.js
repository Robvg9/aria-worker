'use strict';
const assert=require('node:assert/strict');
const {assertBranch,createGitHubBranchWorkspace}=require('../self-development/github-branch-workspace');

assert.throws(()=>assertBranch('main'),/main_branch_forbidden/);
assert.throws(()=>assertBranch('master'),/main_branch_forbidden/);
assert.throws(()=>assertBranch('../escape'),/invalid_branch/);
assert.equal(assertBranch('aria/selfdev/proof'),'aria/selfdev/proof');

(async()=>{
 const calls=[];
 const responses=[];
 const fetchImpl=async(url,init={})=>{
   calls.push({url,init});
   if(String(url).includes('/git/ref/heads/main')) return new Response(JSON.stringify({object:{sha:'base-sha'}}),{status:200});
   if(String(url).includes('/contents/proof.txt?ref=')) return new Response(JSON.stringify({message:'Not Found'}),{status:404});
   if(String(url).endsWith('/git/refs')) return new Response(JSON.stringify({ref:'refs/heads/aria/selfdev/proof'}),{status:201});
   if(String(url).endsWith('/contents/proof.txt')) return new Response(JSON.stringify({commit:{sha:'proof-commit'}}),{status:201});
   if(String(url).endsWith('/pulls')) return new Response(JSON.stringify({number:99,state:'open',head:{ref:'aria/selfdev/proof'}}),{status:201});
   return new Response(JSON.stringify({}),{status:200});
 };
 const ws=createGitHubBranchWorkspace({token:'test-token',fetchImpl});
 await ws.createBranch('aria/selfdev/proof');
 const result=await ws.apply({branch:'aria/selfdev/proof',path:'proof.txt',content:'ARIA_GOVERNED_SELFDEV_OK\n',risk_level:'low'});
 assert.equal(result.status,'succeeded');
 const pr=await ws.openPullRequest({branch:'aria/selfdev/proof',title:'test'});
 assert.equal(pr.number,99);
 const branchWrite=calls.find(x=>String(x.url).endsWith('/contents/proof.txt'));
 assert.equal(branchWrite.init.body.includes('"branch":"aria/selfdev/proof"'),true);
 assert.equal(calls.some(x=>String(x.url).includes('/contents/proof.txt?ref=main')),false);
 console.log('GITHUB BRANCH WORKSPACE TESTS PASS');
})();
