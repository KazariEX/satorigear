import zin from "@zinkawaii/eslint-config";

export default zin({
  ignores: [
    "vendors/**",
  ],
  rules: {
    curly: ["warn", "all"],
  },
});
