const assert=require('assert');
const fs=require('fs');
const path=require('path');

const gateway=fs.readFileSync(path.join(__dirname,'..','supabase','functions','aria-device-gateway','index.ts'),'utf8');

assert(gateway.includes('let routerSnapshotCache:{expires_at:number,snapshot:any}|null=null;'),'router snapshot cache must exist');
assert(gateway.includes('routerSnapshotCache.expires_at>now'),'router cache must honor TTL');
assert(gateway.includes('routerSnapshotCache={expires_at:now+5000,snapshot:data};'),'router cache TTL must be bounded at 5s');
assert(gateway.includes('async function getRouterLiveSnapshot()'),'router snapshot access must be centralized');
assert(gateway.includes('const snapshot=await getRouterLiveSnapshot();'),'router decisions must use the cache boundary');
assert(gateway.includes('const [candidatesRes,capsRes,acctRes]=await Promise.all(['),'Android planner registry reads must be parallelized');
assert(gateway.includes("if(candidatesRes.error)throw new Error(candidatesRes.error.message);"),'candidate errors must remain explicit');
assert(gateway.includes("if(capsRes.error)throw new Error(capsRes.error.message);"),'capability errors must remain explicit');
assert(gateway.includes("if(acctRes.error)throw new Error(acctRes.error.message);"),'account errors must remain explicit');
console.log('performance-intelligence-v1 contract: PASS');
