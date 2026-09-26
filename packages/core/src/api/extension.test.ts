import { describe, expect, it } from "vite-plus/test";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { unwrap } from "../../tests/helpers.ts";
import {
	Crust,
	CrustError,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
	type Extension,
} from "../index.ts";
import { definingOf } from "./context.ts";

describe("defineExtension", () => {
	const HELP = defineExtensionId("acme:help");
	const help = defineExtension(HELP).factory(
		(extension, options: { readonly verbose?: boolean } = {}) =>
			extension.flags({ name: "verbose", type: "boolean", default: options.verbose ?? false }),
	);

	it("exposes the identity and builds frozen, normalized Extensions with default options", () => {
		expect(help.id).toBe(HELP);
		const extension = help();
		expect(extension.id).toBe(HELP);
		expect(Object.isFrozen(extension)).toBe(true);
		const data = definingOf(extension);
		expect(Object.isFrozen(data)).toBe(true);
		expect(Object.isFrozen(data.use)).toBe(true);
		expect(data.flags.verbose?.default).toBe(false);
		expect(definingOf(help({ verbose: true })).flags.verbose?.default).toBe(true);
		type _args = Expect<Equal<Parameters<typeof help>, [options?: { readonly verbose?: boolean }]>>;
	});

	it("passes required options through on each call", () => {
		const prefix = defineExtension(HELP).factory((extension, options: { prefix: string }) =>
			extension.flags({ name: "prefix", type: "string", default: options.prefix }),
		);
		type _args = Expect<Equal<Parameters<typeof prefix>, [options: { prefix: string }]>>;
		expect(definingOf(prefix({ prefix: "first" })).flags.prefix?.default).toBe("first");
		expect(definingOf(prefix({ prefix: "second" })).flags.prefix?.default).toBe("second");
	});

	it("accepts the factory and the handle as section consumers", async () => {
		const handle = defineExtension(HELP);
		const app = new Crust("help", {
			sections: [
				{ title: "Examples", body: "help --verbose", only: [help] },
				{ title: "Notes", body: "help", except: [handle] },
			],
		});
		const sections = (await app.snapshot()).meta.sections;
		expect(sections?.[0]?.only).toEqual([HELP]);
		expect(sections?.[1]?.except).toEqual([HELP]);
	});

	it("keeps every step immutable and leaves earlier handles untouched", () => {
		const logger = defineContext("logger", () => "logger");
		const empty = defineExtension(HELP);
		const used = empty.use(logger);
		const flagged = used.flags({ name: "trace", type: "boolean" });
		expect(used).not.toBe(empty);
		expect(flagged).not.toBe(used);
		for (const handle of [empty, used, flagged]) expect(Object.isFrozen(handle)).toBe(true);
		expect(definingOf(empty).use).toEqual([]);
		expect(definingOf(empty).flags).toEqual({});
		expect(definingOf(used).use).toEqual([logger]);
		expect(definingOf(used).flags).toEqual({});
		expect(Object.keys(definingOf(flagged).flags)).toEqual(["trace"]);
	});

	it("appends repeated collection calls in order", () => {
		const a = defineContext("a", () => "a");
		const b = defineContext("b", () => "b");
		const first = defineCommand("first", (cmd) => cmd);
		const second = defineCommand("second", (cmd) => cmd);
		const extension = defineExtension(HELP)
			.use(a)
			.use(b)
			.provide(a())
			.provide(b())
			.flags({ name: "one", type: "boolean" })
			.flags({ name: "two", type: "string" })
			.add(first)
			.add(second);
		const data = definingOf(extension);
		expect(data.use).toEqual([a, b]);
		expect(data.provide.map((instance) => instance.name)).toEqual(["a", "b"]);
		expect(Object.keys(data.flags)).toEqual(["one", "two"]);
		expect(data.commands).toEqual([first, second]);
	});

	it("replaces repeated lifecycle setters", async () => {
		const seen: string[] = [];
		const extension = defineExtension(HELP)
			.preRun(() => void seen.push("first pre"))
			.postRun(() => void seen.push("first post"))
			.preRun(() => void seen.push("second pre"))
			.postRun(() => void seen.push("second post"));
		await unwrap(
			new Crust("app")
				.extend(extension)
				.action(() => {})
				.run([]),
		);
		expect(seen).toEqual(["second pre", "second post"]);
	});

	it("snapshots contribution arrays and validates flags at the offending call", () => {
		const commands = [defineCommand("child", (command) => command)];
		const extension = defineExtension(HELP).add(...commands);
		commands.length = 0;
		expect(definingOf(extension).commands).toHaveLength(1);
		const factory = defineExtension(HELP).factory((extension, short: string) =>
			extension.flags({ name: "verbose", type: "boolean", short }),
		);
		expect(factory("v").id).toBe(HELP);
		expect(() => factory("long")).toThrow("one character");
	});

	it("owns flag inputs before deriving handles or invoking factories", async () => {
		const aliases = ["p"];
		const flag = { name: "port", type: "number" as const, default: 1, aliases };
		const original = defineExtension(HELP).flags(flag);
		flag.default = 2;
		aliases.push("invalid");
		const derived = original.preRun(() => {});
		const factory = original.factory((extension) => extension.postRun(() => {}));
		for (const extension of [original, derived, factory()]) {
			const snapshot = await new Crust("app").extend(extension).snapshot();
			expect(snapshot.flags.port?.default).toBe(1);
			expect(snapshot.flags.port?.aliases).toEqual(["p"]);
		}
	});

	it("checks flag collisions against provided Context flags across calls", () => {
		const owner = defineContext("owner", { flags: [{ name: "token", type: "string" }] }, () => 1);
		expect(() =>
			defineExtension(HELP)
				.provide(owner())
				// @ts-expect-error The provided Context already owns this spelling.
				.flags({ name: "token", type: "boolean" }),
		).toThrow(CrustError);
		expect(() =>
			defineExtension(HELP)
				.flags({ name: "token", type: "boolean" })
				// @ts-expect-error The declared flag already owns this spelling.
				.provide(owner()),
		).toThrow(CrustError);
		expect(() =>
			defineExtension(HELP)
				.flags({ name: "token", type: "boolean" })
				// @ts-expect-error Repeated flag calls check earlier declarations.
				.flags({ name: "token", type: "string" }),
		).toThrow(CrustError);
	});

	it("rejects factories that return a differently identified Extension", () => {
		const other = defineExtension(defineExtensionId("acme:other"));
		const rebranded = defineExtension(HELP).factory(() => other);
		expect(rebranded.id).toBe(HELP);
		expect(() => rebranded()).toThrow(CrustError);
		const spoofed = defineExtension(HELP).factory(() => ({ ...other, id: HELP }));
		expect(() => spoofed()).toThrow(CrustError);
		const same = defineExtension(HELP).factory(() => defineExtension(HELP));
		expect(same().id).toBe(HELP);
	});

	it("infers flags, dependencies, providers, and commands through the chain", async () => {
		const logger = defineContext("logger", () => ({ info: () => {} }));
		const provided = logger();
		const command = defineCommand("docs", (cmd) => cmd.action(() => "docs"));
		const seen: string[] = [];
		const logging = defineExtension(HELP)
			.use(logger)
			.provide(provided)
			.add(command)
			.flags({ name: "verbose", type: "boolean" })
			.postRun(async ({ ctx, flags }) => {
				(await ctx.logger).info();
				seen.push("post");
				type _flag = Expect<Equal<typeof flags.verbose, boolean | undefined>>;
			});
		const _broad: Extension<
			{ logger: { info: () => void } },
			readonly [typeof provided],
			readonly [{ readonly name: "verbose"; readonly type: "boolean" }],
			readonly [typeof command]
		> = logging;
		expect(definingOf(logging).commands).toEqual([command]);
		await unwrap(new Crust("app").extend(logging).run(["docs"]));
		expect(seen).toEqual(["post"]);
	});

	it("specializes metadata without changing factory identity or runtime normalization", async () => {
		const emit = defineExtension<"version" | "sections">(HELP).factory(
			(extension, prefix: string) =>
				extension.flags({ name: "prefix", type: "string", default: prefix }).preRun((ctx) => {
					ctx.stdout(`${ctx.flags.prefix}:${ctx.rootCommand.meta.version}`);
					expect(ctx.rootCommand.meta.sections[0]?.only).toEqual([HELP]);
				}),
		);
		const output: string[] = [];
		const instance = emit("release");
		expect(emit.id).toBe(HELP);
		expect(instance.id).toBe(HELP);
		expect(Object.isFrozen(instance)).toBe(true);
		await unwrap(
			new Crust("app", {
				version: "1.2.3",
				sections: [{ title: "Example", body: "app", only: [emit] }],
			})
				.extend(instance)
				.action(() => {})
				.run([], {}, { stdout: (line) => output.push(line) }),
		);
		expect(output).toEqual(["release:1.2.3"]);
	});

	it("applies metadata requirements to sections without an invocation hook", async () => {
		const versioned = defineExtension<"version">(HELP).sections(() => [
			{ command: [], title: "Notes", body: "Body" },
		]);
		expect(
			(await new Crust("cli", { version: "1" }).extend(versioned).snapshot()).meta.sections,
		).toEqual([{ title: "Notes", body: "Body" }]);
	});
});

describe("Extension Context declarations", () => {
	const ID = defineExtensionId("acme:contexts");

	it("uses declare consumption only; hooks read Contexts the application provides", async () => {
		const logger = defineContext("logger", () => "app logger");
		const seen: string[] = [];
		const consumer = defineExtension(ID)
			.use(logger)
			.preRun(async ({ ctx }) => void seen.push(await ctx.logger));
		await unwrap(
			new Crust("app")
				.provide(logger())
				.extend(consumer)
				.action(() => {})
				.run([]),
		);
		expect(seen).toEqual(["app logger"]);
		// @ts-expect-error A consumed Context still needs an application provider.
		expect(() => new Crust("app").extend(consumer)).toThrow('No provider for Context "logger"');
	});

	it("provided Contexts are not exposed to the Extension's own hooks without use", async () => {
		const metrics = defineContext("metrics", () => "metrics");
		let keys: string[] = [];
		const provider = defineExtension(ID)
			.provide(metrics())
			.preRun(({ ctx }) => {
				keys = Object.keys(ctx);
				// @ts-expect-error Provided Contexts are not consumed by the Extension's hooks.
				void ctx.metrics;
			});
		const seen: string[] = [];
		await unwrap(
			new Crust("app")
				.extend(provider)
				.action(async ({ ctx }) => void seen.push(await ctx.metrics))
				.run([]),
		);
		expect(keys).toEqual([]);
		expect(seen).toEqual(["metrics"]);
	});

	it("providers stay application-wide regardless of chain order", async () => {
		const metrics = defineContext("metrics", () => "metrics");
		const seen: string[] = [];
		const child = defineCommand("child", (cmd) =>
			cmd.use(metrics).action(async ({ ctx }) => void seen.push(await ctx.metrics)),
		);
		const provider = defineExtension(ID).add(child).provide(metrics());
		await unwrap(new Crust("app").extend(provider).run(["child"]));
		expect(seen).toEqual(["metrics"]);
	});
});
