import { describe, expect, it } from "bun:test";

import { createCommandNode } from "../command/node.ts";
import { validateIncomingAliases } from "./commands.ts";

describe("validateIncomingAliases", () => {
	function sibling(name: string, aliases?: readonly string[]) {
		const node = createCommandNode(name);
		if (aliases) node.meta.aliases = aliases;
		return node;
	}

	it("accepts non-colliding command aliases", () => {
		expect(() =>
			validateIncomingAliases(
				{ canonicalName: "version", aliases: ["v"] },
				{ issue: sibling("issue", ["issues", "i"]) },
				"version",
			),
		).not.toThrow();
	});

	it("rejects an alias colliding with a sibling canonical name", () => {
		expect(() =>
			validateIncomingAliases(
				{ canonicalName: "compile", aliases: ["build"] },
				{ build: sibling("build") },
				"compile",
			),
		).toThrow(/collides with sibling canonical name "build"/);
	});

	it("rejects aliases colliding across sibling commands", () => {
		expect(() =>
			validateIncomingAliases(
				{ canonicalName: "info", aliases: ["i"] },
				{ issue: sibling("issue", ["i"]) },
				"info",
			),
		).toThrow(/collides with alias of sibling "issue"/);
	});

	it("rejects a canonical name colliding with a sibling alias", () => {
		expect(() =>
			validateIncomingAliases({ canonicalName: "i" }, { issue: sibling("issue", ["i"]) }, "i"),
		).toThrow(/canonical name "i" collides with alias of sibling "issue"/);
	});

	it("rejects duplicate and shape-invalid aliases", () => {
		expect(() =>
			validateIncomingAliases({ canonicalName: "issue", aliases: ["i", "i"] }, {}, "issue"),
		).toThrow(/lists alias "i" more than once/);
		expect(() =>
			validateIncomingAliases({ canonicalName: "issue", aliases: ["my issue"] }, {}, "issue"),
		).toThrow(/must not contain whitespace/);
	});
});
