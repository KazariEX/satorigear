import zin from "@zinkawaii/eslint-config";

export default zin({
  javascript: {
    overrides: {
      curly: ["warn", "all"],
    },
  },
  typescript: {
    overrides: {
      "ts/explicit-function-return-type": ["warn", {
        allowExpressions: true,
      }],
    },
  },
  ignores: [
    "vendors/**",
  ],
});
