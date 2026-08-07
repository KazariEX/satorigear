import { Buffer } from "node:buffer";
import { bench, do_not_optimize, run, summary } from "mitata";
import { createDocument, parse, type TextEdit } from "satorigear";
import { force } from "./force.ts";

const body = Array.from({ length: 200 }, (_, index) => [
  `## Section ${index}`,
  "",
  `Paragraph ${index} with *emphasis*, [reference][target], and \`code\`.`,
  "",
  `- item ${index}.1`,
  `- item ${index}.2`,
  "",
].join("\n")).join("\n");
const base = `${body}\n[target]: /url\n`;

function editBetween(source: string, next: string): TextEdit {
  const common = Math.min(source.length, next.length);
  let start = 0;
  while (start < common && source[start] === next[start]) {
    start++;
  }
  let suffix = 0;
  while (suffix < common - start && source[source.length - 1 - suffix] === next[next.length - 1 - suffix]) {
    suffix++;
  }
  return { start, end: source.length - suffix, text: next.slice(start, next.length - suffix) };
}

const paragraphOffset = base.indexOf("Paragraph 100") + "Paragraph ".length;
const fenceSource = `${body}\n\`\`\`\ncode\n\`\`\`\ntrailing\n`;
const longInlineSource = `${"plain text ".repeat(1_000)}tail\n`;
const longInlineOffset = longInlineSource.length - "tail\n".length;
const scenarios = [
  {
    name: "single paragraph character",
    first: base,
    second: `${base.slice(0, paragraphOffset)}X${base.slice(paragraphOffset + 1)}`,
  },
  { name: "document-start newline", first: base, second: `\n${base}` },
  { name: "fence closer to EOF", first: fenceSource, second: fenceSource.replace("```\ntrailing", "``x\ntrailing") },
  { name: "definition availability", first: body, second: `${body}\n[target]: /url\n` },
  { name: "list indentation", first: base, second: base.replace("- item 100.2", "    - item 100.2") },
  {
    name: "long inline tail",
    first: longInlineSource,
    second: `${longInlineSource.slice(0, longInlineOffset)}sail\n`,
  },
];

summary(() => {
  const bytes = Buffer.byteLength(base);
  const document = createDocument(base);
  document.snapshot();

  bench(`snapshot creation (${bytes} bytes)`, () => {
    do_not_optimize(document.snapshot());
  });
  bench(`snapshot fully read (${bytes} bytes)`, () => {
    const tree = document.snapshot();
    force(tree);
    do_not_optimize(tree);
  });
  bench(`fresh snapshot (${bytes} bytes)`, () => {
    do_not_optimize(parse(base));
  });
  bench(`fresh fully read (${bytes} bytes)`, () => {
    const tree = parse(base);
    force(tree);
    do_not_optimize(tree);
  });
});

for (const scenario of scenarios) {
  summary(() => {
    const bytes = Math.max(Buffer.byteLength(scenario.first), Buffer.byteLength(scenario.second));
    let editSource = scenario.first;
    const editDocument = createDocument(editSource);
    let snapshotSource = scenario.first;
    const snapshotDocument = createDocument(snapshotSource);
    let forcedSource = scenario.first;
    const forcedDocument = createDocument(forcedSource);
    let freshSnapshotSource = scenario.first;
    let freshForcedSource = scenario.first;

    bench(`edit only (${scenario.name}, ${bytes} bytes)`, () => {
      const next = editSource === scenario.first ? scenario.second : scenario.first;
      do_not_optimize(editDocument.edit([editBetween(editSource, next)]));
      editSource = next;
    });
    bench(`edit and snapshot (${scenario.name}, ${bytes} bytes)`, () => {
      const next = snapshotSource === scenario.first ? scenario.second : scenario.first;
      snapshotDocument.edit([editBetween(snapshotSource, next)]);
      snapshotSource = next;
      do_not_optimize(snapshotDocument.snapshot());
    });
    bench(`edit and fully read (${scenario.name}, ${bytes} bytes)`, () => {
      const next = forcedSource === scenario.first ? scenario.second : scenario.first;
      forcedDocument.edit([editBetween(forcedSource, next)]);
      forcedSource = next;
      const tree = forcedDocument.snapshot();
      force(tree);
      do_not_optimize(tree);
    });
    bench(`fresh snapshot (${scenario.name}, ${bytes} bytes)`, () => {
      freshSnapshotSource = freshSnapshotSource === scenario.first ? scenario.second : scenario.first;
      do_not_optimize(parse(freshSnapshotSource));
    });
    bench(`fresh fully read (${scenario.name}, ${bytes} bytes)`, () => {
      freshForcedSource = freshForcedSource === scenario.first ? scenario.second : scenario.first;
      const tree = parse(freshForcedSource);
      force(tree);
      do_not_optimize(tree);
    });
  });
}

await run();
