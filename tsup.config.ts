import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/cli/index.ts"],
  format: ["esm", "cjs"],
  target: "node18",
  dts: true,
  clean: true,
  splitting: false,
});
