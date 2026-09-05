import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["node_modules/**", "package-lock.json"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        process: "readonly",
      },
    },
  },
);
