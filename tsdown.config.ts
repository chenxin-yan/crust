import { defineConfig } from "tsdown";

export default defineConfig({
	fixedExtension: false,
	publint: "ci-only",
	attw: {
		enabled: "ci-only",
		profile: "esm-only",
		level: "error",
	},
});
