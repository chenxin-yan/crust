import { setTimeout } from "node:timers/promises";

import { Crust, CrustError, defineCommand } from "@crustjs/core";
import { commandInputSchema } from "@crustjs/core/tooling";
import { withTerminalIO } from "@crustjs/prompts";
import { createPromptIO, type Key } from "@crustjs/prompts/testing";
import { captureExecute } from "@crustjs/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ConfirmationRequiredError, confirm } from "./confirm.ts";
import { help } from "./help.ts";
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
	// The prompt shows only outside CI; the runner may be a CI job.
	beforeEach(() => vi.stubEnv("CI", undefined));
	afterEach(() => vi.unstubAllEnvs());

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

	it("fails with ConfirmationRequiredError on a terminal under CI", async () => {
		vi.stubEnv("CI", "true");
		const harness = createPromptIO();
		expect(await withTerminalIO(harness.io, () => captureExecute(app, ["drop"]))).toEqual({
			stdout: "",
			stderr: "Error: Confirmation required: Drop the database? Pass --yes to confirm.",
			exitCode: 1,
		});
		expect(harness.screen()).toBe("");
	});

	it.each(["", "0", "FALSE"])("prompts on a terminal when CI=%j", async (ci) => {
		vi.stubEnv("CI", ci);
		const { screen: _screen, ...result } = await answer("y", "enter");
		expect(result).toEqual({ stdout: "dropped", stderr: "", exitCode: 0 });
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

	it("offers --yes only on commands that use confirm", async () => {
		const list = defineCommand("list", (cmd) => cmd.action(({ stdout }) => stdout("listed")));
		const scoped = new Crust("app").extend(confirm(), input(), help()).add(drop, list);

		expect((await captureExecute(scoped, ["drop", "--help"])).stdout).toContain("--yes");
		expect((await captureExecute(scoped, ["list", "--help"])).stdout).not.toContain("--yes");
		const snapshot = await scoped.snapshot();
		const inputKeys = (path: "drop" | "list") =>
			Object.keys(commandInputSchema(snapshot.subCommands[path]!, [path]).properties);
		expect(inputKeys("drop")).toContain("yes");
		expect(inputKeys("list")).not.toContain("yes");
		expect(await captureExecute(scoped, ["list", "--input", '{"yes":true}'])).toEqual({
			stdout: "",
			stderr: 'Error: Unknown flag "--yes"',
			exitCode: 1,
		});
		expect(await captureExecute(scoped, ["list", "--yes"])).toEqual({
			stdout: "",
			stderr: 'Error: Unknown flag "--yes"',
			exitCode: 1,
		});
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
