export function generateId(prefix?: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix ?? "id"}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
