import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/cli.ts"],
	format: ["esm"],
	target: "bun",
	dts: false,
	minify: true,
});
