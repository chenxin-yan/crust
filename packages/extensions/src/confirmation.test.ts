import { Crust, defineCommand } from "@crustjs/core";
import { withTerminalIO } from "@crustjs/prompts";
import { createPromptIO } from "@crustjs/prompts/testing";
import { captureExecute } from "@crustjs/testing";
import { runInteractive } from "@crustjs/testing/interactive";
import { describe, expect, it } from "vite-plus/test";

import { ConfirmationRequiredError, confirmation } from "./confirmation.ts";

function appWithRm() {
	return new Crust("app")
		.extend(confirmation())
		.add(
			defineCommand("rm", { destructive: true }, (cmd) =>
				cmd.action(({ stdout }) => stdout("removed")),
			),
		)
		.command("ls", (cmd) => cmd.action(({ stdout }) => stdout("listed")));
}

function nonInteractive<T>(run: () => Promise<T>): Promise<T> {
	return withTerminalIO(createPromptIO({ isTTY: false }).io, run);
}

describe("confirmation", () => {
	it("fails a destructive command without a TTY, naming the command and --yes", async () => {
		expect(await nonInteractive(() => captureExecute(appWithRm(), ["rm"]))).toEqual({
			stdout: "",
			stderr: 'Error: "app rm" is destructive and needs confirmation; pass --yes to run it.',
			exitCode: 1,
		});
	});

	it("throws ConfirmationRequiredError under run() without a TTY", async () => {
		const outcome = await nonInteractive(() => appWithRm().run(["rm"]));

		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") return;
		expect(outcome.error).toBeInstanceOf(ConfirmationRequiredError);
		expect(outcome.stdout).toBe("");
	});

	it("fails when stdin is a TTY but stderr is not", async () => {
		const { input } = createPromptIO().io;
		const { output } = createPromptIO({ isTTY: false }).io;

		const outcome = await withTerminalIO({ input, output }, () => appWithRm().run(["rm"]));

		expect(outcome.status === "failed" && outcome.error).toBeInstanceOf(ConfirmationRequiredError);
	});

	it("runs a destructive command with --yes without prompting", async () => {
		expect(await nonInteractive(() => captureExecute(appWithRm(), ["rm", "--yes"]))).toEqual({
			stdout: "removed",
			stderr: "",
			exitCode: 0,
		});
	});

	it("runs commands not marked destructive without --yes", async () => {
		expect(await nonInteractive(() => captureExecute(appWithRm(), ["ls"]))).toEqual({
			stdout: "listed",
			stderr: "",
			exitCode: 0,
		});
	});

	it("runs a destructive command the user confirms on a TTY", async () => {
		const run = runInteractive(appWithRm(), ["rm"]);
		await run.waitFor(/Run destructive command "app rm"\?/);
		run.keys("y", "return");
		await run.done;

		expect(run.stdout()).toBe("removed");
	});

	it("defaults the prompt to no and fails when the user declines", async () => {
		const run = runInteractive(appWithRm(), ["rm"]);
		await run.waitFor(/Run destructive command "app rm"\?/);
		run.keys("return");

		await expect(run.done).rejects.toThrow('"app rm" was not confirmed; nothing was changed.');
		await expect(run.done).rejects.not.toBeInstanceOf(ConfirmationRequiredError);
		expect(run.stdout()).toBe("");
	});

	it("checks the root command's own destructive marker", async () => {
		const app = new Crust("app", { destructive: true })
			.extend(confirmation())
			.action(({ stdout }) => stdout("wiped"));

		expect(await nonInteractive(() => captureExecute(app, []))).toMatchObject({
			stdout: "",
			exitCode: 1,
		});
		expect(await nonInteractive(() => captureExecute(app, ["--yes"]))).toMatchObject({
			stdout: "wiped",
			exitCode: 0,
		});
	});
});
