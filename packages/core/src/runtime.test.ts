import { describe, expect, it } from "bun:test";

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
	it("checks choices, negation, and positional order", async () => {
		const app = new Crust("run")
			.args({ name: "first", type: "string" }, { name: "rest", type: "json", variadic: true })
			.flags(
				{ name: "tag", type: "string", multiple: true, choices: ["ok"] },
				{ name: "yes", type: "boolean", noNegate: true },
			);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { tag: ["wrong"] } }))).rejects.toThrow(
			"Expected one of: ok",
		);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { yes: false } }))).rejects.toThrow(
			"does not support negation",
		);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { args: { rest: ["b"] } }))).rejects.toThrow(
			"omitted argument",
		);
	});

	it("preserves URL and JSON identity and rejects wrong value kinds", async () => {
		const app = new Crust("values")
			.flags({ name: "endpoint", type: "url" }, { name: "config", type: "json" })
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
		).rejects.toThrow("Expected url");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { config: [endpoint] } }))).rejects.toThrow(
			"Expected json",
		);
	});

	it("lets finishing hooks skip required and schema validation after binding", async () => {
		let schemas = 0;
		const app = new Crust("finish")
			.args({ name: "file", type: "string", required: true })
			.flags({
				name: "config",
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
			})
			.extend(
				defineExtension(defineExtensionId("finish"), {
					hooks: { preRun: ({ finish }) => finish() },
				}),
			);
		const erased: AnyCrust = app;
		expect(await erased.run([], {})).toMatchObject({
			status: "finished",
			by: defineExtensionId("finish"),
		});
		expect(schemas).toBe(0);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { config: 3 } }))).rejects.toThrow("Expected string");
	});

	it("checks dynamic values against the selected command", async () => {
		const app = new Crust("run")
			.flags({ name: "count", type: "number" })
			.action(({ flags }) => flags.count);
		expect(await app.run([], { flags: { count: 3 } })).toMatchObject({
			status: "completed",
			result: 3,
		});
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		await expect(unwrap(app.run([], { flags: { count: "wrong" } }))).rejects.toThrow(
			"Expected number for --count",
		);
	});
});

describe("runtime command names", () => {
	it("validates at consumption, not when wrapping", () => {
		const name = " \t";
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust(name)).toThrow("Command name must be a non-empty string");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => defineCommand("__proto__", (command) => command)).toThrow(
			'Command name "__proto__" is reserved',
		);
	});

	it("preserves independent inputs and selected results", async () => {
		const name: string = "generated";
		const app = new Crust(name)
			.args({ name: "file", type: "string", required: true })
			.action(({ args }) => args.file);
		expect(await app.run([], { args: { file: "input" } })).toMatchObject({
			status: "completed",
			result: "input",
		});
	});

	it("checks renamed names against carried aliases", () => {
		const command = defineCommand("source", { aliases: ["alias", "alias"] }, (builder) => builder);
		expect(command.as("target").name).toBe("target");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => command.as("alias")).toThrow("canonical name");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => command.as("__proto__")).toThrow("reserved");
	});

	it("checks dynamic inline names", () => {
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("root").command("", (command) => command)).toThrow(
			"Command name must be a non-empty string",
		);
	});
});

describe("local metadata boundaries", () => {
	it("checks metadata at consumption without narrowing independent inputs", async () => {
		const title = "Notes" as string;
		const audience = [defineExtensionId("help")];
		const config = { sections: [{ title, body: "text", only: audience }] };
		const app = new Crust("cli", config).flags({ name: "verbose", type: "boolean" });
		audience.length = 0;
		expect((await app.snapshot()).meta.sections?.[0]?.only?.map(String)).toEqual(["help"]);
		expect(() => new Crust("cli", config)).toThrow("invalid documentation sections");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => defineCommand("child", { aliases: ["bad alias"] }, (b) => b)).toThrow("alias");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => defineCommand("child", { aliases: ["child"] }, (b) => b)).toThrow("alias");
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("cli", { sections: [{ title: "\n", body: "text" }] })).toThrow(
			"sections",
		);
		const child = defineCommand("child", { aliases: ["c", "c"] }, (b) => b);
		expect((await new Crust("cli").add(child).snapshot()).subCommands.child?.meta.aliases).toEqual([
			"c",
			"c",
		]);
	});
});

it("checks command relations at each actual destination and keeps Context setup lazy", async () => {
	let setups = 0;
	const owner = defineContext(
		"owner",
		{ flags: [{ name: "token", type: "string" }] },
		() => ++setups,
	);
	const definition = defineCommand("child", (command) =>
		command.flags({ name: "token", type: "number" }),
	);
	const definitions = [definition];
	expect(() => new Crust("first").add(...definitions)).not.toThrow();
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	expect(() => new Crust("second").provide(owner()).add(...definitions)).toThrow("collides");
	const demand = defineCommand("demand", (command) => command.use(owner));
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	expect(() => new Crust("missing").add(demand)).toThrow("owner");
	const app = new Crust("present").provide(owner()).add(demand);
	await app.snapshot();
	expect(setups).toBe(0);
});

it("checks each future Extension section result when prepared", async () => {
	let title = "Notes";
	const docs = defineExtension(defineExtensionId("future"), {
		sections: () => [{ command: [], title, body: "Body" }],
	});
	const first = new Crust("one").extend(docs);
	expect((await first.snapshot()).meta.sections?.[0]?.title).toBe("Notes");
	title = "\n";
	await expect(new Crust("two").extend(docs).snapshot()).rejects.toThrow("sections");
});

it("checks the actual name on a copied command definition", () => {
	const original = defineCommand("original", { aliases: ["alias"] }, (command) => command);
	for (const name of [" ", "__proto__", "alias"]) {
		expect(() => new Crust("cli").add({ ...original, name })).toThrow();
	}
});
