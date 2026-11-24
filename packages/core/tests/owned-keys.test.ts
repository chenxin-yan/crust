import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, expect, it } from "vite-plus/test";

import { ensureDist } from "./helpers.ts";

// A stand-in package owns a key on arguments, flags, and commands through `declare module
// "@crustjs/core"`, against the shipped declarations, where the interfaces live in a chunk.

const repoRoot = resolve(import.meta.dirname, "../../..");
const corePkg = resolve(import.meta.dirname, "..");
const tscBin = join(repoRoot, "node_modules/.bin/tsc");

const STAND_IN = `import {
	defineExtension,
	defineExtensionId,
	type ArgSnapshot,
	type FlagSnapshot,
} from "@crustjs/core";

declare module "@crustjs/core" {
	interface ArgExtras {
		hint?: string;
	}
	interface FlagExtras {
		hint?: string;
	}
	interface CommandExtras {
		tool?: false | { readonly readOnly?: true };
	}
}

// Reads its keys from the routed command's snapshot, typed, without a cast.
export const standIn = () =>
	defineExtension(defineExtensionId("acme:stand-in"))
		.owns("hint", "tool")
		.preRun(({ command, stdout }) => {
			const tool: false | { readonly readOnly?: true } | undefined = command.meta.tool;
			const args: (string | undefined)[] = command.args.map((arg) => arg.hint);
			const flags = Object.entries(command.flags).map(([name, flag]) => [name, flag.hint]);
			stdout(JSON.stringify({ tool, args, flags }));
		});

// A snapshot is frozen, so the keys are read-only too.
export function rewrite(arg: ArgSnapshot, flag: FlagSnapshot) {
	// @ts-expect-error -- read-only
	arg.hint = "other";
	// @ts-expect-error -- read-only
	flag.hint = "other";
}
`;

// A command file that never imports the package: the key is known in every file of the project.
const COMMANDS = `import { defineCommand } from "@crustjs/core";

export const deploy = defineCommand("deploy", { tool: { readOnly: true } }, (c) =>
	c
		.args({ name: "target", type: "string", required: true, hint: "Where to" })
		.flags({ region: { type: "string", hint: "Region" } })
		.action(({ args, flags }) => {
			// The key never changes a value's type.
			const target: string = args.target;
			const region: string | undefined = flags.region;
			return [target, region];
		}),
);

// @ts-expect-error -- the package types the key's value
defineCommand("bad", { tool: true }, (c) => c);
// @ts-expect-error -- an unknown key is still a compile error
defineCommand("typo", { tol: false }, (c) => c);
`;

const APP = `import { Crust } from "@crustjs/core";
import { deploy } from "./commands.ts";
import { standIn } from "./stand-in.ts";

await new Crust("acme", { description: "Acme", tool: { readOnly: true } })
	.extend(standIn())
	.action(() => {})
	.add(deploy)
	.command("status", { tool: false }, (c) =>
		c.flags({ watch: { type: "boolean", hint: "Keep watching" } }).action(() => {}),
	)
	.execute();
`;

// The package is in the project, so the key compiles, but its Extension is not installed.
const UNOWNED = `import { Crust } from "@crustjs/core";
import { deploy } from "./commands.ts";
import "./stand-in.ts";

await new Crust("acme").add(deploy).execute();
`;

// The root's metadata takes the key too, and the same check covers it.
const UNOWNED_ROOT = `import { Crust } from "@crustjs/core";
import "./stand-in.ts";

// @ts-expect-error -- the package types the key's value on the root too
new Crust("acme", { tool: true });

await new Crust("acme", { tool: false }).action(() => {}).execute();
`;

// A project without the package.
const BARE = `import { Crust } from "@crustjs/core";

// @ts-expect-error -- unknown without the package that adds it
new Crust("acme", { tool: false });

new Crust("acme").flags({
	// @ts-expect-error -- unknown without the package that adds it
	region: { type: "string", hint: "Region" },
});
`;

let fixtureDir: string;

beforeAll(() => {
	ensureDist();
	fixtureDir = mkdtempSync(join(tmpdir(), "crust-owned-keys-"));
	mkdirSync(join(fixtureDir, "node_modules/@crustjs"), { recursive: true });
	symlinkSync(corePkg, join(fixtureDir, "node_modules/@crustjs/core"));
	// Without a package.json, Node and TypeScript would read the fixture as CommonJS.
	writeFileSync(join(fixtureDir, "package.json"), JSON.stringify({ type: "module" }));
	for (const [file, source] of Object.entries({
		"stand-in.ts": STAND_IN,
		"commands.ts": COMMANDS,
		"app.ts": APP,
		"unowned.ts": UNOWNED,
		"unowned-root.ts": UNOWNED_ROOT,
		"bare.ts": BARE,
	})) {
		writeFileSync(join(fixtureDir, file), source);
	}
	const compilerOptions = {
		strict: true,
		target: "esnext",
		module: "esnext",
		moduleResolution: "bundler",
		noEmit: true,
		allowImportingTsExtensions: true,
		skipLibCheck: false,
		types: [],
	};
	writeFileSync(
		join(fixtureDir, "tsconfig.json"),
		JSON.stringify({ compilerOptions, files: ["app.ts", "unowned.ts", "unowned-root.ts"] }),
	);
	writeFileSync(
		join(fixtureDir, "tsconfig.bare.json"),
		JSON.stringify({ compilerOptions, files: ["bare.ts"] }),
	);
});

afterAll(() => rmSync(fixtureDir, { recursive: true, force: true }));

it.each([
	["types the keys a package adds, and only where it is in the project", "tsconfig.json"],
	["leaves the keys unknown without the package", "tsconfig.bare.json"],
])("%s", (_title, project) => {
	const result = spawnSync(tscBin, ["-p", project], { cwd: fixtureDir, timeout: 60_000 });
	expect(result.stdout.toString() + result.stderr.toString()).toBe("");
	expect(result.status).toBe(0);
});

function run(file: string, argv: string[], env: Record<string, string> = {}) {
	const result = spawnSync(process.execPath, [file, ...argv], {
		cwd: fixtureDir,
		env: { ...process.env, ...env },
		timeout: 30_000,
	});
	return {
		status: result.status,
		stdout: result.stdout.toString(),
		stderr: result.stderr.toString(),
	};
}

it("passes the keys to the owning Extension through the snapshot", () => {
	expect(run("app.ts", [])).toEqual({
		status: 0,
		stdout: `${JSON.stringify({ tool: { readOnly: true }, args: [], flags: [] })}\n`,
		stderr: "",
	});
	expect(run("app.ts", ["deploy", "api"])).toEqual({
		status: 0,
		stdout: `${JSON.stringify({ tool: { readOnly: true }, args: ["Where to"], flags: [["region", "Region"]] })}\n`,
		stderr: "",
	});
	expect(run("app.ts", ["status"])).toMatchObject({
		status: 0,
		stdout: `${JSON.stringify({ tool: false, args: [], flags: [["watch", "Keep watching"]] })}\n`,
	});
});

it("reports a key no installed Extension owns from source, and not in a built CLI", () => {
	expect(run("unowned.ts", ["deploy", "api"])).toEqual({
		status: 1,
		stdout: "",
		stderr: 'Error: Command "acme deploy" sets "tool", which no installed Extension owns\n',
	});
	expect(run("unowned.ts", ["deploy", "api"], { CRUST_INTERNAL_BUILD: "1" })).toMatchObject({
		status: 0,
	});
	expect(run("unowned-root.ts", [])).toEqual({
		status: 1,
		stdout: "",
		stderr: 'Error: Command "acme" sets "tool", which no installed Extension owns\n',
	});
});
