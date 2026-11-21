import { describe, expect, it } from "vite-plus/test";

import { createSearchIndex, type SearchItem } from "./search.ts";

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
