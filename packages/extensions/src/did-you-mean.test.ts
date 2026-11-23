import { Crust, defineCommand, unknownCommand } from "@crustjs/core";
import { captureExecute } from "@crustjs/testing";
import { describe, expect, it } from "vite-plus/test";

import { didYouMean } from "./did-you-mean.ts";
import { jsonInput } from "./json-input.ts";
import { json } from "./json.ts";
import { noColor } from "./no-color.ts";

describe("didYouMean", () => {
	it("reports the unknown command even when a sibling recipe throws", async () => {
		const built: string[] = [];
		const app = new Crust("app").extend(didYouMean()).add(
			defineCommand("build", (cmd) => {
				built.push("build");
				return cmd.action(() => {});
			}),
			defineCommand("broken", () => {
				built.push("broken");
				throw new Error("broken recipe");
			}),
		);

		const { stderr, exitCode } = await captureExecute(app, ["buld"]);

		expect(stderr).toContain('Unknown command "buld"');
		expect(stderr).toContain('Did you mean "build"?');
		expect(stderr).not.toContain("broken recipe");
		expect(exitCode).toBe(2);
		expect(built).toEqual([]);
	});

	it("suggests a subcommand for a word a root action declines with unknownCommand()", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})))
			.args({ name: "script", type: "string", required: true })
			.action(({ args, command }) => {
				throw unknownCommand(command, args.script);
			});

		const { stderr, exitCode } = await captureExecute(app, ["buidl"]);

		expect(stderr).toContain('Unknown command "buidl". Did you mean "build"?');
		expect(exitCode).toBe(2);
	});

	it("breaks tied scores by canonical name", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("zebra", { aliases: ["cap"] }, (cmd) => cmd.action(() => {})))
			.add(defineCommand("cat", (cmd) => cmd.action(() => {})));

		const { stderr } = await captureExecute(app, ["car"]);

		expect(stderr).toContain('Did you mean "cat"?');
	});

	// ──────────────────────────────────────────────────────────────────────────────
	// alias-aware suggestions
	// ──────────────────────────────────────────────────────────────────────────────

	it("suggests the canonical name when the input matches an alias", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("issue", { aliases: ["issues", "i"] }, (cmd) => cmd.action(() => {})))
			.add(defineCommand("version", (cmd) => cmd.action(() => {})));

		// "issuess" is closest to the alias "issues" (distance 1) than to
		// "issue" (distance 2). The extension must report the canonical name
		// regardless of which spelling triggered the match.
		const { stderr, exitCode } = await captureExecute(app, ["issuess"]);

		expect(stderr).toContain('Unknown command "issuess"');
		expect(stderr).toContain('Did you mean "issue"?');
		expect(stderr).not.toContain('Did you mean "issues"?');
		expect(exitCode).toBe(2);
	});

	it("prefers the closer canonical over a short colliding alias", async () => {
		// Regression: the typo "insall" must suggest "install" (Lev 1), not
		// "issue" via its 1-char alias "i". A short alias must not win simply
		// because it is a prefix of the input.
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("issue", { aliases: ["i"] }, (cmd) => cmd.action(() => {})))
			.add(defineCommand("install", (cmd) => cmd.action(() => {})));

		const { stderr } = await captureExecute(app, ["insall"]);

		expect(stderr).toContain('Did you mean "install"?');
		expect(stderr).not.toContain('Did you mean "issue"?');
	});

	it("renders canonical suggestion and help to stdout in help mode", async () => {
		const app = new Crust("app")
			.extend(didYouMean({ mode: "help" }))
			.add(defineCommand("issue", { aliases: ["issues"] }, (cmd) => cmd.action(() => {})));

		const { stdout, stderr, exitCode } = await captureExecute(app, ["issuee"]);

		expect(stdout).toContain('Unknown command "issuee". Did you mean "issue"?');
		expect(stdout).not.toContain('Did you mean "issues"');
		expect(stdout).toContain("Usage:");
		expect(stderr).toBe("");
		expect(exitCode).toBe(2);
	});

	it("renders help without color for a typed --no-color in help mode", async () => {
		const app = new Crust("app")
			.extend(noColor())
			.extend(didYouMean({ mode: "help" }))
			.add(defineCommand("issue", (cmd) => cmd.action(() => {})));

		const { stdout, exitCode } = await captureExecute(app, ["issuee", "--no-color"], {
			env: { FORCE_COLOR: "1" },
			raw: true,
		});

		expect(stdout).toContain("Usage:");
		expect(stdout).not.toContain("\x1b[");
		expect(exitCode).toBe(2);
	});

	it("never suggests a `meta.hidden: true` command, even on a close match", async () => {
		// `__complete` is the textbook hidden-command scenario: it's a
		// real, invocable command but should not surface in user-facing
		// error output. A close typo of it must not produce a suggestion.
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})))
			.add(defineCommand("__complete", { hidden: true }, (cmd) => cmd.action(() => {})));

		// Typo distance(__complet -> __complete) = 1, well within the
		// threshold. Distance(__complet -> build) is > 3, so without the
		// hidden filter the only suggestion would be `__complete`.
		const { stderr } = await captureExecute(app, ["__complet"]);

		expect(stderr).toContain('Unknown command "__complet"');
		expect(stderr).not.toContain("__complete");
	});

	it("omits hidden commands from the 'Available commands' fallback list", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("build", (cmd) => cmd.action(() => {})))
			.add(defineCommand("test", (cmd) => cmd.action(() => {})))
			.add(defineCommand("__complete", { hidden: true }, (cmd) => cmd.action(() => {})));

		// No close match — we want the "Available commands" line.
		const { stderr } = await captureExecute(app, ["zzzzz"]);

		expect(stderr).toContain("Available commands: build, test");
		expect(stderr).not.toContain("__complete");
		expect(stderr).not.toContain("Did you mean");
	});

	it("suggests only names within two edits", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("add", (cmd) => cmd.action(() => {})))
			.add(defineCommand("install", (cmd) => cmd.action(() => {})));

		expect((await captureExecute(app, ["instal"])).stderr).toContain('Did you mean "install"?');
		expect((await captureExecute(app, ["ins"])).stderr).toContain('Did you mean "install"?');
		expect((await captureExecute(app, ["adz"])).stderr).toContain('Did you mean "add"?');
		// Three edits from "add".
		expect((await captureExecute(app, ["zzz"])).stderr).not.toContain("Did you mean");
	});

	it("never suggests a command for an empty word", async () => {
		const app = new Crust("app")
			.extend(didYouMean())
			.add(defineCommand("add", (cmd) => cmd.action(() => {})))
			.args({ name: "script", type: "string", required: true })
			.action(({ args, command }) => {
				throw unknownCommand(command, args.script);
			});

		const { stderr } = await captureExecute(app, [""]);

		expect(stderr).toContain('Unknown command "".');
		expect(stderr).not.toContain("Did you mean");
	});

	it("suggests a flag of the command the unknown flag was given to", async () => {
		const app = new Crust("app").extend(didYouMean()).add(
			defineCommand("create", (cmd) =>
				cmd
					.flags({
						template: { type: "string", aliases: ["tpl"] },
						color: { type: "boolean", default: true },
						secret: { type: "string", hidden: true },
					})
					.action(() => {}),
			),
		);
		const stderrOf = async (...argv: string[]) => (await captureExecute(app, argv)).stderr;

		expect(await captureExecute(app, ["create", "--tempalte", "vue"])).toEqual({
			stdout: "",
			stderr: 'Error: Unknown flag "--tempalte". Did you mean "--template"?\n',
			exitCode: 2,
		});
		expect(await stderrOf("create", "--tpll")).toContain('Did you mean "--template"?');
		expect(await stderrOf("create", "--no-colr")).toContain('Did you mean "--no-color"?');
		expect(await stderrOf("create", "--secrt")).toBe('Error: Unknown flag "--secrt"\n');
		expect(await stderrOf("create", "--zzz")).toBe('Error: Unknown flag "--zzz"\n');
		expect(await stderrOf("create", "-t")).toBe('Error: Unknown flag "-t"\n');
	});

	it("never suggests the flag the error already names", async () => {
		const app = new Crust("app").extend(didYouMean(), jsonInput(), json()).action(() => {});

		const { stderr } = await captureExecute(app, ["--input", '{"json":true}']);

		expect(stderr).toContain('Flag "--json" is not command input');
		expect(stderr).not.toContain("Did you mean");
	});

	it("keeps a flag suggestion in the JSON error under --json", async () => {
		const app = new Crust("app")
			.extend(didYouMean(), json())
			.flags({ template: { type: "string" } })
			.action(() => {});

		const { stderr, exitCode } = await captureExecute(app, ["--json", "--tempalte", "vue"]);

		expect(JSON.parse(stderr)).toEqual({
			code: "PARSE",
			message: 'Unknown flag "--tempalte". Did you mean "--template"?',
			details: { flag: "tempalte", reason: "unknown-flag" },
		});
		expect(exitCode).toBe(2);
	});
});
