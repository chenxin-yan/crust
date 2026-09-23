import { describe, expect, it } from "bun:test";

import {
	Crust,
	defineCommand,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

import { checkRoundTripCase, fuzzRoundTrip } from "./fuzz.ts";

/** Minimal hand-rolled Standard Schema (no vendor dependency). */
function schema<Input, Output>(
	validate: (value: Input) => { value: Output } | { issues: { message: string }[] },
) {
	return {
		"~standard": {
			version: 1 as const,
			vendor: "crust-test",
			// SAFETY: Crust hands schemas the raw parsed value the fixture declares as Input.
			validate: (value: unknown) => validate(value as Input),
		},
	};
}

/** Every built-in shape the generator derives from a snapshot, plus lifecycle probes. */
function fixture() {
	const calls: string[] = [];
	const db = defineContext("db", () => {
		calls.push("context");
		return "connected";
	});
	const audit = defineExtension(defineExtensionId("audit"), {
		hooks: {
			preRun: () => {
				calls.push("preRun");
			},
			postRun: () => {
				calls.push("postRun");
			},
			onError: () => {
				calls.push("onError");
				return true;
			},
		},
	});
	const app = new Crust("git")
		.extend(audit)
		.provide(db())
		.add(
			defineCommand("remote-add", { aliases: ["ra"] }, (command) =>
				command
					.args(
						{ name: "name", type: "string", required: true },
						{ name: "count", type: "number", required: true },
						{ name: "payload", type: "json" },
						{ name: "mode", type: "string", choices: ["safe", "fast"], default: "safe" },
						{ name: "files", type: "path", variadic: true },
					)
					.flags(
						{ name: "fetch", type: "boolean" },
						{ name: "quiet", type: "boolean", noNegate: true, multiple: true },
						{ name: "tag", type: "string", multiple: true },
						{ name: "config", type: "json" },
						{ name: "offset", type: "number", default: 7 },
						{ name: "level", type: "string", choices: ["debug", "info"], required: true },
						{ name: "upstream", type: "url" },
						{ name: "out", type: "path", default: "./dist" },
						{ name: "flag", type: "boolean", required: true },
					)
					.action(({ stdout }) => {
						calls.push("action");
						stdout("ran");
					}),
			),
		);
	return { app, calls };
}

describe("fuzzRoundTrip", () => {
	it("binds every generated built-in case identically without running the invocation lifecycle", async () => {
		const { app, calls } = fixture();
		const exitCodeBefore = process.exitCode;

		const report = await fuzzRoundTrip(app, ["remote-add"], { runs: 300, env: {} });

		expect(report).toEqual({ seed: 0x5eed, runs: 300, accepted: 300, rejected: 0 });
		expect(calls).toEqual([]);
		expect(process.exitCode).toBe(exitCodeBefore);
	});

	it("reaches the same command through an alias path", async () => {
		const { app } = fixture();
		const report = await fuzzRoundTrip(app, ["ra"], { runs: 20, env: {} });
		expect(report).toMatchObject({ runs: 20, accepted: 20 });
	});

	it("is deterministic for a seed and varies across seeds", async () => {
		const seen = async (seed: number) => {
			const raws: string[] = [];
			const app = new Crust("cli")
				.args({ name: "target", type: "string" })
				.flags({ name: "level", type: "string", parse: (raw) => (raws.push(raw), raw) })
				.action(() => {});
			const report = await fuzzRoundTrip(app, [], { runs: 30, seed });
			return { report, raws };
		};

		const first = await seen(7);
		const second = await seen(7);
		const third = await seen(8);
		expect(first.report).toEqual({ seed: 7, runs: 30, accepted: 30, rejected: 0 });
		expect(second.raws).toEqual(first.raws);
		expect(third.raws).not.toEqual(first.raws);
	});

	it("resolves the seed from the option, then CRUST_FUZZ_SEED, then the default", async () => {
		const app = new Crust("cli").flags({ name: "v", type: "boolean" }).action(() => {});

		expect((await fuzzRoundTrip(app, [], { runs: 1, env: {} })).seed).toBe(0x5eed);
		expect((await fuzzRoundTrip(app, [], { runs: 1, env: { CRUST_FUZZ_SEED: "77" } })).seed).toBe(
			77,
		);
		expect(
			(await fuzzRoundTrip(app, [], { runs: 1, seed: 5, env: { CRUST_FUZZ_SEED: "77" } })).seed,
		).toBe(5);
		await expect(
			fuzzRoundTrip(app, [], { runs: 1, env: { CRUST_FUZZ_SEED: "seven" } }),
		).rejects.toThrow("CRUST_FUZZ_SEED must be an integer");
		await expect(fuzzRoundTrip(app, [], { runs: 0 })).rejects.toThrow(
			"runs must be a positive integer",
		);
	});

	it("honors choices and requiredness in generated values", async () => {
		const modes: string[] = [];
		const app = new Crust("cli")
			.args(
				{
					name: "mode",
					type: "string",
					choices: ["safe", "fast"],
					required: true,
					parse: (raw) => (modes.push(raw), raw),
				},
				{ name: "files", type: "string", variadic: true, required: true },
			)
			.flags({ name: "tag", type: "string", multiple: true, required: true })
			.action(() => {});

		// Out-of-range choices or a missing required value would reject on both paths, which the
		// property reports as a generator failure rather than a rejected case.
		const report = await fuzzRoundTrip(app, [], { runs: 50, env: {} });
		expect(report).toEqual({ seed: 0x5eed, runs: 50, accepted: 50, rejected: 0 });
		expect(modes.length).toBe(100);
		expect(new Set(modes)).toEqual(new Set(["safe", "fast"]));
	});

	it("never places a subcommand name or alias as the first positional", async () => {
		const firsts: string[] = [];
		const app = new Crust("cli")
			.args({
				name: "target",
				type: "string",
				required: true,
				parse: (raw) => (firsts.push(raw), raw),
			})
			.action(() => {})
			.add(defineCommand("origin", { aliases: ["main"] }, (command) => command.action(() => {})));

		const report = await fuzzRoundTrip(app, [], { runs: 100, env: {} });
		expect(report).toMatchObject({ runs: 100, rejected: 0 });
		// Each accepted case binds the same raw value twice (structured, then argv).
		expect(firsts.length).toBe(200);
		expect(firsts).not.toContain("origin");
		expect(firsts).not.toContain("main");
	});

	it("binds prototype-named positionals, aliases, and flags as own properties", async () => {
		const app = new Crust("cli").add(
			defineCommand("serve", { aliases: ["constructor"] }, (command) =>
				command
					.args({ name: "__proto__", type: "string", required: true })
					.flags({ name: "hasOwnProperty", type: "number" })
					.action(() => {}),
			),
		);
		expect(await fuzzRoundTrip(app, ["serve"], { runs: 25, env: {} })).toMatchObject({
			accepted: 25,
		});
		expect(await fuzzRoundTrip(app, ["constructor"], { runs: 25, env: {} })).toMatchObject({
			accepted: 25,
		});
	});

	it("compares cyclic Standard Schema output without overflowing", async () => {
		interface Node {
			self?: Node;
		}
		const cyclic = schema<string | undefined, Node>(() => {
			const node: Node = {};
			node.self = node;
			return { value: node };
		});
		const app = new Crust("cli").args({ name: "graph", schema: cyclic }).action(() => {});
		expect(await fuzzRoundTrip(app, [], { runs: 10, env: {} })).toMatchObject({ accepted: 10 });
	});

	it("binds env-backed flags to their default on both paths regardless of the process environment", async () => {
		expect(process.env.HOME).toBeDefined();
		const app = new Crust("cli")
			.flags({ name: "home", type: "string", env: "HOME", default: "fallback" })
			.action(() => {});
		expect(await fuzzRoundTrip(app, [], { runs: 20, env: {} })).toMatchObject({ accepted: 20 });
	});

	it("never generates a flag's delimiter inside a value", async () => {
		const app = new Crust("cli")
			.flags(
				{ name: "tag", type: "string", multiple: true, delimiter: "," },
				{ name: "eq", type: "string", multiple: true, delimiter: "=" },
				{ name: "payload", type: "json", multiple: true, delimiter: "," },
			)
			.action(() => {});
		expect(await fuzzRoundTrip(app, [], { runs: 100, env: {} })).toMatchObject({ accepted: 100 });
	});

	it("rejects an unknown path with COMMAND_NOT_FOUND before generating anything", async () => {
		const app = new Crust("cli").action(() => {});
		// @ts-expect-error -- deliberately exercise an unknown command path.
		await expect(fuzzRoundTrip(app, ["missing"], { runs: 1 })).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
		});
	});

	it("fails with seed and case diagnostics when binding diverges", async () => {
		let calls = 0;
		const app = new Crust("cli")
			.flags({ name: "level", type: "string", required: true, parse: () => calls++ })
			.action(() => {});

		await expect(fuzzRoundTrip(app, [], { runs: 5, seed: 11 })).rejects.toThrow(
			/structured and argv binding diverged\nseed 11, case 1 of 5; reproduce with \{ seed: 11 \}\n[\s\S]*input:[\s\S]*argv:[\s\S]*structured: \{[\s\S]*argv path:  \{/,
		);
	});

	it("counts parse/schema rejections honestly and refuses a run without accepted cases", async () => {
		const evens = new Crust("cli")
			.args({
				name: "port",
				schema: schema<string | undefined, string>((raw) =>
					raw === undefined || raw.length % 2 === 0
						? { value: raw ?? "none" }
						: { issues: [{ message: "odd length" }] },
				),
			})
			.action(() => {});
		const report = await fuzzRoundTrip(evens, [], { runs: 60, env: {} });
		expect(report.accepted + report.rejected).toBe(60);
		expect(report.accepted).toBeGreaterThan(0);
		expect(report.rejected).toBeGreaterThan(0);

		const never = new Crust("cli")
			.flags({
				name: "level",
				type: "string",
				parse: () => {
					throw new Error("always invalid");
				},
				required: true,
			})
			.action(() => {});
		await expect(fuzzRoundTrip(never, [], { runs: 3, env: {} })).rejects.toThrow(
			"every case was rejected by parse/schema callbacks",
		);
	});
});

describe("checkRoundTripCase", () => {
	const app = new Crust("cli")
		.args({ name: "payload", type: "json" })
		.flags({ name: "config", type: "json" }, { name: "tag", type: "string", multiple: true })
		.action(() => {});

	it("accepts JSON arrays as single values on both paths", async () => {
		const outcome = await checkRoundTripCase(
			app,
			[],
			{
				input: { args: { payload: [1, 2] }, flags: { config: [3, 4], tag: ["a", "b"] } },
				argv: ["[1,2]", "--config=[3,4]", "--tag=a", "--tag=b"],
			},
			false,
			"pinned",
		);
		expect(outcome).toBe("accepted");
	});

	it("detects a JSON array wrongly expanded into repeated occurrences", async () => {
		// Node's parser keeps the last occurrence of a scalar flag, so the expansion silently binds 4.
		await expect(
			checkRoundTripCase(
				app,
				[],
				{ input: { flags: { config: [3, 4] } }, argv: ["--config=3", "--config=4"] },
				false,
				"pinned",
			),
		).rejects.toThrow(
			/binding diverged[\s\S]*structured: [\s\S]*config: \[ 3, 4 \][\s\S]*argv path: [\s\S]*config: 4/,
		);
		await expect(
			checkRoundTripCase(
				app,
				[],
				{ input: { args: { payload: [1, 2] } }, argv: ["1", "2"] },
				false,
				"pinned",
			),
		).rejects.toThrow("one path rejected input the other accepted");
		await expect(
			checkRoundTripCase(
				app,
				[],
				{ input: { flags: { tag: ["a", "b"] } }, argv: ["--tag=b", "--tag=a"] },
				false,
				"pinned",
			),
		).rejects.toThrow("structured and argv binding diverged");
	});

	it("detects a delimiter splitting an argv value that structured input keeps whole", async () => {
		const delimited = new Crust("cli")
			.flags({ name: "tag", type: "string", multiple: true, delimiter: "," })
			.action(() => {});
		await expect(
			checkRoundTripCase(
				delimited,
				[],
				{ input: { flags: { tag: ["a,b"] } }, argv: ["--tag=a,b"] },
				false,
				"pinned",
			),
		).rejects.toThrow(
			/binding diverged[\s\S]*structured: [\s\S]*tag: \[ 'a,b' \][\s\S]*argv path: [\s\S]*tag: \[ 'a', 'b' \]/,
		);
		// An empty segment is dropped on argv but kept as a structured value.
		await expect(
			checkRoundTripCase(
				delimited,
				[],
				{ input: { flags: { tag: [""] } }, argv: ["--tag="] },
				false,
				"pinned",
			),
		).rejects.toThrow("structured and argv binding diverged");
	});

	it("treats a shared rejection of built-in definitions as a failure, not a rejected case", async () => {
		const required = new Crust("cli")
			.flags({ name: "level", type: "string", required: true })
			.action(() => {});
		await expect(
			checkRoundTripCase(required, [], { input: {}, argv: [] }, false, "pinned"),
		).rejects.toThrow("both paths rejected a generated case for built-in definitions");
		expect(await checkRoundTripCase(required, [], { input: {}, argv: [] }, true, "pinned")).toBe(
			"rejected",
		);
	});
});
