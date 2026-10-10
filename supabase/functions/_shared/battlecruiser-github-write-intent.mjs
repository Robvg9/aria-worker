const READ_ONLY_PHRASE = /\b(?:read[- ]only|solo\s+lectura|sin\s+modificar|sin\s+cambios|no\s+mutante|no\s+modificar|non[- ]mutating)\b/i;
const WRITE_TARGET = String.raw`(?:c[oó]digo|archivos?|files?|ramas?|branches?|pull\s+requests?|pr(?:s)?|commits?|repositorios?|repositories|datos|git|github)`;
const NEGATED_WRITE_TARGET = new RegExp(
  String.raw`\bno\s+(?:modifiques?|modificar|cambies?|cambiar|crees?|crear|escribas?|escribir|añadas?|anadas?|agregues?|agregar|elimines?|eliminar|borres?|borrar|edites?|editar|actualices?|actualizar)\b[\s\S]{0,120}\b${WRITE_TARGET}\b`,
  "i"
);
const POSITIVE_WRITE_ACTION = String.raw`(?:crea|crear|cree|crees|añade|anade|añadir|agrega|agregar|escribe|escribir|modifica|modificar|actualiza|actualizar|elimina|eliminar|borra|borrar|abre|abrir|create|creates|add|adds|write|writes|modify|modifies|update|updates|delete|deletes|open|opens)`;
const WRITE_REQUEST = new RegExp(
  String.raw`\b${POSITIVE_WRITE_ACTION}\b[\s\S]{0,100}\b${WRITE_TARGET}\b`,
  "i"
);
const TARGET_THEN_WRITE = new RegExp(
  String.raw`\b(?:rama|branch|archivo|file|pull\s+request|pr(?:s)?)\b[\s\S]{0,100}\b${POSITIVE_WRITE_ACTION}\b`,
  "i"
);

/**
 * Only activate the BattleCruiser GitHub probe when a user explicitly requests
 * a positive write operation. Merely mentioning GitHub nouns, or naming them
 * inside a read-only prohibition, must never authorize branch/file/PR writes.
 */
export function hasExplicitBattleCruiserGitHubWriteIntent(goal) {
  const text = String(goal ?? "");
  if (READ_ONLY_PHRASE.test(text) || NEGATED_WRITE_TARGET.test(text)) return false;
  return WRITE_REQUEST.test(text) || TARGET_THEN_WRITE.test(text);
}
