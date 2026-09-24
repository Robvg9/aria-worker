export function shouldDebate(text: string, lane: string) {
  if (lane !== "deep") return false;
  const value = String(text ?? "").trim();
  if (!value) return false;
  return /\b(compara|compare|contrasta|debate|dos opciones|alternativas|verifica|comprueba|riesgo|pros y contras|qué conviene|que conviene|qué harías|que harias|analiza críticamente|analiza criticamente)\b/i.test(value)
    || value.length > 420;
}

export function debatePrompt(userText: string, proposal: string) {
  return [
    "Actúa como segundo modelo crítico de ARIA.",
    "Revisa la propuesta del primer modelo contra la petición original.",
    "Corrige errores, omisiones, contradicciones o afirmaciones no sustentadas.",
    "Devuelve directamente una respuesta final útil para el usuario; no describas el proceso interno de debate.",
    "PETICIÓN ORIGINAL:",
    userText,
    "PROPUESTA DEL PRIMER MODELO:",
    proposal,
  ].join("\n\n");
}
