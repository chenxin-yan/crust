import { describe, expect, it } from "bun:test";

import { Crust, defineCommand, defineExtension } from "@crustjs/core";
import { help } from "@crustjs/extensions";

import { renderManPageMdoc } from "./mdoc.ts";

describe("renderManPageMdoc", () => {
	it("includes NAME SYNOPSIS SUBCOMMANDS OPTIONS", async () => {
		const app = new Crust("demo", { description: "Demo CLI for tests." })
			.extend(help())
			.flags({
				name: "verbose",
				type: "boolean",
				short: "v",
				description: "Verbose",
			})
			.add(defineCommand("ping", { description: "Ping" }, (cmd) => cmd.action(() => {})));

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		expect(mdoc).toContain(".Sh NAME");
		expect(mdoc).toContain(".Nm demo");
		expect(mdoc).toContain(".Nd Demo CLI for tests.");
		expect(mdoc).toContain(".Sh SYNOPSIS");
		expect(mdoc).toContain("demo <command>");
		expect(mdoc).toContain(".Sh SUBCOMMANDS");
		expect(mdoc).toContain(".It Nm ping");
		expect(mdoc).toContain(".Sh OPTIONS");
		expect(mdoc).toMatch(/verbose|--verbose|help/);
	});

	it("escapes leading dots in descriptions and .Nd", async () => {
		const app = new Crust("x", {
			description: ".config is read automatically.",
		}).action(() => {});

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "x", section: 1 });

		expect(mdoc).toMatch(/\.Nd .*\\&\.config is read automatically\./);
		expect(mdoc).toContain("\\&.config is read automatically.");
	});

	it("appends metadata sections after built-ins and escapes body lines", async () => {
		const app = new Crust("demo", {
			sections: [{ title: "Extra notes", body: ".config is supported.\nMore details." }],
		})
			.extend(
				defineExtension("docs", {
					sections: () => [
						{
							command: [],
							title: "C:\\paths",
							body: "'quoted lines are escaped.",
						},
					],
				}),
			)
			.flags({ name: "verbose", type: "boolean" })
			.action(() => {});

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		expect(mdoc).toContain(".Sh EXTRA NOTES\n\\&.config is supported.\nMore details.");
		expect(mdoc.indexOf(".Sh EXTRA NOTES")).toBeGreaterThan(mdoc.indexOf(".Sh OPTIONS"));
		// Extension-contributed section renders after authored ones, with roff escaping.
		expect(mdoc).toContain(".Sh C:\\ePATHS\n\\&'quoted lines are escaped.");
		expect(mdoc.indexOf(".Sh C:\\ePATHS")).toBeGreaterThan(mdoc.indexOf(".Sh EXTRA NOTES"));
	});

	it("uses explicit date for .Dd", async () => {
		const app = new Crust("x").action(() => {});
		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({
			root,
			name: "x",
			date: "March 15, 2020",
		});
		expect(mdoc.startsWith(".Dd March 15, 2020\n")).toBe(true);
	});

	it("uses SOURCE_DATE_EPOCH when date omitted", async () => {
		const prev = process.env.SOURCE_DATE_EPOCH;
		process.env.SOURCE_DATE_EPOCH = "86400";
		try {
			const app = new Crust("x").action(() => {});
			const root = await app.snapshot();
			const mdoc = renderManPageMdoc({ root, name: "x" });
			expect(mdoc.startsWith(".Dd January 2, 1970\n")).toBe(true);
		} finally {
			if (prev === undefined) {
				delete process.env.SOURCE_DATE_EPOCH;
			} else {
				process.env.SOURCE_DATE_EPOCH = prev;
			}
		}
	});

	it("renders subcommand aliases inline next to the canonical name", async () => {
		const app = new Crust("demo", { description: "Demo CLI for alias tests." })
			.add(
				defineCommand("issue", { description: "Manage issues", aliases: ["issues", "i"] }, (cmd) =>
					cmd.action(() => {}),
				),
			)
			.add(
				defineCommand("version", { description: "Show version" }, (cmd) => cmd.action(() => {})),
			);

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		expect(mdoc).toContain(".Sh SUBCOMMANDS");
		// Aliases inline alongside the canonical name on the .It Nm line.
		expect(mdoc).toContain(".It Nm issue (issues, i)");
		// A command without aliases keeps the original (unparenthesised) form.
		expect(mdoc).toContain(".It Nm version");
		expect(mdoc).not.toContain(".It Nm version (");
		// Column width must accommodate the longer label — sanity-check that
		// the `.Bl -tag -width` directive uses a width >= the inline label.
		const widthMatch = mdoc.match(/\.Bl -tag -width (\d+)n/);
		expect(widthMatch).not.toBeNull();
		const width = Number(widthMatch?.[1]);
		expect(width).toBeGreaterThanOrEqual("issue (issues, i)".length);
	});

	it("omits `meta.hidden: true` subcommands from the SUBCOMMANDS section", async () => {
		// Mirrors the help contract: hidden commands stay invocable
		// but never appear in published man pages.
		const app = new Crust("demo", { description: "Demo." })
			.add(
				defineCommand("build", { description: "Build the project" }, (cmd) => cmd.action(() => {})),
			)
			.add(
				defineCommand(
					"__complete",
					{ description: "Internal completion entrypoint", hidden: true },
					(cmd) => cmd.action(() => {}),
				),
			);

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		expect(mdoc).toContain(".It Nm build");
		expect(mdoc).not.toContain("__complete");
	});

	it("omits the SUBCOMMANDS section entirely when every subcommand is hidden", async () => {
		const app = new Crust("demo")
			.add(
				defineCommand("__complete", { hidden: true, description: "Internal" }, (cmd) =>
					cmd.action(() => {}),
				),
			)
			.action(() => {});

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		expect(mdoc).not.toContain(".Sh SUBCOMMANDS");
		expect(mdoc).not.toContain("__complete");
	});

	it("renders flag `choices` as `[choices: ...]` after the description", async () => {
		const app = new Crust("demo", { description: "Demo." })
			.flags({
				name: "target",
				type: "string",
				choices: ["browser", "bun", "node"],
				description: "Build target",
			})
			.action(() => {});

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		// Convention audit M1: use semantic mdoc flag macros.
		expect(mdoc).toContain(".It Fl Fl target");
		expect(mdoc).toContain("Build target [choices: browser, bun, node]");
	});

	it("renders positional-arg `choices` in the ARGUMENTS section", async () => {
		const app = new Crust("demo", { description: "Demo." })
			.args({
				name: "env",
				type: "string",
				required: true,
				choices: ["dev", "staging", "prod"],
				description: "Target environment",
			})
			.action(() => {});

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		expect(mdoc).toContain(".Sh ARGUMENTS");
		expect(mdoc).toContain(".It Ar env");
		expect(mdoc).toContain("Target environment [choices: dev, staging, prod]");
	});

	it("includes long flag aliases (`def.aliases`) alongside the canonical spelling", async () => {
		const app = new Crust("demo", { description: "Demo." })
			.flags({
				name: "output",
				type: "string",
				short: "o",
				aliases: ["out"],
				description: "Where to write",
			})
			.action(() => {});

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		// Both the canonical `--output` and the alias `--out` appear in the
		// label, comma-separated, after the short flag.
		expect(mdoc).toContain(".It Fl o , Fl Fl output , Fl Fl out");
	});

	it("includes `--no-` negation for every long-form spelling of a boolean flag", async () => {
		const app = new Crust("demo")
			.flags({
				name: "color",
				type: "boolean",
				aliases: ["colour"],
				description: "Use colour",
			})
			.action(() => {});

		const root = await app.snapshot();
		const mdoc = renderManPageMdoc({ root, name: "demo", section: 1 });

		// Canonical + alias + both negations, in declaration order.
		expect(mdoc).toContain(".It Fl Fl color , Fl Fl colour , Fl Fl no-color , Fl Fl no-colour");
	});
});
