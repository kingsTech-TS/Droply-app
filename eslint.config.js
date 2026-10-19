// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", ".expo/*", "android/*", "ios/*", "scripts/*.mjs"],
  },
  {
    // The ported website code uses Array<T>; keep it identical to its source.
    rules: { "@typescript-eslint/array-type": "off" },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: { globals: { jest: "readonly", describe: "readonly", it: "readonly", expect: "readonly", beforeEach: "readonly", afterEach: "readonly", beforeAll: "readonly", afterAll: "readonly" } },
  },
]);
