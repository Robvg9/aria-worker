export const MAX_RETRIEVAL_QUERY_CHARS = 2_000;

export function parseRetrievalQuery(input: unknown): string | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => key !== "query")) return null;
  if (typeof record.query !== "string") return null;
  const query = record.query.trim();
  if (!query || query.length > MAX_RETRIEVAL_QUERY_CHARS) return null;
  return query;
}

export function hasGeneralPrivacyClassification(value: unknown): boolean {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).privacy_class === "general",
  );
}

export function canEnterGeneralIndex(documentMetadata: unknown): boolean {
  return hasGeneralPrivacyClassification(documentMetadata);
}
