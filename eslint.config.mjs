import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals, ...nextTypescript,
  globalIgnores([".next/**", "out/**", "frontend/**", ".qa/**", ".venv/**", "examples/**", "zorax-form-filler/**", "next-env.d.ts"]),
]);
