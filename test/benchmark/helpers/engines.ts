import { remark } from "remark";
import { createParser } from "satorigear";
import { markdownToMdast } from "satteri";

export interface Engine {
  name: string;
  parse: (source: string) => unknown;
}

export function createCommonmarkEngines(): readonly Engine[] {
  const satorigear = createParser();
  const remarkProcessor = remark();
  const satteriOptions = {
    features: {
      frontmatter: false,
      gfm: false,
    },
  } as const;
  return [
    { name: "satorigear", parse: satorigear.parse },
    { name: "satteri", parse: (source) => markdownToMdast(source, satteriOptions) },
    { name: "remark", parse: remarkProcessor.parse.bind(remarkProcessor) },
  ];
}

export function createFeatureEngines(): readonly Engine[] {
  const satorigear = createParser({
    footnote: true,
    frontmatter: true,
    math: true,
    strikethrough: true,
    table: true,
  });
  const satteriOptions = {
    features: {
      frontmatter: true,
      gfm: true,
      math: true,
    },
  } as const;
  return [
    { name: "satorigear", parse: satorigear.parse },
    { name: "satteri", parse: (source) => markdownToMdast(source, satteriOptions) },
  ];
}
