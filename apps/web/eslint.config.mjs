import { readdirSync } from "node:fs";
import { join } from "node:path";

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Job CL (blueprint section 13): NO business-type id appears in application code. A business type is a folder of packages/packs; code asks the registry (lib/packs) and never names one. The ids are read from the
// folders here, so a new pack is covered the day its folder exists. Tests may name a pack (they test one), and so may the pack's own files and the generated bundle.
const packsDir = join(import.meta.dirname, "..", "..", "packages", "packs");
const packIds = readdirSync(packsDir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules").map((e) => e.name);
const noPackIds = packIds.length === 0 ? [] : [{ selector: `Literal[value=/^(${packIds.join("|")})$/]`, message: "Do not name a business type in code (blueprint section 13): ask the registry in lib/packs. A pack is data in packages/packs." }, { selector: `TemplateElement[value.cooked=/^(${packIds.join("|")})$/]`, message: "Do not name a business type in code (blueprint section 13): ask the registry in lib/packs." }];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  { files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "i18n/**/*.{ts,tsx}"], ignores: ["**/*.test.{ts,tsx}", "**/test/**", "**/*-test-kit.{ts,tsx}", "**/*-fixtures.ts", "**/fixtures.ts"], rules: { "no-restricted-syntax": ["error", ...noPackIds] } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
