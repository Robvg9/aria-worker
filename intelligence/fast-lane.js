'use strict';

const COMPLEX_SIGNALS=/\b(implement|implementation|modify|change|fix|debug|refactor|deploy|migration|migrate|security|credential|token|password|audit|forensic|research|investigate|benchmark|verify|test|regression|github|supabase|android|windows|battlecruiser|mission|execute|run|build|code|sql|architecture)\b/i;
const CONTEXT_SIGNALS=/\b(remember|recuerda|antes|ayer|historial|contexto|mi proyecto|como hicimos|como lo dejamos|seg[uú]n|qué hicimos|que hicimos|estado actual|última vez|ultima vez)\b/i;
const LOW_VALUE=/^(hola|hey|buenas|gracias|ok|okay|perfecto|dale|xd|jajaja|sí|si|no|listo|entendido|qué tal|que tal|cómo estás|como estas|bien)[!?.,\s]*$/i;

function classifyConversation(text){
  const value=String(text??'').trim();
  if(!value) return Object.freeze({lane:'deep',reason:'empty_input'});
  if(LOW_VALUE.test(value)) return Object.freeze({lane:'fast',reason:'low_value_conversation',complexity:'low'});
  if(CONTEXT_SIGNALS.test(value)) return Object.freeze({lane:'deep',reason:'context_required'});
  if(COMPLEX_SIGNALS.test(value)) return Object.freeze({lane:'deep',reason:'complex_or_mutating_signal'});
  if(value.length<=80) return Object.freeze({lane:'fast',reason:'short_simple_input',complexity:'low'});
  if(value.length<=180 && !/[?].*[?]/.test(value)) return Object.freeze({lane:'fast',reason:'bounded_simple_input',complexity:'low'});
  return Object.freeze({lane:'deep',reason:'length_or_ambiguity'});
}

module.exports=Object.freeze({classifyConversation});
