import { describe, expect, it } from "bun:test";

import { Crust, defineCommand } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import { runtime } from "../runtime.ts";
import { defineContext } from "./context.ts";
import { defineExtension } from "./extension.ts";
import { defineFlag, defineArg } from "./flags.ts";

describe("checked Extension attachment", () => {
	it("checks declared dependencies without running setup", () => {
		let calls = 0;
		const db = defineContext("db", () => {
			calls++;
			return "db";
		});
		const extension = defineExtension(defineExtensionId("db"), { uses: [db] });
		expect(() => new Crust("app").extend(runtime([extension]))).toThrow("No provider for Context");
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
		const app = new Crust("app").extend(runtime([extension]));
		await expect(app.snapshot()).rejects.toThrow("No provider for Context");
		expect(calls).toBe(0);
	});
	it("consumes the immutable defining Extension rather than overwritten spread fields", async () => {
		const extension = defineExtension(defineExtensionId("original"), {
			commands: [defineCommand("child", (c) => c.action(() => 42))],
		});
		const copy = { ...extension, commands: [] };
		const app = new Crust("app").extend(copy);
		expect(await app.run(["child"])).toEqual({ status: "completed", result: 42 });
	});
});

it("checked Extension commands replace canonical action results in registration order", async () => {
	const name: string = "child";
	const commands = [defineCommand(runtime(name), (c) => c.action(() => "replacement"))];
	const app = new Crust("app")
		.command("child", (c) => c.action(() => 42))
		.extend(runtime([defineExtension(defineExtensionId("replace"), runtime({ commands }))]));
	expect(await app.run(["child"], runtime({}))).toEqual({
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
	const app = new Crust("app")
		.provide(text())
		.add(compatible)
		.extend(runtime([hook]));
	expect(calls).toBe(0);
	expect(await app.run(["child"])).toEqual({ status: "completed", result: 42 });
	expect(seen).toEqual(["CHILD"]);
	expect(calls).toBe(0);
	const unrelated = defineCommand("other", (c) =>
		c.provide(defineContext("db", () => 7)()).action(async ({ ctx }) => await ctx.db),
	);
	const command = defineCommand("consumer", (c) => c.use(text));
	const noHook = defineExtension(defineExtensionId("commands"), { commands: [command] });
	expect(
		await new Crust("app").provide(text()).extend(noHook).add(unrelated).run(["other"]),
	).toEqual({ status: "completed", result: 7 });
});

it("checks pending Extension flag relations at the consuming checked operation", () => {
	const ext = defineExtension(defineExtensionId("pending"), {
		flags: [{ name: "token", type: "string" }],
	});
	const root = new Crust("app").extend(ext);
	expect(() => root.flags(runtime([{ name: "token", type: "number" }]))).toThrow("collides");
	const owner = defineContext("owner", { flags: [{ name: "token", type: "number" }] }, () => 1);
	expect(() => root.provide(runtime([owner()]))).toThrow("collides");
	const child = defineCommand("child", (c) => c.flags({ name: "token", type: "number" }));
	expect(() => root.add(runtime([child]))).toThrow("collides");
	expect(() =>
		new Crust("app").flags({ name: "token", type: "number" }).extend(runtime([ext])),
	).toThrow("collides");
});

it("trusted synchronous parser results do not undergo dynamic Promise inspection", async () => {
	const value = new Proxy(
		{ value: 42 },
		{
			getPrototypeOf() {
				throw new Error("unnecessary Promise inspection");
			},
		},
	);
	const app = new Crust("app")
		.flags({ name: "value", type: "string", parse: () => value })
		.action(({ flags }) => flags.value);
	const outcome = await app.run([], { flags: { value: "input" } });
	expect(outcome.status).toBe("completed");
	if (outcome.status === "completed") expect(outcome.result).toBe(value);
});

it("locally proven helper results cannot be rewritten before checked consumption", async () => {
	const flag = defineFlag(runtime("token"), runtime({ type: "string", short: "t" }));
	expect(() => Object.assign(flag, { short: "too-long" })).toThrow();
	expect(
		await new Crust("app")
			.flags(runtime([flag]))
			.action(({ flags }) => flags.token)
			.run([], { flags: { token: "safe" } }),
	).toEqual({ status: "completed", result: "safe" });
});

it("keeps canonical precedence and earliest-alias routing under checked replacement", async () => {
	const old = defineCommand("old", { aliases: ["shared"] }, (c) => c.action(() => 42));
	const incoming = defineCommand("incoming", { aliases: ["shared", "old"] }, (c) =>
		c.action(() => "new"),
	);
	const app = new Crust("app")
		.add(old)
		.extend(runtime([defineExtension(defineExtensionId("alias"), { commands: [incoming] })]));
	expect(await app.run(["shared"], runtime({}))).toEqual({ status: "completed", result: 42 });
	expect(await app.run(["old"], runtime({}))).toEqual({ status: "completed", result: 42 });
	const canonical = new Crust("app").add(old).extend(
		runtime([
			defineExtension(defineExtensionId("canonical"), {
				commands: [defineCommand("shared", (c) => c.action(() => true))],
			}),
		]),
	);
	expect(await canonical.run(["shared"])).toEqual({ status: "completed", result: true });
	const replaced = new Crust("app").add(old).extend(
		runtime([
			defineExtension(defineExtensionId("replace"), {
				commands: [defineCommand("old", (c) => c.action(() => "replacement"))],
			}),
		]),
	);
	await expect(replaced.run(["shared"])).rejects.toMatchObject({ code: "COMMAND_NOT_FOUND" });
	expect(await replaced.run(["old"])).toEqual({ status: "completed", result: "replacement" });
});

it("owns the checked parser function instead of rereading the mutable author object", async () => {
	const definition = { name: "value", type: "string" as const, parse: () => 1 };
	const app = new Crust("app").flags(runtime([definition])).action(({ flags }) => flags.value);
	definition.parse = () => 2;
	expect(await app.run([], runtime({ flags: { value: "input" } }))).toEqual({
		status: "completed",
		result: 1,
	});
});

it("checked optional parsers preserve both executable output branches", async () => {
	for (const parse of [undefined, (raw: string) => Number(raw)]) {
		const app = new Crust("app")
			.flags(runtime([defineFlag("value", runtime({ type: "string", parse }))]))
			.action(({ flags }) => flags.value);
		expect(await app.run([], { flags: { value: "42" } })).toEqual({
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
	expect(() => defineExtension(defineExtensionId("direct"), runtime(config))).toThrow("collides");
	const factory = defineExtension(
		defineExtensionId("factory"),
		runtime(() => config),
	);
	expect(() => factory()).toThrow("collides");
	expect(() =>
		defineExtension(defineExtensionId("peers"), runtime({ provides: [owner(), peer()] })),
	).toThrow("collides");
});

it("keeps same-name Context replacement order inside checked Extension configs", async () => {
	const old = defineContext("owner", { flags: [{ name: "old", type: "string" }] }, () => "old");
	const current = defineContext(
		"owner",
		{ flags: [{ name: "current", type: "string" }] },
		() => "current",
	);
	const ext = defineExtension(
		defineExtensionId("replacement"),
		runtime({ provides: [old(), current()] }),
	);
	const app = new Crust("app").extend(runtime([ext])).action(({ ctx }) => ctx.owner);
	expect(await app.run([], runtime({}))).toEqual({ status: "completed", result: "current" });
	const emptyOld = defineContext("empty", () => "old");
	const emptyNew = defineContext("empty", () => "new");
	const empty = defineExtension(
		defineExtensionId("empty-replacement"),
		runtime({ provides: [emptyOld(), emptyNew()] }),
	);
	expect(
		await new Crust("app")
			.extend(runtime([empty]))
			.action(({ ctx }) => ctx.empty)
			.run([], runtime({})),
	).toEqual({ status: "completed", result: "new" });
	expect(() =>
		defineExtension(defineExtensionId("repeated-owned"), runtime({ provides: [old(), old()] })),
	).toThrow("collides");
	expect(() =>
		defineExtension(
			defineExtensionId("bad-default"),
			runtime({
				flags: [{ name: "mode", type: "string", choices: ["allowed"], default: "forbidden" }],
			}),
		),
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
	const app = root.provide(runtime([owner()]));
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
	const flag = defineFlag(runtime("value"), { type: "string", parse: () => value });
	const arg = defineArg(runtime("value"), { type: "string", parse: () => value });
	const flags = new Crust("app").flags(flag).action(({ flags }) => flags.value);
	const args = new Crust("app").args(arg).action(({ args }) => args.value);
	for (const outcome of [
		await flags.run([], { flags: { value: "raw" } }),
		await args.run([], { args: { value: "raw" } }),
	]) {
		expect(outcome.status).toBe("completed");
		if (outcome.status === "completed") expect(outcome.result).toBe(value);
	}
	expect(() => defineFlag(runtime("no-value"), { type: "string" })).toThrow("must not start");
	expect(() => defineFlag(runtime("alias"), { type: "string", aliases: ["alias"] })).toThrow(
		"repeats",
	);
	expect(() => defineArg(runtime(""), { type: "string" })).toThrow("non-empty");
});

it("checked invocation owns uncertain choices, requiredness and noNegate", async () => {
	const choices: string[] = ["allowed"];
	const app = new Crust("app")
		.flags(defineFlag("mode", runtime({ type: "string", choices })))
		.action(({ flags }) => flags.mode);
	await expect(app.run([], runtime({ flags: { mode: "forbidden" } }))).rejects.toThrow(
		"Expected one of",
	);
	expect(await app.run([], runtime({ flags: { mode: "allowed" } }))).toEqual({
		status: "completed",
		result: "allowed",
	});
	const required = new Crust("app").flags({
		name: "token",
		type: "string",
		required: true,
		default: undefined,
	});
	await expect(required.run([], runtime({}))).rejects.toThrow("Missing required flag");
	const toggle = new Crust("app").flags({ name: "yes", type: "boolean", noNegate: true });
	await expect(toggle.run([], runtime({ flags: { yes: false } }))).rejects.toThrow(
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
		expect(await app.run([], runtime({ flags: { value } }))).toEqual({
			status: "completed",
			result: value,
		});
		expect(calls).toBe(1);
		const arg = new Crust("app")
			.args(runtime([{ name: "value", type: "string", variadic: multiple }]))
			.action(({ args }) => args.value);
		expect(await arg.run([], runtime({ args: { value } }))).toEqual({
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
		const app = root.extend(runtime([addition]));
		expect(recipes).toBe(0);
		expect(setups).toBe(0);
		await expect(app.snapshot()).rejects.toThrow("collides");
		expect(recipes).toBe(1);
		expect(setups).toBe(0);
		await expect(root.snapshot()).resolves.toBeDefined();
		await expect(
			new Crust("app")
				.extend(runtime([addition]))
				.extend(runtime([pending]))
				.snapshot(),
		).rejects.toThrow("collides");
	}
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
	const inherited = new Crust("app").provide(runtime(providers)).add(runtime([child]));
	await expect(inherited.run(["child", "leaf"], runtime({}))).rejects.toThrow(
		"Missing required flag",
	);
	expect(await inherited.run(["child", "leaf"], runtime({ flags: { token: "ok" } }))).toEqual({
		status: "completed",
		result: "leaf",
	});
	expect(
		await new Crust("app").add(child).provide(runtime(providers)).run(["child", "leaf"]),
	).toEqual({ status: "completed", result: "leaf" });
	for (const recursive of [true, false]) {
		const ext = defineExtension(defineExtensionId("recursive"), {
			flags: [{ name: "token", type: "string", required: true, recursive }],
		});
		for (const app of [
			new Crust("app").add(child).extend(ext),
			new Crust("app").extend(ext).add(runtime([child])),
		]) {
			if (recursive)
				await expect(app.run(["child", "leaf"], runtime({}))).rejects.toThrow(
					"Missing required flag",
				);
			else
				expect(await app.run(["child", "leaf"], runtime({}))).toEqual({
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
		const app = new Crust("app").args(runtime(definitions)).action(() => "ok");
		await expect(app.run([], runtime({}))).rejects.toThrow("Missing required argument");
		expect(
			await app.run([], runtime({ args: condition ? { a: "value" } : { b: "value" } })),
		).toEqual({ status: "completed", result: "ok" });
	}
	const choice: `mode-${string}` = `mode-${Math.random()}`;
	const app = new Crust("app").flags({ name: "mode", type: "string", choices: [choice] });
	await expect(app.run([], runtime({ flags: { mode: "mode-other" } }))).rejects.toThrow(
		"Expected one of",
	);
	await expect(app.run([], runtime({ flags: { mode: choice } }))).resolves.toMatchObject({
		status: "completed",
	});
});

it("checked template identities validate actual names and required values", async () => {
	const name: `mode-${string}` = `mode-${Math.random()}`;
	const flag = defineFlag(runtime(name), { type: "string", required: true });
	const app = new Crust("app").flags(runtime([flag]));
	await expect(app.run([], runtime({}))).rejects.toThrow("Missing required flag");
	await expect(app.run([], runtime({ flags: { [name]: "ok" } }))).resolves.toMatchObject({
		status: "completed",
	});
	const blank: `${string} ` = " ";
	expect(() => new Crust(runtime(blank))).toThrow("non-empty");
	expect(() => defineCommand(runtime(blank), (c) => c)).toThrow("non-empty");
	// Context names have no command-name grammar.
	expect(defineContext(runtime(blank), () => 1).contextName).toBe(blank);
});

it("checked Extension additions preserve nonrecursive flags and same-id replacement", async () => {
	const child = defineCommand("child", (c) => c.flags({ name: "token", type: "boolean" }));
	const id = defineExtensionId("pending-replacement");
	const pending = defineExtension(id, { commands: [child] });
	const root = new Crust("app").extend(pending);
	const local = defineExtension(defineExtensionId("local"), {
		flags: [{ name: "token", type: "string", recursive: false }],
	});
	await expect(root.extend(runtime([local])).snapshot()).resolves.toBeDefined();
	const replacement = defineExtension(id, { flags: [{ name: "token", type: "string" }] });
	const snapshot = await root.extend(runtime([replacement])).snapshot();
	expect(snapshot.subCommands).toEqual({});
});

it("rejects supplied flag keys retired by same-ID Extension replacement", async () => {
	const id = defineExtensionId("retired-flags");
	const original = new Crust("app")
		.extend(defineExtension(id, { flags: [{ name: "oldFlag", type: "string", required: true }] }))
		.action(({ flags }): string => flags.oldFlag);
	const replacement = defineExtension(id, { flags: [{ name: "newFlag", type: "boolean" }] });
	await expect(
		original.extend(replacement).run([], { flags: { oldFlag: "supplied" } }),
	).rejects.toMatchObject({ code: "PARSE", message: 'Unknown flag "--oldFlag"' });
	await expect(
		original.extend(runtime([replacement])).run([], runtime({ flags: { oldFlag: "supplied" } })),
	).rejects.toMatchObject({ code: "PARSE", message: 'Unknown flag "--oldFlag"' });
	expect(await original.run([], { flags: { oldFlag: "supplied" } })).toEqual({
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
		original.extend(replacement).run(["child", "grand"], { flags: { oldFlag: "value" } }),
	).rejects.toThrow('Unknown flag "--oldFlag"');
	const later = new Crust("app").extend(old, replacement).add(child);
	await expect(later.run(["child", "grand"], { flags: { oldFlag: "value" } })).rejects.toThrow(
		'Unknown flag "--oldFlag"',
	);
	const pendingExtension = defineExtension(defineExtensionId("later-recipe"), {
		commands: [defineCommand("pending", (c) => c.action(() => "pending"))],
	});
	const pending = new Crust("app").extend(old, replacement, pendingExtension);
	await expect(pending.run(["pending"], { flags: { oldFlag: "value" } })).rejects.toThrow(
		'Unknown flag "--oldFlag"',
	);
	expect(await original.run(["child", "grand"], { flags: { oldFlag: "original" } })).toEqual({
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
		original.extend(replacement).run(["child", "grand"], { flags: { provided: "value" } }),
	).rejects.toThrow('Unknown flag "--provided"');
	await expect(
		new Crust("app").extend(old, replacement).run([], { flags: { provided: "value" } }),
	).rejects.toThrow('Unknown flag "--provided"');
	await expect(
		original
			.extend(runtime([replacement]))
			.run(["child", "grand"], runtime({ flags: { provided: "value" } })),
	).rejects.toThrow('Unknown flag "--provided"');
	expect(setups).toBe(0);
	expect(await original.run(["child", "grand"], { flags: { provided: "original" } })).toEqual({
		status: "completed",
		result: "grand",
	});
});

it("keeps surviving and reintroduced keys and nonrecursive replacement scope", async () => {
	const id = defineExtensionId("retired-local");
	const old = defineExtension(id, {
		flags: [{ name: "local", type: "string", required: true, recursive: false }],
	});
	const original = new Crust("app").extend(old).command("child", (c) => c.action(() => "child"));
	const removed = original.extend(defineExtension(id, {}));
	await expect(removed.run([], { flags: { local: "value" } })).rejects.toThrow(
		'Unknown flag "--local"',
	);
	expect(await removed.run(["child"])).toEqual({ status: "completed", result: "child" });
	expect(await removed.extend(runtime([old])).run([], { flags: { local: "value" } })).toEqual({
		status: "completed",
		result: undefined,
	});
	expect(await original.extend(runtime([old])).run([], { flags: { local: "value" } })).toEqual({
		status: "completed",
		result: undefined,
	});

	const recursive = defineExtension(id, {
		flags: [{ name: "local", type: "string", required: true }],
	});
	const narrowed = new Crust("app")
		.extend(recursive)
		.command("child", (c) => c.action(() => "child"))
		.extend(runtime([old]));
	expect(await narrowed.run([], { flags: { local: "value" } })).toEqual({
		status: "completed",
		result: undefined,
	});
	await expect(narrowed.run(["child"], { flags: { local: "value" } })).rejects.toThrow(
		'Unknown flag "--local"',
	);
});

it("checked positional input enforces the actual uncertain kind, including local helpers", async () => {
	const build = (type: "string" | "number") =>
		new Crust("app").args({ name: "value", type, required: true }).action(({ args }) => args.value);
	await expect(build("string").run([], runtime({ args: { value: 42 } }))).rejects.toThrow(
		"Expected string",
	);
	expect(await build("number").run([], runtime({ args: { value: 42 } }))).toEqual({
		status: "completed",
		result: 42,
	});
	const helper = (type: "string" | "number") =>
		new Crust("app")
			.args(runtime([defineArg("value", runtime({ type, required: true }))]))
			.action(({ args }) => args.value);
	await expect(helper("number").run([], runtime({ args: { value: "text" } }))).rejects.toThrow(
		"Expected number",
	);
	expect(await helper("string").run([], runtime({ args: { value: "text" } }))).toEqual({
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
	await expect(app.run([], { flags: { toString: "value" } })).rejects.toThrow(
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
		original.extend(defineExtension(id, {})).run(["child"], { flags: { inherited: "value" } }),
	).rejects.toThrow('Unknown flag "--inherited"');
	// Reinstalling the root provider still skips a more specific child Context.
	await expect(
		original.extend(runtime([old])).run(["child"], { flags: { inherited: "value" } }),
	).rejects.toThrow('Unknown flag "--inherited"');
	expect(await original.run(["child"], { flags: { inherited: "value" } })).toEqual({
		status: "completed",
		result: "child",
	});
});

it("consumes each conditional helper branch without losing requiredness or negation", async () => {
	const build = (condition: boolean) => {
		const definition: { type: "string"; required: true } | { type: "string" } = condition
			? { type: "string", required: true }
			: { type: "string" };
		const flag = defineFlag("mode", runtime(definition));
		const arg = defineArg("mode", runtime(definition));
		const boolean: { type: "boolean"; noNegate: true } | { type: "boolean" } = condition
			? { type: "boolean", noNegate: true }
			: { type: "boolean" };
		return {
			flag: new Crust("app").flags(runtime([flag])).action(({ flags }) => flags.mode),
			arg: new Crust("app").args(runtime([arg])).action(({ args }) => args),
			child: new Crust("app").add(
				runtime([defineCommand("child", (c) => c.flags(runtime([flag])))]),
			),
			toggle: new Crust("app")
				.flags(runtime([defineFlag("toggle", runtime(boolean))]))
				.action(({ flags }) => flags.toggle),
		};
	};
	const required = build(true);
	await expect(required.flag.run([], runtime({}))).rejects.toThrow(
		'Missing required flag "--mode"',
	);
	await expect(required.arg.run([], runtime({}))).rejects.toThrow(
		'Missing required argument "<mode>"',
	);
	await expect(required.child.run(["child"], runtime({}))).rejects.toThrow(
		'Missing required flag "--mode"',
	);
	await expect(required.toggle.run([], runtime({ flags: { toggle: false } }))).rejects.toThrow(
		"does not support negation",
	);
	const optional = build(false);
	expect(await optional.flag.run([], runtime({}))).toEqual({
		status: "completed",
		result: undefined,
	});
	expect(await optional.arg.run([], runtime({}))).toEqual({
		status: "completed",
		result: { mode: undefined },
	});
	expect(await optional.toggle.run([], runtime({ flags: { toggle: false } }))).toEqual({
		status: "completed",
		result: false,
	});
	expect(await required.flag.run([], runtime({ flags: { mode: "value" } }))).toEqual({
		status: "completed",
		result: "value",
	});
});

it("preserves conditional helper parsers, defaults and their actual outputs", async () => {
	for (const condition of [true, false]) {
		const parsed: { type: "string"; parse: (raw: string) => number } | { type: "string" } =
			condition ? { type: "string", parse: Number } : { type: "string" };
		const app = new Crust("app")
			.flags(runtime([defineFlag("value", runtime(parsed))]))
			.args(runtime([defineArg("value", runtime(parsed))]))
			.action(({ flags, args }) => [flags.value, args]);
		expect(await app.run([], runtime({ flags: { value: "12" }, args: { value: "12" } }))).toEqual({
			status: "completed",
			result: condition ? [12, { value: 12 }] : ["12", { value: "12" }],
		});
		const defaults: { type: "string"; required: true; default: "a" } | { type: "string" } =
			condition ? { type: "string", required: true, default: "a" } : { type: "string" };
		const defaulted = new Crust("app")
			.flags(runtime([defineFlag("mode", runtime(defaults))]))
			.action(({ flags }) => flags.mode);
		expect(await defaulted.run([], runtime({}))).toEqual({
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
		const after = root.add(runtime([nested])).extend(runtime([demand]));
		expect(setups).toBe(0);
		await before.snapshot();
		await after.snapshot();
		expect(setups).toBe(0);
		await before.run(["nested", "leaf"]);
		await after.run(["nested", "leaf"]);
		expect(setups).toBe(2);
	}
});
