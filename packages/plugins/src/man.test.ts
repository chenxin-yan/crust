import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Crust } from "@crustjs/core";
import { manPagePlugin, renderManPage } from "./man.ts";

let stdoutChunks: string[];
let originalLog: typeof console.log;

beforeEach(() => {
	stdoutChunks = [];
	originalLog = console.log;
	console.log = (...args: unknown[]) => {
		stdoutChunks.push(args.map((arg) => String(arg)).join(" "));
	};
});

afterEach(() => {
	console.log = originalLog;
	process.exitCode = 0;
});

function getStdout() {
	return stdoutChunks.join("\n");
}

/** Normalize `\-` (troff hyphen) to `-` for assertions. */
function unwrapTroffHyphens(s: string): string {
	return s.replace(/\\-/g, "-");
}

describe("renderManPage", () => {
	it("emits .TH NAME SYNOPSIS and DESCRIPTION", () => {
		const root = new Crust("my-cli")
			.meta({ description: "A sample CLI" })
			.flags({
				verbose: {
					type: "boolean",
					short: "v",
					description: "Verbose",
					default: true,
				},
			})
			.run(() => {})._node;

		const out = renderManPage(root, {
			date: "April 2026",
			source: "my-cli",
			manual: "User Commands",
		});

		expect(out).toContain('.TH my-cli 1 "April 2026" "my-cli" "User Commands"');
		expect(out).toContain(".SH NAME");
		expect(out).toContain(".SH SYNOPSIS");
		expect(out).toContain(".SH DESCRIPTION");
		expect(out).toContain("my-cli [options]");
		expect(out).toContain(".SH OPTIONS");
		const plain = unwrapTroffHyphens(out);
		expect(plain).toContain("--verbose");
		expect(plain).toContain("--no-verbose");
		expect(plain).toContain("[default: true]");
	});

	it("escapes a description that starts with a dot", () => {
		const root = new Crust("app")
			.meta({ description: ".config driven tool" })
			.run(() => {})._node;

		const out = renderManPage(root);
		expect(out).toContain("\\&.config driven tool");
		expect(out).not.toMatch(/^\.config/m);
	});

	it("includes nested subcommands in COMMAND REFERENCE", () => {
		const root = new Crust("app")
			.meta({ description: "Root" })
			.command("deploy", (c) =>
				c
					.meta({ description: "Deploy" })
					.flags({
						env: { type: "string", description: "Target env" },
					})
					.run(() => {}),
			)
			.run(() => {})._node;

		const out = renderManPage(root);
		expect(out).toContain(".SH COMMANDS");
		expect(out).toContain(".SS app deploy");
		expect(out).toContain("app deploy [options]");
		expect(unwrapTroffHyphens(out)).toContain("--env");
	});

	it("uses custom meta.usage for synopsis", () => {
		const root = new Crust("tool")
			.meta({ usage: "tool custom synopsis" })
			.run(() => {})._node;

		const out = renderManPage(root);
		expect(out).toContain("tool custom synopsis");
	});

	it("omits boolean negation when noNegate is set", () => {
		const root = new Crust("app")
			.flags({
				help: { type: "boolean", short: "h", noNegate: true },
			})
			.run(() => {})._node;

		const out = renderManPage(root);
		expect(unwrapTroffHyphens(out)).toContain("--help");
		expect(unwrapTroffHyphens(out)).not.toContain("--no-help");
	});

	it("renders extraSectionsAfter and commandSections", () => {
		const root = new Crust("cli")
			.meta({ description: "CLI" })
			.command("sync", (c) => c.meta({ description: "Sync" }).run(() => {}))
			.run(() => {})._node;

		const out = renderManPage(root, {
			extraSectionsAfter: [
				{ title: "SEE ALSO", body: "https://example.com/docs" },
			],
			commandSections: {
				"cli sync": { extra: "Safe to re-run." },
			},
		});

		expect(out).toContain('.SH "SEE ALSO"');
		expect(out).toContain("https://example.com");
		expect(out).toContain(".SH NOTES");
		expect(out).toContain("Safe to re-run.");
	});

	it("inserts rawTroffSectionsAfter without escaping", () => {
		const root = new Crust("x").run(() => {})._node;
		const out = renderManPage(root, {
			rawTroffSectionsAfter: [
				{
					title: "CUSTOM",
					body: ".IP \\(bu 2\nLiteral troff line.",
				},
			],
		});
		expect(out).toContain(".IP \\(bu 2");
		expect(out).toContain("Literal troff line.");
	});

	it("includes commandSections rawExtra as troff", () => {
		const root = new Crust("cli").run(() => {})._node;
		const out = renderManPage(root, {
			commandSections: {
				cli: { rawExtra: ".sp 1\nRaw line." },
			},
		});
		expect(out).toContain(".sp 1");
		expect(out).toContain("Raw line.");
	});

	it("shows group root with subcommands as <command> in root synopsis", () => {
		const root = new Crust("grp").command("sub", (c) => c.run(() => {}))._node;

		const out = renderManPage(root);
		expect(out).toContain("grp <command>");
	});
});

describe("manPagePlugin", () => {
	it("prints man page to stdout when man subcommand runs", async () => {
		const app = new Crust("widget")
			.meta({ description: "Widget tool" })
			.use(manPagePlugin())
			.run(() => {});

		await app.execute({ argv: ["man"] });

		const out = getStdout();
		expect(out).toContain(".TH widget");
		expect(out).toContain(".SH NAME");
	});

	it("writes to file when --output is set", async () => {
		const tmp = join(import.meta.dir, ".man-test-out");
		mkdirSync(tmp, { recursive: true });
		const file = join(tmp, "widget.1");
		try {
			const app = new Crust("widget").use(manPagePlugin()).run(() => {});

			await app.execute({ argv: ["man", "--output", file] });

			expect(getStdout()).toBe("");
			const written = readFileSync(file, "utf8");
			expect(written).toContain(".TH widget");
		} finally {
			rmSync(tmp, { recursive: true, force: true });
		}
	});

	it("respects custom command name", async () => {
		const app = new Crust("app")
			.use(manPagePlugin({ command: "manual" }))
			.run(() => {});

		await app.execute({ argv: ["manual"] });

		expect(getStdout()).toContain(".TH app");
	});
});
