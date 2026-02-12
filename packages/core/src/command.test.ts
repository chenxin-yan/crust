import { describe, expect, it } from "bun:test";
import { defineCommand } from "./command.ts";
import { CrustError } from "./errors.ts";
import type { AnyCommand, CommandContext } from "./types.ts";

// ────────────────────────────────────────────────────────────────────────────
// Type-level test utilities
// ────────────────────────────────────────────────────────────────────────────

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
		? true
		: false;

// ────────────────────────────────────────────────────────────────────────────
// defineCommand — basic behavior
// ────────────────────────────────────────────────────────────────────────────

describe("defineCommand", () => {
	it("returns a frozen object", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
		});

		expect(Object.isFrozen(cmd)).toBe(true);
	});

	it("preserves meta fields", () => {
		const cmd = defineCommand({
			meta: {
				name: "serve",
				description: "Start dev server",
				usage: "serve [options]",
			},
		});

		expect(cmd.meta.name).toBe("serve");
		expect(cmd.meta.description).toBe("Start dev server");
		expect(cmd.meta.usage).toBe("serve [options]");
	});

	it("throws CrustError with DEFINITION code on missing meta.name", () => {
		try {
			defineCommand({ meta: { name: "" } });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("meta.name is required");
		}
	});

	it("throws CrustError with DEFINITION code on whitespace-only meta.name", () => {
		try {
			defineCommand({ meta: { name: "   " } });
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(CrustError);
			expect((err as CrustError).code).toBe("DEFINITION");
			expect((err as CrustError).message).toContain("meta.name is required");
		}
	});

	it("run callback receives correct context shape", () => {
		let receivedContext: CommandContext | undefined;

		const cmd = defineCommand({
			meta: { name: "test" },
			run(ctx) {
				receivedContext = ctx as unknown as CommandContext;
			},
		});

		// Manually invoke run to check context shape
		cmd.run?.({
			args: {} as never,
			flags: {} as never,
			rawArgs: ["--verbose"],
			cmd,
		});

		expect(receivedContext).toBeDefined();
		expect(receivedContext?.rawArgs).toEqual(["--verbose"]);
		expect(receivedContext?.cmd).toBeDefined();
	});

	it("includes subCommands in output", () => {
		const subCmd = defineCommand({
			meta: { name: "status" },
			run() {
				/* noop */
			},
		});

		const parentCmd = defineCommand({
			meta: { name: "serve" },
			subCommands: {
				status: subCmd,
			},
		});

		expect(parentCmd.subCommands).toBeDefined();
		expect(parentCmd.subCommands?.status).toBe(subCmd);
		expect(parentCmd.subCommands?.status?.meta.name).toBe("status");
	});

	it("handles optional fields gracefully — all omitted", () => {
		const cmd = defineCommand({
			meta: { name: "minimal" },
		});

		expect(cmd.meta.name).toBe("minimal");
		expect(cmd.args).toBeUndefined();
		expect(cmd.flags).toBeUndefined();
		expect(cmd.subCommands).toBeUndefined();
		expect(cmd.setup).toBeUndefined();
		expect(cmd.run).toBeUndefined();
		expect(cmd.cleanup).toBeUndefined();
	});

	it("preserves args definitions", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [
				{
					name: "file",
					type: String,
					required: true,
					description: "File path",
				},
				{ name: "count", type: Number, default: 1 },
			],
		});

		expect(cmd.args).toBeDefined();
		expect(cmd.args?.[0].type).toBe(String);
		expect(cmd.args?.[0].required).toBe(true);
		expect(cmd.args?.[1].type).toBe(Number);
		expect(cmd.args?.[1].default).toBe(1);
	});

	it("preserves flags definitions", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			flags: {
				verbose: { type: Boolean, alias: "v", description: "Verbose output" },
				port: { type: Number, default: 3000 },
				output: { type: String, alias: ["o", "out"] },
			},
		});

		expect(cmd.flags).toBeDefined();
		expect(cmd.flags?.verbose.type).toBe(Boolean);
		expect(cmd.flags?.verbose.alias).toBe("v");
		expect(cmd.flags?.port.default).toBe(3000);
		expect(cmd.flags?.output.alias).toEqual(["o", "out"]);
	});

	it("preserves all lifecycle hooks", () => {
		const setupFn = () => {};
		const runFn = () => {};
		const cleanupFn = () => {};

		const cmd = defineCommand({
			meta: { name: "test" },
			setup: setupFn,
			run: runFn,
			cleanup: cleanupFn,
		});

		expect(cmd.setup).toBe(setupFn);
		expect(cmd.run).toBe(runFn);
		expect(cmd.cleanup).toBe(cleanupFn);
	});

	it("allows async lifecycle hooks", async () => {
		const order: string[] = [];

		const cmd = defineCommand({
			meta: { name: "test" },
			async setup() {
				order.push("setup");
			},
			async run() {
				order.push("run");
			},
			async cleanup() {
				order.push("cleanup");
			},
		});

		const ctx = {
			args: {} as never,
			flags: {} as never,
			rawArgs: [],
			cmd,
		};

		await cmd.setup?.(ctx);
		await cmd.run?.(ctx);
		await cmd.cleanup?.(ctx);

		expect(order).toEqual(["setup", "run", "cleanup"]);
	});

	it("does not mutate the original config", () => {
		const config = {
			meta: { name: "test", description: "original" },
			args: [
				{
					name: "file" as const,
					type: String as StringConstructor,
					required: true as const,
					description: "original arg",
				},
			],
			flags: {
				verbose: {
					type: Boolean as BooleanConstructor,
					description: "original flag",
				},
			},
		};

		const cmd = defineCommand(config);

		// The returned command is a frozen copy, not the same reference
		expect(Object.isFrozen(cmd)).toBe(true);
		// The original config should not be frozen
		expect(Object.isFrozen(config)).toBe(false);

		// Mutating original nested objects should not affect the returned command
		config.meta.description = "mutated";
		expect(cmd.meta.description).toBe("original");

		config.flags.verbose.description = "mutated flag";
		expect(cmd.flags?.verbose.description).toBe("original flag");

		const firstArg = config.args[0];
		if (firstArg) firstArg.description = "mutated arg";
		expect(cmd.args?.[0]?.description).toBe("original arg");
	});
});

// ────────────────────────────────────────────────────────────────────────────
// defineCommand — type inference integration
// ────────────────────────────────────────────────────────────────────────────

describe("defineCommand type inference", () => {
	it("infers correct types for args and flags in run()", () => {
		const cmd = defineCommand({
			meta: { name: "serve" },
			args: [
				{
					name: "port",
					type: Number,
					description: "Port number",
					default: 3000,
				},
				{ name: "host", type: String, required: true },
			],
			flags: {
				verbose: { type: Boolean, description: "Verbose logging", alias: "v" },
				output: { type: String, default: "./dist" },
				count: { type: Number, required: true },
			},
			run({ args, flags }) {
				// Compile-time type checks — these lines fail to compile if types are wrong
				type _checkPort = Expect<Equal<typeof args.port, number>>;
				type _checkHost = Expect<Equal<typeof args.host, string>>;
				type _checkVerbose = Expect<
					Equal<typeof flags.verbose, boolean | undefined>
				>;
				type _checkOutput = Expect<Equal<typeof flags.output, string>>;
				type _checkCount = Expect<Equal<typeof flags.count, number>>;

				// Runtime assertions
				expect(typeof args.port).toBe("number");
				expect(typeof args.host).toBe("string");
			},
		});

		// Invoke run with typed context
		cmd.run?.({
			args: { port: 8080, host: "localhost" },
			flags: { verbose: true, output: "./build", count: 5 },
			rawArgs: [],
			cmd,
		});
	});

	it("infers variadic args as arrays", () => {
		defineCommand({
			meta: { name: "test" },
			args: [{ name: "files", type: String, variadic: true }],
			run({ args }) {
				type _checkFiles = Expect<Equal<typeof args.files, string[]>>;
				expect(Array.isArray(args.files)).toBe(true);
			},
		});
	});

	it("infers optional args as T | undefined", () => {
		defineCommand({
			meta: { name: "test" },
			args: [{ name: "name", type: String }],
			flags: {
				debug: { type: Boolean },
			},
			run({ args, flags }) {
				type _checkName = Expect<Equal<typeof args.name, string | undefined>>;
				type _checkDebug = Expect<
					Equal<typeof flags.debug, boolean | undefined>
				>;
				expect(true).toBe(true);
			},
		});
	});

	it("infers broad arg/flag types when args/flags are omitted", () => {
		defineCommand({
			meta: { name: "test" },
			run({ args, flags }) {
				// When args are omitted, A defaults to ArgsDef (readonly ArgDef[]),
				// InferArgsTuple on a non-tuple array resolves to {}, so InferArgs<ArgsDef> = {}
				// biome-ignore lint/complexity/noBannedTypes: InferArgsTuple on non-const ArgsDef resolves to {}
				type _checkArgs = Expect<Equal<typeof args, {}>>;
				// When flags are omitted, F defaults to FlagsDef (broad record),
				// so InferFlags<FlagsDef> = { [x: string]: string | number | boolean | undefined }
				type _checkFlags = Expect<
					Equal<
						typeof flags,
						{ [x: string]: string | number | boolean | undefined }
					>
				>;
				expect(true).toBe(true);
			},
		});
	});

	it("returns Command type that preserves generic params", () => {
		const cmd = defineCommand({
			meta: { name: "test" },
			args: [{ name: "name", type: String, required: true }],
			flags: {
				port: { type: Number, default: 3000 },
			},
		});

		// The command should be assignable to AnyCommand (type-erased reference)
		const _broadCmd: AnyCommand = cmd;
		expect(_broadCmd).toBeDefined();
	});
});
