import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/primitive.ts", "src/source.ts", "src/schema/index.ts"],
	format: ["esm"],
	target: "bun",
	dts: true,
	minify: false,
});
