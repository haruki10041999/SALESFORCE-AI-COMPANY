import js from "@eslint/js";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import requestContextRules from "./eslint-rules/require-request-context.js";

export default [
  {
    ignores: ["dist/**", "outputs/**", "node_modules/**", "coverage/**"]
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,js,mjs,cjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        sourceType: "module",
        ecmaVersion: "latest"
      },
      globals: {
        ...globals.node,
        ...globals.es2021
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "request-context": requestContextRules
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "no-console": "off",
      "no-undef": "off",
      "no-control-regex": "off",
      "no-useless-escape": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_"
        }
      ],
      "request-context/require-request-context": "warn"
    }
  }
];
