# Block B — Current Execution Status

This repository now contains the concrete injected Credential Resolver required to make the existing execution pipeline operational without committing or persisting provider credentials.

The first provider path is the existing `openrouter_chat_completions` adapter. It is exercised in CI through an injected transport, while production credentials and live calls remain outside automated tests.

The execution boundary still requires:

`selected route → 10.7 candidate gate → 10.12 approved authorization → credential_ref → injected resolver → adapter → provider`

Block B does not authorize a route, bypass quota/capacity evidence, retry, switch accounts, invoke fallback internally, or write memory.
