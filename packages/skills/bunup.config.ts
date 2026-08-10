import { defineConfig } from "bunup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/agents.ts",
		"src/annotations.ts",
		"src/bundle.ts",
		"src/extension.ts",
		"src/generate.ts",
	],
	format: ["esm"],
	target: "bun",
	dts: true,
	minify: false,
});
