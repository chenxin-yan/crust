import { describe, expect, it } from "vite-plus/test";

import { isInstalledCommandName } from "./installed-command-name.ts";

describe("isInstalledCommandName", () => {
	it.each(["my-cli", "my.cli", "my_cli", "cli2", "2cli", "MyCli", "x"])("accepts %j", (name) => {
		expect(isInstalledCommandName(name)).toBe(true);
	});

	it.each([
		"",
		".",
		"..",
		"_tool",
		"__proto__",
		"-x",
		".hidden",
		"my~cli",
		"~cli",
		"a/b",
		"a\\b",
		"a b",
		'a"b',
		"a\nb",
		"café",
	])("rejects %j", (name) => {
		expect(isInstalledCommandName(name)).toBe(false);
	});
});
