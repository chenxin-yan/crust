import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	// type:module makes ESM output .js/.d.ts, matching the exports map
	fixedExtension: false,
	// bin-only package, no types published; auto-detect wrongly enables dts here
	dts: false,
	minify: true,
});
