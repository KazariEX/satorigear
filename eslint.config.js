import zin from "@zinkawaii/eslint-config";

export default zin(
  {
    javascript: {
      overrides: {
        curly: ["warn", "all"],
        "no-new-func": "off",
      },
    },
    typescript: {
      overrides: {
        "ts/explicit-function-return-type": ["warn", {
          allowExpressions: true,
        }],
        "ts/prefer-literal-enum-member": "off",
      },
    },
  },
);
