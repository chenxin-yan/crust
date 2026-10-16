import { stripVTControlCharacters } from "node:util";

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";

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
});
