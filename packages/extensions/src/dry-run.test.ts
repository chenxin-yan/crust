import { Crust, defineCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { DryRunUnsupportedError, dryRun, dryRunContext } from "./dry-run.ts";
import { help } from "./help.ts";
import { input } from "./input.ts";

function appWithDeploy() {
	return new Crust("app")
		.extend(dryRun())
		.add(
			defineCommand("deploy", (cmd) =>
				cmd
					.use(dryRunContext)
					.action(async ({ ctx, stdout }) =>
						stdout((await ctx.dryRun) ? "would deploy" : "deployed"),
					),
			),
		)
		.command("rm", (cmd) => cmd.action(({ stdout }) => stdout("removed")));
}

describe("dryRun", () => {
	it("gives a command that uses the Context true with --dry-run", async () => {
		expect(await captureExecute(appWithDeploy(), ["deploy", "--dry-run"])).toEqual({
			stdout: "would deploy",
			stderr: "",
			exitCode: 0,
		});
	});

	it("gives a command that uses the Context false without --dry-run", async () => {
		expect(await captureExecute(appWithDeploy(), ["deploy"])).toEqual({
			stdout: "deployed",
			stderr: "",
			exitCode: 0,
		});
	});

	it("fails a command that does not use the Context with --dry-run, naming it, before its action", async () => {
		expect(await captureExecute(appWithDeploy(), ["rm", "--dry-run"])).toEqual({
			stdout: "",
			stderr: 'Error: "app rm" does not support --dry-run.',
			exitCode: 1,
		});
	});

	it("throws DryRunUnsupportedError under run()", async () => {
		const outcome = await appWithDeploy().run(["rm"], { flags: { "dry-run": true } });

		expect(outcome.status === "failed" && outcome.error).toBeInstanceOf(DryRunUnsupportedError);
		expect(outcome.stdout).toBe("");
	});

	it("runs commands that do not use the Context without --dry-run", async () => {
		expect(await captureExecute(appWithDeploy(), ["rm"])).toEqual({
			stdout: "removed",
			stderr: "",
			exitCode: 0,
		});
	});

	it("checks the routed command only: a parent's .use() does not opt in its children", async () => {
		const app = new Crust("app")
			.extend(dryRun())
			.command("db", (cmd) =>
				cmd.use(dryRunContext).command("drop", (child) => child.action(() => {})),
			);

		const outcome = await app.run(["db", "drop"], { flags: { "dry-run": true } });

		expect(outcome.status === "failed" && outcome.error).toBeInstanceOf(DryRunUnsupportedError);
	});

	it("leaves --help to its handler", async () => {
		const { exitCode, stdout } = await captureExecute(appWithDeploy().extend(help()), [
			"rm",
			"--dry-run",
			"--help",
		]);

		expect(exitCode).toBe(0);
		expect(stdout).toContain("--dry-run");
	});

	it.each([
		["input first", () => [input(), dryRun()] as const],
		["dryRun first", () => [dryRun(), input()] as const],
	])("rejects --dry-run given in an --input payload (%s)", async (_order, extensions) => {
		const app = new Crust("app")
			.extend(...extensions())
			.command("rm", (cmd) => cmd.action(({ stdout }) => stdout("removed")));

		expect(await captureExecute(app, ["rm", "--input", '{"dry-run":true}'])).toEqual({
			stdout: "",
			stderr: 'Error: "app rm" does not support --dry-run.',
			exitCode: 1,
		});
		const outcome = await app.run(["rm"], { flags: { input: '{"dry-run":true}' } });
		expect(outcome).toMatchObject({ status: "failed", stdout: "" });
		expect(outcome.status === "failed" && outcome.error).toBeInstanceOf(DryRunUnsupportedError);
	});
});
