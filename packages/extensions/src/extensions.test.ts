import { stripVTControlCharacters } from "node:util";

import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { completion } from "./completion/index.ts";
import { didYouMean } from "./did-you-mean.ts";
import { help } from "./help.ts";
import { noColor } from "./no-color.ts";
import { updateNotifier } from "./update-notifier.ts";
import { version } from "./version.ts";

const stripAnsi = stripVTControlCharacters;

describe("built-in extensions", () => {
	it("exposes reserved identities on official factories", async () => {
		expect(
			[help.id, version.id, completion.id, didYouMean.id, noColor.id, updateNotifier.id].map(
				String,
			),
		).toEqual([
			"crust:help",
			"crust:version",
			"crust:completion",
			"crust:did-you-mean",
			"crust:no-color",
			"crust:update-notifier",
		]);
		expect(help().id).toBe(help.id);
	});

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
