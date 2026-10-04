'use strict';

const { sha256 } = require('./fingerprint-v1');

const VERSION='aria-proactive-consistency-auditor-v1.0.0';
const ACTION_MODE='recommendation_only';

function asInt(v){const n=Number(v);return Number.isInteger(n)&&n>=0?n:0;}
function unique(v){return [...new Set((Array.isArray(v)?v:[]).map(String))].sort();}
function auditProactiveConsistency(input={}){
 const digests=Array.isArray(input.digests)?input.digests:[];
 const trends=Array.isArray(input.trends)?input.trends:[];
 const digestIds=new Set(digests.map(d=>String(d?.digest_id||d?.id||'')).filter(Boolean));
 const findings=[];
 for(const trend of trends){
  const trendId=String(trend?.trend_id||trend?.id||'');
  const rows=Array.isArray(trend?.trends)?trend.trends:[];
  const actual={trend_count:rows.length,persistent_count:rows.filter(r=>r?.state==='persistent').length,recurring_count:rows.filter(r=>r?.state==='recurring').length,new_count:rows.filter(r=>r?.state==='new').length};
  const declared={trend_count:asInt(trend?.trend_count),persistent_count:asInt(trend?.persistent_count),recurring_count:asInt(trend?.recurring_count),new_count:asInt(trend?.new_count)};
  if(JSON.stringify(actual)!==JSON.stringify(declared)) findings.push({code:'trend_summary_mismatch',severity:'high',trend_id:trendId,declared,recomputed:actual});
  for(const row of rows){
   const ids=unique(row?.digest_ids); const missing=ids.filter(id=>!digestIds.has(id)); const occ=asInt(row?.occurrence_count);
   if(missing.length) findings.push({code:'trend_source_missing',severity:'high',trend_id:trendId,trend_row_id:String(row?.trend_id||''),missing_digest_ids:missing});
   if(occ!==ids.length) findings.push({code:'trend_occurrence_mismatch',severity:'high',trend_id:trendId,trend_row_id:String(row?.trend_id||''),occurrence_count:occ,digest_id_count:ids.length});
  }
 }
 const fps=trends.map(t=>String(t?.fingerprint||'')).filter(Boolean);
 if(fps.length!==new Set(fps).size) findings.push({code:'duplicate_trend_fingerprint',severity:'high'});
 const status=findings.length?'drift':'consistent';
 return Object.freeze({version:VERSION,action_mode:ACTION_MODE,status,generated_at:new Date().toISOString(),source_digest_count:digests.length,source_trend_count:trends.length,finding_count:findings.length,high_count:findings.filter(f=>f.severity==='high').length,fingerprint:sha256({version:VERSION,action_mode:ACTION_MODE,source_digest_ids:unique([...digestIds]),trend_ids:trends.map(t=>String(t?.trend_id||t?.id||'')),findings}),findings:Object.freeze(findings.map(Object.freeze))});
}
module.exports=Object.freeze({VERSION,ACTION_MODE,auditProactiveConsistency});
