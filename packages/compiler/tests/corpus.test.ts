import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

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

// Only Node's diagnostic envelope is discarded; class, code and message stay exact.
function normalizeNodeStderr(stderr: Buffer): Buffer {
	if (stderr.length === 0) return stderr;
	const match =
		/^(?:file:\/\/[^\n]+|node:internal\/[^\n]+):\d+\n[^\n]*\n[ \t]*\^+\n\n((?:TypeError|RangeError)(?: \[([A-Z_]+)\])?: [^\n]+)\n(?:    at [^\n]+\n)+(?:  code: '([A-Z_]+)'\n}\n)?\nNode\.js v\d+\.\d+\.\d+\n$/.exec(
			stderr.toString(),
		);
	if (!match || match[2] !== match[3]) {
		throw new Error(`Unrecognized Node error output:\n${stderr}`);
	}
	return Buffer.from(`${match[1]}\n`);
}

async function expectMatchesNode(fixture: string, args: readonly string[] = []) {
	if (nodePath === null) throw new Error("Node is required as the corpus reference runtime");
	const binary = await compile(fixture);
	try {
		const reference = run(nodePath, [fixture, ...args]);
		expect(run(binary, args)).toEqual({
			...reference,
			stderr: normalizeNodeStderr(reference.stderr),
		});
	} finally {
		await rm(dirname(binary), { recursive: true, force: true });
	}
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
	{ name: "identifier-collisions", args: [] },
	{ name: "indexed-length", args: ["Crust"] },
	{ name: "parenthesized-indexed-length", args: ["Crust"] },
	{ name: "argv-prefix", args: [] },
	{ name: "runtime-free", args: [] },
] as const;

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
				await expectMatchesNode(fixture, args);
			},
			120_000,
		);
	}

	for (const fixtureName of ["unsafe-index-length.ts", "escaped-undefined.ts"]) {
		it.skipIf(goPath === null)(
			`throws when ${fixtureName} reads undefined length`,
			async () => {
				const fixture = join(import.meta.dir, "fixtures", fixtureName);
				await expectMatchesNode(fixture);
			},
			120_000,
		);
	}

	it("rejects direct array logging before emission", async () => {
		const fixture = join(import.meta.dir, "fixtures", "array-log.ts");
		await expect(compile(fixture)).rejects.toThrow("Unsupported TypeScript CallExpression");
	});

	it("rejects default parameters before emission", async () => {
		const fixture = join(import.meta.dir, "fixtures", "default-parameter.ts");
		await expect(compile(fixture)).rejects.toThrow("Unsupported TypeScript Parameter");
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
				await expect(compile(fixture)).rejects.toThrow("Unsupported TypeScript");
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 120_000);

	it("rejects numeric string results escaping through function boundaries", async () => {
		const workspace = await mkdtemp(join(tmpdir(), "crust-string-boundary-"));
		const fixture = join(workspace, "fixture.ts");
		try {
			for (const source of [
				"function len(s: string): number { return s.length; } console.log(len(process.argv[99] + 1));",
				"function len(s: string): number { return s.length; } console.log(len((process.argv[99]! + 1)!));",
				"function value(): string { return process.argv[99] + 1; } console.log(value().length);",
				"function value(s: string): string { return s + 1; } console.log(value(process.argv[99]).length);",
				"function len(s: string): number { return s.length; } console.log(len(process.argv[98] + process.argv[99]));",
			]) {
				await writeFile(fixture, source);
				if (nodePath === null) throw new Error("Node is required as the corpus reference runtime");
				const reference = run(nodePath, [fixture]);
				expect(reference.exitCode).toBe(0);
				expect(reference.stdout.toString()).toBe("undefined\n");
				expect(reference.stderr.toString()).toBe("");
				await expect(compile(fixture)).rejects.toThrow("Unsupported TypeScript");
			}
		} finally {
			await rm(workspace, { recursive: true, force: true });
		}
	}, 120_000);

	it.skipIf(goPath === null)(
		"uses runtime operands for addition",
		async () => {
			const workspace = await mkdtemp(join(tmpdir(), "crust-addition-"));
			const fixture = join(workspace, "fixture.ts");
			try {
				for (const source of [
					"console.log(process.argv[99] + 1);",
					'function len(s: string): number { return s.length; } console.log(len("" + (process.argv[99] + 1)));',
					'function label(s: string): string { return "" + s; } console.log(label(process.argv[99]));',
					"function label(): string { return `${process.argv[99] + 1}`; } console.log(label().length);",
				]) {
					await writeFile(fixture, source);
					await expectMatchesNode(fixture);
				}
			} finally {
				await rm(workspace, { recursive: true, force: true });
			}
		},
		120_000,
	);

	it.skipIf(goPath === null)(
		"retains invalid exit received-value context",
		async () => {
			const workspace = await mkdtemp(join(tmpdir(), "crust-exit-errors-"));
			const fixture = join(workspace, "fixture.ts");
			try {
				for (const code of [
					"0 / 0",
					"-1 / 0",
					"12345.67891",
					"-1e16",
					"1e21",
					"1.23e22",
					"1e100",
				]) {
					await writeFile(fixture, `console.log("before exit"); process.exit(${code});`);
					await expectMatchesNode(fixture);
				}
			} finally {
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
				await expectMatchesNode(fixture);
			},
			120_000,
		);
	}
});
