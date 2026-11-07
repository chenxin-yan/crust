import { Crust, defineCommand, defineContext } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";
import { type NextStepsOptions, nextSteps, nextStepsContext } from "./next-steps.ts";

class NotLoggedInError extends Error {}

function appWith(options?: NextStepsOptions) {
	return new Crust("app")
		.extend(nextSteps(options))
		.add(
			defineCommand("deploy", (cmd) =>
				cmd
					.use(nextStepsContext)
					.args({ name: "env", type: "string", required: true })
					.flags({ fail: { type: "boolean" } })
					.action(async ({ args, flags, ctx }) => {
						const next = await ctx.next;
						next.add(["status"], { args: { env: args.env } }, "Check the deployment");
						next.add(["logs"]);
						if (flags.fail) throw new NotLoggedInError("not logged in");
						return { env: args.env };
					}),
			),
		)
		.command("status", (cmd) => cmd.args({ name: "env", type: "string" }).action(() => {}))
		.command("logs", (cmd) => cmd.action(() => {}))
		.command("login", (cmd) =>
			cmd.flags({ sso: { type: "boolean" } }).action(({ stdout }) => stdout("logged in")),
		);
}

const recovery: NextStepsOptions = {
	onError: (error) =>
		error instanceof NotLoggedInError
			? [{ command: ["login"], input: { flags: { sso: true } }, description: "Log in" }]
			: undefined,
};

describe("nextSteps", () => {
	it("prints the steps the action added on stderr after it completes", async () => {
		expect(await captureExecute(appWith(), ["deploy", "prod"])).toEqual({
			stdout: "",
			stderr: "Next steps:\n  Check the deployment:\n    app status prod\n  app logs",
			exitCode: 0,
		});
	});

	it("prints nothing when no step was added", async () => {
		expect(await captureExecute(appWith(), ["login"])).toEqual({
			stdout: "logged in",
			stderr: "",
			exitCode: 0,
		});
	});

	it("prints onError steps first, then the action's, after the default error line", async () => {
		expect(await captureExecute(appWith(recovery), ["deploy", "prod", "--fail"])).toEqual({
			stdout: "",
			stderr:
				"Error: not logged in\nNext steps:\n  Log in:\n    app login --sso\n  Check the deployment:\n    app status prod\n  app logs",
			exitCode: 1,
		});
	});

	it("prints only the action's steps when onError returns undefined", async () => {
		const { stderr } = await captureExecute(appWith({ onError: () => undefined }), [
			"deploy",
			"prod",
			"--fail",
		]);

		expect(stderr).toBe(
			"Error: not logged in\nNext steps:\n  Check the deployment:\n    app status prod\n  app logs",
		);
	});

	it("passes onError the thrown object and suggests steps after a validation failure", async () => {
		const seen: unknown[] = [];
		const app = appWith({
			onError: (error) => {
				seen.push(error);
				return [{ command: ["deploy"], input: { args: { env: "staging" } } }];
			},
		});

		const { stderr, exitCode } = await captureExecute(app, ["deploy"]);

		expect(exitCode).toBe(1);
		expect(stderr).toMatch(/^Error: .*\nNext steps:\n {2}app deploy staging$/);
		expect(seen).toHaveLength(1);
	});

	it("suggests steps after a Context setup failure", async () => {
		const broken = defineContext("broken").setup((): string => {
			throw new Error("setup failed");
		});
		const app = new Crust("app")
			.provide(broken())
			.extend(nextSteps({ onError: () => [{ command: ["doctor"] }] }))
			.command("doctor", (cmd) => cmd.action(() => {}))
			.command("run", (cmd) => cmd.use(broken).action(async ({ ctx }) => void (await ctx.broken)));

		expect(await captureExecute(app, ["run"])).toEqual({
			stdout: "",
			stderr: "Error: setup failed\nNext steps:\n  app doctor",
			exitCode: 1,
		});
	});

	it("captures the block in run()'s stderr", async () => {
		const outcome = await appWith().run(["deploy"], { args: { env: "prod" } });

		expect(outcome).toMatchObject({
			status: "completed",
			stderr: "Next steps:\n  Check the deployment:\n    app status prod\n  app logs",
		});
	});

	it("prints nothing when a flag handler takes over", async () => {
		const { stderr, exitCode } = await captureExecute(appWith().extend(help()), [
			"deploy",
			"--help",
		]);

		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
	});

	it("renders flags, booleans, repeated values, positionals, and raw tokens as a quoted command line", async () => {
		const app = new Crust("app")
			.extend(nextSteps())
			.command("copy", (cmd) =>
				cmd
					.args(
						{ name: "from", type: "string", required: true },
						{ name: "to", type: "string", variadic: true },
					)
					.flags({
						message: { type: "string" },
						count: { type: "number" },
						tag: { type: "string", multiple: true },
						force: { type: "boolean" },
						cache: { type: "boolean" },
						quiet: { type: "boolean", noNegate: true },
						meta: { type: "json" },
						offset: { type: "number" },
						url: { type: "url" },
					})
					.action(() => {}),
			)
			.command("exec", (cmd) => cmd.action(() => {}))
			.command("seek", (cmd) => cmd.args({ name: "at", type: "number" }).action(() => {}))
			.command("suggest", (cmd) =>
				cmd.use(nextStepsContext).action(async ({ ctx }) => {
					const next = await ctx.next;
					next.add(["copy"], {
						args: { from: "a b.txt", to: ["it's", "c"] },
						flags: {
							message: "hello world",
							count: 3,
							tag: ["x", "y"],
							force: true,
							cache: false,
							quiet: false,
							meta: { a: 1 },
							offset: -5,
							url: new URL("https://example.com/a?b=1"),
						},
					});
					next.add(["exec"], { raw: ["--watch", "src"] });
					next.add(["seek"], { args: { at: -5 } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);

		expect(stderr).toBe(
			[
				"Next steps:",
				`  app copy --message 'hello world' --count 3 --tag x --tag y --force --no-cache --meta '{"a":1}' --offset=-5 --url 'https://example.com/a?b=1' 'a b.txt' 'it'\\''s' c`,
				"  app exec -- --watch src",
				"  app seek -- -5",
			].join("\n"),
		);
	});

	it("skips an invalid step with a note on stderr and never fails the invocation", async () => {
		const app = new Crust("app")
			.extend(nextSteps())
			.command("status", (cmd) =>
				cmd
					.args({ name: "env", type: "string" }, { name: "region", type: "string" })
					.action(() => {}),
			)
			.command("suggest", (cmd) =>
				cmd.use(nextStepsContext).action(async ({ ctx }) => {
					const next = await ctx.next;
					next.add(["nope"]);
					next.add(["status"], { flags: { verbose: true } });
					next.add(["status"], { args: { region: "eu" } });
					next.add(["status"], { args: { stage: "eu" } });
					next.add(["status"], { args: { env: "prod" } }, "Check prod");
				}),
			);

		expect(await captureExecute(app, ["suggest"])).toEqual({
			stdout: "",
			stderr: [
				'nextSteps(): skipped "app nope": unknown command',
				'nextSteps(): skipped "app status": unknown flag "--verbose"',
				'nextSteps(): skipped "app status": argument "region" follows omitted "env"',
				'nextSteps(): skipped "app status": unknown argument "stage"',
				"Next steps:",
				"  Check prod:",
				"    app status prod",
			].join("\n"),
			exitCode: 0,
		});
	});

	it("reports a throwing onError on stderr and still prints the action's steps", async () => {
		const app = appWith({
			onError: () => {
				throw new Error("boom");
			},
		});

		expect(await captureExecute(app, ["deploy", "prod", "--fail"])).toEqual({
			stdout: "",
			stderr:
				"Error: not logged in\nnextSteps(): onError: boom\nNext steps:\n  Check the deployment:\n    app status prod\n  app logs",
			exitCode: 1,
		});
	});
});
