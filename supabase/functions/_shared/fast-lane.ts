export type ConversationLane = "fast" | "deep";

const COMPLEX_SIGNALS = /\b(implement|implementation|modify|change|fix|debug|refactor|deploy|migration|migrate|security|credential|token|password|audit|forensic|research|investigate|benchmark|verify|test|regression|github|supabase|android|windows|battlecruiser|mission|execute|run|build|code|sql|architecture|estado\s+actual)\b/i;
const CONTEXT_SIGNALS = /\b(remember|recuerda|antes|ayer|historial|contexto|mi proyecto|como hicimos|como lo dejamos|seg[uú]n|qué hicimos|que hicimos|última vez|ultima vez)\b/i;
const LOW_VALUE = /^(hola|hey|buenas|gracias|ok|okay|perfecto|dale|xd|jajaja|sí|si|no|listo|entendido|qué tal|que tal|cómo estás|como estas|bien)[!?.,\s]*$/i;

export function classifyConversation(text: unknown): Readonly<{ lane: ConversationLane; reason: string; complexity: "low" | "deep" }> {
  const value = String(text ?? "").trim();
  if (!value) return Object.freeze({ lane: "deep", reason: "empty_input", complexity: "deep" });
  if (LOW_VALUE.test(value)) return Object.freeze({ lane: "fast", reason: "low_value_conversation", complexity: "low" });
  if (CONTEXT_SIGNALS.test(value)) return Object.freeze({ lane: "deep", reason: "context_required", complexity: "deep" });
  if (COMPLEX_SIGNALS.test(value)) return Object.freeze({ lane: "deep", reason: "complex_or_operational_signal", complexity: "deep" });
  if (value.length <= 80) return Object.freeze({ lane: "fast", reason: "short_simple_input", complexity: "low" });
  if (value.length <= 180 && !(/[?].*[?]/.test(value))) return Object.freeze({ lane: "fast", reason: "bounded_simple_input", complexity: "low" });
  return Object.freeze({ lane: "deep", reason: "length_or_ambiguity", complexity: "deep" });
}
