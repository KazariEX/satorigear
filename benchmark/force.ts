export function force(value: unknown): void {
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const child of value) {
      force(child);
    }
    return;
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    force(record[key]);
  }
}
