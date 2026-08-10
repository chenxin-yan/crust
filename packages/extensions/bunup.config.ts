import { defineConfig } from "bunup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/completion/index.ts",
		"src/did-you-mean.ts",
		"src/help.ts",
		"src/no-color.ts",
		"src/update-notifier.ts",
		"src/version.ts",
	],
	format: ["esm"],
	target: "bun",
	dts: true,
	minify: false,
});
