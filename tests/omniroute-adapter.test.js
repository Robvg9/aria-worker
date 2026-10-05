'use strict';
const assert = require('assert');
const engine = require('../execution/lookup');
const adapter = require('../execution/adapters/omniroute');
const { descriptor, DEFAULT_ENDPOINT, ROUTED_BY_HEADER, ROUTE_DECISION_HEADER, buildMessages, buildRequest, isLoopbackEndpoint, normalizeResponse, normalizeUsage, execute } = adapter;

const SECRET = 'phase6-secret-only';
const route = { status:'selected', provider_id:'omniroute', account_id:'acct_omniroute_test', model_id:'ollama/qwen3:4b', upstream_model:'ollama/qwen3:4b', capability:'text_generation', gateway_endpoint:DEFAULT_ENDPOINT, omniroute_provider:'ollama' };

assert.strictEqual(descriptor.adapter_id,'omniroute_gateway_chat_completions');
assert.strictEqual(descriptor.provider_id,'omniroute');
assert.deepStrictEqual(descriptor.operations,['text_generation']);
assert.strictEqual(engine.ADAPTERS.omniroute, adapter);
assert.deepStrictEqual(buildMessages({messages:[{role:'user',content:'hello'}]}),[{role:'user',content:'hello'}]);
assert.deepStrictEqual(buildMessages({prompt:'hello'}),[{role:'user',content:'hello'}]);
assert.strictEqual(buildMessages({}),null);
const built=buildRequest(route,{payload:{prompt:'hello',max_tokens:12,temperature:0}});
assert.strictEqual(built.model,'ollama/qwen3:4b');
assert.strictEqual(built.messages[0].content,'hello');
assert.strictEqual(built.max_tokens,12);
assert.strictEqual(built.temperature,0);
assert.strictEqual(built.stream,false);
assert.strictEqual(isLoopbackEndpoint(DEFAULT_ENDPOINT),true);
assert.strictEqual(isLoopbackEndpoint('https://example.com/v1/chat/completions'),false);
assert.strictEqual(isLoopbackEndpoint('http://10.0.0.5:20128/v1/chat/completions'),false);
assert.deepStrictEqual(normalizeResponse({id:'omni-1',model:'ollama/qwen3:4b',choices:[{message:{content:'pong'},finish_reason:'stop'}]},route),{modality:'text',content:'pong',provider_response_id:'omni-1',finish_reason:'stop',provider_model:'ollama/qwen3:4b'});
assert.deepStrictEqual(normalizeUsage({prompt_tokens:1,completion_tokens:2,total_tokens:3}),{status:'reported',prompt_tokens:1,completion_tokens:2,total_tokens:3});
assert.strictEqual(normalizeResponse({choices:[]},route),null);

(async()=>{
  let observed=null;
  const ok=await execute({
    route,
    input:{payload:{prompt:'hello',temperature:0}},
    secret:SECRET,
    transport:async(url,options)=>{
      observed={url,options};
      return {
        status:200,
        headers:new Headers({
          [ROUTED_BY_HEADER]:'self-hosted-openai-compat',
          [ROUTE_DECISION_HEADER]:'ollama(qwen3:4b)'
        }),
        json:{
          id:'omni-ok',
          model:'ollama/qwen3:4b',
          choices:[{message:{content:'OMNI_OK'},finish_reason:'stop'}],
          usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3}
        }
      };
    }
  });
  assert.strictEqual(ok.ok,true);
  assert.strictEqual(observed.url,DEFAULT_ENDPOINT);
  assert.strictEqual(observed.options.method,'POST');
  assert.strictEqual(observed.options.headers.Authorization,'Bearer '+SECRET);
  assert.strictEqual(observed.options.headers['x-omniroute-provider'],'ollama');
  assert.strictEqual(JSON.parse(observed.options.body).model,'ollama/qwen3:4b');
  assert.deepStrictEqual(ok.usage,{status:'reported',prompt_tokens:1,completion_tokens:2,total_tokens:3});
  assert.strictEqual(ok.metadata.gateway,'omniroute');
  assert.strictEqual(ok.metadata.routed_by,'self-hosted-openai-compat');
  assert.strictEqual(ok.metadata.route_decision,'ollama(qwen3:4b)');
  assert.ok(!JSON.stringify(ok).includes(SECRET));

  let calls=0;
  const rateLimited=await execute({route,input:{payload:{prompt:'hello'}},secret:SECRET,transport:async()=>{calls+=1;return{status:429,json:{error:{message:'rate limited'}}};}});
  assert.strictEqual(rateLimited.ok,false);
  assert.strictEqual(rateLimited.error.code,'provider_error');
  assert.strictEqual(rateLimited.error.provider_status,429);
  assert.strictEqual(calls,1);

  const timeoutError=new Error('secret must never escape'); timeoutError.name='TimeoutError';
  const timed=await execute({route,input:{payload:{prompt:'hello'}},secret:SECRET,transport:async()=>{throw timeoutError;}});
  assert.strictEqual(timed.error.code,'timeout');
  assert.ok(!JSON.stringify(timed).includes(SECRET));

  const invalidEndpoint=await execute({route:{...route,gateway_endpoint:'https://evil.example/v1/chat/completions'},input:{payload:{prompt:'hello'}},secret:SECRET,transport:async()=>{throw new Error('must not be called');}});
  assert.strictEqual(invalidEndpoint.error.code,'adapter_error');

  const missingSecret=await execute({route,input:{payload:{prompt:'hello'}},secret:'',transport:async()=>{throw new Error('must not be called');}});
  assert.strictEqual(missingSecret.error.code,'credential_unavailable');

  const wrongProvider=await execute({route:{...route,provider_id:'openrouter'},input:{payload:{prompt:'hello'}},secret:SECRET,transport:async()=>{throw new Error('must not be called');}});
  assert.strictEqual(wrongProvider.error.code,'adapter_error');

  const malformed=await execute({route,input:{payload:{prompt:'hello'}},secret:SECRET,transport:async()=>({status:200,json:{choices:[]}})});
  assert.strictEqual(malformed.error.code,'invalid_response');

  const noTransport=await execute({route,input:{payload:{prompt:'hello'}},secret:SECRET});
  assert.strictEqual(noTransport.error.code,'transport_error');

  const engineResult=await engine.execute({selected_route:route,authorization:{status:'approved'},input:{modality:'text',payload:{prompt:'hello'}}},{
    candidateSelectable:()=>true,
    getModel:()=>({model_id:'ollama/qwen3:4b',provider_id:'omniroute',status:'available'}),
    isAccountActive:()=>true,
    credentialRefOf:()=> 'secret://omniroute/acct_omniroute_test',
    supports:()=>true,
    capacityAllows:()=>true,
    credentialResolver:{resolve:()=>({status:'resolved',secret:SECRET})},
    transport:async()=>({status:200,headers:new Headers(),json:{id:'e1',model:'ollama/qwen3:4b',choices:[{message:{content:'engine-ok'},finish_reason:'stop'}]}})
  });
  assert.strictEqual(engineResult.status,'succeeded');
  assert.strictEqual(engineResult.metadata.adapter_id,'omniroute_gateway_chat_completions');
  assert.strictEqual(engineResult.metadata.gateway,'omniroute');

  console.log('OmniRoute Phase 6 adapter tests: PASS');
})().catch(error=>{console.error(error);process.exitCode=1;});