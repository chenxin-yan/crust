import { describe, expect, it } from "vite-plus/test";

import { commandSearchItem, createSearchIndex, type SearchItem } from "./search.ts";

/** A search over `items` that returns the labels of the matches. */
function searchOf(items: Readonly<Record<string, Partial<SearchItem>>>) {
	const labels = Object.keys(items);
	const search = createSearchIndex(
		Object.values(items).map(({ names = [], descriptions = [], details = [] }) => ({
			names,
			descriptions,
			details,
		})),
	);
	return (query: string, limit = 5) => search(query, limit).map((at) => labels[at]);
}

const search = searchOf({
	keys: { names: ["keys"], descriptions: ["Manage credentials"] },
	"keys rotate": {
		names: ["keys", "rotate"],
		descriptions: ["Rotate an API key"],
		details: ["id", "Key to rotate"],
	},
	"keys list": { names: ["keys", "list"], descriptions: ["List API keys"] },
	deploy: {
		names: ["deploy"],
		descriptions: ["Deploy the app"],
		details: ["dryRun", "Print the plan only"],
	},
	status: { names: ["status"], descriptions: ["Show the deploy status"] },
	logs: { names: ["logs", "tail"], descriptions: ["Stream output"] },
});

describe("createSearchIndex", () => {
	it("ranks name words over description and detail words", () => {
		expect(search("rotate api key")).toEqual(["keys rotate", "keys list", "keys"]);
	});

	it("ranks an exact name above a description match", () => {
		expect(search("deploy")).toEqual(["deploy", "status"]);
	});

	it("matches every name, prefixes and camelCase words", () => {
		expect(search("tail")).toEqual(["logs"]);
		expect(search("rot")[0]).toBe("keys rotate");
		expect(search("dry run")).toEqual(["deploy"]);
	});

	it("matches singular and plural forms", () => {
		expect(search("credential")).toEqual(["keys"]);
		expect(search("Credentials")).toEqual(["keys"]);
	});

	it("ranks an exact word above a word that only shares its singular", () => {
		const plural = searchOf({ new: { names: ["new"] }, news: { names: ["news"] } });
		expect(plural("news")).toEqual(["news", "new"]);
		expect(plural("new")).toEqual(["new", "news"]);
	});

	it("weighs a query word less the more items it matches", () => {
		// Every name has five words and every description six, so only how many items share a word differs.
		const zone = searchOf({
			list: { names: ["rules-for-a-zone", "list"], descriptions: ["List the rules for a zone"] },
			get: { names: ["rules-for-a-zone", "get"], descriptions: ["Get the rule for a zone"] },
			delete: {
				names: ["rules-for-a-zone", "delete"],
				descriptions: ["Delete the rule for a zone"],
			},
			purge: {
				names: ["zone-cache", "purge-all-files"],
				descriptions: ["Purge every file from the cache"],
			},
		});
		expect(zone("purge the cache for a zone")[0]).toBe("purge");
	});

	it("weighs a word in a short field above the same word in a long one", () => {
		// Every item matches `customer`, in a detail if not in its name.
		const byCustomer = (name: string, description: string) => ({
			names: [name],
			descriptions: [description],
			details: ["customer"],
		});
		const stripe = searchOf({
			"post-customers": { names: ["post-customers"], descriptions: ["Create a customer"] },
			cards: byCustomer("post-customers-customer-cards", "Create a card"),
			sources: byCustomer("post-customers-customer-sources", "Create a card"),
			"bank-accounts": byCustomer("post-customers-customer-bank-accounts", "Create a card"),
			delete: byCustomer("delete-customers-customer", "Delete a customer"),
		});
		expect(stripe("create a customer")[0]).toBe("post-customers");
	});

	it("returns nothing for a query without a match", () => {
		expect(search("nothing here")).toEqual([]);
		expect(search("  ")).toEqual([]);
		expect(searchOf({})("deploy")).toEqual([]);
	});

	it("returns nothing for a limit below one", () => {
		expect(search("api", 0)).toEqual([]);
		expect(search("api", -1)).toEqual([]);
		expect(search("api", Number.NaN)).toEqual([]);
	});

	it("ranks a many-word query over a few hundred items in a fixed order", () => {
		// Pseudo-random texts from a small vocabulary, so most query words match many items.
		const vocabulary =
			"zone cache purge key list get set delete for a the rule worker script token rotate account member record dns".split(
				" ",
			);
		let seed = 1;
		const word = () => vocabulary[(seed = (seed * 48271) % 2147483647) % vocabulary.length]!;
		const text = (count: number) => Array.from({ length: count }, word).join(" ");
		const items = Array.from({ length: 300 }, (_, at) => ({
			names: [text(1 + (at % 4))],
			descriptions: [text(3 + (at % 6))],
			details: [text(at % 3)],
		}));
		const index = createSearchIndex(items);
		expect(index(`${vocabulary.join(" ")} purged caches rot`, 20)).toEqual([
			71, 83, 215, 99, 210, 26, 287, 275, 298, 137, 35, 293, 97, 11, 220, 165, 233, 184, 107, 1,
		]);
		expect(index("purge the cache for a zone", 20)).toEqual([
			37, 169, 99, 233, 53, 181, 241, 224, 65, 165, 5, 194, 89, 191, 71, 80, 220, 64, 43, 16,
		]);
	});

	it("breaks ties in item order and stops at the limit", () => {
		const twins = searchOf({
			pull: { descriptions: ["Sync the repo"] },
			push: { descriptions: ["Sync the repo"] },
			fetch: { descriptions: [undefined, "Sync the repo"] },
		});
		expect(twins("sync")).toEqual(["pull", "push", "fetch"]);
		expect(twins("sync", 1)).toEqual(["pull"]);
	});
});

describe("commandSearchItem", () => {
	it("indexes a command's path, name and aliases, description, and its own inputs", () => {
		expect(
			commandSearchItem(["keys", "rotate"], {
				meta: { name: "rotate", description: "Rotate an API key", aliases: ["roll"] },
				args: [{ name: "id", description: "Key to rotate" }, { name: "note" }],
				flags: {
					dryRun: { description: "Print the plan only" },
					json: { description: "Print JSON", extension: "crust:json" },
				},
			}),
		).toEqual({
			names: ["keys", "rotate", "rotate", "roll"],
			descriptions: ["Rotate an API key"],
			details: ["id", "Key to rotate", "note", undefined, "dryRun", "Print the plan only"],
		});
	});
});
