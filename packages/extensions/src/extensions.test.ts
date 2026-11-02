import { stripVTControlCharacters } from "node:util";

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";
import { version } from "./version.ts";

const stripAnsi = stripVTControlCharacters;

describe("built-in extensions", () => {
	it("lets official help coexist with a user Extension named help", async () => {
		let userHelpRan = false;
		const app = new Crust("app")
			.extend(defineExtension(defineExtensionId("help")).preRun(() => void (userHelpRan = true)))
			.extend(help());

		const { stdout } = await captureExecute(app, []);

		expect(userHelpRan).toBe(true);
		expect(stripAnsi(stdout)).toContain("Usage:");
	});

	it.each([
		["help first", () => [help(), version()] as const],
		["version first", () => [version(), help()] as const],
	])("lets --version run on a root without an action (%s)", async (_, extensions) => {
		const app = new Crust("app", { version: "1.2.3" })
			.extend(...extensions())
			.command("build", (command) => command.action(() => {}));

		expect((await captureExecute(app, ["--version"])).stdout).toBe("app v1.2.3");
		expect(stripAnsi((await captureExecute(app, ["--help"])).stdout)).toContain("Usage:");
		expect(stripAnsi((await captureExecute(app, [])).stdout)).toContain("Usage:");
	});
});
