import { defineConfig } from "tsdown";

import base from "../../tsdown.config.ts";

export default defineConfig({
	...base,
	entry: ["src/index.ts", "src/testing.ts"],
});
