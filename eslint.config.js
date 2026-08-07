import zin from "@zinkawaii/eslint-config";

export default zin({
  ignores: ["vendors/**"],
  // eslint-plugin-perfectionist 5.9 currently crashes under ESLint 10's Markdown processor.
  markdown: false,
});
