export function normalizeAssociationLabel(label: string): string {
  // Already-clean labels skip the pipeline: nothing to trim, and over pure ASCII
  // a single toUpperCase() equals the toLowerCase().toUpperCase() round trip.
  scan: {
    let hasLowercase = false;
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
      if (code >= 97 && code <= 122) {
        hasLowercase = true;
      }
    }
    return hasLowercase ? label.toUpperCase() : label;
  }
  return label.trim().replace(/[ \t\r\n]+/g, " ").toLowerCase().toUpperCase();
}
