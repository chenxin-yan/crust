import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it } from "vite-plus/test";

// A bundler hoists a module's static imports to the top of the bundle, even when the module
// itself is loaded with import(): a CLI command that never opens a store must not load the
// store's Node built-ins. The store gets them with process.getBuiltinModule when it runs.
it("the built store imports no Node built-in when it loads", () => {
	const built = readFileSync(resolve(import.meta.dirname, "../dist/index.js"), "utf8");
	expect(built.match(/^import\b.*\bfrom\s+"node:[^"]+";?$/gmu) ?? []).toEqual([]);
});
