import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/internal.ts", "src/tooling.ts"],
	format: ["esm"],
	target: "bun",
	dts: true,
	minify: true,
});
