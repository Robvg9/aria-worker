#!/usr/bin/env python3
from pathlib import Path
import re

gw = Path("supabase/functions/aria-device-gateway/index.ts").read_text()
old_pref = """  const preferredModels=[
    'google/gemini-3.5-flash-lite-direct',
    'google/gemini-3.1-flash-lite-direct',
    'google/gemini-3.5-flash-direct',
    'nex-agi/nex-n2.5-mini:free',
    'deepseek/deepseek-v4-flash-0731:free',
    'nvidia/nemotron-3.5-lightning:free'
  ];"""
new_pref = """  // Only LIVE-verified routes. Do not list models absent from model_registry / capability_matrix.
  const preferredModels=[
    'google/gemini-3.5-flash-lite-direct',
    'nex-agi/nex-n2.5-mini:free',
    'nvidia/nemotron-3.5-lightning:free'
  ];"""
if old_pref not in gw:
    raise SystemExit("preferredModels block not found")
gw = gw.replace(old_pref, new_pref, 1)
m = re.search(r"  const allowed=\{[\s\S]*?\} as Record<string,\{provider_id:string;account_id:string\}>;", gw)
if not m:
    raise SystemExit("allowed map not found")
new_allowed = """  // Only routes that exist in model_registry with status=available + verified capability.
  // Invented model IDs (3.5-flash-direct, 3.6+, 3.7+, 3.8+) produced unauthorized / provider_error.
  const allowed={
    'google/gemini-3.5-flash-lite-direct':{provider_id:'google',account_id:'acct_google_gemini_free'},
    'nvidia/nemotron-3.5-lightning:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nex-agi/nex-n2.5-mini:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'deepseek/deepseek-v4-flash-0731:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nvidia/nemotron-3-nano-omni:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'poolside/laguna-s-2.1:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'poolside/laguna-xs-2.1:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'inclusionai/ling-3.0-flash-fin:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'inclusionai/ling-3.0-flash-sante:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'thinking-machines/inkling:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'thinking-machines/inkling-small:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'cohere/north-mini-code:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nex-agi/nex-n2.5-pro:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nvidia/nemotron-3-super-120b-a12b:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'nvidia/nemotron-3-ultra-550b-a55b:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'},
    'dots-studio/dots3-note-preview:free':{provider_id:'openrouter',account_id:'acct_openrouter_primary'}
  } as Record<string,{provider_id:string;account_id:string}>;"""
gw = gw[:m.start()] + new_allowed + gw[m.end():]
for bad in ["google/gemini-3.5-flash-direct", "google/gemini-3.6-flash-direct", "google/gemini-3.7-flash-direct", "google/gemini-3.8-flash-direct"]:
    if bad in gw:
        raise SystemExit(f"bad model still present: {bad}")
Path("supabase/functions/aria-device-gateway/index.ts").write_text(gw)

rn = Path("supabase/functions/aria-mission-runner-v22/index.ts").read_text()
old_guard = """async function verifiedModelFallbackRoutes(original: any, operation: string) {
  if (operation !== "text_generation") return [];
  if (String(original?.provider_id || "") !== "openrouter") return [];
  const risk = String(original?.risk || "READ").toUpperCase();
  if (risk !== "READ") return [];

  // Cross-provider fallback is intentionally READ-only. The primary route remains
  // unchanged; only already-verified, enabled routes registered in ARIA may be used."""
new_guard = """async function verifiedModelFallbackRoutes(original: any, operation: string) {
  if (operation !== "text_generation") return [];
  const primaryProvider = String(original?.provider_id || "");
  // Allow fallback from any primary (openrouter OR google) so unauthorized/invalid
  // Google direct routes can recover via other verified routes. Never retry the same route.
  if (primaryProvider !== "openrouter" && primaryProvider !== "google") return [];
  const risk = String(original?.risk || "READ").toUpperCase();
  if (risk !== "READ") return [];

  // Cross-provider fallback is intentionally READ-only. The primary route remains
  // unchanged; only already-verified, enabled routes registered in ARIA may be used."""
if old_guard not in rn:
    raise SystemExit("runner guard not found")
rn = rn.replace(old_guard, new_guard, 1)
if "PLACEHOLDER" in rn or "primaryProvider" not in rn:
    raise SystemExit("runner patch failed")
Path("supabase/functions/aria-mission-runner-v22/index.ts").write_text(rn)
print("PATCH_OK", len(gw), len(rn))
