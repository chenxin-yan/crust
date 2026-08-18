import { defineConfig } from "tsdown";

// Shared build config: packages without their own tsdown.config.ts resolve
// this one (tsdown searches upward), with entry defaulting to src/index.ts.
// Packages that diverge (core, prompts, create-crust) import and extend it.
export default defineConfig({
	// type:module makes ESM output .js/.d.ts, matching the exports maps
	fixedExtension: false,
	publint: "ci-only",
});
