import { describe, expect, it } from "bun:test";

import { unwrap } from "../../tests/helpers.ts";
import { type AnyCrust, Crust, defineCommand } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import type { NamedFlagDef } from "../types.ts";
import { type AnyContextInstance, defineContext } from "./context.ts";
import { defineExtension, type Extension } from "./extension.ts";
import { defineFlag, defineArg } from "./flags.ts";

describe("checked Extension attachment", () => {
	it("checks declared dependencies without running setup", () => {
		let calls = 0;
		const db = defineContext("db", () => {
			calls++;
			return "db";
		});
		const extension = defineExtension(defineExtensionId("db"), { uses: [db] });
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("app").extend(extension)).toThrow("No provider for Context");
		expect(calls).toBe(0);
	});
	it("checks delayed command demands when the recipe is consumed", async () => {
		let calls = 0;
		const db = defineContext("db", () => {
			calls++;
			return "db";
		});
		const command = defineCommand("child", (c) => c.use(db).action(() => 1));
		const extension = defineExtension(defineExtensionId("commands"), { commands: [command] });
		const registrations = [extension];
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		const app = new Crust("app").extend(...registrations);
		await expect(app.snapshot()).rejects.toThrow("No provider for Context");
		expect(calls).toBe(0);
	});
	it("consumes the immutable defining Extension rather than overwritten spread fields", async () => {
		const extension = defineExtension(defineExtensionId("original"), {
			commands: [defineCommand("child", (c) => c.action(() => 42))],
		});
		const copy = { ...extension, commands: [] };
		const app = new Crust("app").extend(copy);
		expect(await app.run(["child"])).toMatchObject({ status: "completed", result: 42 });
	});
});

it("checked Extension commands replace canonical action results in registration order", async () => {
	const name: string = "child";
	const commands = [defineCommand(name, (c) => c.action(() => "replacement"))];
	const app = new Crust("app")
		.command("child", (c) => c.action(() => 42))
		.extend(defineExtension(defineExtensionId("replace"), { commands }));
	expect(await app.run(["child"], {})).toMatchObject({
		status: "completed",
		result: "replacement",
	});
});

it("keeps compatible hook providers and unrelated descendant replacements lazy", async () => {
	let calls = 0;
	const text = defineContext("db", () => {
		calls++;
		return "root";
	});
	const compatible = defineCommand("child", (c) => c.provide(text.of("child")).action(() => 42));
	const seen: string[] = [];
	const hook = defineExtension(defineExtensionId("hook"), {
		uses: [text],
		hooks: {
			preRun: async ({ ctx }) => {
				seen.push((await ctx.db).toUpperCase());
			},
		},
	});
	const app = new Crust("app").provide(text()).add(compatible).extend(hook);
	expect(calls).toBe(0);
	expect(await app.run(["child"])).toMatchObject({ status: "completed", result: 42 });
	expect(seen).toEqual(["CHILD"]);
	expect(calls).toBe(0);
	const unrelated = defineCommand("other", (c) =>
		c.provide(defineContext("db", () => 7)()).action(async ({ ctx }) => await ctx.db),
	);
	const command = defineCommand("consumer", (c) => c.use(text));
	const noHook = defineExtension(defineExtensionId("commands"), { commands: [command] });
	expect(
		await new Crust("app").provide(text()).extend(noHook).add(unrelated).run(["other"]),
	).toMatchObject({ status: "completed", result: 7 });
});

it("checks pending Extension flag relations at the consuming checked operation", () => {
	const ext = defineExtension(defineExtensionId("pending"), {
		flags: [{ name: "token", type: "string" }],
	});
	const root = new Crust("app").extend(ext);
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	expect(() => root.flags({ name: "token", type: "number" })).toThrow("collides");
	const owner = defineContext("owner", { flags: [{ name: "token", type: "number" }] }, () => 1);
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	expect(() => root.provide(owner())).toThrow("collides");
});

it("opaque synchronous parser payloads retain identity without then or prototype probing", async () => {
	const value = new Proxy(
		{
			value: 42,
			// oxlint-disable-next-line unicorn/no-thenable -- hostile payload fixture proves no generic thenable probing.
			get then() {
				throw new Error("unnecessary then inspection");
			},
		},
		{
			getPrototypeOf() {
				throw new Error("unnecessary Promise inspection");
			},
		},
	);
	const app = new Crust("app")
		.flags({ name: "value", type: "string", parse: () => value })
		// Nest the payload to avoid ordinary async return-value thenable assimilation.
		.action(({ flags }) => ({ value: flags.value }));
	const outcome = await app.run([], { flags: { value: "input" } });
	expect(outcome.status).toBe("completed");
	if (outcome.status === "completed") expect(outcome.result.value).toBe(value);
});

it("locally proven helper results cannot be rewritten before checked consumption", async () => {
	const flag = defineFlag("token", { type: "string", short: "t" });
	expect(() => Object.assign(flag, { short: "too-long" })).toThrow();
	expect(
		await new Crust("app")
			.flags(flag)
			.action(({ flags }) => flags.token)
			.run([], { flags: { token: "safe" } }),
	).toMatchObject({ status: "completed", result: "safe" });
});

it("keeps canonical precedence and earliest-alias routing under checked replacement", async () => {
	const old = defineCommand("old", { aliases: ["shared"] }, (c) => c.action(() => 42));
	const incoming = defineCommand("incoming", { aliases: ["shared", "old"] }, (c) =>
		c.action(() => "new"),
	);
	const aliasExtension: Extension = defineExtension(defineExtensionId("alias"), {
		commands: [incoming],
	});
	const app = new Crust("app").add(old).extend(aliasExtension);
	expect(await app.run(["shared"], {})).toMatchObject({ status: "completed", result: 42 });
	expect(await app.run(["old"], {})).toMatchObject({ status: "completed", result: 42 });
	const canonicalExtension: Extension = defineExtension(defineExtensionId("canonical"), {
		commands: [defineCommand("shared", (c) => c.action(() => true))],
	});
	const canonical = new Crust("app").add(old).extend(canonicalExtension);
	expect(await canonical.run(["shared"])).toMatchObject({ status: "completed", result: true });
	const replacementExtension: Extension = defineExtension(defineExtensionId("replace"), {
		commands: [defineCommand("old", (c) => c.action(() => "replacement"))],
	});
	const replaced = new Crust("app").add(old).extend(replacementExtension);
	await expect(unwrap(replaced.run(["shared"]))).rejects.toMatchObject({
		code: "COMMAND_NOT_FOUND",
	});
	expect(await replaced.run(["old"])).toMatchObject({ status: "completed", result: "replacement" });
});

it("owns the checked parser function instead of rereading the mutable author object", async () => {
	const definition = { name: "value", type: "string" as const, parse: () => 1 };
	const app = new Crust("app").flags(definition).action(({ flags }) => flags.value);
	definition.parse = () => 2;
	expect(await app.run([], { flags: { value: "input" } })).toMatchObject({
		status: "completed",
		result: 1,
	});
});

it("checked optional parsers preserve both executable output branches", async () => {
	for (const parse of [undefined, (raw: string) => Number(raw)]) {
		const app = new Crust("app")
			.flags(defineFlag("value", { type: "string", parse }))
			.action(({ flags }) => flags.value);
		expect(await app.run([], { flags: { value: "42" } })).toMatchObject({
			status: "completed",
			result: parse ? 42 : "42",
		});
	}
});

it("checks Extension config flag relations before trusted reuse, including each factory result", () => {
	const owner = defineContext(
		"owner",
		{ flags: [{ name: "token", type: "string", short: "t" }] },
		() => 1,
	);
	const peer = defineContext(
		"peer",
		{ flags: [{ name: "other", type: "boolean", short: "t" }] },
		() => 2,
	);
	const config = { flags: [{ name: "token", type: "boolean" as const }], provides: [owner()] };
	expect(() => defineExtension(defineExtensionId("direct"), config)).toThrow("collides");
	const factory = defineExtension(defineExtensionId("factory"), () => config);
	expect(() => factory()).toThrow("collides");
	expect(() =>
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		defineExtension(defineExtensionId("peers"), { provides: [owner(), peer()] }),
	).toThrow("collides");
});

it("keeps same-name Context replacement order inside checked Extension configs", async () => {
	const old = defineContext("owner", { flags: [{ name: "old", type: "string" }] }, () => "old");
	const current = defineContext(
		"owner",
		{ flags: [{ name: "current", type: "string" }] },
		() => "current",
	);
	const ext = defineExtension(defineExtensionId("replacement"), { provides: [old(), current()] });
	const app = new Crust("app").extend(ext).action(({ ctx }) => ctx.owner);
	expect(await app.run([], {})).toMatchObject({ status: "completed", result: "current" });
	const emptyOld = defineContext("empty", () => "old");
	const emptyNew = defineContext("empty", () => "new");
	const empty = defineExtension(defineExtensionId("empty-replacement"), {
		provides: [emptyOld(), emptyNew()],
	});
	expect(
		await new Crust("app")
			.extend(empty)
			.action(({ ctx }) => ctx.empty)
			.run([], {}),
	).toMatchObject({ status: "completed", result: "new" });
	expect(() =>
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		defineExtension(defineExtensionId("repeated-owned"), { provides: [old(), old()] }),
	).toThrow("collides");
	expect(() =>
		defineExtension(defineExtensionId("bad-default"), {
			// @ts-expect-error -- runtime regression deliberately exercises helper validation.
			flags: [{ name: "mode", type: "string", choices: ["allowed"], default: "forbidden" }],
		}),
	).toThrow("default must be one of choices");
});

it("checked providers validate pending contributed commands lazily against final owned flags", async () => {
	let recipes = 0;
	let setups = 0;
	const owner = defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => {
		setups++;
		return 1;
	});
	const child = defineCommand("child", (c) => {
		recipes++;
		return c.flags({ name: "token", type: "boolean" });
	});
	const ext = defineExtension(defineExtensionId("pending-commands"), {
		commands: [defineCommand("parent", (c) => c.add(child))],
	});
	const root = new Crust("app").extend(ext);
	const widened: AnyContextInstance = owner();
	const app = root.provide(widened);
	expect(recipes).toBe(0);
	expect(setups).toBe(0);
	await expect(app.snapshot()).rejects.toThrow("collides");
	expect(setups).toBe(0);
	// The checked clone does not change the original registration or positional child scope.
	await expect(root.snapshot()).resolves.toBeDefined();
	await expect(new Crust("app").add(child).provide(owner()).snapshot()).resolves.toBeDefined();
});

it("a dynamic helper name does not inspect trusted parser results", async () => {
	const value = new Proxy(
		{ value: 42 },
		{
			getPrototypeOf() {
				throw new Error("unnecessary Promise inspection");
			},
		},
	);
	const flag = defineFlag("value", { type: "string", parse: () => value });
	const arg = defineArg("value", { type: "string", parse: () => value });
	const flags = new Crust("app").flags(flag).action(({ flags }) => flags.value);
	const args = new Crust("app").args(arg).action(({ args }) => args.value);
	for (const outcome of [
		await flags.run([], { flags: { value: "raw" } }),
		await args.run([], { args: { value: "raw" } }),
	]) {
		expect(outcome.status).toBe("completed");
		if (outcome.status === "completed") expect(outcome.result).toBe(value);
	}
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	expect(() => defineFlag("no-value", { type: "string" })).toThrow("must not start");
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	expect(() => defineFlag("alias", { type: "string", aliases: ["alias"] })).toThrow("repeats");
});

it("checked invocation owns uncertain choices, requiredness and noNegate", async () => {
	const choices: string[] = ["allowed"];
	const app = new Crust("app")
		.flags(defineFlag("mode", { type: "string", choices }))
		.action(({ flags }) => flags.mode);
	const erased: AnyCrust = app;
	await expect(unwrap(erased.run([], { flags: { mode: "forbidden" } }))).rejects.toThrow(
		"Expected one of",
	);
	expect(await erased.run([], { flags: { mode: "allowed" } })).toMatchObject({
		status: "completed",
		result: "allowed",
	});
	const required = new Crust("app").flags({
		name: "token",
		type: "string",
		required: true,
		default: undefined,
	});
	const erasedRequired: AnyCrust = required;
	await expect(unwrap(erasedRequired.run([], {}))).rejects.toThrow("Missing required flag");
	const toggle: AnyCrust = new Crust("app").flags({
		name: "yes",
		type: "boolean",
		noNegate: true,
	});
	await expect(unwrap(toggle.run([], { flags: { yes: false } }))).rejects.toThrow(
		"does not support negation",
	);
});

it("checked uncertain occurrence layouts preserve schema ownership and variadic output", async () => {
	for (const multiple of [true, undefined] as const) {
		let calls = 0;
		const schema = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate(value: unknown) {
					calls++;
					return { value };
				},
			},
		};
		const app = new Crust("app")
			.flags({ name: "value", type: "string", schema, multiple })
			.action(({ flags }) => flags.value);
		const value = multiple ? ["raw"] : "raw";
		const erasedApp: AnyCrust = app;
		expect(await erasedApp.run([], { flags: { value } })).toMatchObject({
			status: "completed",
			result: value,
		});
		expect(calls).toBe(1);
		const arg = new Crust("app")
			.args({ name: "value", type: "string", variadic: multiple })
			.action(({ args }) => args.value);
		const erasedArg: AnyCrust = arg;
		expect(await erasedArg.run([], { args: { value } })).toMatchObject({
			status: "completed",
			result: value,
		});
	}
});

it("checked Extensions validate earlier pending commands against new flags and provider flags lazily", async () => {
	for (const source of ["flags", "provider"] as const) {
		let recipes = 0;
		let setups = 0;
		const owner = defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => {
			setups++;
			return 1;
		});
		const child = defineCommand("child", (c) => {
			recipes++;
			return c.flags({ name: "token", type: "boolean" });
		});
		const pending = defineExtension(defineExtensionId("pending"), {
			commands: [defineCommand("parent", (c) => c.add(child))],
		});
		const addition =
			source === "flags"
				? defineExtension(defineExtensionId("addition"), {
						flags: [{ name: "token", type: "string" }],
					})
				: defineExtension(defineExtensionId("addition"), { provides: [owner()] });
		const root = new Crust("app").extend(pending);
		const app = root.extend(addition);
		expect(recipes).toBe(0);
		expect(setups).toBe(0);
		await expect(app.snapshot()).rejects.toThrow("collides");
		expect(recipes).toBe(1);
		expect(setups).toBe(0);
		await expect(root.snapshot()).resolves.toBeDefined();
		await expect(new Crust("app").extend(addition).extend(pending).snapshot()).rejects.toThrow(
			"collides",
		);
	}
});

it("validates extension flags against the final replaced command tree", async () => {
	const first = defineExtension(defineExtensionId("first"), {
		commands: [defineCommand("child", (c) => c.flags({ name: "token", type: "boolean" }))],
	});
	const recursive = defineExtension(defineExtensionId("recursive-token"), {
		flags: [{ name: "token", type: "string", recursive: true }],
	});
	const replacement = defineExtension(defineExtensionId("replacement"), {
		commands: [defineCommand("child", (c) => c.action(() => "replacement"))],
	});
	// @ts-expect-error -- static tuples reject the transient collision; runtime validates the final replaced tree.
	const app = new Crust("app").extend(first, recursive, replacement);
	expect(await app.run(["child"])).toMatchObject({
		status: "completed",
		result: "replacement",
	});
});

it("checked inputs validate open inherited flags without changing positional provider scope", async () => {
	const owner = defineContext(
		"owner",
		{ flags: [{ name: "token", type: "string", required: true }] },
		() => 1,
	);
	const providers = [owner()];
	const child = defineCommand("child", (c) =>
		c.add(defineCommand("leaf", (c) => c.action(() => "leaf"))),
	);
	const inherited = new Crust("app").provide(...providers).add(child);
	await expect(unwrap(inherited.run(["child", "leaf"], {}))).rejects.toThrow(
		"Missing required flag",
	);
	expect(await inherited.run(["child", "leaf"], { flags: { token: "ok" } })).toMatchObject({
		status: "completed",
		result: "leaf",
	});
	expect(
		await new Crust("app")
			.add(child)
			.provide(...providers)
			.run(["child", "leaf"]),
	).toMatchObject({ status: "completed", result: "leaf" });
	for (const recursive of [true, false]) {
		const ext = defineExtension(defineExtensionId("recursive"), {
			flags: [{ name: "token", type: "string", required: true, recursive }],
		});
		for (const app of [
			new Crust("app").add(child).extend(ext),
			new Crust("app").extend(ext).add(child),
		]) {
			if (recursive)
				await expect(unwrap(app.run(["child", "leaf"], {}))).rejects.toThrow(
					"Missing required flag",
				);
			else
				expect(await app.run(["child", "leaf"], {})).toMatchObject({
					status: "completed",
					result: "leaf",
				});
		}
	}
});

it("checked invocation validates the actual conditional argument and template choice", async () => {
	for (const condition of [true, false]) {
		const definitions = condition
			? ([{ name: "a", type: "string", required: true }] as const)
			: ([{ name: "b", type: "string", required: true }] as const);
		const app = new Crust("app").args(...definitions).action(() => "ok");
		await expect(unwrap(app.run([], {}))).rejects.toThrow("Missing required argument");
		expect(await app.run([], { args: condition ? { a: "value" } : { b: "value" } })).toMatchObject({
			status: "completed",
			result: "ok",
		});
	}
	const choice: `mode-${string}` = `mode-${Math.random()}`;
	const app = new Crust("app").flags({ name: "mode", type: "string", choices: [choice] });
	const erased: AnyCrust = app;
	await expect(unwrap(erased.run([], { flags: { mode: "mode-other" } }))).rejects.toThrow(
		"Expected one of",
	);
	await expect(erased.run([], { flags: { mode: choice } })).resolves.toMatchObject({
		status: "completed",
	});
});

it("checked template identities validate actual names and required values", async () => {
	const name: `mode-${string}` = `mode-${Math.random()}`;
	const flag = defineFlag(name, { type: "string", required: true });
	const app = new Crust("app").flags(flag);
	await expect(unwrap(app.run([], {}))).rejects.toThrow("Missing required flag");
	await expect(app.run([], { flags: { [name]: "ok" } })).resolves.toMatchObject({
		status: "completed",
	});
	const blank: `${string} ` = " ";
	expect(() => new Crust(blank)).toThrow("non-empty");
	expect(() => defineCommand(blank, (c) => c)).toThrow("non-empty");
	// Context names have no command-name grammar.
	expect(defineContext(blank, () => 1).contextName).toBe(blank);
});

it("checked Extension additions preserve nonrecursive flags and same-id replacement", async () => {
	const child = defineCommand("child", (c) => c.flags({ name: "token", type: "boolean" }));
	const id = defineExtensionId("pending-replacement");
	const pending = defineExtension(id, { commands: [child] });
	const root = new Crust("app").extend(pending);
	const local = defineExtension(defineExtensionId("local"), {
		flags: [{ name: "token", type: "string", recursive: false }],
	});
	const localExtension: Extension = local;
	await expect(root.extend(localExtension).snapshot()).resolves.toBeDefined();
	const replacement = defineExtension(id, { flags: [{ name: "token", type: "string" }] });
	const replacementExtension: Extension = replacement;
	const snapshot = await root.extend(replacementExtension).snapshot();
	expect(snapshot.subCommands).toEqual({});
});

it("rejects supplied flag keys retired by same-ID Extension replacement", async () => {
	const id = defineExtensionId("retired-flags");
	const original = new Crust("app")
		.extend(defineExtension(id, { flags: [{ name: "oldFlag", type: "string", required: true }] }))
		.action(({ flags }): string => flags.oldFlag);
	const replacement = defineExtension(id, { flags: [{ name: "newFlag", type: "boolean" }] });
	await expect(
		unwrap(original.extend(replacement).run([], { flags: { oldFlag: "supplied" } })),
	).rejects.toMatchObject({ code: "PARSE", message: 'Unknown flag "--oldFlag"' });
	expect(await original.run([], { flags: { oldFlag: "supplied" } })).toMatchObject({
		status: "completed",
		result: "supplied",
	});
});

it("rejects retired recursive keys on existing and later descendants and same-call replacements", async () => {
	const id = defineExtensionId("retired-recursive");
	const old = defineExtension(id, { flags: [{ name: "oldFlag", type: "string", required: true }] });
	const replacement = defineExtension(id, {});
	const grand = defineCommand("grand", (g) => g.action(() => "grand"));
	const child = defineCommand("child", (c) => c.add(grand));
	const original = new Crust("app").extend(old).add(child);
	await expect(
		unwrap(original.extend(replacement).run(["child", "grand"], { flags: { oldFlag: "value" } })),
	).rejects.toThrow('Unknown flag "--oldFlag"');
	const later = new Crust("app").extend(old, replacement).add(child);
	await expect(
		unwrap(later.run(["child", "grand"], { flags: { oldFlag: "value" } })),
	).rejects.toThrow('Unknown flag "--oldFlag"');
	const pendingExtension = defineExtension(defineExtensionId("later-recipe"), {
		commands: [defineCommand("pending", (c) => c.action(() => "pending"))],
	});
	const pending = new Crust("app").extend(old, replacement, pendingExtension);
	await expect(unwrap(pending.run(["pending"], { flags: { oldFlag: "value" } }))).rejects.toThrow(
		'Unknown flag "--oldFlag"',
	);
	expect(await original.run(["child", "grand"], { flags: { oldFlag: "original" } })).toMatchObject({
		status: "completed",
		result: "grand",
	});
});

it("rejects retired Extension provider flags in both registration forms without setup", async () => {
	let setups = 0;
	const provider = defineContext(
		"provider",
		{ flags: [{ name: "provided", type: "string", required: true }] },
		() => {
			setups++;
			return "provider";
		},
	);
	const id = defineExtensionId("retired-provider");
	const old = defineExtension(id, { provides: [provider()] });
	const replacement = defineExtension(id, {});
	const grand = defineCommand("grand", (g) => g.action(() => "grand"));
	const child = defineCommand("child", (c) => c.add(grand));
	const original = new Crust("app").extend(old).add(child);
	await expect(
		unwrap(original.extend(replacement).run(["child", "grand"], { flags: { provided: "value" } })),
	).rejects.toThrow('Unknown flag "--provided"');
	await expect(
		unwrap(new Crust("app").extend(old, replacement).run([], { flags: { provided: "value" } })),
	).rejects.toThrow('Unknown flag "--provided"');
	expect(setups).toBe(0);
	expect(await original.run(["child", "grand"], { flags: { provided: "original" } })).toMatchObject(
		{
			status: "completed",
			result: "grand",
		},
	);
});

it("keeps surviving and reintroduced keys and nonrecursive replacement scope", async () => {
	const id = defineExtensionId("retired-local");
	const old = defineExtension(id, {
		flags: [{ name: "local", type: "string", required: true, recursive: false }],
	});
	const original = new Crust("app").extend(old).command("child", (c) => c.action(() => "child"));
	const removed = original.extend(defineExtension(id, {}));
	await expect(unwrap(removed.run([], { flags: { local: "value" } }))).rejects.toThrow(
		'Unknown flag "--local"',
	);
	expect(await removed.run(["child"])).toMatchObject({ status: "completed", result: "child" });
	const widened: Extension = old;
	expect(await removed.extend(widened).run([], { flags: { local: "value" } })).toMatchObject({
		status: "completed",
		result: undefined,
	});
	expect(await original.extend(widened).run([], { flags: { local: "value" } })).toMatchObject({
		status: "completed",
		result: undefined,
	});

	const recursive = defineExtension(id, {
		flags: [{ name: "local", type: "string", required: true }],
	});
	const narrowed = new Crust("app")
		.extend(recursive)
		.command("child", (c) => c.action(() => "child"))
		.extend(widened);
	expect(await narrowed.run([], { flags: { local: "value" } })).toMatchObject({
		status: "completed",
		result: undefined,
	});
	await expect(unwrap(narrowed.run(["child"], { flags: { local: "value" } }))).rejects.toThrow(
		'Unknown flag "--local"',
	);
});

it("checked positional input enforces the actual uncertain kind, including local helpers", async () => {
	const build = (type: "string" | "number"): AnyCrust =>
		new Crust("app").args({ name: "value", type, required: true }).action(({ args }) => args.value);
	await expect(unwrap(build("string").run([], { args: { value: 42 } }))).rejects.toThrow(
		"Expected string",
	);
	expect(await build("number").run([], { args: { value: 42 } })).toMatchObject({
		status: "completed",
		result: 42,
	});
	const helper = (type: "string" | "number"): AnyCrust =>
		new Crust("app")
			.args(defineArg("value", { type, required: true }))
			.action(({ args }) => args.value);
	await expect(unwrap(helper("number").run([], { args: { value: "text" } }))).rejects.toThrow(
		"Expected number",
	);
	expect(await helper("string").run([], { args: { value: "text" } })).toMatchObject({
		status: "completed",
		result: "text",
	});
});

it("does not mistake inherited object names for surviving replacement flags", async () => {
	const id = defineExtensionId("retired-prototype-name");
	const old = defineExtension(id, {
		flags: [{ name: "toString", type: "string", required: true }],
	});
	const replacement = defineExtension(id, { flags: [{ name: "other", type: "boolean" }] });
	const app = new Crust("app").extend(old, replacement);
	await expect(unwrap(app.run([], { flags: { toString: "value" } }))).rejects.toThrow(
		'Unknown flag "--toString"',
	);
});

it("retires actually inherited provider flags even below a later Context shadow", async () => {
	const provider = defineContext(
		"shadowed",
		{ flags: [{ name: "inherited", type: "string", required: true }] },
		() => "original",
	);
	const shadow = defineContext("shadowed", () => 42);
	const child = defineCommand("child", (c) => c.provide(shadow()).action(() => "child"));
	const id = defineExtensionId("retired-shadowed-provider");
	const old = defineExtension(id, { provides: [provider()] });
	const original = new Crust("app").extend(old).add(child);
	await expect(
		unwrap(
			original.extend(defineExtension(id, {})).run(["child"], { flags: { inherited: "value" } }),
		),
	).rejects.toThrow('Unknown flag "--inherited"');
	// Reinstalling the root provider still skips a more specific child Context.
	const widened: Extension = old;
	await expect(
		unwrap(original.extend(widened).run(["child"], { flags: { inherited: "value" } })),
	).rejects.toThrow('Unknown flag "--inherited"');
	expect(await original.run(["child"], { flags: { inherited: "value" } })).toMatchObject({
		status: "completed",
		result: "child",
	});
});

it("consumes each conditional helper branch without losing requiredness or negation", async () => {
	type ConditionalApps = Record<"flag" | "arg" | "child" | "toggle", AnyCrust>;
	const build = (condition: boolean): ConditionalApps => {
		const definition: { type: "string"; required: true } | { type: "string" } = condition
			? { type: "string", required: true }
			: { type: "string" };
		const flag = defineFlag("mode", definition);
		const widenedFlag: NamedFlagDef = flag;
		const arg = defineArg("mode", definition);
		const boolean: { type: "boolean"; noNegate: true } | { type: "boolean" } = condition
			? { type: "boolean", noNegate: true }
			: { type: "boolean" };
		return {
			flag: new Crust("app").flags(flag).action(({ flags }) => flags.mode),
			arg: new Crust("app").args(arg).action(({ args }) => args),
			child: new Crust("app").add(defineCommand("child", (c) => c.flags(widenedFlag))),
			toggle: new Crust("app")
				.flags(defineFlag("toggle", boolean))
				.action(({ flags }) => flags.toggle),
		};
	};
	const required = build(true);
	await expect(unwrap(required.flag.run([], {}))).rejects.toThrow('Missing required flag "--mode"');
	await expect(unwrap(required.arg.run([], {}))).rejects.toThrow(
		'Missing required argument "<mode>"',
	);
	await expect(unwrap(required.child.run(["child"], {}))).rejects.toThrow(
		'Missing required flag "--mode"',
	);
	await expect(unwrap(required.toggle.run([], { flags: { toggle: false } }))).rejects.toThrow(
		"does not support negation",
	);
	const optional = build(false);
	expect(await optional.flag.run([], {})).toMatchObject({
		status: "completed",
		result: undefined,
	});
	expect(await optional.arg.run([], {})).toMatchObject({
		status: "completed",
		result: { mode: undefined },
	});
	expect(await optional.toggle.run([], { flags: { toggle: false } })).toMatchObject({
		status: "completed",
		result: false,
	});
	expect(await required.flag.run([], { flags: { mode: "value" } })).toMatchObject({
		status: "completed",
		result: "value",
	});
});

it("preserves conditional helper parsers, defaults and their actual outputs", async () => {
	for (const condition of [true, false]) {
		const parsed: { type: "string"; parse: (raw: string) => number } | { type: "string" } =
			condition ? { type: "string", parse: Number } : { type: "string" };
		const app = new Crust("app")
			.flags(defineFlag("value", parsed))
			.args(defineArg("value", parsed))
			.action(({ flags, args }) => [flags.value, args]);
		const erased: AnyCrust = app;
		expect(await erased.run([], { flags: { value: "12" }, args: { value: "12" } })).toMatchObject({
			status: "completed",
			result: condition ? [12, { value: 12 }] : ["12", { value: "12" }],
		});
		const defaults: { type: "string"; required: true; default: "a" } | { type: "string" } =
			condition ? { type: "string", required: true, default: "a" } : { type: "string" };
		const defaulted = new Crust("app")
			.flags(defineFlag("mode", defaults))
			.action(({ flags }) => flags.mode);
		expect(await defaulted.run([], {})).toMatchObject({
			status: "completed",
			result: condition ? "a" : undefined,
		});
	}
});

it("keeps compatible conditional descendant providers lazy in either hook attachment order", async () => {
	for (const condition of [true, false]) {
		let setups = 0;
		const text = defineContext("db", () => {
			setups++;
			return "db";
		});
		const compatible = defineContext("db", () => {
			setups++;
			return "child";
		});
		const demand = defineExtension(defineExtensionId("conditional-demand"), {
			uses: [text],
			hooks: {
				preRun: async ({ ctx }) => {
					expect((await ctx.db).toUpperCase()).toBe(condition ? "CHILD" : "DB");
				},
			},
		});
		const leaf = defineCommand("leaf", (c) => (condition ? c.provide(compatible()) : c));
		const nested = defineCommand("nested", (c) => c.add(leaf));
		const root = new Crust("app").provide(text());
		const before = root.extend(demand).add(nested);
		const after = root.add(nested).extend(demand);
		expect(setups).toBe(0);
		await before.snapshot();
		await after.snapshot();
		expect(setups).toBe(0);
		await unwrap(before.run(["nested", "leaf"]));
		await unwrap(after.run(["nested", "leaf"]));
		expect(setups).toBe(2);
	}
});
