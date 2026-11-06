const META = Object.freeze({
  scopeId: "mission_wonder_2_a4_scope_id",
  goalHash: "mission_wonder_2_a4_goal_hash",
  deviceId: "mission_wonder_2_a4_allowed_device_id",
  readonlyMarker: "mission_wonder_2_a4_readonly",
  // Explicit admission-lane provenance keyed A4 missions stamp into their metadata so
  // the standalone-mission claim guard never depends on the goal_source fallback.
  executionLane: "execution_lane",
});
// The A4 queue lane value. "user" is provably behavior-preserving: the guard and every
// queue CASE coalesce execution_lane with goal_source, and PWA intake already stamps
// goal_source="user", so the effective lane of an A4 mission was "user" before this
// constant existed and stays "user" with the stamp applied.
export const A4_EXECUTION_LANE_V1 = "user";
const norm = (v) => typeof v === "string" ? v.trim() : "";
const normProject = (v) => v == null || String(v).trim() === "" ? null : String(v).trim();
export async function m22A4GoalIdentityHashV1(userId, goal, projectId = null) {
  const payload=JSON.stringify({version:1,user_id:norm(userId),goal:norm(goal),project_id:normProject(projectId)});
  const digest=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
}
export async function m22A4ScopeRowMatchesV1({
  scope,metadata,missionId,userId,requestId,goal,projectId=null,
  requiredStatuses=["claimed","bound"],nowMs=Date.now(),
}) {
  if(!scope||typeof scope!=="object"||Array.isArray(scope)||!metadata||typeof metadata!=="object"||Array.isArray(metadata))return false;
  const owner=norm(userId),request=norm(requestId),id=norm(missionId);
  const expectedHash=await m22A4GoalIdentityHashV1(owner,goal,projectId);
  const expiresAt=Date.parse(String(scope.expires_at||""));
  const statuses=Array.isArray(requiredStatuses)?requiredStatuses.map(String):[];
  return Boolean(owner&&request&&id&&scope.scope_id===metadata[META.scopeId]&&scope.mission_id===id&&
    scope.owner_user_id===owner&&scope.request_id===request&&scope.goal_hash===expectedHash&&
    metadata[META.goalHash]===expectedHash&&scope.allowed_device_id===metadata[META.deviceId]&&
    metadata.user_id===owner&&(metadata.owner_user_id==null||metadata.owner_user_id===owner)&&
    metadata.source_application==="aria-app-v1"&&metadata.goal_source==="user"&&
    metadata[META.readonlyMarker]===true&&normProject(projectId)===null&&normProject(metadata.project_id)===null&&
    statuses.includes(String(scope.status||""))&&Number.isFinite(expiresAt)&&expiresAt>Number(nowMs));
}
export function m22A4BuildReadonlyProbeStepV1(deviceId) {
  const id=norm(deviceId);if(!id)throw new Error("a4_device_id_required");
  return {
    id:"a4_readonly_utc_clock_probe",operation:"shell.execute",executor_type:"device",risk:"READ",
    target:{type:"device",device_id:id},input:{command:"[DateTime]::UtcNow.ToString('o')",cwd:null},
    policy:{read_only:true,read_only_audit:true,mission_wonder_2_a4_readonly:true},
    authorization:{status:"approved",risk_class:"READ",evidence_ref:"mission-wonder-2-step4-a4-v1"},
    timeout_ms:15000,retryable:false,max_attempts:1,depends_on:[],
    verify:{expected_exit_code:0,stdout_contains:"Z"},
  };
}
export function m22A4ReadonlyProbeStepMatchesV1(step,deviceId) {
  if(!step||typeof step!=="object"||Array.isArray(step))return false;
  const input=step.input&&typeof step.input==="object"?step.input:{};
  const target=step.target&&typeof step.target==="object"?step.target:{};
  const policy=step.policy&&typeof step.policy==="object"?step.policy:{};
  const authorization=step.authorization&&typeof step.authorization==="object"?step.authorization:{};
  const verify=step.verify&&typeof step.verify==="object"?step.verify:{};
  return Boolean(step.id==="a4_readonly_utc_clock_probe"&&step.operation==="shell.execute"&&step.executor_type==="device"&&
    String(step.risk||"READ").toUpperCase()==="READ"&&target.device_id===deviceId&&target.type==="device"&&
    input.command==="[DateTime]::UtcNow.ToString('o')"&&(input.cwd===null||input.cwd===undefined)&&
    step.timeout_ms===15000&&step.retryable===false&&step.max_attempts===1&&Array.isArray(step.depends_on)&&step.depends_on.length===0&&
    policy.read_only===true&&policy.read_only_audit===true&&policy.mission_wonder_2_a4_readonly===true&&
    authorization.status==="approved"&&authorization.risk_class==="READ"&&authorization.evidence_ref==="mission-wonder-2-step4-a4-v1"&&
    verify.expected_exit_code===0&&verify.stdout_contains==="Z");
}
