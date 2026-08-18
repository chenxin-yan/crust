import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/testing.ts"],
	format: ["esm"],
	platform: "node",
	deps: { alwaysBundle: ["@crustjs/utils"] },
	outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
	dts: true,
});
