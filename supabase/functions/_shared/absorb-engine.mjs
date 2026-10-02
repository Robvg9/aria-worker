const ALLOWED_STATUS = new Set(["DISCOVERED","INSPECTED","INDEXED","SANDBOXED","VERIFIED","REGISTERED","ENABLED","DISABLED","REJECTED","DEPRECATED"]);
const GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]{1,100}$/;
const GITHUB_REF_RE = /^(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._\/-]{1,200}$/;

export const ABSORB_VERSION = "1.0.0";
export const ABSORB_SCHEMA = "aria.absorb.v1";
export const ABSORB_STAGES = Object.freeze(["DISCOVER","INSPECT","UNDERSTAND","INDEX","ISOLATE","ADAPT","TEST","VERIFY","REGISTER","ENABLE","LEARN","USE","MONITOR","REPLACE_OR_RETIRE"]);
export const ABSORB_STATUS = Object.freeze(Array.from(ALLOWED_STATUS));

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(buf)).map(v => v.toString(16).padStart(2,"0")).join("");
}

export function normalizeGithubSource(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("github_source_invalid");
  let owner = String(input.owner || "").trim();
  let repo = String(input.repo || "").trim();
  let ref = String(input.ref || "").trim();
  const url = String(input.url || "").trim();
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error("github_url_invalid"); }
    if (parsed.protocol !== "https:" || parsed.hostname !== "github.com") throw new Error("github_url_not_allowed");
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 2) throw new Error("github_url_shape_invalid");
    owner = owner || parts[0];
    repo = repo || parts[1];
    if (!ref && parts.length >= 4 && (parts[2] === "tree" || parts[2] === "blob")) ref = parts.slice(3).join("/");
  }
  if (!GITHUB_OWNER_RE.test(owner)) throw new Error("github_owner_invalid");
  if (!GITHUB_REPO_RE.test(repo)) throw new Error("github_repo_invalid");
  if (ref && !GITHUB_REF_RE.test(ref)) throw new Error("github_ref_invalid");
  return Object.freeze({source_type:"github",owner,repo,ref:ref || null,canonical_url:"https://github.com/"+owner+"/"+repo+(ref ? "/tree/"+encodeURI(ref) : "")});
}

function githubHeaders() { return {accept:"application/vnd.github+json","x-github-api-version":"2022-11-28","user-agent":"ARIA-ABSORB/1.0"}; }
async function githubJson(fetchImpl, path) {
  const response = await fetchImpl("https://api.github.com" + path, {method:"GET",headers:githubHeaders()});
  if (!response.ok) throw new Error("github_http_"+response.status);
  return response.json();
}

function classifyEntry(path, type) {
  if (type === "tree") {
    if (/^agents$/.test(path)) return "agents-directory";
    if (/^skills$/.test(path)) return "skills-directory";
    if (/^commands$/.test(path)) return "commands-directory";
    if (/^workflows$/.test(path)) return "workflows-directory";
    if (/^hooks$/.test(path)) return "hooks-directory";
    if (/^ecc2$/.test(path)) return "control-plane-directory";
  }
  if (/^agents\//.test(path)) return "agent-source";
  if (/^skills\//.test(path)) return "skill-source";
  if (/^commands\//.test(path)) return "command-source";
  if (/^workflows\//.test(path)) return "workflow-source";
  if (/^hooks\//.test(path)) return "hook-source";
  if (/^mcp-configs\//.test(path) || path === ".mcp.json") return "mcp-source";
  if (/^tests\//.test(path)) return "test-source";
  if (/^docs\//.test(path)) return "documentation";
  if (/^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(path)) return "dependency-manifest";
  if (/^ecc2(?:\/|$)/.test(path)) return "control-plane-source";
  return "supporting-artifact";
}

export function summarizeInventory(entries) {
  const categories = {};
  for (const entry of entries) { const c = entry.category || classifyEntry(entry.path, entry.type); categories[c] = (categories[c] || 0) + 1; }
  const counts = {agents:0,skills:0,commands:0,workflows:0,hooks:0,mcp:0};
  for (const e of entries) if (e.type === "blob") {
    if (/^agents\/[^/]+\.md$/.test(e.path)) counts.agents++;
    else if (/^skills\/[^/]+\/SKILL\.md$/.test(e.path)) counts.skills++;
    else if (/^commands\/[^/]+\.md$/.test(e.path)) counts.commands++;
    else if (/^workflows\/[^/]+\.workflow\.js$/.test(e.path)) counts.workflows++;
    else if (/^hooks\//.test(e.path)) counts.hooks++;
    else if (e.path === ".mcp.json" || /^mcp-configs\//.test(e.path)) counts.mcp++;
  }
  return Object.freeze({total_entries:entries.length,files:entries.filter(e=>e.type==="blob").length,directories:entries.filter(e=>e.type==="tree").length,category_counts:Object.fromEntries(Object.entries(categories).sort()),capability_unit_counts:counts});
}

export async function inspectGithubSource(input, {fetchImpl = fetch, maxEntries = 10000} = {}) {
  const source = normalizeGithubSource(input);
  const repository = await githubJson(fetchImpl, "/repos/"+source.owner+"/"+source.repo);
  const selectedRef = source.ref || String(repository.default_branch || "main");
  if (!GITHUB_REF_RE.test(selectedRef)) throw new Error("github_default_ref_invalid");
  const resolvedCommit = await githubJson(fetchImpl, "/repos/"+source.owner+"/"+source.repo+"/commits/"+encodeURIComponent(selectedRef));
  const commitSha = String(resolvedCommit?.sha || "").trim();
  if (!/^[0-9a-f]{40}$/i.test(commitSha)) throw new Error("github_commit_sha_invalid");
  const tree = await githubJson(fetchImpl, "/repos/"+source.owner+"/"+source.repo+"/git/trees/"+encodeURIComponent(commitSha)+"?recursive=1");
  if (!Array.isArray(tree?.tree) || tree.truncated === true) throw new Error("github_tree_incomplete");
  if (tree.tree.length > maxEntries) throw new Error("github_tree_too_large");
  const entries = tree.tree.map(entry => {
    const type = String(entry.type || "");
    if (type !== "blob" && type !== "tree") throw new Error("github_tree_entry_invalid");
    return Object.freeze({path:String(entry.path || ""),type,sha:String(entry.sha || ""),size:Number.isFinite(Number(entry.size)) ? Number(entry.size) : null,category:classifyEntry(String(entry.path || ""),type)});
  }).sort((a,b)=>a.path.localeCompare(b.path)||a.type.localeCompare(b.type)||a.sha.localeCompare(b.sha));
  const canonical = {
    schema:ABSORB_SCHEMA,version:ABSORB_VERSION,
    source:{owner:source.owner,repo:source.repo,ref:selectedRef,commit_sha:commitSha,canonical_url:source.canonical_url},
    repository:{full_name:String(repository.full_name || source.owner+"/"+source.repo),default_branch:String(repository.default_branch || selectedRef),visibility:String(repository.visibility || "unknown"),archived:Boolean(repository.archived),license:repository.license?.spdx_id ? String(repository.license.spdx_id) : null},
    deterministic:true,complete_tree:true,entries,summary:summarizeInventory(entries),
    execution_policy:{external_code_execution:"FORBIDDEN",downloaded_code_execution:false,secrets_injected:false,activation_requires_registered_binding:true}
  };
  const digest = await sha256(JSON.stringify(canonical));
  return Object.freeze({...canonical,inventory_digest_sha256:digest});
}

export function buildCapabilityIndex(inventory) {
  if (!inventory || inventory.schema !== ABSORB_SCHEMA || inventory.deterministic !== true || inventory.complete_tree !== true) throw new Error("absorb_inventory_invalid");
  const units=[];
  for (const entry of inventory.entries || []) {
    if (entry.type !== "blob") continue;
    let kind=null;
    if (/^agents\/[^/]+\.md$/.test(entry.path)) kind="agent";
    else if (/^skills\/[^/]+\/SKILL\.md$/.test(entry.path)) kind="skill";
    else if (/^commands\/[^/]+\.md$/.test(entry.path)) kind="command";
    else if (/^workflows\/[^/]+\.workflow\.js$/.test(entry.path)) kind="workflow";
    else if (/^hooks\//.test(entry.path)) kind="hook";
    else if (entry.path === ".mcp.json" || /^mcp-configs\//.test(entry.path)) kind="mcp";
    if (!kind) continue;
    units.push({kind,name:entry.path,source_sha:entry.sha});
  }
  units.sort((a,b)=>a.kind.localeCompare(b.kind)||a.name.localeCompare(b.name));
  return units.map((unit,index)=>({capability_id:"absorb."+unit.kind+"."+(index+1)+"."+String(unit.source_sha).slice(0,12),...unit,status:"DISCOVERED",runtime_binding:null,verification_state:"NOT_VERIFIED"}));
}

export function buildAbsorptionPlan({source,requestedCapabilities=[]} = {}) {
  const defs=[["DISCOVER","Localizar y fijar la fuente.","READ"],["INSPECT","Inspeccionar metadatos y árbol sin ejecutar código externo.","READ"],["UNDERSTAND","Clasificar componentes y dependencias potenciales.","READ"],["INDEX","Crear IDs deterministas de capacidades candidatas.","READ"],["ISOLATE","Preparar sandbox lógico; ningún código externo se ejecuta aún.","READ"],["ADAPT","Diseñar binding explícito al runtime de ARIA.","LOW_RISK_WRITE"],["TEST","Ejecutar únicamente contratos controlados del adaptador ARIA.","READ"],["VERIFY","Comprobar procedencia, seguridad, compatibilidad y evidencia.","READ"],["REGISTER","Registrar la capacidad gobernada.","LOW_RISK_WRITE"],["ENABLE","Habilitar solo un binding certificado y autorizado.","HIGH_RISK_WRITE"],["LEARN","Registrar resultados y contexto de uso.","READ"],["USE","Consumir la capacidad desde rutas gobernadas de ARIA.","LOW_RISK_WRITE"],["MONITOR","Observar resultados, degradación y deriva.","READ"],["REPLACE_OR_RETIRE","Sustituir o retirar cuando exista evidencia.","LOW_RISK_WRITE"]];
  return Object.freeze({schema:ABSORB_SCHEMA,plan_version:"aria-absorb-plan-v1",source,requested_capabilities:[...requestedCapabilities].map(String).slice(0,64),external_code_execution:false,stages:defs.map((d,i)=>Object.freeze({index:i+1,stage:d[0],description:d[1],risk:d[2],state:i===0?"DONE":"PENDING",auto_execute:false})),governance:{safe_default:true,least_privilege:true,reversible:true,provenance_required:true,runtime_binding_allowlist_required:true,human_gate_for_enable_write:true}});
}

export function transitionStatus(current,next) {
  if (!ALLOWED_STATUS.has(current) || !ALLOWED_STATUS.has(next)) throw new Error("absorb_status_invalid");
  const allowed={DISCOVERED:["INSPECTED","REJECTED"],INSPECTED:["INDEXED","SANDBOXED","REJECTED"],INDEXED:["SANDBOXED","VERIFIED","REJECTED"],SANDBOXED:["VERIFIED","REJECTED"],VERIFIED:["REGISTERED","DISABLED","REJECTED"],REGISTERED:["ENABLED","DISABLED","DEPRECATED"],ENABLED:["DISABLED","DEPRECATED"],DISABLED:["REGISTERED","DEPRECATED"],REJECTED:[],DEPRECATED:[]};
  if (current === next) return current;
  if (!(allowed[current] || []).includes(next)) throw new Error("absorb_invalid_transition:"+current+"->"+next);
  return next;
}

export async function buildAbsorptionIdentity(inventory,capabilities) {
  return sha256(JSON.stringify({schema:ABSORB_SCHEMA,source:inventory?.source,inventory_digest_sha256:inventory?.inventory_digest_sha256,capability_ids:(capabilities||[]).map(x=>x.capability_id)}));
}
