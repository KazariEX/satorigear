declare module "commonmark-spec" {
  export interface CommonMarkSpecCase {
    markdown: string;
    html: string;
    section: string;
    number: number;
  }

  export const tests: CommonMarkSpecCase[];
}
