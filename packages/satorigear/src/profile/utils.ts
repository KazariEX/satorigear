export function normalizeAssociationLabel(label: string): string {
  // Already-clean labels skip the pipeline: nothing to trim, and over pure ASCII
  // lowercase is the final folded form expected by mdast identifiers.
  scan: {
    let hasUppercase = false;
    for (let index = 0; index < label.length; index++) {
      const code = label.charCodeAt(index);
      if (code === 32) {
        // Leading, trailing, or doubled spaces need the full pipeline.
        if (index === 0 || index + 1 === label.length || label.charCodeAt(index + 1) === 32) {
          break scan;
        }
        continue;
      }
      // Non-printable or non-ASCII characters need the full pipeline.
      if (code < 32 || code > 126) {
        break scan;
      }
      if (code >= 65 && code <= 90) {
        hasUppercase = true;
      }
    }
    return hasUppercase ? label.toLowerCase() : label;
  }
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase().toLowerCase();
}
