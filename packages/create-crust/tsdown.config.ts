import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	platform: "node",
	outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
	dts: false,
	minify: true,
});
