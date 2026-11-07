import { Crust } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { ConfirmationRequiredError, confirmation } from "./confirmation.ts";
import { input } from "./input.ts";

describe("confirmation", () => {
	it("accepts a recursive --yes flag", async () => {
		const app = new Crust("app")
			.extend(confirmation())
			.command("rm", (cmd) => cmd.action(({ stdout }) => stdout("removed")));

		expect(await captureExecute(app, ["rm", "--yes"])).toEqual({
			stdout: "removed",
			stderr: "",
			exitCode: 0,
		});
	});

	it.each([
		["confirmation first", () => [confirmation(), input()] as const],
		["input first", () => [input(), confirmation()] as const],
	])("accepts yes from --input (%s)", async (_order, extensions) => {
		const app = new Crust("app")
			.extend(...extensions())
			.command("rm", (cmd) => cmd.action(({ stdout }) => stdout("removed")));

		expect(await captureExecute(app, ["rm", "--input", '{"yes":true}'])).toEqual({
			stdout: "removed",
			stderr: "",
			exitCode: 0,
		});
	});

	it("names the command and --yes in ConfirmationRequiredError", () => {
		expect(new ConfirmationRequiredError("app rm").message).toBe(
			'"app rm" needs confirmation; pass --yes to run it.',
		);
	});
});
