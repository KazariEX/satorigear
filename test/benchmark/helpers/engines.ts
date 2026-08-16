import { remark } from "remark";
import { createParser } from "satorigear";
import { markdownToMdast } from "satteri";

export interface Engine {
  name: string;
  parse: (source: string) => unknown;
}

function selectEngines(engines: readonly Engine[]): readonly Engine[] {
  const selected = process.env.BENCHMARK_ENGINE;
  return selected === void 0
    ? engines
    : engines.filter((engine) => engine.name === selected);
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
  return selectEngines([
    { name: "satorigear", parse: satorigear.parse },
    { name: "satteri", parse: (source) => markdownToMdast(source, satteriOptions) },
    { name: "remark", parse: remarkProcessor.parse.bind(remarkProcessor) },
  ]);
}

export function createFeatureEngines(): readonly Engine[] {
  const satorigear = createParser({
    features: {
      footnote: true,
      frontmatter: true,
      math: true,
      strikethrough: true,
      table: true,
      taskList: true,
    },
  });
  const satteriOptions = {
    features: {
      frontmatter: true,
      gfm: true,
      math: true,
    },
  } as const;
  return selectEngines([
    { name: "satorigear", parse: satorigear.parse },
    { name: "satteri", parse: (source) => markdownToMdast(source, satteriOptions) },
  ]);
}
