import { describe, expect, it } from "vite-plus/test";

import { defineCommand } from "../index.ts";
import { createCommandIndex } from "./command-index.ts";
import { Crust } from "./crust.ts";
import type { CommandSnapshot } from "./snapshot.ts";

const app = new Crust("acme")
	.add(
		defineCommand("keys", { description: "Manage credentials" }, (cmd) =>
			cmd.add(
				defineCommand("rotate", { description: "Rotate an API key" }, (sub) =>
					sub.args({ name: "id", type: "string", description: "Key to rotate" }).action(() => {}),
				),
				defineCommand("list", { description: "List API keys" }, (sub) => sub.action(() => {})),
			),
		),
		defineCommand("deploy", { description: "Deploy the app" }, (cmd) =>
			cmd
				.flags({ dryRun: { type: "boolean", description: "Print the plan only" } })
				.action(() => {}),
		),
		defineCommand("status", { description: "Show the deploy status" }, (cmd) =>
			cmd.action(() => {}),
		),
		defineCommand("logs", { aliases: ["tail"], description: "Stream output" }, (cmd) =>
			cmd.action(() => {}),
		),
	)
	.action(() => {});

/** Every command under the root, the root included, as index entries. */
function entries(root: CommandSnapshot) {
	const list: { path: readonly string[]; command: CommandSnapshot }[] = [];
	const visit = (command: CommandSnapshot, path: readonly string[]) => {
		list.push({ path, command });
		for (const [name, sub] of Object.entries(command.subCommands)) visit(sub, [...path, name]);
	};
	visit(root, []);
	return list;
}

const index = createCommandIndex(entries(await app.snapshot()));

describe("createCommandIndex", () => {
	it("ranks path words over description and argument words", () => {
		expect(index.search("rotate api key", 5)).toEqual([
			["keys", "rotate"],
			["keys", "list"],
			["keys"],
		]);
	});

	it("ranks an exact command name above a description match", () => {
		expect(index.search("deploy", 5)).toEqual([["deploy"], ["status"]]);
	});

	it("matches aliases, prefixes and camelCase flag names", () => {
		expect(index.search("tail", 5)).toEqual([["logs"]]);
		expect(index.search("rot", 5)[0]).toEqual(["keys", "rotate"]);
		expect(index.search("dry run", 5)).toEqual([["deploy"]]);
	});

	it("matches singular and plural forms", () => {
		expect(index.search("credential", 5)).toEqual([["keys"]]);
		expect(index.search("Credentials", 5)).toEqual([["keys"]]);
	});

	it("ranks an exact word above a word that only shares its singular", async () => {
		const plural = new Crust("acme").add(
			defineCommand("new", (cmd) => cmd.action(() => {})),
			defineCommand("news", (cmd) => cmd.action(() => {})),
		);
		const words = createCommandIndex(entries(await plural.snapshot()));
		expect(words.search("news", 5)).toEqual([["news"], ["new"]]);
		expect(words.search("new", 5)).toEqual([["new"], ["news"]]);
	});

	it("finds the root command by its name", async () => {
		const root = createCommandIndex(entries(await new Crust("deploy").action(() => {}).snapshot()));
		expect(root.search("deploy", 5)).toEqual([[]]);
	});

	it("returns nothing for a query without a match", () => {
		expect(index.search("nothing here", 5)).toEqual([]);
		expect(index.search("  ", 5)).toEqual([]);
	});

	it("breaks ties by path and stops at the limit", () => {
		expect(index.search("api", 5)).toEqual([
			["keys", "list"],
			["keys", "rotate"],
		]);
		expect(index.search("api", 1)).toEqual([["keys", "list"]]);
	});
});
