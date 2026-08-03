import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/tooling.ts"],
	format: ["esm"],
	target: "bun",
	dts: { splitting: true },
	minify: false,
});
