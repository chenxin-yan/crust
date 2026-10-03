import { describe, expect, it } from "vite-plus/test";

import { INSTALLED_COMMAND_NAME_RULE, isInstalledCommandName } from "./installed-command-name.ts";

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

	it("allows exactly the punctuation INSTALLED_COMMAND_NAME_RULE names, never first", () => {
		for (const char of [".", "_", "-", "~", "+", "@", ":"]) {
			expect(isInstalledCommandName(`a${char}b`)).toBe(
				INSTALLED_COMMAND_NAME_RULE.includes(`"${char}"`),
			);
			expect(isInstalledCommandName(`${char}a`)).toBe(false);
		}
		expect(INSTALLED_COMMAND_NAME_RULE).toContain("starting with a letter or digit");
	});
});
