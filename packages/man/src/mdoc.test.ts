import { describe, expect, it } from "bun:test";
import { Crust } from "@crustjs/core";
import { helpPlugin } from "@crustjs/plugins";
import { renderManPageMdoc } from "./mdoc.ts";

describe("renderManPageMdoc", () => {
	it("includes NAME SYNOPSIS SUBCOMMANDS OPTIONS", async () => {
		const app = new Crust("demo")
			.meta({ description: "Demo CLI for tests." })
			.use(helpPlugin())
			.flags({
				verbose: { type: "boolean", short: "v", description: "Verbose" },
			})
			.command(new Crust("ping").meta({ description: "Ping" }).run(() => {}));

		const { root } = await app.prepareCommandTree();
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
		const app = new Crust("x")
			.meta({ description: ".config is read automatically." })
			.run(() => {});

		const { root } = await app.prepareCommandTree();
		const mdoc = renderManPageMdoc({ root, name: "x", section: 1 });

		expect(mdoc).toMatch(/\.Nd .*\\&\.config is read automatically\./);
		expect(mdoc).toContain("\\&.config is read automatically.");
	});
});
