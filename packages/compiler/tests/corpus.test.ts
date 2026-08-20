import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { lower } from "../src/frontend.js";
import { compile } from "../src/index.js";

const goPath = Bun.which("go");
const nodePath = Bun.which("node");
if (goPath === null) {
	console.warn(
		"[compiler corpus] SKIPPED: Go is not on PATH; native differential tests did not run",
	);
}

function run(command: string, args: readonly string[] = []) {
	const { exitCode, stderr, stdout } = Bun.spawnSync([command, ...args]);
	return { exitCode, stderr, stdout };
}

const fixtures = [
	{ name: "hello", args: [] },
	{ name: "lone-surrogate", args: [] },
	{ name: "embedded-bom", args: [] },
	{ name: "literals", args: [] },
	{ name: "expressions", args: ["Crust"] },
	{ name: "template", args: ["Crust", "extra"] },
	{ name: "functions", args: [] },
	{ name: "hello-argv", args: ["Crust", "extra"] },
	{ name: "bounds", args: ["Crust"] },
	{ name: "identifiers", args: [] },
	{ name: "indexed-length", args: ["Crust"] },
	{ name: "parenthesized-indexed-length", args: ["Crust"] },
	{ name: "argv-prefix", args: [] },
	{ name: "arrays", args: ["Crust", "extra"] },
	{ name: "runtime-free", args: [] },
] as const;

const numberFuzzSeed = BigInt(process.env.CRUST_NUMBER_FUZZ_SEED ?? "0xc2a57");
const numberFuzzSamples = 2_048;
const uint64Mask = (1n << 64n) - 1n;

function fuzzNumbers(seed: bigint, count: number): number[] {
	let state = seed & uint64Mask || 1n;
	const view = new DataView(new ArrayBuffer(8));
	return Array.from({ length: count }, () => {
		state ^= state >> 12n;
		state ^= (state << 25n) & uint64Mask;
		state ^= state >> 27n;
		const bits = (state * 0x2545_f491_4f6c_dd1dn) & uint64Mask;
		view.setBigUint64(0, bits);
		return view.getFloat64(0);
	});
}

function numberExpression(value: number): string {
	const runtimeZero = "(process.argv.length - process.argv.length)";
	if (Number.isNaN(value)) return `0 / ${runtimeZero}`;
	if (value === Infinity) return `1 / ${runtimeZero}`;
	if (value === -Infinity) return `-1 / ${runtimeZero}`;
	if (Object.is(value, -0)) return `-${runtimeZero}`;
	return String(value);
}

describe("compiler differential corpus", () => {
	it("rejects a directory-valued output path", async () => {
		const fixture = join(import.meta.dir, "fixtures", "hello.ts");
		const outputPath = await mkdtemp(join(tmpdir(), "crust-compiler-output-"));
		try {
			await expect(compile(fixture, { outputPath })).rejects.toThrow("must not be a directory");
		} finally {
			await rm(outputPath, { recursive: true, force: true });
		}
	});

	for (const { name, args } of fixtures) {
		it.skipIf(goPath === null)(
			`matches Node for ${name}`,
			async () => {
				const fixture = join(import.meta.dir, "fixtures", `${name}.ts`);
				if (nodePath === null) throw new Error("Node is required as the corpus reference runtime");

				const binary = await compile(fixture);
				try {
					expect(run(binary, args)).toEqual(run(nodePath, [fixture, ...args]));
				} finally {
					await rm(dirname(binary), { recursive: true, force: true });
				}
			},
			120_000,
		);
	}

	it.skipIf(goPath === null)(
		"matches Node array inspection edge cases",
		async () => {
			if (nodePath === null) throw new Error("Node is required as the corpus reference runtime");

			const fixture = join(import.meta.dir, "fixtures", "arrays.ts");
			const binary = await compile(fixture);
			try {
				for (const args of [
					["a'b", `a'"b`, "a'\"`b", "${x}'\""],
					["\b\f\v\x01\x1f\x7f"],
					["a".repeat(89) + "\n" + "b".repeat(20)],
					["x".repeat(90)],
					Array.from({ length: 10 }, (_, index) => `value${index}`),
					Array(7).fill("中"),
					Array(3).fill("中".repeat(10)),
					Array(8).fill("🇺🇸"),
					Array.from({ length: 101 }, (_, index) => `value${index}`),
					Array.from({ length: 105 }, (_, index) => `value${index}`),
				]) {
					expect(run(binary, args)).toEqual(run(nodePath, [fixture, ...args]));
				}
			} finally {
				await rm(dirname(binary), { recursive: true, force: true });
			}
		},
		120_000,
	);

	it.skipIf(goPath === null)(
		"matches ECMAScript number formatting",
		async () => {
			if (nodePath === null) throw new Error("Node is required as the corpus reference runtime");

			const values = [
				0,
				-0,
				5e-324,
				-5e-324,
				2.2250738585072014e-308,
				1e-7,
				1e-6,
				1e20,
				1e21,
				1_000_000_000_000_000_100,
				1.2345678901234567,
				Number.MAX_VALUE,
				NaN,
				Infinity,
				-Infinity,
				...fuzzNumbers(numberFuzzSeed, numberFuzzSamples),
			];
			const workspace = await mkdtemp(join(tmpdir(), "crust-number-fuzz-"));
			const fixture = join(workspace, "numbers.ts");
			let binary: string | undefined;
			try {
				await writeFile(
					fixture,
					values
						.map((value) => {
							const expression = numberExpression(value);
							return `console.log(${expression});\nconsole.log(\`\${${expression}}\`);`;
						})
						.join("\n"),
				);
				binary = await compile(fixture);
				try {
					expect(run(binary)).toEqual(run(nodePath, [fixture]));
				} catch (error) {
					console.error(
						`[compiler corpus] number fuzz failed; seed=0x${numberFuzzSeed.toString(16)}`,
					);
					throw error;
				}
			} finally {
				if (binary) await rm(dirname(binary), { recursive: true, force: true });
				await rm(workspace, { recursive: true, force: true });
			}
		},
		120_000,
	);

	for (const fixtureName of ["unsafe-index-length.ts", "escaped-undefined.ts"]) {
		it.skipIf(goPath === null)(
			`throws when ${fixtureName} reads undefined length`,
			async () => {
				const fixture = join(import.meta.dir, "fixtures", fixtureName);
				if (nodePath === null) throw new Error("Node is required as the corpus reference runtime");

				const binary = await compile(fixture);
				try {
					const compiled = run(binary);
					const reference = run(nodePath, [fixture]);
					expect(compiled.exitCode).toBe(reference.exitCode);
					expect(new TextDecoder().decode(compiled.stderr)).toContain("TypeError");
				} finally {
					await rm(dirname(binary), { recursive: true, force: true });
				}
			},
			120_000,
		);
	}

	it("rejects default parameters before emission", () => {
		const fixture = join(import.meta.dir, "fixtures", "default-parameter.ts");
		expect(() => lower(fixture)).toThrow("Unsupported TypeScript Parameter");
	});

	it("rejects expressions unsupported by the Go runtime", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "crust-unsupported-expression-"));
		const fixture = join(workspace, "fixture.ts");
		try {
			for (const source of [
				'console.log("abc".slice(1));',
				'console.log("abc"[0]);',
				'console.log("abc"[0].length);',
				'console.log(+"42");',
				"console.log(String(42));",
				"console.log(undefined);",
				"function f(): void {} console.log(f());",
				"console.log(process.exit(0));",
				"function f(value: void): number { return 1; } f();",
				"function f(): void {} function g(): void { return f(); } g();",
				'console.log(process.argv["0"]);',
				'process.exit("2");',
				'console.log("%s", "ok");',
				'function format(): string { return "%s"; } console.log(format(), "ok");',
				"function f(): void {} console.log(`${f()}`);",
				"console.log(`${process.exit(0)}`);",
				"console.log(process.exit(0) + 1);",
				"console.log((process.argv[99] + 1).length);",
				"function f(): number { process.exit(0); } f();",
				"function f() { return 1; } console.log(f);",
				"function f(value: number) { return value; } console.log(f.length);",
			]) {
				await writeFile(fixture, source);
				expect(() => lower(fixture)).toThrow("Unsupported TypeScript");
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 120_000);

	it.skipIf(goPath === null)(
		"uses runtime operands for addition",
		async () => {
			if (nodePath === null) throw new Error("Node is required as the corpus reference runtime");
			const workspace = await mkdtemp(join(tmpdir(), "crust-addition-"));
			const fixture = join(workspace, "fixture.ts");
			let binary: string | undefined;
			try {
				await writeFile(fixture, "console.log(process.argv[99] + 1);");
				binary = await compile(fixture);
				expect(run(binary)).toEqual(run(nodePath, [fixture]));
			} finally {
				if (binary) await rm(dirname(binary), { recursive: true, force: true });
				await rm(workspace, { recursive: true, force: true });
			}
		},
		120_000,
	);

	it.skipIf(goPath === null)(
		"canonicalizes process.argv[0] for relative invocation",
		async () => {
			const workspace = await mkdtemp(join(tmpdir(), "crust-argv0-"));
			const fixture = join(workspace, "fixture.ts");
			let binary: string | undefined;
			try {
				await writeFile(fixture, "console.log(process.argv[0]);");
				binary = await compile(fixture);
				const result = Bun.spawnSync([`./${basename(binary)}`], { cwd: dirname(binary) });
				expect(new TextDecoder().decode(result.stdout).trim()).toBe(binary);
			} finally {
				if (binary) await rm(dirname(binary), { recursive: true, force: true });
				await rm(workspace, { recursive: true, force: true });
			}
		},
		120_000,
	);

	for (const fixtureName of ["fractional-exit.ts", "non-finite-exit.ts", "large-exit.ts"]) {
		it.skipIf(goPath === null)(
			`rejects invalid process exit code from ${fixtureName}`,
			async () => {
				const fixture = join(import.meta.dir, "fixtures", fixtureName);
				if (nodePath === null) throw new Error("Node is required as the corpus reference runtime");

				const binary = await compile(fixture);
				try {
					const compiled = run(binary);
					const reference = run(nodePath, [fixture]);
					expect(compiled.exitCode).toBe(reference.exitCode);
					expect(new TextDecoder().decode(compiled.stderr)).toContain("RangeError");
				} finally {
					await rm(dirname(binary), { recursive: true, force: true });
				}
			},
			120_000,
		);
	}
});
