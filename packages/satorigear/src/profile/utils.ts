export function normalizeAssociationLabel(label: string): string {
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}
