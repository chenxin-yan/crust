import { getAmbientTerminalIO } from "@crustjs/utils/terminal";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { unwrap } from "../../tests/helpers.ts";
import { defineContext } from "../api/context.ts";
import { type ExtensionContext, defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import type { ArgsDef, FlagsDef, ParsedFlagValue, RunInputPayload } from "../types.ts";
import { type AnyCrust, type CommandConfig, Crust, defineCommand } from "./crust.ts";
import { cloneCommandNode, subCommandsOf } from "./node.ts";
import type { CommandSnapshot } from "./snapshot.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level test utilities
// ────────────────────────────────────────────────────────────────────────────

interface ExecuteReceivedContext {
	args: { dir: string };
	flags: { port: number };
}

/**
 * Default IO writes one `text\n` per call, straight to fd 1/2 outside Windows and through the
 * process streams on Windows; capture each as a line for the mapped fds and pass every other
 * write through. Restore with `vi.restoreAllMocks()`.
 */
function captureDefaultIO(fds: { 1?: () => string[]; 2?: () => string[] }): void {
	if (process.platform === "win32") {
		for (const [fd, stream] of [
			[1, process.stdout],
			[2, process.stderr],
		] as const) {
			const lines = fds[fd];
			if (!lines) continue;
			vi.spyOn(stream, "write").mockImplementation((chunk: string | Uint8Array) => {
				lines().push(Buffer.from(chunk).toString("utf8").replace(/\n$/, ""));
				return true;
			});
		}
		return;
	}
	const fs = process.getBuiltinModule("node:fs");
	const writeSync = fs.writeSync;
	const capture = (fd: number, buffer: Uint8Array, offset?: number) => {
		const lines = (fd === 1 || fd === 2) && fds[fd]?.();
		if (!lines) return writeSync(fd, buffer, offset);
		lines.push(Buffer.from(buffer.subarray(offset)).toString("utf8").replace(/\n$/, ""));
		return buffer.length - (offset ?? 0);
	};
	vi.spyOn(fs, "writeSync").mockImplementation(capture as typeof writeSync);
}

// ────────────────────────────────────────────────────────────────────────────
// Constructor
// ────────────────────────────────────────────────────────────────────────────

describe("Crust constructor", () => {
	it("rejects blank root command names", () => {
		for (const name of ["", "   "]) {
			expect(() => new Crust(name)).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: { subject: "command", name, reason: "empty-name" },
				}),
			);
		}
	});

	it("does not carry sibling-only metadata onto the root", async () => {
		const snapshot = await new Crust("my-cli", {
			// @ts-expect-error -- aliases belong to defineCommand() config
			aliases: ["cli"],
		}).snapshot();
		expect(snapshot.meta.aliases).toBeUndefined();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Builder methods — immutability + non-mutation invariants
// ────────────────────────────────────────────────────────────────────────────

describe("Crust builder methods — immutability + non-mutation", () => {
	type BuilderCase = readonly [name: string, apply: (app: Crust) => AnyCrust];

	const builderCases: readonly BuilderCase[] = [
		[".flags()", (app) => app.flags({ verbose: { type: "boolean" } })],
		[".args()", (app) => app.args({ name: "file", type: "string" })],
		[
			".provide()",
			(app) =>
				app.provide(
					defineContext("auth")
						.flags({ "api-key": { type: "string" } })
						.setup(() => ({}))(),
				),
		],
		[".add()", (app) => app.add(defineCommand("sub", (command) => command))],
		[".action()", (app) => app.action(() => {})],
	];

	it.each(builderCases)("%s does not mutate the original builder", async (_name, apply) => {
		const app = new Crust("test");
		const before = await new Crust("test").snapshot();
		apply(app);
		expect(await app.snapshot()).toEqual(before);
	});

	it("copies exactly the containers a builder method changes", async () => {
		const auth = defineContext("auth")
			.flags({ "api-key": { type: "string" } })
			.setup(() => ({}))();
		const db = defineContext("db").setup(() => "db");
		const base = new Crust("test")
			.flags({ verbose: { type: "boolean", short: "v" } })
			.add(defineCommand("existing", (command) => command));
		const baseNode = cloneCommandNode(base._node);

		const withFlags = base.flags({ quiet: { type: "boolean" } });
		expect(withFlags._node.localFlags).not.toBe(base._node.localFlags);
		expect(withFlags._node.effectiveFlags).not.toBe(base._node.effectiveFlags);
		expect(withFlags._node.flagSpellings).not.toBe(base._node.flagSpellings);
		expect(Object.keys(withFlags._node.effectiveFlags)).toEqual(["verbose", "quiet"]);

		const withArgs = base.args({ name: "file", type: "string" });
		expect(withArgs._node.args).not.toBe(base._node.args);
		expect(withArgs._node.args.map(({ name }) => name)).toEqual(["file"]);

		const withContext = base.provide(auth);
		expect(withContext._node.contexts).not.toBe(base._node.contexts);
		expect(withContext._node.ownedFlags).not.toBe(base._node.ownedFlags);
		expect(withContext._node.effectiveFlags).not.toBe(base._node.effectiveFlags);
		expect(withContext._node.flagSpellings).not.toBe(base._node.flagSpellings);
		expect(Object.keys(withContext._node.effectiveFlags)).toEqual(["verbose", "api-key"]);

		const withChild = base.add(defineCommand("added", (command) => command));
		expect(withChild._node.addedChildren).not.toBe(base._node.addedChildren);
		expect(Object.keys(subCommandsOf(withChild._node))).toEqual(["existing", "added"]);
		expect(Object.keys(subCommandsOf(base._node))).toEqual(["existing"]);

		const withAction = base.action(() => {});
		expect(withAction._node.run).toBeDefined();

		// `.extend()` only records Extensions; preparation applies their providers.
		const withExtension = base.extend(defineExtension(defineExtensionId("ext")).provide(db()));
		expect(withExtension._node.extensions).not.toBe(base._node.extensions);
		for (const key of ["effectiveFlags", "addedChildren", "contexts"] as const) {
			expect(withExtension._node[key]).toBe(base._node[key]);
		}

		let demandsChecked = false;
		await new Crust("test")
			.provide(db())
			.add(
				defineCommand("child", (command) => {
					const withDemand = command.use(db);
					expect(withDemand._node.demands).not.toBe(command._node.demands);
					expect(command._node.demands).toEqual([]);
					expect(withDemand._node.demands).toEqual([db]);
					demandsChecked = true;
					return withDemand;
				}),
			)
			.snapshot();
		expect(demandsChecked).toBe(true);

		expect(cloneCommandNode(base._node)).toEqual(baseNode);
	});

	it("shares flag spelling entries across fluent clones while keeping the tables independent", async () => {
		const seen: Record<string, boolean | undefined>[] = [];
		const base = new Crust("test")
			.flags({ verbose: { type: "boolean", short: "v", aliases: ["loud"] } })
			.action(({ flags }) => {
				seen.push({ verbose: flags.verbose });
			});
		const derived = base
			.flags({ quiet: { type: "boolean", short: "q", aliases: ["hush"] } })
			.action(({ flags }) => {
				seen.push({ verbose: flags.verbose, quiet: flags.quiet });
			});

		expect(derived._node.flagSpellings).not.toBe(base._node.flagSpellings);
		for (const spelling of ["verbose", "v", "loud"]) {
			const entry = base._node.flagSpellings.get(spelling);
			expect(entry?.def).toBe(base._node.effectiveFlags.verbose);
			expect(derived._node.flagSpellings.get(spelling)).toBe(entry);
		}
		for (const spelling of ["quiet", "q", "hush"]) {
			expect(derived._node.flagSpellings.get(spelling)?.def).toBe(
				derived._node.effectiveFlags.quiet,
			);
			expect(base._node.flagSpellings.has(spelling)).toBe(false);
		}
		expect(base._node.effectiveFlags.quiet).toBeUndefined();

		await base.execute({ argv: ["--loud"] });
		await derived.execute({ argv: ["-q", "--no-loud"] });
		await derived.execute({ argv: ["--hush", "-v"] });
		expect(seen).toEqual([
			{ verbose: true },
			{ verbose: false, quiet: true },
			{ verbose: true, quiet: true },
		]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .flags()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .flags()", () => {
	it("copies scalar flag definition fields (decoupled from caller)", async () => {
		const flagDef = {
			type: "boolean" as const,
			short: "v",
		};

		const app = new Crust("test").flags({ verbose: flagDef });

		// Mutating the original def should not affect the builder
		flagDef.short = "V";
		expect((await app.snapshot()).flags.verbose?.short).toBe("v");
	});

	it("repeated .flags() calls accumulate runtime and action types", async () => {
		let received: { first: boolean | undefined; second: string | undefined } | undefined;
		const app = new Crust("test")
			.flags({ first: { type: "boolean" } })
			.flags({ second: { type: "string" } })
			.action(({ flags }) => {
				type _First = Expect<Equal<typeof flags.first, boolean | undefined>>;
				type _Second = Expect<Equal<typeof flags.second, string | undefined>>;
				received = flags;
			});

		await unwrap(app.run([], { flags: { first: true, second: "value" } }));
		expect(received).toEqual({ first: true, second: "value" });
		expect((await app.snapshot()).flags).toEqual({
			first: { type: "boolean", negatable: true },
			second: { type: "string", negatable: false },
		});
	});
});

describe("Crust .flags() records", () => {
	it("registers keys in insertion order across calls", async () => {
		const app = new Crust("test")
			.flags({ zeta: { type: "boolean", short: "z" }, "dry-run": { type: "boolean" } })
			.flags({ alpha: { type: "string", aliases: ["a-alias"] } });
		const { flags } = await app.snapshot();
		expect(Object.keys(flags)).toEqual(["zeta", "dry-run", "alpha"]);
		expect(flags).toEqual({
			zeta: { type: "boolean", short: "z", negatable: true },
			"dry-run": { type: "boolean", negatable: true },
			alpha: { type: "string", aliases: ["a-alias"], negatable: false },
		});
	});

	it("copies each definition and ignores symbol keys TypeScript did not see", async () => {
		const out = { type: "string" as const, short: "o" };
		const hidden = Symbol("hidden");
		const app = new Crust("test")
			// @ts-expect-error -- TypeScript rejects symbol keys; untyped callers get them ignored
			.flags({ out, [hidden]: { type: "string", default: "hidden" } })
			.action(({ flags }) => {
				expect(Reflect.ownKeys(flags)).toEqual(["out"]);
			});
		out.short = "x";
		expect((await app.snapshot()).flags).toEqual({
			out: { type: "string", short: "o", negatable: false },
		});
		await unwrap(app.run([], { flags: { out: "value" } }));
	});

	it("ignores symbol definitions in Context setup and Extension hooks", async () => {
		const hidden = Symbol("hidden");
		const seen: PropertyKey[][] = [];
		const context = defineContext("symbols")
			// @ts-expect-error -- TypeScript rejects symbol keys; untyped callers get them ignored
			.flags({ [hidden]: { type: "string", default: "hidden" } })
			.setup(({ flags }) => {
				seen.push(Reflect.ownKeys(flags));
			});
		const extension = defineExtension(defineExtensionId("symbols"))
			// @ts-expect-error -- as above
			.flags({ [hidden]: { type: "string", default: "hidden" } })
			.preRun(({ flags }) => {
				seen.push(Reflect.ownKeys(flags));
			})
			.postRun(({ flags }) => {
				seen.push(Reflect.ownKeys(flags));
			});
		await unwrap(
			new Crust("test")
				.provide(context())
				.extend(extension)
				.action(async ({ ctx }) => {
					await ctx.symbols;
				})
				.run([]),
		);
		expect(seen).toEqual([[], [], []]);
	});

	it.each([false, true])(
		"preserves conditional definitions across calls (present: %s)",
		async (present) => {
			const definitions: {} | { port: { type: "number"; default: number } } = present
				? { port: { type: "number", default: 3 } }
				: {};
			const extension = defineExtension(defineExtensionId("conditional"))
				.flags(definitions)
				.flags({ quiet: { type: "boolean", default: false } });
			const context = defineContext("conditional")
				.flags(definitions)
				.flags({ quiet: { type: "boolean", default: false } })
				.setup(({ flags }) => flags);
			const expected = present ? { port: 3, quiet: false } : { quiet: false };
			await unwrap(
				new Crust("test")
					.extend(extension)
					.action(({ flags }) => {
						expect(flags).toEqual(expected);
					})
					.run([]),
			);
			expect(
				await new Crust("test")
					.provide(context())
					.action(async ({ ctx }) => {
						expect(await ctx.conditional).toEqual(expected);
					})
					.execute({ argv: [] }),
			).toBe(0);
		},
	);

	it("treats a one-key record keyed `name` as a flag named name", async () => {
		const app = new Crust("test").flags({ name: { type: "string" } });
		expect(Object.keys((await app.snapshot()).flags)).toEqual(["name"]);
	});

	it("rejects colliding keys in one record", () => {
		expect(() =>
			new Crust("test").flags({
				out: { type: "string", short: "o" },
				...({ open: { type: "boolean", short: "o" } } as {}),
			}),
		).toThrow(
			expect.objectContaining({ details: expect.objectContaining({ reason: "flag-collision" }) }),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .args()
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .args()", () => {
	it("copies scalar arg definition fields (decoupled from caller)", async () => {
		const argDef = {
			name: "file" as const,
			type: "string" as const,
			description: "orig",
		};
		const app = new Crust("test").args(argDef);

		argDef.description = "changed";
		expect((await app.snapshot()).args[0]?.description).toBe("orig");
	});

	it("repeated .args() calls append in positional order and preserve action types", async () => {
		let received: { source: string; destination: string } | undefined;
		const app = new Crust("copy")
			.args({ name: "source", type: "string", required: true })
			.args({ name: "destination", type: "string", required: true })
			.action(({ args }) => {
				type _Source = Expect<Equal<typeof args.source, string>>;
				type _Destination = Expect<Equal<typeof args.destination, string>>;
				received = args;
			});

		await unwrap(app.run([], { args: { source: "from", destination: "to" } }));
		expect(received).toEqual({ source: "from", destination: "to" });
		expect((await app.snapshot()).args.map((arg) => arg.name)).toEqual(["source", "destination"]);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// Command metadata
// ────────────────────────────────────────────────────────────────────────────

describe("command metadata", () => {
	it("preserves root metadata through builder calls", async () => {
		const app = new Crust("test", {
			description: "A test command",
			version: "1.2.3",
			usage: "test [options]",
		})
			.flags({ verbose: { type: "boolean" } })
			.args({ name: "file", type: "string" });

		expect(await app.snapshot()).toMatchObject({
			meta: {
				name: "test",
				description: "A test command",
				version: "1.2.3",
				usage: "test [options]",
			},
			flags: { verbose: { type: "boolean" } },
			args: [{ name: "file", type: "string" }],
		});
	});

	it("applies definition metadata from config", async () => {
		const app = new Crust("cli").add(
			defineCommand(
				"sub",
				{ description: "A subcommand", usage: "cli sub [options]" },
				(command) => command,
			),
		);

		expect((await app.snapshot()).subCommands.sub?.meta).toEqual({
			name: "sub",
			description: "A subcommand",
			usage: "cli sub [options]",
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .add() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .add() with inline definitions", () => {
	it("subcommand effective flags include Context-owned and local flags only", async () => {
		const verbose = defineFlag({ type: "boolean" });
		const logging = defineContext("logging")
			.flags({ verbose })
			.setup(() => ({}));
		const app = new Crust("cli")
			.flags({ port: { type: "number" } })
			.provide(logging())
			.add(defineCommand("sub", (cmd) => cmd.use(logging).flags({ output: { type: "string" } })));

		expect((await app.snapshot()).subCommands.sub?.flags).toEqual({
			verbose: { type: "boolean", negatable: true },
			output: { type: "string", negatable: false },
		});
	});

	it("rejects a nested definition with a missing Context demand", async () => {
		const db = defineContext("db").setup(() => "db");
		const nested = defineCommand("grandchild", (command) => command.use(db));
		const definition = defineCommand("child", (command) =>
			// @ts-expect-error -- runtime regression deliberately exercises the consuming check.
			command.add(nested),
		);

		await expect(new Crust("cli").add(definition).snapshot()).rejects.toThrow(
			'No provider for Context "db"',
		);
	});

	it("gives a command the Contexts of an Extension it uses", async () => {
		const greeter = defineContext("greeter").setup(() => (name: string) => `hi ${name}`);
		const greeting = defineExtension(defineExtensionId("test:greeting"))
			.provide(greeter())
			.factory((extension) => extension);
		const hello = defineCommand("hello", (command) =>
			command.use(greeting).action(async ({ ctx }) => (await ctx.greeter)("factory")),
		);
		const hey = defineCommand("hey", (command) =>
			command.use(greeting()).action(async ({ ctx }) => (await ctx.greeter)("instance")),
		);
		const app = new Crust("cli").extend(greeting()).add(hello, hey);

		expect(await app.run(["hello"], {})).toMatchObject({
			status: "completed",
			result: "hi factory",
		});
		expect(await app.run(["hey"], {})).toMatchObject({
			status: "completed",
			result: "hi instance",
		});
	});

	it("checks the Contexts of a used Extension instance, not only its id", async () => {
		const db = defineContext("db").setup(() => "db");
		const base = defineExtension(defineExtensionId("test:storage"));
		const full = base.provide(db());
		const query = defineCommand("query", (command) => command.use(full));

		// @ts-expect-error -- runtime regression: the extended same-id variant provides no db.
		const app = new Crust("cli").extend(base).add(query);
		await expect(app.snapshot()).rejects.toThrow('No provider for Context "db"');
	});

	it("does not demand the dependencies an .of() value of a used Extension dropped", async () => {
		const config = defineContext("config").setup(() => "configuration");
		const db = defineContext("db")
			.use(config)
			.setup(async ({ ctx }) => `db:${await ctx.config}`);
		const bound = defineExtension(defineExtensionId("test:bound")).provide(db.of("bound db"));
		const query = defineCommand("query", (command) =>
			command.use(bound).action(async ({ ctx }) => await ctx.db),
		);

		const app = new Crust("cli").extend(bound).add(query);
		expect(await app.run(["query"], {})).toMatchObject({
			status: "completed",
			result: "bound db",
		});
	});

	it("matches a used Extension copy by its defining id, as .extend() does", async () => {
		const value = defineContext("value").setup(() => "ok");
		const original = defineExtension(defineExtensionId("test:original")).provide(value());
		const copy = { ...original, id: defineExtensionId("test:copy") };
		const query = defineCommand("query", (command) =>
			command.use(copy).action(async ({ ctx }) => await ctx.value),
		);

		const app = new Crust("cli").extend(copy).add(query);
		expect(await app.run(["query"], {})).toMatchObject({ status: "completed", result: "ok" });
	});

	it("rejects a command that uses an Extension the application does not extend", async () => {
		const greeter = defineContext("greeter").setup(() => "hi");
		const greeting = defineExtension(defineExtensionId("test:greeting"))
			.provide(greeter())
			.factory((extension) => extension);
		const hello = defineCommand("hello", (command) => command.use(greeting));

		// @ts-expect-error -- runtime regression deliberately exercises the preparation check.
		const app = new Crust("cli").add(hello);
		const error = await app.snapshot().catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({
			code: "DEFINITION",
			message:
				'Command "cli hello" uses Extension "test:greeting", which the application does not extend',
			details: { subject: "extension", name: "test:greeting", reason: "missing-extension" },
		});
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .extend() — Runtime tests
// ────────────────────────────────────────────────────────────────────────────

describe("Crust .extend()", () => {
	it("deduplicates the same Extension object before hooks and Context setup", async () => {
		let preRuns = 0;
		let sections = 0;
		let setups = 0;
		let disposals = 0;
		const resource = defineContext("resource").setup(() => {
			setups++;
			return {
				[Symbol.dispose]() {
					disposals++;
				},
			};
		});
		const extension = defineExtension(defineExtensionId("deduplicated"))
			.provide(resource())
			.preRun(() => void preRuns++)
			.sections(() => {
				sections++;
				return [];
			});
		const base = new Crust("test")
			.extend(extension)
			.action(async ({ ctx }) => void (await ctx.resource));
		// Duplicate ids are runtime-only; the cast bypasses the duplicate Context brand.
		const app = base.extend(extension as never);

		await app.snapshot();
		await unwrap(app.run([]));

		expect({ preRuns, sections, setups, disposals }).toEqual({
			preRuns: 1,
			sections: 1,
			setups: 1,
			disposals: 1,
		});
	});

	it("keeps the last Extension registration for a shared id", async () => {
		const id = defineExtensionId("shared");
		const calls: string[] = [];
		const firstResource = defineContext("firstResource")
			.flags({ legacyProvider: { type: "boolean" } })
			.setup(() => {
				calls.push("first:setup");
				return { [Symbol.dispose]: () => calls.push("first:dispose") };
			});
		const secondResource = defineContext("secondResource").setup(() => {
			calls.push("second:setup");
			return { [Symbol.dispose]: () => calls.push("second:dispose") };
		});
		const first = defineExtension(id)
			.provide(firstResource())
			.flags({ legacy: { type: "boolean" } })
			.add(defineCommand("legacy", (command) => command))
			.preRun(() => void calls.push("first:preRun"))
			.sections(() => (calls.push("first:sections"), []));
		const second = defineExtension(id)
			.provide(secondResource())
			.flags({ current: { type: "boolean" } })
			.add(defineCommand("current", (command) => command))
			.preRun(() => void calls.push("second:preRun"))
			.sections(() => (calls.push("second:sections"), []));
		// Extension ids are branded strings rather than literal types, so id dedup is runtime-only.
		const app = new Crust("test")
			.extend(first)
			.extend(second)
			.action(async ({ ctx }) => {
				expect(Object.hasOwn(ctx, "firstResource")).toBe(false);
				await ctx.secondResource;
			});

		const snapshot = await app.snapshot();
		expect(snapshot.flags.current).toBeDefined();
		expect(snapshot.flags.legacy).toBeUndefined();
		expect(snapshot.flags.legacyProvider).toBeUndefined();
		expect(snapshot.subCommands.current).toBeDefined();
		expect(snapshot.subCommands.legacy).toBeUndefined();
		await unwrap(app.run([]));

		expect(calls).toEqual(["second:sections", "second:preRun", "second:setup", "second:dispose"]);
	});

	it("moves re-registered Extension providers to the last registration", async () => {
		let value: string | undefined;
		const fromA = defineContext("sharedProvider").setup(() => "A");
		const fromB = defineContext("sharedProvider").setup(() => "B");
		const a = defineExtension(defineExtensionId("provider-a")).provide(fromA());
		const b = defineExtension(defineExtensionId("provider-b")).provide(fromB());
		const app = new Crust("test")
			.extend(a)
			.extend(b as never)
			.extend(a as never)
			.action(async ({ ctx }) => {
				const bag = ctx as { sharedProvider: Promise<string> };
				value = await bag.sharedProvider;
			});

		await unwrap(app.run([]));
		expect(value).toBe("A");
	});

	it("replaces an inherited Extension provider on existing descendants", async () => {
		let value: string | undefined;
		const original = defineContext("resource").setup(() => "original");
		const replacement = defineContext("resource").setup(() => "replacement");
		const child = defineCommand("child", (command) =>
			command.action(async ({ ctx }) => {
				value = await (ctx as { resource: Promise<string> }).resource;
			}),
		);
		const app = new Crust("test")
			.extend(defineExtension(defineExtensionId("original-provider")).provide(original()))
			.add(child)
			.extend(
				defineExtension(defineExtensionId("replacement-provider")).provide(replacement()) as never,
			);

		await unwrap(app.run(["child"]));
		expect(value).toBe("replacement");
	});

	it("rejects an Extension provider flag colliding with a local flag at preparation", async () => {
		const id = defineExtensionId("flag-provider");
		const provider = defineContext("flagProvider")
			.flags({ mode: { type: "number", aliases: ["extension-mode"] } })
			.setup(() => ({}));
		const first = defineExtension(id).provide(provider());
		const app = new Crust("test").flags({
			mode: {
				type: "string",
				aliases: ["local-mode"],
			},
		});
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		const extended = app.extend(first);
		await expect(extended.snapshot()).rejects.toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: expect.objectContaining({ reason: "flag-collision" }),
			}),
		);
		// Only the final registration for an id is applied, so a replacement rescues it,
		// on the root and on children added before or after the conflicting registration.
		const child = defineCommand("child", (command) =>
			command.flags({ mode: { type: "string" } }).action(() => "ran"),
		);
		const addedBefore = new Crust("test")
			.add(child)
			.extend(first as never)
			.extend(defineExtension(id) as never);
		const replaced = [
			extended.extend(defineExtension(id) as never),
			addedBefore,
			new Crust("test")
				.extend(first)
				.add(child as never)
				.extend(defineExtension(id) as never),
		];
		for (const candidate of replaced) await expect(candidate.snapshot()).resolves.toBeDefined();
		expect(await addedBefore.run(["child"])).toMatchObject({ status: "completed", result: "ran" });
	});

	it("keeps a local provider override across unrelated .extend() calls", async () => {
		let value: string | undefined;
		const resource = defineContext("resource").setup(() => "extension");
		const name: string = "resource";
		const local = [defineContext(name).setup(() => "local")()];
		const providing = defineExtension(defineExtensionId("providing")).provide(resource());
		const app = new Crust("test")
			.extend(providing)
			// Dynamically named providers retain the runtime last-write-wins policy.
			.provide(...local)
			.extend(defineExtension(defineExtensionId("unrelated")))
			.action(async ({ ctx }) => {
				value = await ctx.resource;
			});

		await unwrap(app.run([], {}));
		expect(value).toBe("local");
		// Re-registering moves the provider after the local one.
		await unwrap(app.extend(providing).run([], {}));
		expect(value).toBe("extension");
	});

	it("lets an Extension replace a root provider registered before it, as the types infer", async () => {
		const local = defineContext("value")
			.sections({ title: "Local", body: "local" })
			.setup(() => 123);
		const remote = defineContext("value")
			.sections({ title: "Remote", body: "remote" })
			.setup(() => "extension");
		// A non-tuple list opts out of the duplicate-name check, so this compiles
		// and infers the Extension's value.
		const providers = [local()];
		const upper = defineCommand("upper", (command) =>
			command.use(remote).action(async ({ ctx }) => (await ctx.value).toUpperCase()),
		);
		// TypeScript rejects a command added before `.extend()` that demands either value,
		// so this one reads it untyped.
		const before = defineCommand("before", (command) =>
			command.action(async ({ ctx }) => await (ctx as { value: Promise<unknown> }).value),
		);
		const app = new Crust("test")
			.provide(...providers)
			.add(before)
			.extend(defineExtension(defineExtensionId("provider")).provide(remote()))
			.add(upper)
			.action(async ({ ctx }) => {
				const value: string = await ctx.value;
				return value.toUpperCase();
			});

		expect(await app.run([])).toMatchObject({ status: "completed", result: "EXTENSION" });
		expect(await app.run(["upper"])).toMatchObject({ status: "completed", result: "EXTENSION" });
		expect(await app.run(["before"])).toMatchObject({ status: "completed", result: "extension" });
		const titles = (await app.snapshot()).meta.sections?.map(({ title }) => title);
		expect(titles).toEqual(["Remote"]);
	});

	it("preserves interleaved local and Context flag order across .extend()", async () => {
		const owner = defineContext("owner")
			.flags({ bFlag: { type: "boolean" } })
			.setup(() => ({}));
		const app = new Crust("test")
			.flags({ aFlag: { type: "boolean" } })
			.provide(owner())
			.extend(defineExtension(defineExtensionId("order-noop")))
			.action(() => {});

		const snapshot = await app.snapshot();
		expect(Object.keys(snapshot.flags)).toEqual(["aFlag", "bFlag"]);
	});
});

describe("Extension application at prepare time", () => {
	it("rejects an Extension providing a Context name already on the path at compile time", () => {
		const db = defineContext("db").setup(() => "real");
		const impostor = defineContext("db").setup(() => 42);
		const ext = defineExtension(defineExtensionId("impostor")).provide(impostor());
		const app = new Crust("cli").provide(db());
		// @ts-expect-error -- Extension-provided Context "db" is already on the path (FIX_DUPLICATE_CONTEXT)
		expect(() => app.extend(ext)).not.toThrow();
	});

	it("rejects an Extension providing two Contexts that share a flag spelling at compile time", () => {
		const first = defineContext("first")
			.flags({ mode: { type: "number" } })
			.setup(() => ({}));
		const second = defineContext("second")
			.flags({ mode: { type: "string" } })
			.setup(() => ({}));
		expect(() =>
			defineExtension(defineExtensionId("double-provider"))
				// @ts-expect-error -- second Context's owned flag "mode" collides with the first's (FIX_ALIAS_COLLISION)
				.provide(first(), second()),
		).toThrow("collides");
	});

	it("rejects an Extension flag colliding with a subcommand's local flag at preparation", async () => {
		const themer = defineExtension(defineExtensionId("themer")).flags({
			mode: {
				type: "boolean",
			},
		});
		const sub = defineCommand("sub", (cmd) =>
			cmd.flags({ mode: { type: "string" } }).action(() => {}),
		);
		const appWithSub = new Crust("cli").add(sub);
		// @ts-expect-error -- Extension flag "mode" collides with subcommand "sub"'s local flag (FIX_ALIAS_COLLISION)
		const extended = appWithSub.extend(themer);
		await expect(extended.snapshot()).rejects.toThrow("collides");

		const appWithExt = new Crust("cli").extend(themer);
		// @ts-expect-error -- subcommand "sub"'s local flag "mode" collides with the registered Extension flag (FIX_ALIAS_COLLISION)
		const added = appWithExt.add(sub);
		await expect(added.snapshot()).rejects.toThrow("collides");
	});

	it("rejects an Extension flag colliding with its own provided Context's flag at compile time", () => {
		const modeContext = defineContext("mode-owner")
			.flags({ mode: { type: "number" } })
			.setup(() => ({}));
		expect(() =>
			defineExtension(defineExtensionId("self-collider"))
				.provide(modeContext())
				// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
				.flags({ mode: { type: "string" } }),
		).toThrow("collides");
	});

	it("recursive Extension flags reach every command, including Extension commands", async () => {
		const seen: Record<string, ParsedFlagValue>[] = [];
		const debug = defineExtension(defineExtensionId("debug")).flags({
			debug: {
				type: "boolean",
			},
		});

		const app = new Crust("cli").extend(debug).add(
			defineCommand("sub", (cmd) =>
				cmd.action(({ flags }) => {
					seen.push(flags);
				}),
			),
		);

		await app.execute({ argv: ["sub", "--debug"] });

		expect(seen[0]?.debug).toBe(true);
	});

	it("checks dynamic Extension flag collisions at preparation", async () => {
		const thief = defineExtension(defineExtensionId("thief")).flags({
			auth: {
				type: "boolean",
			},
		});
		const app = new Crust("cli").flags({ token: { type: "string", aliases: ["auth"] } });
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		const extended = app.extend(thief);
		await expect(extended.snapshot()).rejects.toThrow(
			'Flag "auth" collides with existing flag "token"',
		);
	});

	it("non-recursive Extension flags stay on the root", async () => {
		const version = defineExtension(defineExtensionId("version")).flags({
			version: {
				type: "boolean",
				recursive: false,
			},
		});

		let ran = false;
		const app = new Crust("cli")
			.extend(version)
			.add(defineCommand("sub", (cmd) => cmd.action(() => {})))
			.action(({ flags }) => {
				ran = (flags as Record<string, ParsedFlagValue>).version === true;
			});

		// Extension flags only exist on the prepared tree, so this must go through
		// execute(): --version parses on the root but is unknown on the subcommand.
		const stderr: string[] = [];
		const originalExitCode = process.exitCode;
		try {
			await app.execute({ argv: ["--version"], io: { stderr: (text) => stderr.push(text) } });
			expect(ran).toBe(true);
			await app.execute({
				argv: ["sub", "--version"],
				io: { stderr: (text) => stderr.push(text) },
			});
		} finally {
			process.exitCode = originalExitCode ?? 0;
		}
		expect(stderr.join("\n")).toContain('Unknown flag "--version"');
	});

	it("Extension command definitions are routable, validated, and receive recursive flags", async () => {
		const lines: string[] = [];
		const errors: string[] = [];
		const completion = defineExtension(defineExtensionId("completion"))
			.add(
				defineCommand("completion", (command) =>
					command
						.args({
							name: "shell",
							type: "string",
							required: true,
							choices: ["bash", "zsh"],
						})
						.action(({ args, flags, rootCommand }) => {
							lines.push(
								`completion:${args.shell}:${String((flags as Record<string, ParsedFlagValue>).verbose)}:${rootCommand.meta.name}`,
							);
						}),
				),
			)
			.onError((error) => {
				errors.push((error as CrustError).code);
				return true;
			});
		const verbose = defineExtension(defineExtensionId("verbose")).flags({
			verbose: {
				type: "boolean",
			},
		});

		const app = new Crust("cli").extend(completion, verbose).action(() => {});

		const originalExitCode = process.exitCode;
		try {
			await app.execute({ argv: ["completion", "bash", "--verbose"] });
			await app.execute({ argv: ["completion", "fish"] });
			await app.execute({ argv: ["completion"] });
		} finally {
			process.exitCode = originalExitCode ?? 0;
		}
		expect(lines).toEqual(["completion:bash:true:cli"]);
		expect(errors).toEqual(["PARSE", "VALIDATION"]);
	});

	it("builders derived after a run see their own commands without affecting the original", async () => {
		const calls: string[] = [];
		const app = new Crust("derive").action(() => {
			calls.push("root");
		});

		await unwrap(app.run([]));

		const derived = app.add(
			defineCommand("extra", (command) =>
				command.action(() => {
					calls.push("extra");
				}),
			),
		);

		await unwrap(derived.run(["extra"]));
		// the original builder must not see the derived command: its typed tree
		// has no "extra" path, so the forced path fails to resolve
		// @ts-expect-error -- "extra" is deliberately absent from the original builder.
		await expect(unwrap(app.run(["extra"]))).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
			details: { input: "extra" },
		});

		expect(calls).toEqual(["root", "extra"]);
	});

	it("materializes Extension command recipes once per builder across runs", async () => {
		let materialized = 0;
		const calls: string[] = [];
		const tools = defineExtension(defineExtensionId("tools")).add(
			defineCommand("sub", (command) => {
				materialized++;
				return command.action(() => {
					calls.push("sub");
				});
			}),
		);
		const app = new Crust("cli").extend(tools).action(() => {});

		await app.execute({ argv: ["sub"] });
		await app.execute({ argv: ["sub"] });

		// The action still runs per dispatch, but the recipe that builds the
		// command tree runs once per builder instance (prepared tree is cached).
		expect(calls).toEqual(["sub", "sub"]);
		expect(materialized).toBe(1);
	});

	it("does not cache a failed preparation: a throwing recipe is retried", async () => {
		let attempts = 0;
		const flaky = defineExtension(defineExtensionId("flaky")).add(
			defineCommand("sub", (command) => {
				attempts++;
				if (attempts === 1) throw new Error("recipe boom");
				return command.action(() => {});
			}),
		);
		const app = new Crust("cli").extend(flaky).action(() => {});

		await expect(app.snapshot()).rejects.toThrow("recipe boom");
		await app.snapshot();

		expect(attempts).toBe(2);
	});

	it("extending a builder after a cached run affects only the derived builder", async () => {
		const calls: string[] = [];
		const audit = defineExtension(defineExtensionId("audit")).preRun(() => {
			calls.push("audit");
		});
		const app = new Crust("cli").action(() => {
			calls.push("root");
		});

		await unwrap(app.run([]));
		const derived = app.extend(audit);
		await unwrap(derived.run([]));
		await unwrap(app.run([]));

		expect(calls).toEqual(["root", "audit", "root", "root"]);
	});
});

describe("Extension named hooks", () => {
	it("runs pre-run hooks in extension order before the action, and a handler skips them all", async () => {
		const order: string[] = [];
		const first = defineExtension(defineExtensionId("first")).preRun(() => {
			order.push("first");
		});
		const gate = defineExtension(defineExtensionId("gate"))
			.flags({ stop: { type: "boolean" } })
			.preRun(() => {
				order.push("gate");
			})
			.handle("stop", () => {
				order.push("stop");
			});
		const last = defineExtension(defineExtensionId("last")).preRun(() => {
			order.push("last");
		});
		const app = new Crust("cli")
			.args({ name: "file", type: "string", required: true })
			.extend(first, gate, last)
			.action(() => {
				order.push("action");
			});

		await unwrap(app.run([], { args: { file: "unused" } }));
		expect(order).toEqual(["first", "gate", "last", "action"]);
		order.length = 0;
		await unwrap(app.run([], { args: { file: "unused" }, flags: { stop: true } }));
		expect(order).toEqual(["stop"]);
	});

	it("runs post-run hooks LIFO for completed, failed, and handled invocations", async () => {
		const outcomes: string[] = [];
		const first = defineExtension(defineExtensionId("first")).postRun((_ctx, outcome) => {
			outcomes.push(`first:${outcome.status}`);
		});
		const second = defineExtension(defineExtensionId("second")).postRun((_ctx, outcome) => {
			outcomes.push(`second:${outcome.status}`);
		});

		await unwrap(
			new Crust("cli")
				.extend(first, second)
				.action(() => {})
				.run([]),
		);
		expect(outcomes).toEqual(["second:completed", "first:completed"]);

		outcomes.length = 0;
		await expect(
			unwrap(
				new Crust("cli")
					.extend(first, second)
					.action(() => {
						throw new Error("boom");
					})
					.run([]),
			),
		).rejects.toThrow("boom");
		expect(outcomes).toEqual(["second:failed", "first:failed"]);

		outcomes.length = 0;
		const gate = defineExtension(defineExtensionId("gate"))
			.flags({ stop: { type: "boolean" } })
			.handle("stop", () => {});
		await unwrap(
			new Crust("cli")
				.extend(first, gate, second)
				.action(() => {})
				.run([], { flags: { stop: true } }),
		);
		expect(outcomes).toEqual(["second:handled", "first:handled"]);
	});

	it("passes the action's awaited result to postRun for run() and execute()", async () => {
		const outcomes: unknown[] = [];
		const observer = defineExtension(defineExtensionId("observer")).postRun(
			(_ctx, outcome) => void outcomes.push(outcome),
		);
		const app = new Crust("cli").extend(observer).action(async () => ({ id: 7 }));

		await unwrap(app.run([]));
		expect(await app.execute({ argv: [] })).toBe(0);
		await unwrap(new Crust("cli").extend(observer).run([]));

		expect(outcomes).toEqual([
			{ status: "completed", result: { id: 7 } },
			{ status: "completed", result: { id: 7 } },
			{ status: "completed", result: undefined },
		]);
		expect(outcomes[0]).toHaveProperty("result");
		expect(outcomes[2]).toHaveProperty("result");
		expect(Object.isFrozen(outcomes[0])).toBe(true);
	});

	describe("bindInput", () => {
		let originalExitCode: typeof process.exitCode;

		beforeEach(() => {
			originalExitCode = process.exitCode;
		});

		afterEach(() => {
			vi.unstubAllEnvs();
			process.exitCode = originalExitCode ?? 0;
		});

		function bindingApp(...payloads: RunInputPayload[]) {
			const preRunSeen: unknown[] = [];
			const received: unknown[] = [];
			const binder = defineExtension(defineExtensionId("binder")).preRun((ctx) => {
				for (const payload of payloads) ctx.bindInput(payload);
				preRunSeen.push({ args: { ...ctx.args }, flags: { ...ctx.flags }, rawArgs: ctx.rawArgs });
			});
			const app = new Crust("cli")
				.flags({
					name: { type: "string", default: "dflt" },
					port: { type: "number", env: { name: "BIND_PORT" } },
					verbose: { type: "boolean", default: false },
					tags: { type: "string", multiple: true, delimiter: "," },
				})
				.args({ name: "source", type: "string" })
				.args({ name: "target", type: "string", default: "out" })
				.extend(binder)
				.action(({ args, flags, rawArgs }) => void received.push({ args, flags, rawArgs }));
			async function execute(argv: string[]) {
				const stderr: string[] = [];
				const exitCode = await app.execute({
					argv,
					io: { stdout: () => {}, stderr: (line) => void stderr.push(line) },
				});
				return { exitCode, stderr: stderr.join("\n") };
			}
			return { app, execute, preRunSeen, received };
		}

		it("lets argv-explicit flags win, even when equal to the default or negated", async () => {
			const { execute, received } = bindingApp({
				flags: { name: "json", verbose: true, port: 1 },
			});
			expect(await execute(["--name", "dflt", "--no-verbose"])).toEqual({
				exitCode: 0,
				stderr: "",
			});
			expect(received).toEqual([
				{
					args: { source: undefined, target: "out" },
					flags: { name: "dflt", port: 1, verbose: false, tags: undefined },
					rawArgs: [],
				},
			]);
		});

		it("replaces environment values and defaults with structured values", async () => {
			vi.stubEnv("BIND_PORT", "9000");
			const { execute, preRunSeen, received } = bindingApp({
				args: { source: "a", target: "b" },
				flags: { name: "json", port: 1, tags: ["x"] },
				raw: ["--dry"],
			});
			expect(await execute([])).toEqual({ exitCode: 0, stderr: "" });
			const bound = {
				args: { source: "a", target: "b" },
				flags: { name: "json", port: 1, verbose: false, tags: ["x"] },
				rawArgs: ["--dry"],
			};
			// ctx.args/ctx.flags reflect the bound values for later hooks.
			expect(preRunSeen).toEqual([bound]);
			expect(received).toEqual([bound]);
		});

		it("lets a structured value replace an invalid environment value", async () => {
			vi.stubEnv("BIND_PORT", "abc");
			const { execute, received } = bindingApp({ flags: { port: 1 } });
			expect(await execute([])).toEqual({ exitCode: 0, stderr: "" });
			expect(received).toMatchObject([{ flags: { port: 1 } }]);
		});

		it('keeps an explicit `--tags ""` that splits to zero occurrences', async () => {
			const { execute, received } = bindingApp({ flags: { tags: ["x"] } });
			expect(await execute(["--tags", ""])).toEqual({ exitCode: 0, stderr: "" });
			expect(received).toMatchObject([{ flags: { tags: undefined } }]);
		});

		it("never converts a structured value that argv overrides", async () => {
			const { execute, received } = bindingApp({
				args: { source: 1 },
				flags: { port: "not a number", verbose: "yes" },
			});
			expect(await execute(["src", "--port", "80", "--verbose"])).toEqual({
				exitCode: 0,
				stderr: "",
			});
			expect(received).toMatchObject([
				{ args: { source: "src" }, flags: { port: 80, verbose: true } },
			]);
		});

		it("binds later positionals from structured input after argv-explicit ones", async () => {
			const { execute, received } = bindingApp({ args: { source: "json", target: "dest" } });
			expect(await execute(["src"])).toEqual({ exitCode: 0, stderr: "" });
			expect(await execute(["--", "src", "dst"])).toEqual({ exitCode: 0, stderr: "" });
			expect(received).toMatchObject([
				{ args: { source: "src", target: "dest" } },
				{ args: { source: "src", target: "dst" }, rawArgs: [] },
			]);
		});

		it("keeps argv passthrough tokens over structured raw values", async () => {
			const { execute, received } = bindingApp({ raw: ["json"] });
			expect(await execute(["a", "b", "--", "argv"])).toEqual({ exitCode: 0, stderr: "" });
			expect(received).toMatchObject([{ rawArgs: ["argv"] }]);
		});

		it("re-binds against the original input on each call, so the last call wins", async () => {
			const { execute, received } = bindingApp(
				{ args: { source: "first" }, flags: { name: "first", port: 1 } },
				{ flags: { name: "second" } },
			);
			expect(await execute([])).toEqual({ exitCode: 0, stderr: "" });
			expect(received).toMatchObject([
				{ args: { source: undefined }, flags: { name: "second", port: undefined } },
			]);
		});

		it("never re-resolves defaults it does not replace", async () => {
			const calls: string[] = [];
			const strict = (raw: string) => {
				calls.push(raw);
				if (raw === "bad") throw new Error("rejected");
				return raw;
			};
			const app = new Crust("cli")
				.flags({
					mode: { type: "string", default: "bad", parse: strict },
					level: { type: "string", default: "low", parse: strict },
					other: { type: "string" },
				})
				.args({ name: "source", type: "string", default: "here", parse: strict })
				.extend(
					defineExtension(defineExtensionId("binder")).preRun((ctx) =>
						ctx.bindInput({ flags: { other: "x" } }),
					),
				)
				.action(() => {});
			expect(await app.execute({ argv: ["--mode", "good"], io: { stderr: () => {} } })).toBe(0);
			// One parse each from argv binding: the argv value and the two untouched defaults.
			expect(calls.toSorted()).toEqual(["good", "here", "low"]);
		});

		it("keeps typed run() positionals that precede a replaced one", async () => {
			const { app, received } = bindingApp({ args: { target: "new" } });
			await unwrap(app.run([], { args: { source: "src", target: "old" } }));
			expect(received).toMatchObject([{ args: { source: "src", target: "new" } }]);
		});

		it("rejects a structured positional after one nothing supplied", async () => {
			const gap = {
				code: "PARSE",
				message: "Argument <target> cannot be provided after omitted argument <source>",
			};
			const { app, execute, received } = bindingApp({ args: { target: "new" } });
			expect(await execute([])).toEqual({ exitCode: 1, stderr: `Error: ${gap.message}` });
			await expect(app.run([])).resolves.toMatchObject({ status: "failed", error: gap });
			expect(received).toEqual([]);
		});

		it("replaces typed run() input, which has no argv-explicit values", async () => {
			const { app, received } = bindingApp({ flags: { name: "json" }, args: { source: "json" } });
			await unwrap(app.run([], { args: { source: "typed" }, flags: { name: "typed", port: 2 } }));
			expect(received).toMatchObject([
				{ args: { source: "json" }, flags: { name: "json", port: 2 } },
			]);
		});

		it("validates the bound values", async () => {
			const regions: unknown[] = [];
			const app = (input: RunInputPayload) =>
				new Crust("cli")
					.flags({ region: { type: "string", required: true } })
					.extend(
						defineExtension(defineExtensionId("binder")).preRun((ctx) => ctx.bindInput(input)),
					)
					.action(({ flags }) => void regions.push(flags.region));
			const stderr: string[] = [];
			const io = { stdout: () => {}, stderr: (line: string) => void stderr.push(line) };
			expect(await app({ flags: { region: "eu" } }).execute({ argv: [], io })).toBe(0);
			expect(await app({}).execute({ argv: [], io })).toBe(1);
			expect(regions).toEqual(["eu"]);
			expect(stderr).toEqual(['Error: Missing required flag "--region"']);
		});

		it.each(["setup", "preRun"] as const)(
			"routes a PARSE error from bindInput in %s through onError and postRun",
			async (hook) => {
				const errors: unknown[] = [];
				const outcomes: unknown[] = [];
				const extension = defineExtension(defineExtensionId("binder"));
				const binder = extension[hook]((ctx) => ctx.bindInput({ flags: { port: "abc" } }))
					.postRun((_ctx, outcome) => void outcomes.push(outcome.status))
					.onError((error) => void errors.push(error));
				const actions: string[] = [];
				const app = new Crust("cli")
					.flags({ port: { type: "number" } })
					.extend(binder)
					.action(() => void actions.push("ran"));
				const stderr: string[] = [];
				expect(
					await app.execute({ argv: [], io: { stderr: (line) => void stderr.push(line) } }),
				).toBe(1);
				expect(errors).toEqual([expect.objectContaining({ code: "PARSE" })]);
				expect(stderr.join("\n")).toContain("Expected a number for --port.");
				expect(outcomes).toEqual(["failed"]);
				expect(actions).toEqual([]);
			},
		);

		it("shows values bound in setup to every preRun and never lets them select a flag handler", async () => {
			const order: string[] = [];
			const gate = defineExtension(defineExtensionId("gate"))
				.flags({ stop: { type: "boolean" } })
				.handle("stop", () => void order.push("stop"))
				.preRun(({ flags }) => void order.push(`preRun stop=${flags.stop}`));
			const binder = defineExtension(defineExtensionId("binder")).setup((ctx) =>
				ctx.bindInput({ flags: { stop: true } }),
			);
			const app = new Crust("cli")
				.extend(gate, binder)
				.action(({ flags }) => void order.push(`action stop=${flags.stop}`));
			await unwrap(app.run([]));
			expect(order).toEqual(["preRun stop=true", "action stop=true"]);
		});

		it("gives the routing-failure onError context a no-op bindInput", async () => {
			let flags: unknown;
			const renderer = defineExtension(defineExtensionId("renderer")).onError((_error, ctx) => {
				ctx.bindInput({ flags: { anything: true } });
				flags = ctx.flags;
				return true;
			});
			const app = new Crust("cli")
				.extend(renderer)
				.add(defineCommand("known", (cmd) => cmd.action(() => {})));
			expect(await app.execute({ argv: ["nope"] })).toBe(1);
			expect(flags).toEqual({});
		});
	});

	describe("sources", () => {
		function recordingApp(bind: (ctx: ExtensionContext) => void = () => {}) {
			const seen: ExtensionContext["sources"][] = [];
			const recorder = defineExtension(defineExtensionId("recorder"))
				.setup((ctx) => {
					seen.push(ctx.sources);
					bind(ctx);
				})
				.preRun((ctx) => void seen.push(ctx.sources))
				.onError((_error, ctx) => void seen.push(ctx.sources));
			const app = new Crust("cli")
				.flags({
					name: { type: "string", default: "dflt" },
					verbose: { type: "boolean", short: "V" },
					color: { type: "boolean" },
					port: { type: "number", env: { name: "SOURCES_PORT" } },
					tags: { type: "string", multiple: true, delimiter: "," },
					count: { type: "number" },
				})
				.args({ name: "source", type: "string" })
				.args({ name: "target", type: "string", default: "tgt" })
				.extend(recorder)
				.action(() => {});
			return { app, seen };
		}

		afterEach(() => vi.unstubAllEnvs());

		it("reports argv, env, and default by canonical name and omits names without a value", async () => {
			vi.stubEnv("SOURCES_PORT", "9000");
			const { app, seen } = recordingApp();
			const argv = ["a", "-V", "--no-color", "--tags", "", "--", "b", "--x"];
			expect(await app.execute({ argv, io: { stdout: () => {} } })).toBe(0);
			expect(seen[0]).toEqual({
				args: { source: "argv", target: "argv" },
				flags: { name: "default", verbose: "argv", color: "argv", port: "env", tags: "argv" },
				raw: "argv",
			});
			expect(Object.isFrozen(seen[0])).toBe(true);
			expect(Object.isFrozen(seen[0]?.flags)).toBe(true);
		});

		it("reports no passthrough when `--` has no tokens left over", async () => {
			const { app, seen } = recordingApp();
			await app.execute({ argv: ["--name", "x", "--"] });
			expect(seen[0]).toEqual({
				args: { target: "default" },
				flags: { name: "argv" },
				raw: undefined,
			});
		});

		it("reports typed run() input as run", async () => {
			vi.stubEnv("SOURCES_PORT", "9000");
			const { app, seen } = recordingApp();
			await unwrap(
				app.run([], { args: { source: "a" }, flags: { verbose: true, port: 1 }, raw: ["r"] }),
			);
			expect(seen[0]).toEqual({
				args: { source: "run", target: "default" },
				flags: { name: "default", verbose: "run", port: "run" },
				raw: "run",
			});
		});

		it("reads bound keys live, and a later bindInput reverts keys it no longer supplies", async () => {
			vi.stubEnv("SOURCES_PORT", "9000");
			const { app, seen } = recordingApp((ctx) => {
				ctx.bindInput({ args: { source: "x" }, flags: { name: "a", port: 1 }, raw: ["r"] });
				seen.push(ctx.sources);
				ctx.bindInput({ flags: { name: "b", verbose: true } });
			});
			expect(await app.execute({ argv: ["-V"] })).toBe(0);
			const original = {
				args: { target: "default" },
				flags: { name: "default", verbose: "argv", port: "env" },
				raw: undefined,
			};
			expect(seen).toEqual([
				original,
				{
					args: { source: "bound", target: "default" },
					flags: { name: "bound", verbose: "argv", port: "bound" },
					raw: "bound",
				},
				// argv still wins for verbose; port and source revert to the original parse.
				{ ...original, flags: { ...original.flags, name: "bound" } },
			]);
		});

		it("reports an empty variadic, multiple-flag, or raw array as omitted under run() and bindInput", async () => {
			const empty = { args: { files: [] }, flags: { tags: [], labels: [] }, raw: [] };
			const seen: ExtensionContext["sources"][] = [];
			const app = (bind: boolean) =>
				new Crust("cli")
					.flags({
						tags: { type: "string", multiple: true, default: ["d"] },
						labels: { type: "string", multiple: true },
					})
					.args({ name: "files", type: "string", variadic: true })
					.extend(
						defineExtension(defineExtensionId("recorder"))
							.setup((ctx) => void (bind && ctx.bindInput(empty)))
							.preRun((ctx) => void seen.push(ctx.sources)),
					)
					.action(() => {});
			await unwrap(app(false).run([], empty));
			expect(await app(true).execute({ argv: [] })).toBe(0);
			const omitted = { args: {}, flags: { tags: "default" }, raw: undefined };
			expect(seen).toEqual([omitted, omitted]);
		});

		it("keeps argv's passthrough tokens over bound raw", async () => {
			const { app, seen } = recordingApp((ctx) => ctx.bindInput({ raw: ["bound"] }));
			await app.execute({ argv: ["--", "a", "b", "c"] });
			expect(seen.at(-1)?.raw).toBe("argv");
		});

		it("is empty in the routing-failure onError context", async () => {
			const { app, seen } = recordingApp();
			await app.execute({ argv: ["--nope"], io: { stderr: () => {} } });
			expect(seen).toEqual([{ args: {}, flags: {}, raw: undefined }]);
		});
	});

	it("reports the handling Extension and exposes parsed snapshots before validation", async () => {
		let outcomeBy = "";
		let seenPort: unknown;
		const gate = defineExtension(defineExtensionId("gate"))
			.flags({ stop: { type: "boolean" } })
			.handle("stop", (ctx) => {
				seenPort = ctx.flags.port;
			})
			.postRun((_ctx, outcome) => {
				outcomeBy = outcome.status === "handled" ? outcome.by : "";
			});
		await unwrap(
			new Crust("cli")
				.flags({ port: { type: "number", required: true } })
				.extend(gate)
				.action(() => {})
				.run([], { flags: { port: 8080, stop: true } }),
		);

		expect(seenPort).toBe(8080);
		expect(outcomeBy).toBe("gate");
	});

	describe("deferred flag and argument value errors", () => {
		let originalExitCode: typeof process.exitCode;

		beforeEach(() => {
			originalExitCode = process.exitCode;
		});

		afterEach(() => {
			vi.unstubAllEnvs();
			process.exitCode = originalExitCode ?? 0;
		});

		function deferringApp() {
			const seen: unknown[] = [];
			const errors: unknown[] = [];
			const actions: string[] = [];
			const port = { name: "port", type: "number", default: 3000, env: { name: "PORT" } } as const;
			const gate = defineExtension(defineExtensionId("gate"))
				.flags({ stop: { type: "boolean", recursive: true } })
				.preRun((ctx) => void seen.push(ctx.flags.port))
				.handle("stop", () => {})
				.onError((error) => void errors.push(error));
			const app = new Crust("cli")
				.flags({ port, mode: { type: "string", choices: ["fast", "safe"] } })
				.args({ name: "count", type: "number" })
				.extend(gate)
				.add(
					defineCommand("serve", (c) => c.flags({ port }).action(() => void actions.push("serve"))),
				)
				.action(() => void actions.push("root"));
			async function execute(argv: string[]) {
				const stderr: string[] = [];
				const exitCode = await app.execute({
					argv,
					io: { stdout: () => {}, stderr: (line) => void stderr.push(line) },
				});
				return { exitCode, stderr: stderr.join("\n") };
			}
			return { execute, seen, errors, actions };
		}

		it("lets a flag handler win over invalid argv values in any order", async () => {
			const { execute, errors, actions } = deferringApp();
			for (const argv of [
				["--port", "abc", "--stop"],
				["--stop", "--port", "abc"],
				["--mode", "slow", "--stop"],
				["nan", "--stop"],
				["serve", "--port", "abc", "--stop"],
			]) {
				expect(await execute(argv), argv.join(" ")).toEqual({ exitCode: 0, stderr: "" });
			}
			expect(errors).toEqual([]);
			expect(actions).toEqual([]);
		});

		it("lets a flag handler win over an invalid env fallback", async () => {
			vi.stubEnv("PORT", "abc");
			const { execute, actions } = deferringApp();
			expect(await execute(["--stop"])).toEqual({ exitCode: 0, stderr: "" });
			expect(await execute(["serve", "--stop"])).toEqual({ exitCode: 0, stderr: "" });
			expect(actions).toEqual([]);
		});

		it("surfaces the original error after preRun, which sees the invalid flag unset", async () => {
			const cases: Array<[string[], Record<string, string>, string]> = [
				[["--port", "abc"], {}, "Expected a number for --port."],
				[[], { PORT: "abc" }, "Expected a number for --port (from $PORT)."],
				[["serve"], { PORT: "abc" }, "Expected a number for --port (from $PORT)."],
				[["--mode", "slow"], {}, "Invalid value for --mode. Expected one of: fast, safe"],
				[["nan"], {}, "Expected a number for <count>."],
			];
			const { execute, seen, errors, actions } = deferringApp();
			for (const [argv, env, message] of cases) {
				vi.unstubAllEnvs();
				for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
				const result = await execute(argv);
				expect(result.exitCode, argv.join(" ")).toBe(1);
				// Core's default renderer still prints the unchanged message.
				expect(result.stderr).toContain(message);
				expect(errors.at(-1)).toBeInstanceOf(CrustError);
				expect(errors.at(-1)).toMatchObject({ code: "PARSE", message });
			}
			expect(seen).toEqual([undefined, undefined, undefined, 3000, 3000]);
			expect(actions).toEqual([]);
		});

		it("reports a deferred value error to onError with the preRun context", async () => {
			let preRunContext: unknown;
			let onErrorContext: unknown;
			const observer = defineExtension(defineExtensionId("observer"))
				.preRun((ctx) => {
					preRunContext = ctx;
				})
				.onError((_error, ctx) => {
					onErrorContext = ctx;
					return true;
				});
			const app = new Crust("cli")
				.flags({ port: { type: "number" } })
				.extend(observer)
				.action(() => {});

			expect(await app.execute({ argv: ["--port", "abc"] })).toBe(1);
			expect(preRunContext).toBeDefined();
			expect(onErrorContext).toBe(preRunContext);
		});

		it("shows Extension-owned defaulted flags as unset to setup and postRun", async () => {
			const seen: unknown[] = [];
			const owner = defineExtension(defineExtensionId("owner"))
				.flags({ port: { type: "number", default: 3000 } })
				.setup(({ flags }) => void seen.push(["setup", flags.port]))
				.postRun(({ flags }, outcome) => void seen.push(["post", flags.port, outcome.status]));
			const gate = defineExtension(defineExtensionId("gate"))
				.flags({ stop: { type: "boolean" } })
				.handle("stop", () => {});
			const app = new Crust("cli").extend(owner, gate).action(() => void seen.push("action"));
			const io = { stdout: () => {}, stderr: () => {} };

			expect(await app.execute({ argv: ["--port", "abc", "--stop"], io })).toBe(0);
			expect(await app.execute({ argv: ["--port", "abc"], io })).toBe(1);
			expect(seen).toEqual([
				["setup", undefined],
				["post", undefined, "handled"],
				["setup", undefined],
				["post", undefined, "failed"],
			]);
		});

		it("keeps structural argv errors ahead of preRun", async () => {
			const { execute, seen } = deferringApp();
			expect(await execute(["--port", "--stop"])).toMatchObject({
				exitCode: 1,
				stderr: expect.stringContaining(
					'Missing value for flag "--port"; to pass a value starting with "-", write --port=<value>',
				),
			});
			expect(await execute(["--nope", "--stop"])).toMatchObject({
				exitCode: 1,
				stderr: expect.stringContaining('Unknown flag "--nope"'),
			});
			expect(seen).toEqual([]);
		});
	});

	it("does not run hooks for routing failures and exposes frozen snapshots with injected io", async () => {
		let preRunCalled = false;
		const lines: string[] = [];
		const probe = defineExtension(defineExtensionId("probe")).preRun((ctx) => {
			preRunCalled = true;
			expect(Object.isFrozen(ctx.rootCommand)).toBe(true);
			expect(Object.isFrozen(ctx.command)).toBe(true);
			expect(() => structuredClone(ctx.rootCommand)).not.toThrow();
			ctx.stdout(`probe:${ctx.command.meta.name}`);
		});
		const app = new Crust("cli")
			.extend(probe)
			.add(defineCommand("known", (cmd) => cmd.action(() => {})));

		await unwrap(app.run(["known"], undefined, { stdout: (line) => lines.push(line) }));
		expect(lines).toEqual(["probe:known"]);
		preRunCalled = false;
		// @ts-expect-error -- deliberately exercise an unknown command path.
		await expect(unwrap(app.run(["unknown"]))).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
		});
		expect(preRunCalled).toBe(false);
	});

	it("preserves a failed invocation over post-run errors and fails success with the first cleanup error", async () => {
		const original = new Error("original");
		const cleanup = defineExtension(defineExtensionId("cleanup")).postRun(() => {
			throw new Error("cleanup");
		});
		await expect(
			new Crust("cli")
				.extend(cleanup)
				.action(() => {
					throw original;
				})
				.run([]),
		).resolves.toMatchObject({ status: "failed", error: original });

		const calls: string[] = [];
		const first = defineExtension(defineExtensionId("first")).postRun(() => {
			calls.push("first");
			throw new Error("first cleanup");
		});
		const second = defineExtension(defineExtensionId("second")).postRun(() => {
			calls.push("second");
			throw new Error("second cleanup");
		});
		await expect(
			unwrap(
				new Crust("cli")
					.extend(first, second)
					.action(() => {})
					.run([]),
			),
		).rejects.toThrow("second cleanup");
		expect(calls).toEqual(["second", "first"]);
	});

	it("passes the application root snapshot to app and Extension command actions", async () => {
		const roots: string[] = [];
		const extension = defineExtension(defineExtensionId("extension")).add(
			defineCommand("owned", (command) =>
				command.action(({ rootCommand }) => {
					roots.push(rootCommand.meta.name);
				}),
			),
		);
		const app = new Crust("cli").extend(extension).action(({ rootCommand }) => {
			roots.push(rootCommand.meta.name);
		});

		await unwrap(app.run([]));
		await app.execute({ argv: ["owned"] });
		expect(roots).toEqual(["cli", "cli"]);
	});
});

describe("Extension setup, flag handlers, and noAction", () => {
	afterEach(() => void vi.unstubAllEnvs());

	/** One app per `.extend()` order; each handler prints its flag name. */
	function handlerApps() {
		const handler = (name: string, eager = false) =>
			defineExtension(defineExtensionId(name))
				.flags({ [name]: { type: "boolean", env: { name: name.toUpperCase() } } } as const)
				.handle(name, (ctx) => ctx.stdout(name), { eager });
		const [help, version, preview, dry] = [
			handler("help", true),
			handler("version", true),
			handler("preview"),
			handler("dry"),
		];
		return [
			new Crust("cli").extend(help, version, preview, dry).action(({ stdout }) => stdout("action")),
			new Crust("cli").extend(dry, preview, version, help).action(({ stdout }) => stdout("action")),
		];
	}

	async function outputs(argv: string[]) {
		return Promise.all(
			handlerApps().map(async (app) => {
				const lines: string[] = [];
				await app.execute({
					argv,
					io: { stdout: (line) => void lines.push(line), stderr: () => {} },
				});
				return lines.join("\n");
			}),
		);
	}

	it("ranks eager handlers first, then the flag given first, whatever the .extend() order", async () => {
		for (const [argv, expected] of [
			[["--preview", "--help"], "help"],
			[["--dry", "--preview", "--version"], "version"],
			[["--help", "--version"], "help"],
			[["--version", "--help"], "version"],
			[["--dry", "--preview"], "dry"],
			[["--preview", "--dry"], "preview"],
			[["--preview", "--no-dry"], "preview"],
		] as const) {
			expect(await outputs([...argv]), argv.join(" ")).toEqual([expected, expected]);
		}
	});

	it("ranks environment-sourced handlers after argv", async () => {
		vi.stubEnv("DRY", "true");
		expect(await outputs(["--preview"])).toEqual(["preview", "preview"]);
		expect(await outputs([])).toEqual(["dry", "dry"]);
	});

	it("does not handle a negated flag", async () => {
		expect(await outputs(["--no-preview"])).toEqual(["action", "action"]);
	});

	it("handles only flags that were given, not omissions that resolve to a default", async () => {
		const handled = (flags: FlagsDef) =>
			new Crust("cli")
				.extend(
					defineExtension(defineExtensionId("mode"))
						.flags(flags)
						.handle("mode", (ctx) => ctx.stdout("handled")),
				)
				.action(({ stdout }) => stdout("action"));
		const repeatable = handled({ mode: { type: "boolean", multiple: true } });
		expect((await repeatable.run([], { flags: { mode: [false] } })).stdout).toBe("action");
		const defaulted = handled({ mode: { type: "boolean", default: true } });
		expect((await defaulted.run([], { flags: { mode: undefined } })).stdout).toBe("action");
		const listed = handled({
			mode: { type: "string", multiple: true, delimiter: ",", default: ["a"] },
		});
		expect((await listed.run([], { flags: { mode: [] } })).stdout).toBe("action");
		const lines: string[] = [];
		await listed.execute({
			argv: ["--mode", ""],
			io: { stdout: (line) => void lines.push(line), stderr: () => {} },
		});
		expect(lines).toEqual(["action"]);
	});

	it("handles any supplied value of a non-boolean flag, including JSON arrays and false", async () => {
		const app = new Crust("cli")
			.extend(
				defineExtension(defineExtensionId("json-mode"))
					.flags({ mode: { type: "json" } })
					.handle("mode", (ctx) => ctx.stdout("handled")),
			)
			.action(({ stdout }) => stdout("action"));
		for (const mode of [[], [false], false]) {
			expect((await app.run([], { flags: { mode } })).stdout, JSON.stringify(mode)).toBe("handled");
		}
		const lines: string[] = [];
		await app.execute({
			argv: ["--mode", "[]"],
			io: { stdout: (line) => void lines.push(line), stderr: () => {} },
		});
		expect(lines).toEqual(["handled"]);
	});

	it("handles a root-only flag only on the root, not a child's own flag of that name", async () => {
		const version = defineExtension(defineExtensionId("version"))
			.flags({ version: { type: "boolean", recursive: false } })
			.handle("version", (ctx) => ctx.stdout("cli v1"), { eager: true });
		const app = new Crust("cli")
			.extend(version)
			.command("publish", (command) =>
				command
					.flags({ version: { type: "string" } })
					.action(({ flags, stdout }) => stdout(`publishing ${flags.version}`)),
			)
			.action(() => {});
		expect((await app.run([], { flags: { version: true } })).stdout).toBe("cli v1");
		expect((await app.run(["publish"], { flags: { version: "2.0.0" } })).stdout).toBe(
			"publishing 2.0.0",
		);
		const lines: string[] = [];
		await app.execute({
			argv: ["publish", "--version", "2.0.0"],
			io: { stdout: (line) => void lines.push(line), stderr: () => {} },
		});
		expect(lines).toEqual(["publishing 2.0.0"]);
	});

	it("ranks structured run() flags by key order", async () => {
		for (const app of handlerApps()) {
			expect(await app.run([], { flags: { dry: true, preview: true } })).toMatchObject({
				status: "handled",
				by: "dry",
			});
			expect(await app.run([], { flags: { preview: true, dry: true } })).toMatchObject({
				status: "handled",
				by: "preview",
			});
		}
	});

	it("runs preRun after every setup and before validation, only when the action runs", async () => {
		const seen: string[] = [];
		const gate = defineExtension(defineExtensionId("gate"))
			.flags({ stop: { type: "boolean" } })
			.preRun(() => void seen.push("preRun"))
			.setup(() => void seen.push("gate setup"))
			.handle("stop", () => void seen.push("stop"));
		const fallback = defineExtension(defineExtensionId("fallback"))
			.setup(() => void seen.push("fallback setup"))
			.noAction(() => void seen.push("noAction"));
		const app = new Crust("cli")
			.args({ name: "file", type: "string", required: true })
			.extend(gate, fallback)
			.command("group", (command) => command)
			.action(() => void seen.push("action"));

		expect(await app.run([], {} as never)).toMatchObject({ status: "failed" });
		expect(seen).toEqual(["gate setup", "fallback setup", "preRun"]);
		seen.length = 0;
		await unwrap(app.run([], { args: { file: "x" } }));
		expect(seen).toEqual(["gate setup", "fallback setup", "preRun", "action"]);
		seen.length = 0;
		expect(await app.run([], { flags: { stop: true } } as never)).toMatchObject({
			status: "handled",
			by: "gate",
		});
		expect(seen).toEqual(["gate setup", "fallback setup", "stop"]);
		seen.length = 0;
		expect(await app.run(["group"])).toMatchObject({ status: "handled", by: "fallback" });
		expect(seen).toEqual(["gate setup", "fallback setup", "noAction"]);
	});

	it("passes setup the same context object as later hooks", async () => {
		const seen = new WeakSet<object>();
		let sameInPostRun = false;
		const tracker = defineExtension(defineExtensionId("tracker"))
			.setup((ctx) => void seen.add(ctx))
			.postRun((ctx) => void (sameInPostRun = seen.has(ctx)));
		await unwrap(
			new Crust("cli")
				.extend(tracker)
				.action(() => {})
				.run([]),
		);
		expect(sameInPostRun).toBe(true);
	});

	it("runs deferred setup cleanup in reverse after postRun and Context disposal, even when a later setup throws", async () => {
		const seen: string[] = [];
		const resource = defineContext("resource").setup(() => ({
			async [Symbol.asyncDispose]() {
				seen.push("dispose");
			},
		}));
		const extension = (name: string) =>
			defineExtension(defineExtensionId(name))
				.setup(({ defer }) => {
					seen.push(`setup ${name}`);
					defer(() => void seen.push(`cleanup ${name}`));
				})
				.postRun(() => void seen.push(`postRun ${name}`));
		const app = new Crust("cli")
			.provide(resource())
			.extend(extension("a"), extension("b"))
			.action(async ({ ctx }) => void (await ctx.resource));

		await unwrap(app.run([]));
		expect(seen).toEqual([
			"setup a",
			"setup b",
			"postRun b",
			"postRun a",
			"dispose",
			"cleanup b",
			"cleanup a",
		]);

		seen.length = 0;
		const boom = defineExtension(defineExtensionId("boom")).setup(() => {
			throw new Error("boom");
		});
		const failing = new Crust("cli")
			.extend(extension("a"), boom, extension("b"))
			.action(() => void seen.push("action"));
		await expect(unwrap(failing.run([]))).rejects.toThrow("boom");
		expect(seen).toEqual(["setup a", "postRun b", "postRun a", "cleanup a"]);

		let late: ((cleanup: () => void) => void) | undefined;
		const leaky = defineExtension(defineExtensionId("leaky")).setup(({ defer }) => {
			late = defer;
		});
		await unwrap(
			new Crust("cli")
				.extend(leaky)
				.action(() => {})
				.run([]),
		);
		expect(() => late?.(() => {})).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: expect.objectContaining({ reason: "extension-defer-after-setup" }),
			}),
		);
	});

	it("rejects two noAction Extensions and handlers for unowned flags", async () => {
		const fallback = (name: string) => defineExtension(defineExtensionId(name)).noAction(() => {});
		await expect(new Crust("cli").extend(fallback("a"), fallback("b")).snapshot()).rejects.toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: expect.objectContaining({ reason: "duplicate-no-action" }),
			}),
		);
		const dynamic: Record<string, { type: "boolean" }> = { owned: { type: "boolean" } };
		const extension = defineExtension(defineExtensionId("dynamic")).flags(dynamic);
		expect(() => extension.handle("missing", () => {})).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: expect.objectContaining({ reason: "unknown-handle-flag" }),
			}),
		);
		expect(() => extension.handle("owned", () => {})).not.toThrow();
	});
});

describe("Extension renderer", () => {
	let originalExitCode: number | string | null | undefined;

	beforeEach(() => {
		originalExitCode = process.exitCode;
	});

	afterEach(() => {
		process.exitCode = originalExitCode ?? 0;
	});

	/** A renderer that tags every member call, so tests read one ordered transcript. */
	function tagging(lines: string[]) {
		return {
			text: (line: string) => void lines.push(`text:${line}`),
			diag: (line: string) => void lines.push(`diag:${line}`),
			result: (value: unknown) => void lines.push(`result:${JSON.stringify(value)}`),
			error: (error: unknown) => void lines.push(`error:${(error as Error).message}`),
		};
	}

	/** Execute with captured IO; stdout and stderr share one transcript, tagged by stream. */
	async function execute(app: AnyCrust, argv: string[], lines: string[]) {
		return app.execute({
			argv,
			io: {
				stdout: (line) => void lines.push(`stdout:${line}`),
				stderr: (line) => void lines.push(`stderr:${line}`),
			},
		});
	}

	it("routes action and Context output and the result through the renderer, but not the Extension's own output", async () => {
		const lines: string[] = [];
		const logger = defineContext("logger").setup(({ stderr }) => stderr);
		const render = defineExtension(defineExtensionId("render"))
			.renderer(() => tagging(lines))
			.preRun((ctx) => ctx.stdout("preRun"))
			.postRun((ctx, outcome) => ctx.stderr(`postRun:${outcome.status}`));
		const app = new Crust("cli")
			.provide(logger())
			.extend(render)
			.add(
				defineCommand("log", (cmd) =>
					cmd.use(logger).action(async ({ ctx, stdout }) => {
						stdout("action");
						(await ctx.logger)("logged");
						return { ok: true };
					}),
				),
			);

		expect(await execute(app, ["log"], lines)).toBe(0);
		expect(lines).toEqual([
			"stdout:preRun",
			"text:action",
			"diag:logged",
			'result:{"ok":true}',
			"stderr:postRun:completed",
		]);
	});

	it("chooses the renderer after every setup and flushes earlier action-side output through it in order", async () => {
		const lines: string[] = [];
		const logger = defineContext("logger").setup(({ stdout, stderr }) => {
			stdout("logger:setup");
			stderr("logger:diag");
			return stdout;
		});
		const early = defineExtension(defineExtensionId("early"))
			.provide(logger())
			.use(logger)
			.setup(async ({ ctx }) => void (await ctx.logger));
		let configured = false;
		const seen: boolean[] = [];
		const render = defineExtension(defineExtensionId("render"))
			.setup(() => void (configured = true))
			.renderer(() => (seen.push(configured), tagging(lines)));
		// The selector runs after every setup, so `.extend()` order doesn't matter.
		const app = new Crust("cli")
			.extend(render, early)
			.add(
				defineCommand("log", (cmd) =>
					cmd.use(logger).action(async ({ ctx }) => (await ctx.logger)("logger:action")),
				),
			);

		expect(await execute(app, ["log"], lines)).toBe(0);
		expect(seen).toEqual([true]);
		expect(lines).toEqual([
			"text:logger:setup",
			"diag:logger:diag",
			"text:logger:action",
			"result:undefined",
		]);
	});

	it("keeps the default for an undefined selection and for omitted members", async () => {
		const lines: string[] = [];
		const render = defineExtension(defineExtensionId("render"))
			.flags({ tagged: { type: "boolean" } })
			.renderer((ctx) =>
				ctx.flags.tagged === true
					? {
							text: (line) => void lines.push(`text:${line}`),
							diag: (line) => void lines.push(`diag:${line}`),
						}
					: undefined,
			);
		const app = new Crust("cli").extend(render).action(({ stdout }) => {
			stdout("action");
			throw new Error("boom");
		});

		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual(["stdout:action", "stderr:Error: boom"]);
		lines.length = 0;
		expect(await execute(app, ["--tagged"], lines)).toBe(1);
		expect(lines).toEqual(["text:action", "stderr:Error: boom"]);
	});

	/** An Extension whose setup writes through a Context, then throws. */
	function brokenSetup(failure: unknown = new Error("setup failed")) {
		const logger = defineContext("logger").setup(({ stdout }) => {
			stdout("logger:setup");
			return stdout;
		});
		return defineExtension(defineExtensionId("broken"))
			.provide(logger())
			.use(logger)
			.setup(async ({ ctx }) => {
				await ctx.logger;
				throw failure;
			});
	}

	it("routes a setup failure, and the output waiting for it, through the renderer an argv flag selected", async () => {
		const lines: string[] = [];
		const render = defineExtension(defineExtensionId("render"))
			.flags({ tagged: { type: "boolean" } })
			.renderer((ctx) => (ctx.flags.tagged === true ? tagging(lines) : undefined))
			.onError(() => void lines.push("onError"));
		const app = new Crust("cli").extend(render, brokenSetup()).action(() => {});

		expect(await execute(app, ["--tagged"], lines)).toBe(1);
		expect(lines).toEqual(["text:logger:setup", "onError", "error:setup failed"]);
		lines.length = 0;
		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual(["stdout:logger:setup", "onError", "stderr:Error: setup failed"]);
	});

	it("renders a setup failure by default when the selector then throws or rejects", async () => {
		const lines: string[] = [];
		for (const select of [
			() => {
				lines.push("selector");
				throw new Error("no renderer");
			},
			async () => {
				lines.push("selector");
				throw new Error("no async renderer");
			},
		]) {
			lines.length = 0;
			const render = defineExtension(defineExtensionId("render")).renderer(select);
			const app = new Crust("cli").extend(render, brokenSetup()).action(() => {});
			expect(await execute(app, [], lines)).toBe(1);
			expect(lines).toEqual(["selector", "stdout:logger:setup", "stderr:Error: setup failed"]);
		}
	});

	it("keeps a setup failure when flushing waiting output through the renderer throws", async () => {
		const lines: string[] = [];
		const seen: string[] = [];
		const render = defineExtension(defineExtensionId("render"))
			.renderer(() => ({
				...tagging(lines),
				text() {
					throw new Error("formatter failed");
				},
			}))
			.onError((error) => void seen.push(`onError:${(error as Error).message}`))
			.postRun((_ctx, outcome) => {
				if (outcome.status === "failed") seen.push(`postRun:${(outcome.error as Error).message}`);
			});

		const failing = new Crust("cli").extend(render, brokenSetup()).action(() => {});
		expect(await execute(failing, [], lines)).toBe(1);
		expect(lines).toEqual(["error:setup failed"]);
		expect(seen).toEqual(["onError:setup failed", "postRun:setup failed"]);
		await expect(failing.run([])).resolves.toMatchObject({
			status: "failed",
			error: { message: "setup failed" },
		});

		lines.length = 0;
		const cancelled = new Crust("cli")
			.extend(render, brokenSetup(new DOMException("stop", "AbortError")))
			.action(() => {});
		expect(await execute(cancelled, [], lines)).toBe(130);
		expect(lines).toEqual([]);
	});

	it("writes Context output immediately when no Extension sets a renderer", async () => {
		const lines: string[] = [];
		const logger = defineContext("logger").setup(({ stdout }) => {
			stdout("initializing");
			return stdout;
		});
		const early = defineExtension(defineExtensionId("early"))
			.provide(logger())
			.use(logger)
			.setup(async ({ ctx, stdout }) => {
				await ctx.logger;
				lines.push("pulled");
				stdout("ready");
			});
		const app = new Crust("cli").extend(early).action(() => {});

		expect(await execute(app, [], lines)).toBe(0);
		expect(lines).toEqual(["stdout:initializing", "pulled", "stdout:ready"]);
		const outcome = await app.run([]);
		expect(outcome.stdout).toBe("initializing\nready");
	});

	it("renders routing and selector failures by default", async () => {
		const lines: string[] = [];
		let selected = false;
		const render = defineExtension(defineExtensionId("render")).renderer(
			() => ((selected = true), tagging(lines)),
		);
		const routed = new Crust("cli")
			.extend(render)
			.add(defineCommand("known", (cmd) => cmd.action(() => {})));
		expect(await execute(routed, ["nope"], lines)).toBe(1);
		expect(selected).toBe(false);
		expect(lines).toEqual([expect.stringMatching(/^stderr:Error: /)]);

		lines.length = 0;
		const throwing = defineExtension(defineExtensionId("render")).renderer(() => {
			throw new Error("no renderer");
		});
		expect(
			await execute(
				new Crust("cli").extend(throwing).action(() => {}),
				[],
				lines,
			),
		).toBe(1);
		expect(lines).toEqual(["stderr:Error: no renderer"]);

		lines.length = 0;
		const rejecting = defineExtension(defineExtensionId("render")).renderer(async () => {
			throw new Error("no async renderer");
		});
		expect(
			await execute(
				new Crust("cli").extend(rejecting).action(() => {}),
				[],
				lines,
			),
		).toBe(1);
		expect(lines).toEqual(["stderr:Error: no async renderer"]);
	});

	it("awaits an async selector before any handler, preRun, or action runs", async () => {
		const lines: string[] = [];
		const logger = defineContext("logger").setup(({ stdout }) => {
			stdout("logger:setup");
			return stdout;
		});
		const render = defineExtension(defineExtensionId("render"))
			.provide(logger())
			.use(logger)
			.setup(async ({ ctx }) => void (await ctx.logger))
			.renderer(async () => {
				await new Promise((resolve) => setTimeout(resolve, 0));
				lines.push("selected");
				return tagging(lines);
			})
			.preRun(() => void lines.push("preRun"));
		const app = new Crust("cli").extend(render).action(() => ({ ok: true }));

		expect(await execute(app, [], lines)).toBe(0);
		expect(lines).toEqual(["selected", "text:logger:setup", "preRun", 'result:{"ok":true}']);
	});

	it("calls error once after onError hooks decline or throw, never when one claims the failure", async () => {
		const lines: string[] = [];
		let claim: boolean | "throw" = false;
		const presenter = defineExtension(defineExtensionId("presenter")).onError((error, ctx) => {
			if (claim === "throw") throw new Error("hook broke");
			if (!claim) return false;
			ctx.stderr(`claimed:${(error as Error).message}`);
			return true;
		});
		const render = defineExtension(defineExtensionId("render")).renderer(() => tagging(lines));
		const app = new Crust("cli").extend(presenter, render).action(() => {
			throw new Error("boom");
		});

		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual(["error:boom"]);
		lines.length = 0;
		claim = "throw";
		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual(["error:boom"]);
		lines.length = 0;
		claim = true;
		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual(["stderr:claimed:boom"]);
	});

	it("calls error for postRun and cleanup failures after a successful action", async () => {
		const lines: string[] = [];
		const render = defineExtension(defineExtensionId("render")).renderer(() => tagging(lines));
		const late = defineExtension(defineExtensionId("late")).postRun(() => {
			throw new Error("postRun failed");
		});
		const leaky = defineExtension(defineExtensionId("leaky")).setup(({ defer }) =>
			defer(() => {
				throw new Error("cleanup failed");
			}),
		);

		expect(
			await execute(
				new Crust("cli").extend(render, late).action(() => 1),
				[],
				lines,
			),
		).toBe(1);
		expect(lines).toEqual(["result:1", "error:postRun failed"]);
		lines.length = 0;
		expect(
			await execute(
				new Crust("cli").extend(render, leaky).action(() => 1),
				[],
				lines,
			),
		).toBe(1);
		expect(lines).toEqual(["result:1", "error:cleanup failed"]);
	});

	it("calls cleanup once per disposal failure after a rendered failure, else writes Core's lines", async () => {
		const lines: string[] = [];
		let cleanup: ((error: unknown) => void) | undefined;
		const render = defineExtension(defineExtensionId("render")).renderer(() => ({
			...tagging(lines),
			...(cleanup && { cleanup }),
		}));
		const leaky = defineExtension(defineExtensionId("leaky")).setup(({ defer }) => {
			defer(() => {
				throw new Error("db close failed");
			});
			defer(() => {
				throw new Error("cache close failed");
			});
		});
		const app = new Crust("cli").extend(render, leaky).action(() => {
			throw new Error("boom");
		});

		// Two failing cleanups reach Core as one SuppressedError; the renderer gets each failure.
		cleanup = (error) => void lines.push(`cleanup:${(error as Error).message}`);
		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual(["error:boom", "cleanup:db close failed", "cleanup:cache close failed"]);

		lines.length = 0;
		cleanup = undefined;
		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual([
			"error:boom",
			"stderr:Cleanup failed: db close failed\nCleanup failed: cache close failed",
		]);

		// A failing renderer must never hide the cleanup failure.
		lines.length = 0;
		cleanup = () => {
			throw new Error("renderer broke");
		};
		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual([
			"error:boom",
			"stderr:Cleanup failed: db close failed",
			"stderr:Cleanup failed: cache close failed",
		]);
	});

	it("falls back to Core's rendering when error throws, and stays silent on cancellation", async () => {
		const lines: string[] = [];
		const render = defineExtension(defineExtensionId("render")).renderer(() => ({
			...tagging(lines),
			error() {
				throw new Error("renderer broke");
			},
		}));
		const app = new Crust("cli").extend(render).action(() => {
			throw new Error("boom");
		});
		expect(await execute(app, [], lines)).toBe(1);
		expect(lines).toEqual(["stderr:Error: boom"]);

		lines.length = 0;
		const cancelled = new Crust("cli")
			.extend(defineExtension(defineExtensionId("render")).renderer(() => tagging(lines)))
			.action(() => {
				throw new DOMException("stop", "AbortError");
			});
		expect(await execute(cancelled, [], lines)).toBe(130);
		expect(lines).toEqual([]);
	});

	it("calls result only for a completed action, and a throwing result fails the invocation", async () => {
		const lines: string[] = [];
		const outcomes: string[] = [];
		const render = defineExtension(defineExtensionId("render"))
			.flags({ info: { type: "boolean" } })
			.handle("info", (ctx) => ctx.stdout("info"))
			.renderer(() => ({
				...tagging(lines),
				result(value) {
					if (value === "bad") throw new Error("cannot render bad");
					lines.push(`result:${String(value)}`);
				},
			}))
			.postRun((_ctx, outcome) => void outcomes.push(outcome.status));
		const app = new Crust("cli").extend(render).add(
			defineCommand("good", (cmd) => cmd.action(() => "good")),
			defineCommand("bad", (cmd) => cmd.action(() => "bad")),
			defineCommand("group", (cmd) => cmd),
		);

		expect(await execute(app, ["good", "--info"], lines)).toBe(0);
		expect(await execute(app, ["group"], lines)).toBe(0);
		expect(lines).toEqual(["stdout:info"]);
		lines.length = 0;

		await expect(app.run(["good"])).resolves.toMatchObject({ status: "completed" });
		expect(lines).toEqual(["result:good"]);
		lines.length = 0;
		const failed = await app.run(["bad"]);
		expect(failed).toMatchObject({ status: "failed", error: { message: "cannot render bad" } });
		// run() never renders failures; the caller reads outcome.error.
		expect(lines).toEqual([]);
		expect(outcomes).toEqual(["handled", "completed", "completed", "failed"]);
	});

	it("rejects two renderer Extensions", async () => {
		const render = (name: string) =>
			defineExtension(defineExtensionId(name)).renderer(() => undefined);
		await expect(new Crust("cli").extend(render("a"), render("b")).snapshot()).rejects.toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				message: 'Extensions "a" and "b" both set renderer; an application can have one',
				details: expect.objectContaining({ reason: "duplicate-renderer" }),
			}),
		);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// .execute() — Full execution pipeline tests
// ────────────────────────────────────────────────────────────────────────────

describe("Extension onError hooks", () => {
	let originalExitCode: number | string | null | undefined;
	let stderrChunks: string[];

	beforeEach(() => {
		originalExitCode = process.exitCode;
		stderrChunks = [];
		captureDefaultIO({ 2: () => stderrChunks });
		process.exitCode = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.exitCode = originalExitCode ?? 0;
	});

	const failing = () =>
		new Crust("cli").action(() => {
			throw new Error("boom");
		});

	it("stops at the first truthy result and retains the nonzero exit status", async () => {
		const order: string[] = [];
		const first = defineExtension(defineExtensionId("first")).onError(
			() => (order.push("first"), undefined),
		);
		const presenter = defineExtension(defineExtensionId("presenter")).onError((error, ctx) => {
			order.push("presenter");
			ctx.stderr(`pretty: ${(error as Error).message}`);
			return true;
		});
		const never = defineExtension(defineExtensionId("never")).onError(() => {
			order.push("never");
		});

		await failing().extend(first, presenter, never).execute({ argv: [] });
		expect(order).toEqual(["first", "presenter"]);
		expect(stderrChunks.join("\n")).toContain("pretty: boom");
		expect(stderrChunks.join("\n")).not.toContain("Error: boom");
		expect(process.exitCode).toBe(1);
	});

	it("keeps invocation Contexts live through onError and disposes them afterwards", async () => {
		let disposed = false;
		let pulled = false;
		const resource = defineContext("resource").setup(() => ({
			[Symbol.dispose]() {
				disposed = true;
			},
		}));
		const observer = defineExtension(defineExtensionId("observer"))
			.use(resource)
			.onError(async (_error, ctx) => {
				await ctx.ctx.resource;
				pulled = true;
				return true;
			});
		const app = new Crust("cli")
			.provide(resource())
			.extend(observer)
			.action(async ({ ctx }) => {
				await ctx.resource;
				throw new Error("boom");
			});

		await app.execute({ argv: [] });
		expect(pulled).toBe(true);
		expect(disposed).toBe(true);
	});

	it("passes the same context identity from preRun to onError", async () => {
		let preRunContext: unknown;
		let onErrorContext: unknown;
		const observer = defineExtension(defineExtensionId("observer"))
			.preRun((ctx) => {
				preRunContext = ctx;
			})
			.onError((_error, ctx) => {
				onErrorContext = ctx;
				return true;
			});

		expect(await failing().extend(observer).execute({ argv: [] })).toBe(1);
		expect(preRunContext).toBeDefined();
		expect(onErrorContext).toBe(preRunContext);
	});

	it("attributes handled and core-rendered failures before postRun", async () => {
		const handled: unknown[] = [];
		const unhandled: unknown[] = [];
		const presenterId = defineExtensionId("presenter");
		const presenter = defineExtension(presenterId)
			.onError(() => true)
			.postRun((_ctx, outcome) => void handled.push(outcome));
		const observer = defineExtension(defineExtensionId("observer")).postRun(
			(_ctx, outcome) => void unhandled.push(outcome),
		);

		await failing().extend(presenter).execute({ argv: [] });
		await failing().extend(observer).execute({ argv: [] });
		expect(handled[0]).toMatchObject({ status: "failed", by: presenterId });
		expect(Object.isFrozen(handled[0])).toBe(true);
		expect(unhandled[0]).toMatchObject({ status: "failed" });
		expect(unhandled[0]).not.toHaveProperty("by");
	});

	it("falls through to Core's renderer without attribution when an onError hook throws", async () => {
		let laterRan = false;
		const outcomes: unknown[] = [];
		const thrower = defineExtension(defineExtensionId("thrower"))
			.onError(() => {
				throw new Error("renderer broke");
			})
			.postRun((_ctx, outcome) => void outcomes.push(outcome));
		const later = defineExtension(defineExtensionId("later")).onError(() => {
			laterRan = true;
			return true;
		});

		await failing().extend(thrower, later).execute({ argv: [] });
		expect(laterRan).toBe(false);
		expect(stderrChunks.join("\n")).toContain("Error: boom");
		expect(outcomes[0]).toMatchObject({ status: "failed" });
		expect(outcomes[0]).not.toHaveProperty("by");
		expect(process.exitCode).toBe(1);
	});

	it("sees the routed command when its argv fails to parse, and the root when routing fails", async () => {
		const seen: { name: string; path: readonly string[]; error: string }[] = [];
		const observer = defineExtension(defineExtensionId("observer")).onError((error, ctx) => {
			seen.push({
				name: ctx.command.meta.name,
				path: ctx.commandPath,
				error: (error as Error).message,
			});
		});
		const app = new Crust("cli")
			.extend(observer)
			.add(defineCommand("sub", { aliases: ["s"] }, (cmd) => cmd.action(() => {})));

		await app.execute({ argv: ["s", "--bogus"] });
		await app.execute({ argv: ["nope"] });
		expect(seen).toEqual([
			{ name: "sub", path: ["cli", "sub"], error: 'Unknown flag "--bogus"' },
			{ name: "cli", path: ["cli"], error: expect.stringContaining('"nope"') },
		]);
	});

	it("falls through to Core's default renderer and never runs for run()", async () => {
		let onErrorRan = false;
		const observer = defineExtension(defineExtensionId("observer")).onError(() => {
			onErrorRan = true;
		});

		await failing().extend(observer).execute({ argv: [] });
		expect(stderrChunks.join("\n")).toContain("Error: boom");
		expect(onErrorRan).toBe(true);

		onErrorRan = false;
		stderrChunks = [];
		await expect(unwrap(failing().extend(observer).run([]))).rejects.toThrow("boom");
		expect(onErrorRan).toBe(false);
		expect(stderrChunks).toEqual([]);
	});
});

describe("Crust .run()", () => {
	let originalExitCode: number | string | null | undefined;

	beforeEach(() => {
		originalExitCode = process.exitCode;
		process.exitCode = 0;
	});

	afterEach(() => {
		process.exitCode = originalExitCode ?? 0;
	});

	it("captures the original CrustError without rendering or setting exitCode", async () => {
		const stderrLines: string[] = [];
		const app = new Crust("test").flags({ port: { type: "number" } }).action(() => {});

		await expect(
			unwrap(
				app.run(
					[],
					{ flags: { unknown: true } },
					// @ts-expect-error -- unknown flag makes the compatibility overload's IO parameter never.
					{
						stderr: (text: string) => stderrLines.push(text),
					},
				),
			),
		).rejects.toMatchObject({ code: "PARSE" });
		expect(stderrLines).toEqual([]);
		// run() never touches process status
		expect(process.exitCode).toBe(0);
	});

	it("resolves failed with the original action error unwrapped", async () => {
		const boom = new Error("action exploded");
		const app = new Crust("test").action(() => {
			throw boom;
		});

		await expect(app.run([])).resolves.toMatchObject({ status: "failed", error: boom });
		// run() never touches process status
		expect(process.exitCode).toBe(0);
	});

	it("injected stdout/stderr callbacks reach the Command Action", async () => {
		const out: string[] = [];
		const err: string[] = [];
		const app = new Crust("test").action((ctx) => {
			ctx.stdout("to out");
			ctx.stderr("to err");
		});

		await unwrap(
			app.run([], undefined, {
				stdout: (t) => out.push(t),
				stderr: (t) => err.push(t),
			}),
		);

		expect(out).toEqual(["to out"]);
		expect(err).toEqual(["to err"]);
	});

	it("makes explicitly injected run IO ambient during the invocation", async () => {
		const out: string[] = [];
		const err: string[] = [];
		const app = new Crust("test").action(() => {
			const io = getAmbientTerminalIO();
			io?.stdout("ambient out");
			io?.stderr("ambient err");
		});

		const result = await unwrap(
			app.run([], undefined, {
				stdout: (text) => out.push(text),
				stderr: (text) => err.push(text),
			}),
		);

		expect(out).toEqual(["ambient out"]);
		expect(err).toEqual(["ambient err"]);
		expect(result.stdout).toBe("ambient out");
		expect(result.stderr).toBe("ambient err");
		expect(getAmbientTerminalIO()).toBeUndefined();
	});
});

describe("Crust .execute()", () => {
	// Capture default IO and save/restore process.exitCode around each test
	let originalExitCode: number | string | null | undefined;
	let stdoutChunks: string[];
	let stderrChunks: string[];

	beforeEach(() => {
		originalExitCode = process.exitCode;
		stdoutChunks = [];
		stderrChunks = [];
		captureDefaultIO({ 1: () => stdoutChunks, 2: () => stderrChunks });
		// Reset exitCode — setting to 0 then deleting clears the value
		process.exitCode = 0;
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Restore original exit code (0 acts as "no error")
		process.exitCode = originalExitCode ?? 0;
	});

	it("runs root action with flags and args combined", async () => {
		let receivedCtx: ExecuteReceivedContext | undefined;

		const app = new Crust("test")
			.flags({ port: { type: "number", default: 3000 }, verbose: { type: "boolean" } })
			.args({ name: "dir", type: "string", default: "." })
			.action((ctx) => {
				receivedCtx = ctx;
			});

		const exitCode = await app.execute({ argv: ["public", "--port", "8080"] });

		expect(exitCode).toBe(0);
		expect(receivedCtx).toBeDefined();
		expect(receivedCtx?.args.dir).toBe("public");
		expect(receivedCtx?.flags.port).toBe(8080);
	});

	it("routes to subcommand", async () => {
		let actionRan = "";

		const app = new Crust("cli")
			.action(() => {
				actionRan = "root";
			})
			.add(
				defineCommand("sub", (cmd) =>
					cmd.action(() => {
						actionRan = "sub";
					}),
				),
			);

		await app.execute({ argv: ["sub"] });

		expect(actionRan).toBe("sub");
	});

	it("passes Context-owned flags but not parent-local flags to subcommand actions", async () => {
		let subFlags: Record<string, ParsedFlagValue> = {};
		const verbose = defineFlag({ type: "boolean" });
		const logging = defineContext("logging")
			.flags({ verbose })
			.setup(() => ({}));

		const app = new Crust("cli")
			.flags({ port: { type: "number", default: 3000 } })
			.provide(logging())
			.add(
				defineCommand("sub", (cmd) =>
					cmd.use(logging).action((ctx) => {
						subFlags = ctx.flags;
					}),
				),
			);

		await app.execute({ argv: ["sub", "--verbose"] });

		expect(subFlags.verbose).toBe(true);
		// Parent-local flags never enter a descendant's parse surface.
		expect(subFlags.port).toBeUndefined();
	});

	it("dispatches a Context-owned flag written before the subcommand", async () => {
		let subFlags: Record<string, ParsedFlagValue> = {};
		const verbose = defineFlag({ type: "boolean" });
		const logging = defineContext("logging")
			.flags({ verbose })
			.setup(() => ({}));

		const app = new Crust("cli").provide(logging()).add(
			defineCommand("sub", (cmd) =>
				cmd.use(logging).action((ctx) => {
					subFlags = ctx.flags;
				}),
			),
		);

		await app.execute({ argv: ["--verbose", "sub"] });

		expect(subFlags.verbose).toBe(true);
	});

	it("rejects a parent-local flag written before the subcommand", async () => {
		let subRan = false;

		const app = new Crust("cli").flags({ quiet: { type: "boolean" } }).add(
			defineCommand("sub", (cmd) =>
				cmd.action(() => {
					subRan = true;
				}),
			),
		);

		await app.execute({ argv: ["--quiet", "sub"] });

		expect(subRan).toBe(false);
		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain(
			'Flag "--quiet" cannot be used before subcommand "sub"',
		);
	});

	it("catches errors and sets exitCode", async () => {
		const app = new Crust("test").action(() => {
			throw new Error("execution failed");
		});

		const exitCode = await app.execute({ argv: [] });

		expect(exitCode).toBe(1);
		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("execution failed");
	});

	it("offers AbortError to onError hooks before the silent default", async () => {
		const seen: unknown[] = [];
		const cancelRenderer = defineExtension(defineExtensionId("cancel-renderer")).onError(
			(error, ctx) => {
				seen.push(error);
				ctx.stderr("Operation cancelled");
				return true;
			},
		);

		const app = new Crust("test").extend(cancelRenderer).action(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(seen).toHaveLength(1);
		expect((seen[0] as Error).name).toBe("AbortError");
		expect(stderrChunks.join("\n")).toContain("Operation cancelled");
	});

	it("preserves the cancellation exit code after onError hooks", async () => {
		const exitCodeOverride = defineExtension(defineExtensionId("exit-code-override")).onError(
			() => {
				process.exitCode = 1;
			},
		);

		const app = new Crust("test").extend(exitCodeOverride).action(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
	});

	it("keeps cancellation silent when onError hooks decline it", async () => {
		let observed = false;
		const observer = defineExtension(defineExtensionId("observer")).onError(() => {
			observed = true;
			// Decline: Core's default for cancellation stays silent
		});

		const app = new Crust("test").extend(observer).action(() => {
			throw new DOMException("Prompt was cancelled.", "AbortError");
		});

		await app.execute({ argv: [] });

		expect(process.exitCode).toBe(130);
		expect(observed).toBe(true);
		expect(stderrChunks).toEqual([]);
	});

	it("does not run a runnable parent for a typoed subcommand", async () => {
		let ran = false;
		const app = new Crust("gyst")
			.add(defineCommand("session", (cmd) => cmd.action(() => {})))
			.action(() => {
				ran = true;
			});

		await app.execute({ argv: ["sesion", "status"] });

		expect(ran).toBe(false);
		expect(process.exitCode).toBe(1);
		expect(stderrChunks.join("\n")).toContain("Unexpected positional arguments");
		process.exitCode = 0;
	});

	it("no action is a no-op (no error)", async () => {
		const app = new Crust("test").flags({ verbose: { type: "boolean" } });

		await app.execute({ argv: ["--verbose"] });

		// Should complete without error (exitCode stays 0)
		expect(process.exitCode).toBe(0);
	});

	it("rawArgs are passed through", async () => {
		let receivedRawArgs: string[] = [];

		const app = new Crust("test").flags({ verbose: { type: "boolean" } }).action((ctx) => {
			receivedRawArgs = ctx.rawArgs;
		});

		await app.execute({ argv: ["--verbose", "--", "extra1", "extra2"] });

		expect(receivedRawArgs).toEqual(["extra1", "extra2"]);
	});

	it("fills declared positionals from tokens after -- before rawArgs", async () => {
		let seen: [number, string[]] | undefined;
		const app = new Crust("test")
			.args({ name: "offset", type: "number", required: true })
			.action(({ args, rawArgs }) => {
				seen = [args.offset, rawArgs];
			});

		expect(await app.execute({ argv: ["--", "-5", "-x"], io: { stdout() {}, stderr() {} } })).toBe(
			0,
		);
		expect(seen).toEqual([-5, ["-x"]]);
	});

	it("default flag values work on subcommands", async () => {
		let receivedPort: number | undefined;
		const port = defineFlag({ type: "number", default: 3000 });

		const ports = defineContext("ports")
			.flags({ port })
			.setup(({ flags }) => ({
				port: flags.port,
			}));
		const app = new Crust("cli").provide(ports()).add(
			defineCommand("sub", (cmd) =>
				cmd.use(ports).action(async ({ ctx }) => {
					receivedPort = (await ctx.ports).port;
				}),
			),
		);

		await app.execute({ argv: ["sub"] });

		expect(receivedPort).toBe(3000);
	});

	it("Context-owned flag short alias works on subcommand", async () => {
		let receivedVerbose: boolean | undefined;
		const verbose = defineFlag({ type: "boolean", short: "v" });

		const logging = defineContext("logging")
			.flags({ verbose })
			.setup(({ flags }) => ({
				verbose: flags.verbose,
			}));
		const app = new Crust("cli").provide(logging()).add(
			defineCommand("sub", (cmd) =>
				cmd.use(logging).action(async ({ ctx }) => {
					receivedVerbose = (await ctx.logging).verbose;
				}),
			),
		);

		await app.execute({ argv: ["sub", "-v"] });

		expect(receivedVerbose).toBe(true);
	});

	it("action context exposes stdout/stderr text callbacks", async () => {
		const app = new Crust("test").action((ctx) => {
			ctx.stdout("hello out");
			ctx.stderr("hello err");
		});

		await app.execute({ argv: [] });

		expect(stdoutChunks).toContain("hello out");
		expect(stderrChunks).toContain("hello err");
	});

	it("keeps extension hooks and the action inside explicitly injected IO", async () => {
		const stdout = () => {};
		const stderr = () => {};
		const observed: (ReturnType<typeof getAmbientTerminalIO> | undefined)[] = [];
		const observer = defineExtension(defineExtensionId("ambient-observer"))
			.preRun(() => {
				observed.push(getAmbientTerminalIO());
			})
			.postRun(() => {
				observed.push(getAmbientTerminalIO());
			})
			.onError(() => {
				observed.push(getAmbientTerminalIO());
			});
		const app = new Crust("test").extend(observer).action(() => {
			observed.push(getAmbientTerminalIO());
			throw new Error("expected failure");
		});

		await app.execute({ argv: [], io: { stdout, stderr } });

		expect(observed).toHaveLength(4);
		for (const io of observed) {
			expect(io?.stdout).toBe(stdout);
			expect(io?.stderr).toBe(stderr);
		}
		expect(getAmbientTerminalIO()).toBeUndefined();
	});

	it("does not create an ambient terminal scope when execute IO is omitted", async () => {
		const observations: ReturnType<typeof getAmbientTerminalIO>[] = [];
		const app = new Crust("test").action(() => {
			observations.push(getAmbientTerminalIO());
		});

		expect(await app.execute({ argv: [] })).toBe(0);
		expect(observations).toHaveLength(1);
		expect(observations[0]).toBeUndefined();
	});

	describe("cleanup failure diagnostics", () => {
		const failingDisposer = (message: string) =>
			defineContext("resource").setup(() => ({
				[Symbol.dispose]() {
					throw new Error(message);
				},
			}));
		const recordingOnError = (seen: unknown[], claim = false) =>
			defineExtension(defineExtensionId("errors")).onError((error, ctx) => {
				seen.push(error);
				if (claim) ctx.stderr(`pretty: ${String(error)}`);
				return claim;
			});

		it("renders the cleanup failure after the rendered action failure without re-running onError", async () => {
			const seen: unknown[] = [];
			const actionError = new Error("action failed");
			const cleanupError = new Error("db close failed");
			const resource = defineContext("resource").setup(() => ({
				[Symbol.dispose]() {
					throw cleanupError;
				},
			}));
			const app = new Crust("cli")
				.provide(resource())
				.extend(recordingOnError(seen))
				.action(async ({ ctx }) => {
					await ctx.resource;
					throw actionError;
				});

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(process.exitCode).toBe(1);
			expect(seen).toEqual([actionError]);
			expect(stderrChunks).toEqual(["Error: action failed", "Cleanup failed: db close failed"]);

			const outcome = await app.run([]);
			expect(outcome.status).toBe("failed");
			if (outcome.status !== "failed") return;
			const escaping = outcome.error as { name: string; error: unknown; suppressed: unknown };
			expect(escaping.name).toBe("SuppressedError");
			expect(escaping.suppressed).toBe(actionError);
			expect(escaping.error).toBe(cleanupError);
		});

		it("renders the cleanup failure even when an onError hook claims the action failure", async () => {
			const seen: unknown[] = [];
			const app = new Crust("cli")
				.provide(failingDisposer("db close failed")())
				.extend(recordingOnError(seen, true))
				.action(async ({ ctx }) => {
					await ctx.resource;
					throw new Error("action failed");
				});

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(seen).toHaveLength(1);
			expect(stderrChunks).toEqual([
				"pretty: Error: action failed",
				"Cleanup failed: db close failed",
			]);
		});

		it.each(["x", Number.NaN])(
			"associates the cleanup failure with a primitive action failure: %o",
			async (actionError) => {
				const seen: unknown[] = [];
				const app = new Crust("cli")
					.provide(failingDisposer("db close failed")())
					.extend(recordingOnError(seen))
					.action(async ({ ctx }) => {
						await ctx.resource;
						throw actionError;
					});

				expect(await app.execute({ argv: [] })).toBe(1);
				expect(seen).toEqual([actionError]);
				expect(stderrChunks).toEqual([
					`Error: ${String(actionError)}`,
					"Cleanup failed: db close failed",
				]);
			},
		);

		it("exits 130 and renders only the cleanup failure when cancellation cleanup fails", async () => {
			const seen: unknown[] = [];
			const app = new Crust("cli")
				.provide(failingDisposer("db close failed")())
				.extend(recordingOnError(seen))
				.action(async ({ ctx }) => {
					await ctx.resource;
					throw new DOMException("Prompt was cancelled.", "AbortError");
				});

			expect(await app.execute({ argv: [] })).toBe(130);
			expect(process.exitCode).toBe(130);
			expect(seen).toHaveLength(1);
			expect(stderrChunks).toEqual(["Cleanup failed: db close failed"]);
		});

		it.each([false, true])(
			"lists all ten cleanup failures with action failure: %o",
			async (actionFails) => {
				const resource = defineContext("resource").setup(({ defer }) => {
					for (let index = 0; index < 10; index++) {
						defer(() => {
							throw new Error(`close ${index}`);
						});
					}
					return {};
				});
				const app = new Crust("cli").provide(resource()).action(async ({ ctx }) => {
					await ctx.resource;
					if (actionFails) throw new Error("action failed");
				});

				expect(await app.execute({ argv: [] })).toBe(1);
				const label = actionFails ? "Cleanup failed" : "Error";
				const expected = Array.from({ length: 10 }, (_, index) => `${label}: close ${index}`);
				if (actionFails) expected.push("Error: action failed");
				expect(stderrChunks.join("\n").split("\n").toSorted()).toEqual(expected.toSorted());
			},
		);

		it("renders each member of an AggregateError preparation failure", async () => {
			const app = new Crust("cli").extend(
				defineExtension(defineExtensionId("prepare")).sections(() => {
					throw new AggregateError(
						[new Error("first section"), new Error("second section")],
						"Disposal failed",
					);
				}),
			);

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(stderrChunks).toEqual(["Error: first section\nError: second section"]);
		});

		it("flattens a structural SuppressedError without native support", async () => {
			// Down-level bundles can synthesize this plain-Error shape; no instanceof is possible.
			const structural = Object.assign(new Error("An error was suppressed during disposal"), {
				name: "SuppressedError",
				error: new Error("close failed"),
				suppressed: "action failed",
			});
			const app = new Crust("cli").action(() => {
				throw structural;
			});

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(stderrChunks).toEqual(["Error: close failed\nError: action failed"]);
		});

		it("terminates on a self-referential SuppressedError with throwing getters", async () => {
			const hostile = Object.assign(new Error("hostile"), { name: "SuppressedError" });
			Object.defineProperty(hostile, "error", { value: hostile });
			Object.defineProperty(hostile, "suppressed", {
				get() {
					throw new Error("getter");
				},
			});
			const app = new Crust("cli").action(() => {
				throw hostile;
			});

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(stderrChunks).toHaveLength(1);
			expect(stderrChunks[0]).toMatch(/^Error: \S/);
		});

		it("does not report cleanup failure for a self-suppressed action error", async () => {
			const error = Object.assign(new Error("container"), {
				name: "SuppressedError",
				error: new Error("body"),
			});
			Object.defineProperty(error, "suppressed", { value: error });
			const app = new Crust("cli").action(() => {
				throw error;
			});

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(stderrChunks).toEqual(["Error: body"]);
		});

		it("returns 1 when a member's message cannot be coerced to a string", async () => {
			const member = new Error("member");
			Object.defineProperty(member, "message", {
				value: {
					toString() {
						throw new Error("coercion");
					},
				},
			});
			const app = new Crust("cli").extend(
				defineExtension(defineExtensionId("prepare")).sections(() => {
					throw new AggregateError([member], "aggregate");
				}),
			);

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(stderrChunks).toEqual(["Error: [unreadable failure]"]);
		});

		it("still renders readable siblings of an unreadable member", async () => {
			const aggregate = new AggregateError([new Error("hidden"), new Error("visible")]);
			Object.defineProperty(aggregate.errors, "0", {
				get() {
					throw new Error("index getter");
				},
			});
			const suppressed = Object.assign(new Error(""), {
				name: "SuppressedError",
				suppressed: aggregate,
			});
			Object.defineProperty(suppressed, "error", {
				get() {
					throw new Error("error getter");
				},
			});
			const app = new Crust("cli").action(() => {
				throw suppressed;
			});

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(stderrChunks).toEqual([
				"Error: [unreadable failure]\nError: [unreadable failure]\nError: visible",
			]);
		});

		it.each(["deep", "wide", "unreadable"])(
			"marks truncated diagnostics for a %s failure graph",
			async (shape) => {
				let failure = new AggregateError([]);
				let memberReads = 0;
				if (shape === "deep") {
					for (let index = 0; index < 1_000; index++) {
						failure = new AggregateError([failure]);
					}
				} else {
					failure.errors.length = 1_000_000;
					if (shape === "unreadable") {
						for (let index = 0; index < 256; index++) {
							Object.defineProperty(failure.errors, index, {
								get() {
									throw new Error("index getter");
								},
							});
						}
					}
					// Count member reads: the renderer must stop touching the array once its budget is spent.
					failure.errors = new Proxy(failure.errors, {
						get(target, key) {
							if (key !== "length") memberReads++;
							return target[key as keyof typeof target];
						},
					});
				}
				const app = new Crust("cli").action(() => {
					throw failure;
				});

				expect(await app.execute({ argv: [] })).toBe(1);
				const lines = stderrChunks.join("\n").split("\n");
				expect(lines.at(-1)).toBe("Error: [additional failures omitted]");
				expect(lines).toHaveLength(shape === "deep" ? 1 : 256);
				// 256-value budget: the root AggregateError counts, leaving 255 member reads.
				expect(memberReads).toBe(shape === "deep" ? 0 : 255);
			},
		);

		it("never renders a bare label for an empty AggregateError", async () => {
			const app = new Crust("cli").action(() => {
				throw new AggregateError([], "nothing inside");
			});

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(stderrChunks).toEqual(["Error: nothing inside"]);
		});

		it("renders an ordinary error's own message even when it carries an errors array", async () => {
			const app = new Crust("cli").action(() => {
				throw Object.assign(new Error("validation failed"), {
					errors: [new Error("incidental member")],
				});
			});

			expect(await app.execute({ argv: [] })).toBe(1);
			expect(stderrChunks).toEqual(["Error: validation failed"]);
		});
	});
});

describe("value errors never echo the raw value", () => {
	const SECRET = "s3cr3t-sentinel";
	afterEach(() => vi.unstubAllEnvs());

	function valueApp() {
		const errors: unknown[] = [];
		const observer = defineExtension(defineExtensionId("observer")).onError(
			(error) => void errors.push(error),
		);
		const app = new Crust("cli")
			.flags({
				port: { type: "number", env: { name: "R3_PORT" } },
				mode: { type: "string", choices: ["fast", "safe"], env: { name: "R3_MODE" } },
				home: { type: "url", env: { name: "R3_HOME" } },
				data: { type: "json", env: { name: "R3_DATA" } },
			})
			.args({ name: "count", type: "number" })
			.extend(observer)
			.action(() => {});
		async function execute(argv: string[]) {
			const stderr: string[] = [];
			const exitCode = await app.execute({
				argv,
				io: { stdout: () => {}, stderr: (line) => void stderr.push(line) },
			});
			return { exitCode, stderr: stderr.join("\n"), error: errors.at(-1) };
		}
		return { app, execute };
	}

	/** The sentinel is absent from every message, `details`, and cause in the chain. */
	function expectNoEcho(error: unknown): void {
		expect(error).toBeInstanceOf(CrustError);
		for (let current = error; current !== undefined;) {
			if (!(current instanceof Error)) {
				expect(String(current)).not.toContain(SECRET);
				break;
			}
			expect(current.message).not.toContain(SECRET);
			if (current instanceof CrustError) {
				expect(JSON.stringify(current.details ?? {})).not.toContain(SECRET);
			}
			current = current.cause;
		}
	}

	it.each([
		[["--port", SECRET], "Expected a number for --port."],
		[["--mode", SECRET], "Invalid value for --mode. Expected one of: fast, safe"],
		[["--home", SECRET], "Invalid URL for --home (missing protocol — e.g. https://example.com)."],
		[["--data", SECRET], "Invalid JSON for --data. Tip: wrap JSON in single quotes"],
		[[SECRET], "Expected a number for <count>."],
	])("execute() with argv %j", async (argv, message) => {
		const { exitCode, stderr, error } = await valueApp().execute(argv);
		expect(exitCode).toBe(1);
		expect(stderr).toContain(message);
		expect(stderr).not.toContain(SECRET);
		expectNoEcho(error);
	});

	it.each([
		["R3_PORT", "Expected a number for --port (from $R3_PORT)."],
		["R3_MODE", "Invalid value for --mode (from $R3_MODE). Expected one of: fast, safe"],
		[
			"R3_HOME",
			"Invalid URL for --home (from $R3_HOME) (missing protocol — e.g. https://example.com).",
		],
		["R3_DATA", "Invalid JSON for --data (from $R3_DATA). Tip: wrap JSON in single quotes"],
	])("execute() with %s names the variable", async (variable, message) => {
		vi.stubEnv(variable, SECRET);
		const { exitCode, stderr, error } = await valueApp().execute([]);
		expect(exitCode).toBe(1);
		expect(stderr).toContain(message);
		expect(stderr).not.toContain(SECRET);
		expectNoEcho(error);
	});

	it.each([
		[{ flags: { mode: SECRET } }, "Invalid value for --mode. Expected one of: fast, safe"],
		[{ args: { count: SECRET } }, "Expected a number for <count>."],
	] as const)("run() with %j", async (input, message) => {
		const outcome = await valueApp().app.run([], input as RunInputPayload);
		expect(outcome).toMatchObject({ status: "failed", error: { message } });
		if (outcome.status === "failed") expectNoEcho(outcome.error);
	});
});

describe("Crust.snapshot", () => {
	it("returns a frozen snapshot with Extension flags applied", async () => {
		const docs = defineExtension(defineExtensionId("doc-test")).flags({
			extra: {
				type: "boolean",
				description: "Injected for docs",
			},
		});

		const app = new Crust("cli", { description: "Test" }).extend(docs);
		const root = await app.snapshot();
		expect(root.flags.extra).toMatchObject({
			type: "boolean",
			description: "Injected for docs",
		});
		expect(Object.isFrozen(root)).toBe(true);
		expect(() => structuredClone(root)).not.toThrow();
	});
});

// ──────────────────────────────────────────────────────────────────────────────
// .add() aliases
// ──────────────────────────────────────────────────────────────────────────────

describe("Crust .add() aliases", () => {
	it("routes aliases from definition config and includes them in the snapshot", async () => {
		let calls = 0;
		const app = new Crust("cli").add(
			defineCommand("issue", { aliases: ["issues", "i"] }, (command) =>
				command.action(() => {
					calls++;
				}),
			),
		);

		await unwrap(app.run(["issues"]));
		expect(calls).toBe(1);
		expect((await app.snapshot()).subCommands.issue?.meta.aliases).toEqual(["issues", "i"]);
	});

	it("resolves ctx.command to the canonical subtree object inside ctx.rootCommand", async () => {
		const seen: Array<{ command: CommandSnapshot; rootCommand: CommandSnapshot }> = [];
		const probe = defineExtension(defineExtensionId("probe")).preRun(({ command, rootCommand }) => {
			seen.push({ command, rootCommand });
		});
		const app = new Crust("cli")
			.extend(probe)
			.add(
				defineCommand("issue", { aliases: ["i"] }, (issue) =>
					issue.add(
						defineCommand("list", { aliases: ["ls"] }, (list) =>
							list.action(({ command, rootCommand }) => {
								seen.push({ command, rootCommand });
							}),
						),
					),
				),
			)
			.action(({ command, rootCommand }) => {
				seen.push({ command, rootCommand });
			});

		await unwrap(app.run(["i", "ls"]));
		const [hook, action] = seen;
		expect(hook?.command).toBe(action?.command);
		expect(hook?.rootCommand).toBe(action?.rootCommand);
		expect(hook?.command).toBe(hook?.rootCommand.subCommands.issue?.subCommands.list);
		expect(hook?.rootCommand.subCommands.i).toBeUndefined();
		expect(hook?.command?.meta.name).toBe("list");

		seen.length = 0;
		await unwrap(app.run([]));
		expect(seen).toHaveLength(2);
		for (const { command, rootCommand } of seen) expect(command).toBe(rootCommand);
	});
});

describe("dynamic definition guards (brands own literals; runtime owns config-built defs)", () => {
	type DynamicDefs = FlagsDef[] & ArgsDef;
	// SAFETY: adversarial fixtures deliberately model definitions received from untyped JavaScript.
	const asDynamic = (value: unknown): DynamicDefs => value as DynamicDefs;
	// SAFETY: as above; each fixture keeps its name beside the definition, as config-built input would.
	const asFlags = (defs: readonly Record<string, unknown>[]): FlagsDef =>
		Object.fromEntries(defs.map(({ name, ...def }) => [name, def])) as FlagsDef;

	it("rejects duplicate argument names from dynamic defs", () => {
		const defs = asDynamic([
			{ name: "file", type: "string" },
			{ name: "file", type: "string" },
		]);
		expect(() => new Crust("cli").args(...defs)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "argument", name: "file", reason: "duplicate-arg" },
			}),
		);
	});

	it("rejects a mid-tuple variadic from dynamic defs", () => {
		const defs = asDynamic([
			{ name: "files", type: "string", variadic: true },
			{ name: "dest", type: "string", required: true },
		]);
		expect(() => new Crust("cli").args(...defs)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "argument", name: "files", reason: "variadic-position" },
			}),
		);
	});

	it("rejects empty, no-prefixed, and __proto__ flag spellings from dynamic defs", () => {
		const cases: [Record<string, ParsedFlagValue>, string][] = [
			[{ name: "", type: "string" }, "empty-spelling"],
			[{ name: "no-color", type: "boolean" }, "reserved-no-prefix"],
			[{ name: "cache", type: "boolean", aliases: ["no-store"] }, "reserved-no-prefix"],
			[{ name: "__proto__", type: "string" }, "reserved-spelling"],
			[{ name: "safe", type: "string", aliases: ["__proto__"] }, "reserved-spelling"],
		];
		for (const [def, reason] of cases) {
			expect(() => new Crust("cli").flags(asFlags([def]))).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: expect.objectContaining({ reason }),
				}),
			);
		}
	});

	it("rejects flag spellings no argv token can match from dynamic defs", () => {
		const cases: [Record<string, ParsedFlagValue>, string][] = [
			[{ name: "a=b", type: "string" }, "a=b"],
			[{ name: "-x", type: "boolean" }, "-x"],
			[{ name: "dry run", type: "boolean" }, "dry run"],
			[{ name: "dry\trun", type: "boolean" }, "dry\trun"],
			[{ name: "out", type: "string", aliases: ["o=x"] }, "o=x"],
			[{ name: "out", type: "string", aliases: ["--output"] }, "--output"],
			[{ name: "out", type: "string", aliases: ["out put"] }, "out put"],
			[{ name: "out", type: "boolean", short: "-" }, "-"],
			[{ name: "out", type: "boolean", short: " " }, " "],
		];
		for (const [def, spelling] of cases) {
			expect(() => new Crust("cli").flags(asFlags([def])), spelling).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: { subject: "flag", name: spelling, reason: "invalid-spelling" },
				}),
			);
		}
	});

	it("accepts a short `=`, which `-=` still addresses", async () => {
		let seen: boolean | undefined;
		const app = new Crust("cli")
			.flags(asFlags([{ name: "eq", type: "boolean", short: "=" }]))
			.action(({ flags }) => {
				seen = flags.eq === true;
			});
		await app.execute({ argv: ["-="] });
		expect(seen).toBe(true);
	});

	it("rejects malformed .flags() records on commands, Contexts, and Extensions", () => {
		const attach = [
			(input: unknown) => new Crust("cli").flags(asDynamic(input)[0]!),
			(input: unknown) => defineContext("cfg").flags(asDynamic(input)[0]!),
			(input: unknown) => defineExtension(defineExtensionId("cfg-ext")).flags(asDynamic(input)[0]!),
		];
		const cases: [unknown, string, string | undefined][] = [
			// Nullish values typecheck without strictNullChecks; `FlagsInput` admits undefined definitions.
			[[null], "invalid-flags", undefined],
			[[undefined], "invalid-flags", undefined],
			[[{ out: null }], "invalid-flags", "out"],
			[[{ out: undefined }], "invalid-flags", "out"],
			// A literal `__proto__` key sets the record's prototype instead of naming a flag.
			[[{ __proto__: { type: "string" } }], "invalid-flags", undefined],
			[[{ ["__proto__"]: { type: "string" } }], "reserved-spelling", "__proto__"],
			[[{ 2: { type: "string" } }], "integer-like-name", "2"],
			[[{ "0": { type: "string" } }], "integer-like-name", "0"],
			[[{ out: { type: "string" }, 10: { type: "string" } }], "integer-like-name", "10"],
			// Past the array-index range, matching the type-level rule.
			[[{ "4294967295": { type: "string" } }], "integer-like-name", "4294967295"],
			[[{ "a=b": { type: "string" } }], "invalid-spelling", "a=b"],
			[[{ "-x": { type: "string" } }], "invalid-spelling", "-x"],
		];
		for (const add of attach) {
			for (const [input, reason, name] of cases) {
				expect(() => add(input), `${reason} ${String(name)}`).toThrow(
					expect.objectContaining({
						code: "DEFINITION",
						details: { subject: "flag", ...(name === undefined ? {} : { name }), reason },
					}),
				);
			}
		}
		// The `__proto__` hint only fits a record that has a prototype.
		expect(() => attach[0]!([undefined])).toThrow(/expects a plain object record$/);
		expect(() => attach[0]!([{ __proto__: { type: "string" } }])).toThrow(/`__proto__` key/);
		// Not array indexes: they keep insertion order.
		for (const name of ["01", "2fa", "1.5"]) {
			expect(() =>
				new Crust("cli").flags(asDynamic([{ [name]: { type: "string" } }])[0]!),
			).not.toThrow();
		}
		expect(() =>
			new Crust("cli").flags(
				asDynamic([Object.assign(Object.create(null), { out: { type: "string" } })])[0]!,
			),
		).not.toThrow();
	});

	it("rejects empty env names and delimiters from dynamic defs", () => {
		const cases: [Record<string, ParsedFlagValue>, string][] = [
			[{ name: "token", type: "string", env: { name: "" } }, "empty-env"],
			[
				{ name: "tags", type: "string", multiple: true, env: { name: "TAGS", delimiter: "" } },
				"empty-delimiter",
			],
			[{ name: "tags", type: "string", multiple: true, delimiter: "" }, "empty-delimiter"],
		];
		for (const [def, reason] of cases) {
			expect(() => new Crust("cli").flags(asFlags([def]))).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: { subject: "flag", name: def.name, reason },
				}),
			);
		}
		expect(() =>
			new Crust("cli").flags(
				asFlags([
					{
						name: "tags",
						type: "string",
						multiple: true,
						env: { name: "TAGS", delimiter: ":" },
						delimiter: ",",
					},
				]),
			),
		).not.toThrow();
	});

	it("rejects __proto__ flags at defineContext/defineExtension time", () => {
		expect(() =>
			defineContext("cfg")
				.flags(asFlags([{ name: "__proto__", type: "string" }]))
				.setup(() => ({})),
		).toThrow(expect.objectContaining({ code: "DEFINITION" }));
		expect(() =>
			defineExtension(defineExtensionId("cfg-ext")).flags(
				asFlags([{ name: "__proto__", type: "string" }]),
			),
		).toThrow(expect.objectContaining({ code: "DEFINITION" }));
	});

	it("rejects dynamic .flags() collisions with existing spellings", () => {
		const app = new Crust("cli").flags({ mode: { type: "string", short: "m" } });
		const sameName = asFlags([{ name: "mode", type: "boolean" }]);
		const aliasSteal = asFlags([{ name: "method", type: "string", short: "m" }]);
		for (const flags of [sameName, aliasSteal]) {
			expect(() => app.flags(flags)).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: expect.objectContaining({ reason: "flag-collision" }),
				}),
			);
		}
	});

	it("rejects duplicate spellings within a dynamic .flags() definition", () => {
		for (const definition of [
			{ name: "mode", type: "string", short: "mode" },
			{ name: "mode", type: "string", aliases: ["mode"] },
			{ name: "mode", type: "string", aliases: ["m", "m"] },
		]) {
			expect(() => new Crust("cli").flags(asFlags([definition]))).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: { subject: "flag", name: "mode", reason: "flag-collision" },
				}),
			);
		}
	});

	it("rejects a dynamic .add() replacing an existing sibling", () => {
		const first = defineCommand("deploy", (cmd) => cmd.action(() => {}));
		const second = defineCommand("deploy", (cmd) => cmd.action(() => {}));
		const app = new Crust("cli").add(first);
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => app.add(second)).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "command", name: "deploy", reason: "command-collision" },
			}),
		);
	});

	it("rejects invalid command aliases from dynamic config", () => {
		for (const alias of ["", "a b", "-i"]) {
			const config: CommandConfig = { aliases: [alias] };
			expect(() => defineCommand("deploy", config, (cmd) => cmd)).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: { subject: "command", name: "deploy", reason: "invalid-alias" },
				}),
			);
		}
	});

	it("rejects child command names that are not one argv token, including .as() renames", () => {
		const invalidName = (name: string) =>
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "command", name, reason: "invalid-name" },
			});
		const dynamicName: string = "-x";
		expect(() => defineCommand(dynamicName, (cmd) => cmd)).toThrow(invalidName("-x"));
		expect(() => new Crust("cli").command(dynamicName, (cmd) => cmd)).toThrow(invalidName("-x"));
		const deploy = defineCommand("deploy", (cmd) => cmd);
		const dashedRename: string = "--deploy";
		expect(() => deploy.as(dashedRename)).toThrow(invalidName("--deploy"));
		const spacedName: string = "my cmd";
		expect(() => defineCommand(spacedName, (cmd) => cmd)).toThrow(invalidName("my cmd"));
		const tabbedRename: string = "de\tploy";
		expect(() => deploy.as(tabbedRename)).toThrow(invalidName("de\tploy"));
	});

	it("rejects __proto__ as a command name", () => {
		// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
		expect(() => new Crust("__proto__")).toThrow(
			expect.objectContaining({
				code: "DEFINITION",
				details: { subject: "command", name: "__proto__", reason: "reserved-name" },
			}),
		);
	});
});
