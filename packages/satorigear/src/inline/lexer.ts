import { inlineKind } from "./kinds.ts";

const htmlComment = /<!-->|<!--->|<!--[\s\S]*?(?:-->|$)/y;
const autolink = /<(?:[A-Z][A-Z0-9+.\-]{1,31}:[^ \t\n\r<>]+|[\w!#$%&'*+\-/=?^`{|}~.]+@[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9]))*(?:\.[A-Z0-9](?:[A-Z0-9]|-(?=[A-Z0-9]))*)+)>/iy;
const inlineHtml = /<[A-Za-z][A-Za-z0-9-]*(?:[ \t\n\r]+[A-Za-z_:][\w.:-]*(?:[ \t\n\r]*=[ \t\n\r]*(?:[^ \t\n\r"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t\n\r]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t\n\r]*>|<\?[\s\S]*?\?>|<![A-Z][\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>/y;
const entity = /&(?:#x[0-9A-F]{1,6}|#\d{1,7}|[A-Z][A-Z0-9]{0,30});/iy;

const htmlCommentKind = inlineKind("HtmlComment");
const codeSpanKind = inlineKind("CodeSpan");
const autolinkKind = inlineKind("Autolink");
const inlineHtmlKind = inlineKind("InlineHtml");
const entityKind = inlineKind("Entity");
const hardBreakKind = inlineKind("HardBreak");
const escapeKind = inlineKind("Escape");
const textKind = inlineKind("Text");
const asteriskRunKind = inlineKind("AsteriskRun");
const underscoreRunKind = inlineKind("UnderscoreRun");
const tildeRunKind = inlineKind("TildeRun");
const imageOpenKind = inlineKind("ImageOpen");
const bracketOpenKind = inlineKind("BracketOpen");
const linkTailKind = inlineKind("LinkTail");
const referenceTailKind = inlineKind("ReferenceTail");
const shortcutReferenceTailKind = inlineKind("ShortcutReferenceTail");
const delimiterKind = inlineKind("Delimiter");
const newlineKind = inlineKind("Newline");

function appendToken(tokens: number[], kind: number, start: number, end: number): void {
  tokens.push(kind, start, end, 0);
}

function matchEnd(pattern: RegExp, source: string, start: number): number {
  pattern.lastIndex = start;
  const match = pattern.exec(source);
  return match === null ? -1 : start + match[0].length;
}

function runEnd(source: string, start: number, marker: number): number {
  let end = start + 1;
  while (source.charCodeAt(end) === marker) {
    end++;
  }
  return end;
}

function codeSpanEnd(source: string, start: number): number {
  if (source.charCodeAt(start - 1) === 96) {
    return -1;
  }
  const openEnd = runEnd(source, start, 96);
  const markerLength = openEnd - start;
  let offset = openEnd;
  while (offset < source.length) {
    if (source.charCodeAt(offset) !== 96) {
      offset++;
      continue;
    }
    const closeEnd = runEnd(source, offset, 96);
    if (closeEnd - offset === markerLength) {
      return closeEnd;
    }
    offset = closeEnd;
  }
  return -1;
}

function skipWhitespace(source: string, start: number): number {
  let end = start;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code !== 9 && code !== 10 && code !== 13 && code !== 32) {
      break;
    }
    end++;
  }
  return end;
}

function linkDestinationEnd(source: string, start: number): number {
  if (source.charCodeAt(start) === 60) {
    let end = start + 1;
    while (end < source.length) {
      const code = source.charCodeAt(end);
      if (code === 62) {
        return end + 1;
      }
      if (code === 10 || code === 13 || code === 60) {
        return -1;
      }
      end += code === 92 && end + 1 < source.length ? 2 : 1;
    }
    return -1;
  }

  let depth = 0;
  let end = start;
  let consumed = false;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code === 92) {
      if (end + 1 >= source.length) {
        break;
      }
      consumed = true;
      end += 2;
      continue;
    }
    if (code === 40) {
      if (depth === 32) {
        return -1;
      }
      depth++;
      consumed = true;
      end++;
      continue;
    }
    if (code === 41) {
      if (depth === 0) {
        break;
      }
      depth--;
      consumed = true;
      end++;
      continue;
    }
    if (code === 9 || code === 10 || code === 13 || code === 32) {
      break;
    }
    consumed = true;
    end++;
  }
  return consumed && depth === 0 ? end : -1;
}

function linkTitleEnd(source: string, start: number): number {
  const marker = source.charCodeAt(start);
  const close = marker === 40 ? 41 : marker;
  if (marker !== 34 && marker !== 39 && marker !== 40) {
    return -1;
  }
  let end = start + 1;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code === close) {
      return end + 1;
    }
    if (code === 10 || code === 13) {
      return -1;
    }
    end += code === 92 && end + 1 < source.length ? 2 : 1;
  }
  return -1;
}

function linkTailEnd(source: string, start: number): number {
  if (source.charCodeAt(start + 1) !== 40) {
    return -1;
  }
  let offset = skipWhitespace(source, start + 2);
  if (source.charCodeAt(offset) === 41) {
    return offset + 1;
  }
  const destinationEnd = linkDestinationEnd(source, offset);
  if (destinationEnd < 0) {
    return -1;
  }
  offset = destinationEnd;
  const whitespaceEnd = skipWhitespace(source, offset);
  if (whitespaceEnd > offset && source.charCodeAt(whitespaceEnd) !== 41) {
    const titleEnd = linkTitleEnd(source, whitespaceEnd);
    if (titleEnd < 0) {
      return -1;
    }
    offset = titleEnd;
  }
  else {
    offset = whitespaceEnd;
  }
  offset = skipWhitespace(source, offset);
  return source.charCodeAt(offset) === 41 ? offset + 1 : -1;
}

function referenceTailEnd(source: string, start: number): number {
  if (source.charCodeAt(start + 1) !== 91) {
    return -1;
  }
  let offset = start + 2;
  if (source.charCodeAt(offset) === 93) {
    return offset + 1;
  }
  let characters = 0;
  let hasContent = false;
  while (offset < source.length && characters < 999) {
    const code = source.charCodeAt(offset);
    if (code === 93) {
      return hasContent ? offset + 1 : -1;
    }
    if (code === 91) {
      return -1;
    }
    if (code === 92) {
      if (offset + 1 >= source.length) {
        return -1;
      }
      hasContent = true;
      offset += 2;
    }
    else {
      hasContent ||= code !== 9 && code !== 10 && code !== 13 && code !== 32;
      offset++;
    }
    characters++;
  }
  return -1;
}

function isAsciiPunctuation(code: number): boolean {
  return (
    code >= 33 && code <= 47 ||
    code >= 58 && code <= 64 ||
    code >= 91 && code <= 96 ||
    code >= 123 && code <= 126
  );
}

function textEnd(source: string, start: number): number {
  let end = start;
  while (end < source.length) {
    const code = source.charCodeAt(end);
    if (code === 92 && (source.charCodeAt(end + 1) === 32 || source.charCodeAt(end + 1) === 9)) {
      end += 2;
      continue;
    }
    if (code === 32) {
      let spaces = end + 1;
      while (source.charCodeAt(spaces) === 32) {
        spaces++;
      }
      const next = source.charCodeAt(spaces);
      if (spaces > end + 1 && (spaces === source.length || next === 10 || next === 13)) {
        break;
      }
      end++;
      continue;
    }
    if (
      code === 10 || code === 13 || code === 92 || code === 96 || code === 42 ||
      code === 95 || code === 91 || code === 93 || code === 60 || code === 33 ||
      code === 38 || code === 126
    ) {
      break;
    }
    end++;
  }
  return end;
}

export function tokenizeInline(source: string): readonly number[] {
  const tokens: number[] = [];
  let offset = 0;
  let lineStart = true;
  while (offset < source.length) {
    if (lineStart) {
      let content = offset;
      while (source.charCodeAt(content) === 32) {
        content++;
      }
      if (content === source.length) {
        break;
      }
      let code = source.charCodeAt(content);
      if (code === 10 || code === 13) {
        offset = content + 1;
        if (code === 13 && source.charCodeAt(offset) === 10) {
          offset++;
        }
        continue;
      }
      if (code === 9) {
        let blankEnd = content;
        while (source.charCodeAt(blankEnd) === 9 || source.charCodeAt(blankEnd) === 32) {
          blankEnd++;
        }
        code = source.charCodeAt(blankEnd);
        if (blankEnd === source.length || code === 10 || code === 13) {
          offset = blankEnd + (blankEnd < source.length ? 1 : 0);
          if (code === 13 && source.charCodeAt(offset) === 10) {
            offset++;
          }
          continue;
        }
      }
      offset = content;
      if (tokens.length > 0) {
        appendToken(tokens, newlineKind, offset, offset);
      }
      lineStart = false;
      continue;
    }

    const code = source.charCodeAt(offset);
    if (code === 32 || code === 9) {
      if (code === 32) {
        const end = runEnd(source, offset, 32);
        const next = source.charCodeAt(end);
        if (end - offset >= 2 && (next === 10 || next === 13)) {
          appendToken(tokens, hardBreakKind, offset, end);
          offset = end;
          continue;
        }
        if (end > offset + 1) {
          offset = end;
          continue;
        }
      }
      offset++;
      continue;
    }
    if (code === 10 || code === 13) {
      offset++;
      if (code === 13 && source.charCodeAt(offset) === 10) {
        offset++;
      }
      lineStart = true;
      continue;
    }

    let end = -1;
    let kind = delimiterKind;
    if (code === 60) {
      end = matchEnd(htmlComment, source, offset);
      kind = htmlCommentKind;
      if (end < 0) {
        end = matchEnd(autolink, source, offset);
        kind = autolinkKind;
      }
      if (end < 0) {
        end = matchEnd(inlineHtml, source, offset);
        kind = inlineHtmlKind;
      }
    }
    else if (code === 38) {
      end = matchEnd(entity, source, offset);
      kind = entityKind;
    }
    else if (code === 92) {
      const next = source.charCodeAt(offset + 1);
      if (next === 10 || next === 13) {
        end = offset + 1;
        kind = hardBreakKind;
      }
      else if (isAsciiPunctuation(next)) {
        end = offset + 2;
        kind = escapeKind;
      }
      else if (next === 32 || next === 9) {
        end = textEnd(source, offset);
        kind = textKind;
      }
    }
    else if (code === 96) {
      end = codeSpanEnd(source, offset);
      kind = codeSpanKind;
    }
    else if (code === 42 || code === 95 || code === 126) {
      end = runEnd(source, offset, code);
      kind = code === 42 ? asteriskRunKind : code === 95 ? underscoreRunKind : tildeRunKind;
    }
    else if (code === 33 && source.charCodeAt(offset + 1) === 91) {
      end = offset + 2;
      kind = imageOpenKind;
    }
    else if (code === 91) {
      end = offset + 1;
      kind = bracketOpenKind;
    }
    else if (code === 93) {
      end = linkTailEnd(source, offset);
      kind = linkTailKind;
      if (end < 0) {
        end = referenceTailEnd(source, offset);
        kind = referenceTailKind;
      }
      if (end < 0) {
        end = offset + 1;
        kind = shortcutReferenceTailKind;
      }
    }
    else {
      end = textEnd(source, offset);
      kind = textKind;
    }

    if (end <= offset) {
      end = offset + 1;
      kind = delimiterKind;
    }
    appendToken(tokens, kind, offset, end);
    offset = end;
  }
  return tokens;
}
