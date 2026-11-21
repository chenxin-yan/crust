import { type AnyCrust, type CommandSnapshot, Crust, defineCommand } from "@crustjs/core";
import { describe, expect, it } from "vite-plus/test";

import { createToolIndex, type ToolIndex } from "./tool-index.ts";
import { toolsFromSnapshot } from "./tools.ts";

/** The index `search_tools` builds for `app`. */
async function indexOf(app: AnyCrust): Promise<ToolIndex> {
	const snapshot = await app.snapshot();
	return createToolIndex(
		toolsFromSnapshot(snapshot).map((tool) => [
			tool,
			tool.path.reduce<CommandSnapshot>((command, name) => command.subCommands[name]!, snapshot),
		]),
	);
}

/** The names of the tools `search` returns. */
function names(index: ToolIndex, query: string, limit = 5): string[] {
	return index.search(query, limit).map((tool) => tool.name);
}

const index = await indexOf(
	new Crust("acme").add(
		defineCommand("keys", { description: "Manage credentials" }, (cmd) =>
			cmd
				.action(() => {})
				.add(
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
	),
);

describe("createToolIndex", () => {
	it("ranks path words over description and argument words", () => {
		expect(names(index, "rotate api key")).toEqual(["keys_rotate", "keys_list", "keys"]);
	});

	it("ranks an exact command name above a description match", () => {
		expect(names(index, "deploy")).toEqual(["deploy", "status"]);
	});

	it("matches aliases, prefixes and camelCase flag names", () => {
		expect(names(index, "tail")).toEqual(["logs"]);
		expect(names(index, "rot")[0]).toBe("keys_rotate");
		expect(names(index, "dry run")).toEqual(["deploy"]);
	});

	it("matches singular and plural forms", () => {
		expect(names(index, "credential")).toEqual(["keys"]);
		expect(names(index, "Credentials")).toEqual(["keys"]);
	});

	it("ranks an exact word above a word that only shares its singular", async () => {
		const plural = await indexOf(
			new Crust("acme").add(
				defineCommand("new", (cmd) => cmd.action(() => {})),
				defineCommand("news", (cmd) => cmd.action(() => {})),
			),
		);
		expect(names(plural, "news")).toEqual(["news", "new"]);
		expect(names(plural, "new")).toEqual(["new", "news"]);
	});

	it("finds the root tool by its name", async () => {
		const root = await indexOf(new Crust("deploy").action(() => {}));
		expect(names(root, "deploy")).toEqual(["deploy"]);
	});

	it("weighs a query word less the more tools it matches", async () => {
		// Every name has five words and every description six, so only how many tools share a word differs.
		const command = (name: string, description: string) =>
			defineCommand(name, { description }, (cmd) => cmd.action(() => {}));
		const zone = await indexOf(
			new Crust("cf").add(
				defineCommand("rules-for-a-zone", (cmd) =>
					cmd.add(
						command("list", "List the rules for a zone"),
						command("get", "Get the rule for a zone"),
						command("delete", "Delete the rule for a zone"),
					),
				),
				defineCommand("zone-cache", (cmd) =>
					cmd.add(command("purge-all-files", "Purge every file from the cache")),
				),
			),
		);
		expect(names(zone, "purge the cache for a zone")[0]).toBe("zone-cache_purge-all-files");
	});

	it("weighs a word in a short field above the same word in a long one", async () => {
		// Every tool matches `customer`, in a path parameter if not in its name.
		const byCustomer = (name: string, description: string) =>
			defineCommand(name, { description }, (cmd) =>
				cmd.args({ name: "customer", type: "string" }).action(() => {}),
			);
		const stripe = await indexOf(
			new Crust("stripe").add(
				defineCommand("post-customers", { description: "Create a customer" }, (cmd) =>
					cmd.action(() => {}),
				),
				byCustomer("post-customers-customer-cards", "Create a card"),
				byCustomer("post-customers-customer-sources", "Create a card"),
				byCustomer("post-customers-customer-bank-accounts", "Create a card"),
				byCustomer("delete-customers-customer", "Delete a customer"),
			),
		);
		expect(names(stripe, "create a customer")[0]).toBe("post-customers");
	});

	it("returns nothing for a query without a match", () => {
		expect(names(index, "nothing here")).toEqual([]);
		expect(names(index, "  ")).toEqual([]);
	});

	it("breaks ties by path and stops at the limit", async () => {
		const twins = await indexOf(
			new Crust("acme").add(
				defineCommand("pull", { description: "Sync the repo" }, (cmd) => cmd.action(() => {})),
				defineCommand("push", { description: "Sync the repo" }, (cmd) => cmd.action(() => {})),
				defineCommand("fetch", { description: "Sync the repo" }, (cmd) => cmd.action(() => {})),
			),
		);
		expect(names(twins, "sync")).toEqual(["fetch", "pull", "push"]);
		expect(names(twins, "sync", 1)).toEqual(["fetch"]);
	});
});
