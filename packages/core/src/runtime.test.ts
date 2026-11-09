import { describe, expect, it } from "vite-plus/test";

import { unwrap } from "../tests/helpers.ts";
import {
	type AnyCrust,
	Crust,
	defineContext,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "./index.ts";

describe("runtime structured invocation", () => {
	it("checks choices and negation", async () => {
		const app = new Crust("run").flags({
			tag: { type: "string", multiple: true, choices: ["ok"] },
			yes: { type: "boolean", noNegate: true },
		});
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { tag: ["wrong"] } }))).rejects.toThrow(
			"Expected one of: ok",
		);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { yes: false } }))).rejects.toThrow(
			"does not support negation",
		);
	});

	it("preserves URL and JSON identity and rejects wrong value kinds", async () => {
		const app = new Crust("values")
			.flags({ endpoint: { type: "url" }, config: { type: "json" } })
			.action(({ flags }) => flags);
		const endpoint = new URL("https://example.com");
		const config = { nested: [true, null, 3] };
		const result = await app.run([], { flags: { endpoint, config } });
		expect(result).toMatchObject({ status: "completed", result: { endpoint, config } });
		if (result.status === "completed") {
			expect(result.result.endpoint).toBe(endpoint);
			expect(result.result.config).toBe(config);
		}
		await expect(
			unwrap(
				// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
				app.run([], { flags: { endpoint: "https://example.com" } }),
			),
		).rejects.toThrow("Expected a URL for --endpoint.");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { config: [endpoint] } }))).rejects.toThrow(
			"Expected a JSON value for --config.",
		);
	});

	it("lets handling hooks skip required and schema validation after binding", async () => {
		let schemas = 0;
		const app = new Crust("handled")
			.args({ name: "file", type: "string", required: true })
			.flags({
				config: {
					type: "string",
					schema: {
						"~standard": {
							version: 1,
							vendor: "test",
							validate: () => {
								schemas++;
								return { value: "parsed" };
							},
						},
					},
				},
			})
			.extend(defineExtension(defineExtensionId("handled")).noAction(() => {}));
		const erased: AnyCrust = app;
		expect(await erased.run([], {})).toMatchObject({
			status: "handled",
			by: defineExtensionId("handled"),
		});
		expect(schemas).toBe(0);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { config: 3 } }))).rejects.toThrow(
			"Expected a string for --config.",
		);
	});
});

describe("local metadata boundaries", () => {
	it("checks metadata at consumption without narrowing independent inputs", async () => {
		const title = "Notes" as string;
		const audience = [defineExtensionId("help")];
		const config = { sections: [{ title, body: "text", only: audience }] };
		const app = new Crust("cli", config).flags({ verbose: { type: "boolean" } });
		audience.length = 0;
		expect((await app.snapshot()).meta.sections?.[0]?.only?.map(String)).toEqual(["help"]);
		expect(() => new Crust("cli", config)).toThrow("invalid documentation sections");
		const child = defineCommand("child", { aliases: ["c", "c"] }, (b) => b);
		expect((await new Crust("cli").add(child).snapshot()).subCommands.child?.meta.aliases).toEqual([
			"c",
			"c",
		]);
	});
});

it("checks command relations at each actual destination and keeps Context setup lazy", async () => {
	let setups = 0;
	const owner = defineContext("owner")
		.flags({ token: { type: "string" } })
		.setup(() => ++setups);
	const definition = defineCommand("child", (command) =>
		command.flags({ token: { type: "number" } }),
	);
	const definitions = [definition];
	expect(() => new Crust("first").add(...definitions)).not.toThrow();
	// The definition does not use owner, so its own token flag does not collide with owner's.
	const unrelated = new Crust("second").provide(owner()).add(...definitions);
	await expect(unrelated.snapshot()).resolves.toBeDefined();
	const demand = defineCommand("demand", (command) => command.use(owner));
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	const missing = new Crust("missing").add(demand);
	await expect(missing.snapshot()).rejects.toThrow("owner");
	const app = new Crust("present").provide(owner()).add(demand);
	await app.snapshot();
	expect(setups).toBe(0);
});
