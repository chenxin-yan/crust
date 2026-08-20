import { beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ────────────────────────────────────────────────────────────────────────────
// Declaration emission — a consumer with `declaration: true` must be able to
// export values with inferred builder types. If a type used in a public
// inferred signature (e.g. `Simplify` in defineFlag's return type) is not
// re-exported from the package root, tsc fails with TS2742 ("cannot be
// named") because the private dist chunk is not an importable specifier.
// ────────────────────────────────────────────────────────────────────────────

const repoRoot = resolve(import.meta.dir, "../../..");
const corePkg = resolve(import.meta.dir, "..");
const tscBin = join(repoRoot, "node_modules/.bin/tsc");

const CONSUMER_SOURCE = `import { Crust, defineCommand, defineContext, defineExtension, defineExtensionId, defineFlag } from "@crustjs/core";

// Inferred defineFlag element type references Simplify
export const configFlag = defineFlag("config", {
	type: "string",
	description: "Path to config file",
});

export const flags = [
	configFlag,
	defineFlag("quiet", { type: "boolean", short: "q", description: "Quiet mode" }),
];

// Inferred builder type exposes the accumulated spelling-literal union
export const flagged = new Crust("flagged").flags(...flags);

export const apiKey = defineFlag("api-key", { type: "string", short: "k" });
export const auth = defineContext("auth", { flags: [apiKey] }, ({ flags }) => ({
	apiKey: flags["api-key"],
}));

// Inferred setup input exposes the declared lazy Context bag
export const authenticatedApi = defineContext("authenticated-api", { uses: [auth] }, async ({ ctx }) => ({
	apiKey: (await ctx.auth).apiKey,
}));

// A declared Context bag preserves the factory's value type
export const deploy = defineCommand("deploy", { uses: [auth] }, (cmd) =>
	cmd.action(async ({ ctx }) => {
		void (await ctx.auth).apiKey;
	}),
);

// An exported Extension carries evaluated dependency intersections,
// ContextInstance tuples, and its contributed CommandDefinition tuple; a
// TS2742 regression here must fail emission.
export const telemetry = defineExtension(defineExtensionId("telemetry"), {
	uses: [authenticatedApi],
	provides: [auth()],
	commands: [deploy],
	hooks: { preRun: async ({ ctx }) => void (await ctx.auth) },
});

// Inferred builder type references accumulated Context-owned flag shapes
export const app = new Crust("consumer-cli")
	.flags(...flags)
	.provide(auth(), authenticatedApi())
	.add(defineCommand("build", (cmd) => cmd.action(() => {})))
	.add(deploy);
`;

let fixtureDir: string;

beforeAll(() => {
	// Declaration emission must be checked against dist, where types live in
	// a private chunk. Never rebuild an existing dist here: sibling packages'
	// tests import @crustjs/core from dist in parallel, and a rebuild races
	// them. In turbo runs core:build precedes core:test (packages/core/
	// turbo.json); this fallback only serves a direct `bun test` on a fresh
	// checkout.
	if (!existsSync(join(corePkg, "dist/index.d.ts"))) {
		const build = Bun.spawnSync(["bun", "run", "build"], { cwd: corePkg });
		if (build.exitCode !== 0) {
			throw new Error(`core build failed:\n${build.stdout.toString()}\n${build.stderr.toString()}`);
		}
	}

	fixtureDir = mkdtempSync(join(tmpdir(), "crust-dts-consumer-"));
	// Consume like a real dependency (package.json exports map in effect),
	// mirroring link:/node_modules resolution.
	mkdirSync(join(fixtureDir, "node_modules/@crustjs"), { recursive: true });
	symlinkSync(corePkg, join(fixtureDir, "node_modules/@crustjs/core"));

	writeFileSync(join(fixtureDir, "consumer.ts"), CONSUMER_SOURCE);
	writeFileSync(
		join(fixtureDir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				module: "esnext",
				moduleResolution: "bundler",
				target: "esnext",
				strict: true,
				declaration: true,
				emitDeclarationOnly: true,
				outDir: "out",
			},
			include: ["consumer.ts"],
		}),
	);
});

describe("declaration emission for consumers", () => {
	it("emits declarations for exported inferred builder types without TS2742/TS4058", () => {
		const result = Bun.spawnSync([tscBin, "-p", "."], { cwd: fixtureDir });
		const output = result.stdout.toString() + result.stderr.toString();
		expect(output).toBe("");
		expect(result.exitCode).toBe(0);
	});
});
