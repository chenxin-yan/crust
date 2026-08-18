import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/tooling.ts"],
	// type:module makes ESM output .js/.d.ts, matching the exports map
	fixedExtension: false,
	publint: "ci-only",
});
