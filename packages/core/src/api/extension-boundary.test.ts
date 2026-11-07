import { describe, expect, it } from "vite-plus/test";

import { unwrap } from "../../tests/helpers.ts";
import { Crust, defineCommand } from "../command/crust.ts";
import { defineExtensionId } from "../identity.ts";
import type { ExecuteOptions } from "../types.ts";
import { type AnyContextInstance, defineContext } from "./context.ts";
import { defineExtension, type Extension } from "./extension.ts";
import { defineFlag } from "./flags.ts";

describe("checked Extension attachment", () => {
	it("checks declared dependencies at preparation without running setup", async () => {
		let calls = 0;
		const db = defineContext("db").setup(() => {
			calls++;
			return "db";
		});
		const extension = defineExtension(defineExtensionId("db")).use(db);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		const app = new Crust("app").extend(extension);
		await expect(app.snapshot()).rejects.toThrow("No provider for Context");
		expect(calls).toBe(0);
	});
	it("checks delayed command demands when the recipe is consumed", async () => {
		let calls = 0;
		const db = defineContext("db").setup(() => {
			calls++;
			return "db";
		});
		const command = defineCommand("child", (c) => c.use(db).action(() => 1));
		const extension = defineExtension(defineExtensionId("commands")).add(command);
		const registrations = [extension];
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		const app = new Crust("app").extend(...registrations);
		await expect(app.snapshot()).rejects.toThrow("No provider for Context");
		expect(calls).toBe(0);
	});
	it("consumes the immutable defining Extension rather than overwritten spread fields", async () => {
		const extension = defineExtension(defineExtensionId("original")).add(
			defineCommand("child", (c) => c.action(() => 42)),
		);
		const copy = { ...extension, id: defineExtensionId("forged") };
		const app = new Crust("app").extend(copy);
		expect(await app.run(["child"])).toMatchObject({ status: "completed", result: 42 });
		// Replacement also follows the defining id, not the overwritten public one.
		const replaced = new Crust("app").extend(copy, defineExtension(defineExtensionId("original")));
		expect(await replaced.run(["child"])).toMatchObject({ status: "failed" });
	});
});

it("keeps compatible hook providers and unrelated descendant replacements lazy", async () => {
	let calls = 0;
	const text = defineContext("db").setup(() => {
		calls++;
		return "root";
	});
	const compatible = defineCommand("child", (c) => c.provide(text.of("child")).action(() => 42));
	const seen: string[] = [];
	const hook = defineExtension(defineExtensionId("hook"))
		.use(text)
		.preRun(async ({ ctx }) => {
			seen.push((await ctx.db).toUpperCase());
		});
	const app = new Crust("app").provide(text()).add(compatible).extend(hook);
	expect(calls).toBe(0);
	expect(await app.run(["child"])).toMatchObject({ status: "completed", result: 42 });
	expect(seen).toEqual(["CHILD"]);
	expect(calls).toBe(0);
	const unrelated = defineCommand("other", (c) =>
		c.provide(defineContext("db").setup(() => 7)()).action(async ({ ctx }) => await ctx.db),
	);
	const command = defineCommand("consumer", (c) => c.use(text));
	const noHook = defineExtension(defineExtensionId("commands")).add(command);
	expect(
		await new Crust("app").provide(text()).extend(noHook).add(unrelated).run(["other"]),
	).toMatchObject({ status: "completed", result: 7 });
});

it("checks pending Extension flag relations at preparation", async () => {
	const ext = defineExtension(defineExtensionId("pending")).flags({
		token: {
			type: "string",
		},
	});
	const root = new Crust("app").extend(ext);
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	const withFlag = root.flags({ token: { type: "number" } });
	await expect(withFlag.snapshot()).rejects.toThrow("collides");
	const owner = defineContext("owner")
		.flags({ token: { type: "number" } })
		.setup(() => 1);
	// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
	const withProvider = root.provide(owner());
	await expect(withProvider.snapshot()).rejects.toThrow("collides");
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
		.flags({ value: { type: "string", parse: () => value } })
		// Nest the payload to avoid ordinary async return-value thenable assimilation.
		.action(({ flags }) => ({ value: flags.value }));
	const outcome = await app.run([], { flags: { value: "input" } });
	expect(outcome.status).toBe("completed");
	if (outcome.status === "completed") expect(outcome.result.value).toBe(value);
});

it("locally proven helper results cannot be rewritten before checked consumption", async () => {
	const flag = defineFlag({ type: "string", short: "t" });
	expect(() => Object.assign(flag, { short: "too-long" })).toThrow();
	expect(
		await new Crust("app")
			.flags({ token: flag })
			.action(({ flags }) => flags.token)
			.run([], { flags: { token: "safe" } }),
	).toMatchObject({ status: "completed", result: "safe" });
});

it("rejects dynamically named Extension commands that collide with another root command at preparation", async () => {
	let configured = 0;
	// A factory with a caller-chosen name, like `skills({ command })`.
	const contribute = (id: string, name: string, aliases: string[] = []) =>
		defineExtension(defineExtensionId(id)).add(
			defineCommand(name, { aliases }, (c) => {
				configured++;
				return c.action(() => "extension");
			}),
		);
	const deploy = defineCommand("deploy", { aliases: ["d"] }, (c) => {
		configured++;
		return c.action(() => "app");
	});
	const collision = (name: string) =>
		expect.objectContaining({
			code: "DEFINITION",
			details: { subject: "command", name, reason: "command-collision" },
		});
	// Structural so differently shaped apps share one check; `run()` takes any path here.
	type Prepared = {
		snapshot(): Promise<unknown>;
		run(path: readonly string[]): Promise<unknown>;
		execute(options: ExecuteOptions): Promise<number>;
	};
	const expectCollision = async (app: Prepared, name: string) => {
		await expect(app.snapshot()).rejects.toThrow(collision(name));
		expect(await app.run(["deploy"])).toMatchObject({ status: "failed", error: collision(name) });
		const stderr: string[] = [];
		const originalExitCode = process.exitCode;
		try {
			const io = { stdout: () => {}, stderr: (text: string) => stderr.push(text) };
			expect(await app.execute({ argv: ["deploy"], io })).toBe(1);
		} finally {
			process.exitCode = originalExitCode ?? 0;
		}
		expect(stderr.join("\n")).toContain("collides with an existing command");
	};
	await expectCollision(
		new Crust("app").add(deploy).extend(contribute("name", "deploy")),
		"deploy",
	);
	await expectCollision(new Crust("app").add(deploy).extend(contribute("onto-alias", "d")), "d");
	await expectCollision(
		new Crust("app").add(deploy).extend(contribute("alias", "ship", ["deploy"])),
		"ship",
	);
	// Added after `.extend()`, as the types also reject.
	await expectCollision(
		new Crust("app").extend(contribute("before-add", "deploy")).add(deploy),
		"deploy",
	);
	// Two Extensions with different ids.
	await expectCollision(
		new Crust("app").extend(contribute("first", "lint")).extend(contribute("second", "lint")),
		"lint",
	);
	expect(configured).toBe(0);
	// Registering the same id again replaces its commands instead of colliding.
	const replaced = new Crust("app")
		.extend(contribute("same", "lint"))
		.extend(contribute("same", "lint", ["l"]));
	expect(await replaced.run(["l"])).toMatchObject({ status: "completed", result: "extension" });
});

it("owns the checked parser function instead of rereading the mutable author object", async () => {
	const definition = { type: "string" as const, parse: () => 1 };
	const app = new Crust("app").flags({ value: definition }).action(({ flags }) => flags.value);
	definition.parse = () => 2;
	expect(await app.run([], { flags: { value: "input" } })).toMatchObject({
		status: "completed",
		result: 1,
	});
});

it("checks Extension flag relations before trusted reuse, including each factory result", () => {
	const owner = defineContext("owner")
		.flags({ token: { type: "string", short: "t" } })
		.setup(() => 1);
	const peer = defineContext("peer")
		.flags({ other: { type: "boolean", short: "t" } })
		.setup(() => 2);
	// Widened names opt out of the static relation, leaving the consuming check.
	const flags: Record<string, { type: "boolean" }> = { token: { type: "boolean" } };
	const provided = [owner()];
	expect(() =>
		defineExtension(defineExtensionId("direct"))
			.flags(flags)
			.provide(...provided),
	).toThrow("collides");
	const factory = defineExtension(defineExtensionId("factory")).factory((extension) =>
		extension.flags(flags).provide(...provided),
	);
	expect(() => factory()).toThrow("collides");
	expect(() =>
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		defineExtension(defineExtensionId("peers")).provide(owner(), peer()),
	).toThrow("collides");
});

it("keeps same-name Context replacement order inside checked Extensions", async () => {
	const old = defineContext("owner")
		.flags({ old: { type: "string" } })
		.setup(() => "old");
	const current = defineContext("owner")
		.flags({ current: { type: "string" } })
		.setup(() => "current");
	const ext = defineExtension(defineExtensionId("replacement")).provide(old(), current());
	const app = new Crust("app").extend(ext).action(({ ctx }) => ctx.owner);
	expect(await app.run([], {})).toMatchObject({ status: "completed", result: "current" });
	const emptyOld = defineContext("empty").setup(() => "old");
	const emptyNew = defineContext("empty").setup(() => "new");
	const empty = defineExtension(defineExtensionId("empty-replacement")).provide(
		emptyOld(),
		emptyNew(),
	);
	expect(
		await new Crust("app")
			.extend(empty)
			.action(({ ctx }) => ctx.empty)
			.run([], {}),
	).toMatchObject({ status: "completed", result: "new" });
	expect(() =>
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		defineExtension(defineExtensionId("repeated-owned")).provide(old(), old()),
	).toThrow("collides");
	expect(() =>
		defineExtension(defineExtensionId("bad-default"))
			// @ts-expect-error -- runtime regression deliberately exercises helper validation.
			.flags({ mode: { type: "string", choices: ["allowed"], default: "forbidden" } }),
	).toThrow("default must be one of choices");
});

it("keeps root providers' flags off contributed commands that do not use them", async () => {
	let recipes = 0;
	let setups = 0;
	const owner = defineContext("owner")
		.flags({ token: { type: "string" } })
		.setup(() => {
			setups++;
			return 1;
		});
	const child = defineCommand("child", (c) => {
		recipes++;
		return c.flags({ token: { type: "boolean" } });
	});
	const ext = defineExtension(defineExtensionId("pending-commands")).add(
		defineCommand("parent", (c) => c.add(child)),
	);
	const widened: AnyContextInstance = owner();
	const app = new Crust("app").extend(ext).provide(widened);
	expect(recipes).toBe(0);
	const snapshot = await app.snapshot();
	expect(snapshot.flags.token?.type).toBe("string");
	expect(snapshot.subCommands.parent?.subCommands.child?.flags.token?.type).toBe("boolean");
	expect(setups).toBe(0);
});

it("checked Extensions validate earlier pending commands against new flags and provider flags lazily", async () => {
	for (const source of ["flags", "provider"] as const) {
		let recipes = 0;
		let setups = 0;
		const owner = defineContext("owner")
			.flags({ token: { type: "string" } })
			.setup(() => {
				setups++;
				return 1;
			});
		const child = defineCommand("child", (c) => {
			recipes++;
			return c.flags({ token: { type: "boolean" } });
		});
		const pending = defineExtension(defineExtensionId("pending")).add(
			defineCommand("parent", (c) => c.add(child)),
		);
		// A provided Context reaches every command only when the Extension's hooks use it.
		const addition =
			source === "flags"
				? defineExtension(defineExtensionId("addition")).flags({ token: { type: "string" } })
				: defineExtension(defineExtensionId("addition")).use(owner).provide(owner());
		const root = new Crust("app").extend(pending);
		const app = root.extend(addition);
		expect(recipes).toBe(0);
		expect(setups).toBe(0);
		await expect(app.snapshot()).rejects.toThrow("collides");
		expect(recipes).toBe(1);
		expect(setups).toBe(0);
		await expect(root.snapshot()).resolves.toBeDefined();
		// The flags of Contexts hooks use are checked at runtime only, so this union type-checks.
		await expect(new Crust("app").extend(addition).extend(pending).snapshot()).rejects.toThrow(
			"collides",
		);
	}
});

it("checked inputs validate open provider flags only where they are parsed", async () => {
	const owner = defineContext("owner")
		.flags({ token: { type: "string", required: true } })
		.setup(() => 1);
	const providers = [owner()];
	const child = defineCommand("child", (c) =>
		c.add(defineCommand("leaf", (c) => c.action(() => "leaf"))),
	);
	const inherited = new Crust("app").provide(...providers).add(child);
	await expect(unwrap(inherited.run([], {}))).rejects.toThrow("Missing required flag");
	expect(await inherited.run(["child", "leaf"], {})).toMatchObject({
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
		const ext = defineExtension(defineExtensionId("recursive")).flags({
			token: {
				type: "string",
				required: true,
				recursive,
			},
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

it("checked Extension additions preserve nonrecursive flags and same-id replacement", async () => {
	const child = defineCommand("child", (c) => c.flags({ token: { type: "boolean" } }));
	const id = defineExtensionId("pending-replacement");
	const pending = defineExtension(id).add(child);
	const root = new Crust("app").extend(pending);
	const local = defineExtension(defineExtensionId("local")).flags({
		token: {
			type: "string",
			recursive: false,
		},
	});
	const localExtension: Extension = local;
	await expect(root.extend(localExtension).snapshot()).resolves.toBeDefined();
	const replacement = defineExtension(id).flags({ token: { type: "string" } });
	const replacementExtension: Extension = replacement;
	const snapshot = await root.extend(replacementExtension).snapshot();
	expect(snapshot.subCommands).toEqual({});
});

it("rejects supplied flag keys retired by same-ID Extension replacement", async () => {
	const id = defineExtensionId("retired-flags");
	const original = new Crust("app")
		.extend(defineExtension(id).flags({ oldFlag: { type: "string", required: true } }))
		.action(({ flags }): string => flags.oldFlag);
	const replacement = defineExtension(id).flags({ newFlag: { type: "boolean" } });
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
	const old = defineExtension(id).flags({ oldFlag: { type: "string", required: true } });
	const replacement = defineExtension(id);
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
	const pendingExtension = defineExtension(defineExtensionId("later-recipe")).add(
		defineCommand("pending", (c) => c.action(() => "pending")),
	);
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
	const provider = defineContext("provider")
		.flags({ provided: { type: "string", required: true } })
		.setup(() => {
			setups++;
			return "provider";
		});
	const id = defineExtensionId("retired-provider");
	const old = defineExtension(id).provide(provider());
	const replacement = defineExtension(id);
	const original = new Crust("app")
		.extend(old)
		.command("child", (c) => c.command("grand", (g) => g.action(() => "grand")));
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
	const old = defineExtension(id).flags({
		local: {
			type: "string",
			required: true,
			recursive: false,
		},
	});
	const original = new Crust("app").extend(old).command("child", (c) => c.action(() => "child"));
	const removed = original.extend(defineExtension(id));
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

	const recursive = defineExtension(id).flags({ local: { type: "string", required: true } });
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

it("does not mistake inherited object names for surviving replacement flags", async () => {
	const id = defineExtensionId("retired-prototype-name");
	const old = defineExtension(id).flags({ toString: { type: "string", required: true } });
	const replacement = defineExtension(id).flags({ other: { type: "boolean" } });
	const app = new Crust("app").extend(old, replacement);
	await expect(unwrap(app.run([], { flags: { toString: "value" } }))).rejects.toThrow(
		'Unknown flag "--toString"',
	);
});

it("retires actually inherited provider flags even below a later Context shadow", async () => {
	const provider = defineContext("shadowed")
		.flags({ inherited: { type: "string", required: true } })
		.setup(() => "original");
	const shadow = defineContext("shadowed").setup(() => 42);
	const id = defineExtensionId("retired-shadowed-provider");
	const old = defineExtension(id).provide(provider());
	const original = new Crust("app")
		.extend(old)
		.command("child", (c) => c.provide(shadow()).action(() => "child"));
	await expect(
		unwrap(original.extend(defineExtension(id)).run(["child"], { flags: { inherited: "value" } })),
	).rejects.toThrow('Unknown flag "--inherited"');
	// Re-registering the same provider changes nothing: a child Context shadows the
	// value, not the flags it inherits.
	const widened: Extension = old;
	expect(
		await original.extend(widened).run(["child"], { flags: { inherited: "value" } }),
	).toMatchObject({ status: "completed", result: "child" });
	expect(await original.run(["child"], { flags: { inherited: "value" } })).toMatchObject({
		status: "completed",
		result: "child",
	});
});

it("keeps compatible conditional descendant providers lazy in either hook attachment order", async () => {
	for (const condition of [true, false]) {
		let setups = 0;
		const text = defineContext("db").setup(() => {
			setups++;
			return "db";
		});
		const compatible = defineContext("db").setup(() => {
			setups++;
			return "child";
		});
		const demand = defineExtension(defineExtensionId("conditional-demand"))
			.use(text)
			.setup(async ({ ctx }) => {
				expect((await ctx.db).toUpperCase()).toBe(condition ? "CHILD" : "DB");
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
