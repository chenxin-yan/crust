import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/testing.ts"],
	format: ["esm"],
	target: "bun",
	dts: true,
	minify: false,
});
