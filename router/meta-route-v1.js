/**
 * ARIA Router Meta-Reasoning Overlay v1.
 * Adds metacognitive gating without changing classic or economic router contracts.
 */
const router = require('./lookup.js');
const economics = require('./economic-route-v1.js');
const meta = require('../meta-reasoning/engine-v1.js');

const VERSION = 'router-meta-overlay-v1';

function decideRoute(input) {
  if (!input || typeof input !== 'object') return { status: 'abstain', reason: 'invalid_input', version: VERSION };
  const economic = economics.economicallySelect(input);
  const selected = economic && economic.selected;
  const metaDecision = meta.assess({
    task: input.task,
    confidence: input.confidence,
    evidence: input.evidence,
    strategy_history: input.strategy_history,
    current_strategy: input.current_strategy,
    skills: input.skills,
    agents: input.agents,
    ambiguity: input.ambiguity,
    risk: input.risk,
    expected_value: input.expected_value,
    requires_human_approval: input.requires_human_approval,
    human_gate: input.human_gate,
    irreversible: input.irreversible,
    destructive: input.destructive,
    needs_research: input.needs_research,
    experiment_preferred: input.experiment_preferred,
    experiment_required: input.experiment_required
  });
  return {
    ...metaDecision,
    route: typeof input.capability === 'string' ? router.route({
      capability: input.capability,
      preferred_model: selected?.model_id || input.preferred_model,
      preferred_provider: selected?.provider_id || input.preferred_provider,
      preferred_account: selected?.account_id || input.preferred_account,
    }) : { status: 'no_route' },
    economic_decision: economic,
    meta_overlay_version: VERSION
  };
}

module.exports = { version: VERSION, decideRoute };
