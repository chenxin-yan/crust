import { defineConfig } from "bunup";

export default defineConfig({
	entry: ["src/index.ts", "src/effect/index.ts", "src/zod/index.ts"],
	format: ["esm"],
	target: "bun",
	dts: true,
});
