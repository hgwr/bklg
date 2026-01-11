const tseslint = require("typescript-eslint");
const prettier = require("eslint-config-prettier");

module.exports = [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  ...tseslint.configs.recommended,
  prettier,
];
