// Shared type guard functions

/**
 * Type guard to check if a value is a plain object (Record<string, unknown>)
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
