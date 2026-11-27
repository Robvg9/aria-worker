const DEFAULT_TIMEOUT_MS = 30000;

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function buildGeminiContents(messages, nonceFactory = () => globalThis.crypto.randomUUID()) {
  const systemParts = [];
  const contents = [];
  const toolNames = new Map();

  for (const message of Array.isArray(messages) ? messages : []) {
    const role = String(message?.role || '');

    if (role === 'system') {
      if (typeof message?.content === 'string' && message.content.trim()) systemParts.push(message.content.trim());
      continue;
    }

    if (role === 'user') {
      contents.push({ role: 'user', parts: [{ text: String(message?.content ?? '') }] });
      continue;
    }

    if (role === 'assistant') {
      const exactParts = Array.isArray(message?.geminiParts) ? message.geminiParts : null;
      if (exactParts?.length) {
        for (const part of exactParts) {
          const call = part?.functionCall;
          if (call?.id && call?.name) toolNames.set(String(call.id), String(call.name));
        }
        contents.push({ role: 'model', parts: exactParts });
        continue;
      }

      const parts = [];
      if (typeof message?.content === 'string' && message.content.trim()) parts.push({ text: message.content });

      for (const call of Array.isArray(message?.tool_calls) ? message.tool_calls : []) {
        const name = String(call?.function?.name || '');
        const id = String(call?.id || nonceFactory());
        let args = {};
        try { args = JSON.parse(call?.function?.arguments || '{}'); } catch {}

        const original = call?.geminiPart && typeof call.geminiPart === 'object' ? call.geminiPart : null;
        if (original) {
          parts.push(original);
          if (name) toolNames.set(id, name);
          continue;
        }

        if (name) {
          toolNames.set(id, name);
          parts.push({ functionCall: { id, name, args } });
        }
      }
      if (parts.length) contents.push({ role: 'model', parts });
      continue;
    }

    if (role === 'tool') {
      const callId = String(message?.tool_call_id || '');
      const name = toolNames.get(callId) || String(message?.name || 'unknown_tool');
      let responseValue;
      try { responseValue = JSON.parse(String(message?.content ?? '{}')); }
      catch { responseValue = { output: String(message?.content ?? '') }; }

      const functionResponse = {
        name,
        response: responseValue && typeof responseValue === 'object' ? responseValue : { output: responseValue },
      };
      if (toolNames.has(callId)) functionResponse.id = callId;
      contents.push({ role: 'user', parts: [{ functionResponse }] });
    }
  }

  return {
    systemInstruction: systemParts.length ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined,
    contents,
  };
}

export function buildGeminiTools(tools) {
  return Array.isArray(tools) && tools.length
    ? [{
        functionDeclarations: tools
          .filter((tool) => tool?.type === 'function' && tool?.function?.name)
          .map((tool) => ({
            name: String(tool.function.name),
            description: String(tool.function.description || ''),
            parameters: tool.function.parameters || { type: 'object', properties: {}, required: [] },
          })),
      }]
    : undefined;
}

export function classifyAgentToolModelFailure(error, round, sawToolCall) {
  const reason = error instanceof Error ? error.message : String(error ?? '');
  const errorCode = String(error?.code || '').toLowerCase();
  const missionBudgetTerminal = errorCode.startsWith('mission_budget_') || /mission_budget_/i.test(reason);
  const retryableQuota = /(^|[^0-9])429([^0-9]|$)|rate.?limit|quota|too many requests/i.test(reason);
  const retryableProviderAvailability = /(^|[^0-9])503([^0-9]|$)|high demand|temporarily unavailable|overloaded|service unavailable/i.test(reason);
  const retryableCredential = /(^|[^0-9])401([^0-9]|$)|(^|[^0-9])403([^0-9]|$)|unauthorized|forbidden|invalid credential|credential unavailable|invalid api key|authentication failed/i.test(reason);

  return {
    missionBudgetTerminal,
    retryableQuota,
    retryableProviderAvailability,
    retryableCredential,
    canFallback: !missionBudgetTerminal && round === 0 && !sawToolCall
      && (retryableQuota || retryableProviderAvailability || retryableCredential),
  };
}

export function createBudgetedModelCaller(options = {}) {
  const endpoint = String(options.endpoint || '').trim();
  const secret = String(options.secret || '').trim();
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const nonceFactory = options.nonceFactory || (() => globalThis.crypto.randomUUID());
  const signalFactory = options.signalFactory || (() => globalThis.AbortSignal.timeout(DEFAULT_TIMEOUT_MS));

  if (!endpoint || !secret || typeof fetchImpl !== 'function' || typeof nonceFactory !== 'function') {
    throw new Error('agent_tool_loop_runtime_configuration_missing');
  }

  return async function callBudgetedModel(
    agent,
    missionId,
    stepId,
    model,
    messages,
    tools,
    forceTool,
    provider,
    allowWrite,
    callerPolicy,
    callerAuthorization,
  ) {
    const mission = String(missionId || '').trim();
    const step = String(stepId || '').trim();
    const modelId = String(model || '').trim();
    const providerId = String(provider || '').trim().toLowerCase();
    if (!mission || !step || !modelId) throw new Error('agent_tool_loop_mission_identity_required');
    if (providerId !== 'google' && providerId !== 'openrouter') throw new Error('agent_tool_loop_provider_not_supported');
    if (providerId === 'openrouter' && !modelId.startsWith('openrouter/')) throw new Error('agent_tool_loop_model_id_not_canonical');

    const policyInput = asObject(callerPolicy);
    const authorizationInput = asObject(callerAuthorization);
    if (allowWrite && (
      policyInput.human_gate_required !== true
      || authorizationInput.human_gate_verified !== true
      || !authorizationInput.human_gate_mission_id
      || !authorizationInput.human_gate_step_id
      || !authorizationInput.human_gate_action_hash
      || !authorizationInput.human_gate_approval_token
    )) {
      throw new Error('agent_tool_loop_human_gate_required');
    }
    if (allowWrite && (
      authorizationInput.human_gate_mission_id !== mission
      || authorizationInput.human_gate_step_id !== step
    )) {
      throw new Error('agent_tool_loop_human_gate_scope_mismatch');
    }

    const nonce = String(nonceFactory() || '').trim();
    if (!nonce || nonce.length > 120) throw new Error('agent_tool_loop_request_nonce_invalid');
    const requestId = mission + ':' + step + ':' + nonce;
    if (requestId.length > 240) throw new Error('agent_tool_loop_request_id_too_long');

    const isGoogle = providerId === 'google';
    const routeModelId = isGoogle ? 'google/' + modelId + '-direct' : modelId;
    const selectedRoute = {
      status: 'selected',
      provider_id: providerId,
      account_id: isGoogle ? 'acct_google_gemini_free' : 'acct_openrouter_primary',
      model_id: routeModelId,
      capability: 'text_generation',
    };

    const toolList = Array.isArray(tools) ? tools : [];
    const messageList = Array.isArray(messages) ? messages : [];
    let payload;

    if (isGoogle) {
      const converted = buildGeminiContents(messageList, nonceFactory);
      const declaredTools = buildGeminiTools(toolList);
      payload = {
        contents: converted.contents,
        ...(converted.systemInstruction ? { systemInstruction: converted.systemInstruction } : {}),
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 4096,
          ...(toolList.length ? { thinkingConfig: { thinkingLevel: forceTool ? 'low' : 'medium' } } : {}),
        },
        ...(declaredTools ? { tools: declaredTools } : {}),
        ...(declaredTools ? { tool_choice: forceTool ? 'required' : 'auto' } : {}),
      };
    } else {
      const normalizedMessages = messageList.map((message) => ({
        role: String(message?.role || 'user'),
        ...(typeof message?.content === 'string' ? { content: message.content } : {}),
        ...(Array.isArray(message?.tool_calls) ? {
          tool_calls: message.tool_calls.map((call) => ({
            id: String(call?.id || ''),
            type: 'function',
            function: {
              name: String(call?.function?.name || ''),
              arguments: String(call?.function?.arguments || '{}'),
            },
          })),
        } : {}),
        ...(typeof message?.tool_call_id === 'string' ? { tool_call_id: message.tool_call_id } : {}),
        ...(typeof message?.name === 'string' ? { name: message.name } : {}),
      }));
      payload = {
        messages: normalizedMessages,
        ...(toolList.length ? { tools: toolList, tool_choice: forceTool ? 'required' : 'auto' } : {}),
        temperature: 0,
        max_completion_tokens: 2200,
      };
    }

    const authorization = {
      ...authorizationInput,
      status: 'approved',
      risk_class: allowWrite ? 'LOW_RISK_WRITE' : 'READ',
      evidence_ref: String(authorizationInput.evidence_ref || ('agent-tool-loop:' + String(agent?.agent_id || 'unknown'))),
    };
    const policy = {
      ...policyInput,
      tool_use: toolList.length > 0,
      mission_budget_required: true,
      ...(allowWrite ? { human_gate_required: true } : {}),
    };

    const requestBody = {
      execution_version: '1',
      request_id: requestId,
      task_id: step,
      capability: 'text_generation',
      selected_route: selectedRoute,
      authorization,
      input: { payload },
      policy,
      metadata: {
        executor_type: 'agent_tool_loop',
        agent_id: String(agent?.agent_id || ''),
        agent_role: String(agent?.role || ''),
        mission_id: mission,
        step_id: step,
        provider_id: providerId,
        account_id: selectedRoute.account_id,
        model_id: routeModelId,
        capability_id: 'text_generation',
        tool_turn: true,
      },
    };

    const requestOptions = {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + secret,
      },
      body: JSON.stringify(requestBody),
    };
    if (signalFactory) requestOptions.signal = signalFactory();

    const response = await fetchImpl(endpoint, requestOptions);
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.status !== 'succeeded') {
      const code = String(body?.error?.code || body?.reason || ('execution_runtime_http_' + response.status));
      const message = String(body?.error?.message || body?.error?.code || body?.reason || 'Provider execution was blocked');
      const error = new Error(code + ':' + message);
      error.code = code;
      error.providerStatus = body?.error?.provider_status ?? response.status;
      throw error;
    }

    const result = body?.response || {};
    return {
      role: 'assistant',
      content: typeof result.content === 'string' ? result.content : '',
      tool_calls: Array.isArray(result.tool_calls) ? result.tool_calls : [],
      ...(Array.isArray(result.gemini_parts) ? { geminiParts: result.gemini_parts } : {}),
      ...(result.gemini_meta && typeof result.gemini_meta === 'object' ? { geminiMeta: result.gemini_meta } : {}),
    };
  };
}
