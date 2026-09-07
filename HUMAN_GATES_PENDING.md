# ARIA — Human Gates Pending

Updated: 2026-09-07

This file contains only work that is intentionally blocked by a physical or third-party authorization boundary. Autonomous implementation must continue around these gates and must never fabricate evidence.

## 1. Gemini Direct — Google credential/account

Status: READY FOR HUMAN GATE.

Implemented: direct Google Gemini adapter, credential boundary, model registry entry, non-routing rule for unknown credential state, and provider lifecycle adapter.

Human action required: configure/authorize a real Google Gemini credential in ARIA's secret boundary and allow a LIVE health/request verification.

Until then the direct Gemini model remains `unknown` and must not be routed.

## 2. Android Runtime Autonomy — physical reboot validation

Status: SOFTWARE COMPLETE / PHYSICAL GATE.

Implemented: supervisor, Termux:Boot launcher, wake-lock support, restart loop, local secret boundary, heartbeat, job claim, governed execution, checkpoint/resume and reporting.

Human action required: perform the physical Android lifecycle test after reboot, including Termux:Boot activation/background-start permission where required by the device.

## 3. External Multi-IA Client Fabric — third-party authorization

Status: INTERNAL FABRIC READY / EXTERNAL GATE.

Implemented: internal adapter contracts, routing/capability negotiation, envelope normalization, fallback and safety boundaries; existing Grok MCP/OAuth infrastructure is available.

Human action required: connect/authorize the external client account(s) that ARIA is intended to use.

## Rule

These gates do not block autonomous engineering work. When a gate is completed, its evidence must be promoted from this document into the relevant LIVE certification rather than merely changing a status label.
