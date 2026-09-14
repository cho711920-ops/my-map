import js from "@eslint/js";

// Legacy browser modules intentionally expose globals across script tags. Keep
// correctness checks everywhere; strict type contracts are migrated separately.
export default [
  { ignores: ["node_modules/**", ".*/**", "outputs/**", "legacy/**", "assets/**"] },
  {
    files: ["js/**/*.js", "cloudflare/**/*.js", "tools/**/*.{js,mjs,cjs}", "edge-automation/**/*.js", "tests/**/*.{mjs,cjs}", "*.{js,mjs}"],
    ...js.configs.recommended,
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-useless-escape": "off"
    }
  },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs" } },
  // These two compatibility layers deliberately replace old global functions
  // with wrappers. Do not change hoisting/initialization during lint adoption.
  { files: ["js/analysis.js", "js/parser.js"], rules: { "no-func-assign": "off" } }
];
