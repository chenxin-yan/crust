import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/schema/index.ts"],
	format: ["esm"],
	target: "bun",
	dts: true,
	minify: true,
});
