import { defineConfig } from "tsdown";

import base from "../../tsdown.config.ts";

export default defineConfig({
	...base,
	// bin-only package has no type entry points for attw to validate
	attw: false,
	// bin-only package, no types published; auto-detect wrongly enables dts here
	dts: false,
	minify: true,
});
