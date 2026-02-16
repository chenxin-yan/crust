import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/plugins.ts"],
	format: ["esm"],
	target: "bun",
	dts: true,
});
