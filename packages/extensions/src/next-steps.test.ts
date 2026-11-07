import { Crust, CrustError, defineCommand, defineContext } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { help } from "./help.ts";
import { type NextStepsOptions, nextSteps } from "./next-steps.ts";

class NotLoggedInError extends Error {}

/** POSIX shell word splitting for the single-quoted lines nextSteps() prints. */
function shellWords(line: string): string[] {
	const words: string[] = [];
	let word: string | undefined;
	for (let i = 0; i < line.length; i++) {
		const char = line[i]!;
		if (char === " ") {
			if (word !== undefined) words.push(word);
			word = undefined;
		} else if (char === "'") {
			const end = line.indexOf("'", i + 1);
			word = (word ?? "") + line.slice(i + 1, end);
			i = end;
		} else if (char === "\\") {
			word = (word ?? "") + line[++i];
		} else {
			word = (word ?? "") + char;
		}
	}
	if (word !== undefined) words.push(word);
	return words;
}

const status = defineCommand("status", (cmd) =>
	cmd.args({ name: "env", type: "string" }).action(() => {}),
);
const logs = defineCommand("logs", (cmd) => cmd.action(() => {}));
const login = defineCommand("login", (cmd) =>
	cmd.flags({ sso: { type: "boolean" } }).action(({ stdout }) => stdout("logged in")),
);
const deploy = defineCommand("deploy", (cmd) =>
	cmd
		.use(nextSteps)
		.args({ name: "env", type: "string", required: true })
		.flags({ fail: { type: "boolean" } })
		.action(async ({ args, flags, ctx }) => {
			const next = await ctx.nextSteps;
			next.add(status, { args: { env: args.env } }, "Check the deployment");
			next.add(logs);
			if (flags.fail) throw new NotLoggedInError("not logged in");
			return { env: args.env };
		}),
);

function appWith(options?: NextStepsOptions) {
	return new Crust("app").extend(nextSteps(options)).add(deploy, status, logs, login);
}

const recovery: NextStepsOptions = {
	onError: (error) =>
		error instanceof NotLoggedInError
			? [{ command: login, input: { flags: { sso: true } }, description: "Log in" }]
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
				return [{ command: deploy, input: { args: { env: "staging" } } }];
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
		const doctor = defineCommand("doctor", (cmd) => cmd.action(() => {}));
		const app = new Crust("app")
			.provide(broken())
			.extend(nextSteps({ onError: () => [{ command: doctor }] }))
			.add(doctor)
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
		const copy = defineCommand("copy", (cmd) =>
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
		);
		const exec = defineCommand("exec", (cmd) => cmd.action(() => {}));
		const seek = defineCommand("seek", (cmd) =>
			cmd.args({ name: "at", type: "number" }).action(() => {}),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(copy, exec, seek)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(copy, {
						args: { from: "a b.txt", to: ["it's", "c"] },
						flags: {
							message: "hello world",
							count: 3,
							tag: ["x", "y"],
							force: true,
							cache: false,
							// @ts-expect-error -- `false` on a noNegate flag has no spelling and is left out.
							quiet: false,
							meta: { a: 1 },
							offset: -5,
							url: new URL("https://example.com/a?b=1"),
						},
					});
					next.add(exec, { raw: ["--watch", "src"] });
					next.add(seek, { args: { at: -5 } });
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

	it("prints the path the application added a nested definition at", async () => {
		const migrate = defineCommand("migrate", (cmd) => cmd.action(() => {}));
		const db = defineCommand("db", { aliases: ["d"] }, (cmd) => cmd.add(migrate));
		const app = new Crust("app")
			.extend(nextSteps())
			.add(db)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => void (await ctx.nextSteps).add(migrate)),
			);

		expect((await captureExecute(app, ["suggest"])).stderr).toBe("Next steps:\n  app db migrate");
	});

	it("skips an invalid step with a note on stderr and never fails the invocation", async () => {
		const unadded = defineCommand("nope", (cmd) => cmd.action(() => {}));
		const status = defineCommand("status", (cmd) =>
			cmd
				.args({ name: "env", type: "string" }, { name: "region", type: "string" })
				.action(() => {}),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(status)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(unadded);
					// @ts-expect-error -- runtime regression for input the types reject.
					next.add(status, { flags: { verbose: true } });
					// @ts-expect-error -- runtime regression for input the types reject.
					next.add(status, { args: { region: "eu" } });
					// @ts-expect-error -- runtime regression for input the types reject.
					next.add(status, { args: { stage: "eu" } });
					next.add(status, { args: { env: "prod" } }, "Check prod");
				}),
			);

		expect(await captureExecute(app, ["suggest"])).toEqual({
			stdout: "",
			stderr: [
				'nextSteps(): skipped "nope": the application does not add this command',
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

	it("skips a step whose command fails to build while searching, with a note", async () => {
		const broken = defineCommand("broken", (): never => {
			throw new Error("recipe failed");
		});
		const unadded = defineCommand("nope", (cmd) => cmd.action(() => {}));
		const app = new Crust("app")
			.extend(nextSteps())
			.add(broken)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(unadded);
					next.add(logs);
				}),
			)
			.add(logs);

		const { stderr, exitCode } = await captureExecute(app, ["suggest"]);
		expect(exitCode).toBe(0);
		expect(stderr).toBe('nextSteps(): skipped "nope": recipe failed\nNext steps:\n  app logs');
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

	it("replays each suggested command line to the input it was built from", async () => {
		const seen: unknown[] = [];
		const remove = defineCommand("delete", { aliases: ["rm"] }, (cmd) =>
			cmd.action(() => void seen.push(["delete"])),
		);
		const group = defineCommand("group", (cmd) =>
			cmd
				.args({ name: "target", type: "string" })
				.action(({ args }) => void seen.push(["group", args]))
				.add(remove),
		);
		const show = defineCommand("show", (cmd) =>
			cmd
				.args({ name: "doc", type: "json" })
				.flags({
					meta: { type: "json" },
					metas: { type: "json", multiple: true },
					tags: { type: "string", multiple: true, delimiter: "," },
				})
				.action(({ args, flags }) => void seen.push(["show", args, flags])),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(group, show)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(group, { args: { target: "delete" } });
					next.add(group, { args: { target: "rm" } });
					next.add(show, {
						args: { doc: "123" },
						flags: { meta: "hello", metas: ["1", "x"], tags: ["a", "b"] },
					});
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const lines = stderr.split("\n").slice(1);
		expect(lines).toEqual([
			"  app group -- delete",
			"  app group -- rm",
			`  app show --meta '"hello"' --metas '"1"' --metas '"x"' --tags a --tags b '"123"'`,
		]);
		for (const line of lines) {
			expect(await captureExecute(app, shellWords(line.trim()).slice(1))).toMatchObject({
				exitCode: 0,
			});
		}
		expect(seen).toEqual([
			["group", { target: "delete" }],
			["group", { target: "rm" }],
			["show", { doc: "123" }, { meta: "hello", metas: ["1", "x"], tags: ["a", "b"] }],
		]);
	});

	it("replays infinite numbers and skips NaN, which argv cannot spell", async () => {
		const seen: unknown[] = [];
		const wait = defineCommand("wait", (cmd) =>
			cmd
				.args({ name: "at", type: "number" })
				.flags({ timeout: { type: "number" } })
				.action(({ args, flags }) => void seen.push([args, flags])),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(wait)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(wait, { args: { at: -Infinity }, flags: { timeout: Infinity } });
					next.add(wait, { flags: { timeout: Number.NaN } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		expect(stderr.split("\n")).toEqual([
			'nextSteps(): skipped "app wait": "--timeout" value NaN has no argv spelling',
			"Next steps:",
			"  app wait --timeout Infinity -- -Infinity",
		]);
		const line = stderr.split("\n").at(-1)!.trim();
		expect(await captureExecute(app, shellWords(line).slice(1))).toMatchObject({ exitCode: 0 });
		expect(seen).toEqual([[{ at: -Infinity }, { timeout: Infinity }]]);
	});

	it("skips a repeatable flag value its delimiter would split or drop", async () => {
		const tag = defineCommand("tag", (cmd) =>
			cmd.flags({ tags: { type: "string", multiple: true, delimiter: "," } }).action(() => {}),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(tag)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(tag, { flags: { tags: ["a,b"] } });
					next.add(tag, { flags: { tags: [""] } });
				}),
			);

		expect((await captureExecute(app, ["suggest"])).stderr).toBe(
			[
				'nextSteps(): skipped "app tag": "--tags" value "a,b" contains its delimiter ","',
				'nextSteps(): skipped "app tag": "--tags" value "" is dropped by its delimiter ","',
			].join("\n"),
		);
	});

	it("renders omitted prototype-named arguments as omitted", async () => {
		const seen: unknown[] = [];
		const target = defineCommand("target", (cmd) =>
			cmd
				.args({ name: "constructor", type: "string" }, { name: "__proto__", type: "string" })
				.action(({ args }) => void seen.push({ ...args })),
		);
		const app = new Crust("app")
			.extend(nextSteps())
			.add(target)
			.command("suggest", (cmd) =>
				cmd.use(nextSteps).action(async ({ ctx }) => {
					const next = await ctx.nextSteps;
					next.add(target);
					next.add(target, { args: { constructor: "x" } });
				}),
			);

		const { stderr } = await captureExecute(app, ["suggest"]);
		const lines = stderr.split("\n").slice(1);
		expect(lines).toEqual(["  app target", "  app target x"]);
		for (const line of lines) {
			expect(await captureExecute(app, shellWords(line.trim()).slice(1))).toMatchObject({
				exitCode: 0,
			});
		}
		const omitted: unknown = {};
		expect(seen).toEqual([omitted, { constructor: "x" }]);
	});

	it("keeps a completed result when writing to stderr throws", async () => {
		const outcome = await appWith().run(
			["deploy"],
			{ args: { env: "prod" } },
			{
				stderr: () => {
					throw new Error("stderr closed");
				},
			},
		);

		expect(outcome).toMatchObject({ status: "completed", result: { env: "prod" } });
	});

	it("rejects a command that uses nextSteps without extending nextSteps()", async () => {
		// @ts-expect-error -- runtime regression deliberately exercises the preparation check.
		const unextended = new Crust("app").add(deploy);
		const error = await unextended.snapshot().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({
			code: "DEFINITION",
			details: { subject: "extension", name: "crust:next-steps", reason: "missing-extension" },
		});
	});
});
