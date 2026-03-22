import tseslint from "typescript-eslint";

const eslintConfig = tseslint.config(
  {
    files: ["src/**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
  {
    files: ["src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  {
    ignores: ["dist/**"],
  }
);

export default eslintConfig;
