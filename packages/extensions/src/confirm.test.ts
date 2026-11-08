import { setTimeout } from "node:timers/promises";

import { Crust, CrustError, defineCommand } from "@crustjs/core";
import { withTerminalIO } from "@crustjs/prompts";
import { createPromptIO, type Key } from "@crustjs/prompts/testing";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { ConfirmationRequiredError, confirm } from "./confirm.ts";
import { input } from "./input.ts";

const drop = defineCommand("drop", (cmd) =>
	cmd.use(confirm).action(async ({ ctx, stdout }) => {
		const ask = await ctx.confirm;
		await ask("Drop the database?");
		stdout("dropped");
	}),
);

const app = new Crust("app").extend(confirm()).add(drop);

/** Runs `app drop` on a fake TTY and presses `keys` once the prompt shows. */
async function answer(...keys: Key[]) {
	const harness = createPromptIO();
	const pending = withTerminalIO(harness.io, () => captureExecute(app, ["drop"]));
	while (!harness.screen().includes("Drop the database?")) await setTimeout(5);
	harness.keys(...keys);
	return { ...(await pending), screen: harness.screen() };
}

describe("confirm", () => {
	it("resolves without asking under --yes", async () => {
		expect(await captureExecute(app, ["drop", "--yes"])).toEqual({
			stdout: "dropped",
			stderr: "",
			exitCode: 0,
		});
	});

	it.each([
		["confirm first", () => [confirm(), input()] as const],
		["input first", () => [input(), confirm()] as const],
	])("takes yes from --input (%s)", async (_order, extensions) => {
		const withInput = new Crust("app").extend(...extensions()).add(drop);

		expect(await captureExecute(withInput, ["drop", "--input", '{"yes":true}'])).toEqual({
			stdout: "dropped",
			stderr: "",
			exitCode: 0,
		});
	});

	it("fails with ConfirmationRequiredError naming --yes without a terminal", async () => {
		expect(await captureExecute(app, ["drop"])).toEqual({
			stdout: "",
			stderr: "Error: Confirmation required: Drop the database? Pass --yes to confirm.",
			exitCode: 1,
		});
		const outcome = await app.run(["drop"]);
		expect(outcome.status === "failed" && outcome.error).toBeInstanceOf(ConfirmationRequiredError);
	});

	it("runs when the prompt is accepted", async () => {
		const { screen, ...result } = await answer("y", "enter");
		expect(result).toEqual({ stdout: "dropped", stderr: "", exitCode: 0 });
		expect(screen).toContain("Drop the database?");
	});

	it("defaults to No and fails without changing anything when declined", async () => {
		const { screen: _screen, ...result } = await answer("enter");
		expect(result).toEqual({
			stdout: "",
			stderr: "Error: Not confirmed: Drop the database? Nothing was changed.",
			exitCode: 1,
		});
	});

	it("treats Ctrl-C at the prompt as cancellation", async () => {
		const { screen: _screen, ...result } = await answer("ctrl+c");
		expect(result).toEqual({ stdout: "", stderr: "", exitCode: 130 });
	});

	it("rejects a command that uses confirm without extending confirm()", async () => {
		// @ts-expect-error -- runtime regression deliberately exercises the preparation check.
		const unextended = new Crust("app").add(drop);
		const error = await unextended.snapshot().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({
			code: "DEFINITION",
			details: { subject: "extension", name: "crust:confirm", reason: "missing-extension" },
		});
	});
});
