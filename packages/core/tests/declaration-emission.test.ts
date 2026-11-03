import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { beforeAll, describe, expect, it } from "vite-plus/test";

import { ensureDist } from "./helpers.ts";

// ────────────────────────────────────────────────────────────────────────────
// Declaration emission — a consumer with `declaration: true` must be able to
// export values with inferred builder types. Public signatures must remain
// nameable without relying on private dist-chunk types, or tsc fails with
// TS2742 ("cannot be named").
// ────────────────────────────────────────────────────────────────────────────

const repoRoot = resolve(import.meta.dirname, "../../..");
const corePkg = resolve(import.meta.dirname, "..");
const tscBin = join(repoRoot, "node_modules/.bin/tsc");

const CONSUMER_SOURCE = `import { Crust, defineCommand, defineContext, defineExtension, defineExtensionId, defineFlag, type AnyCrust } from "@crustjs/core";

export const localFlag = defineFlag("local", { type: "string", choices: ["a"], default: "a" });
export const localConfigured = new Crust("local", { sections: [{ title: "Notes", body: "text" }] })
	.flags(localFlag).args({ name: "file", type: "string" });
export const configuredChild = defineCommand("configured", { aliases: ["alias"] }, b => b);

export const checkedApp = new Crust("checked")
	.args({ name: "file", type: "string", required: true })
	.action(({ args }) => args.file);
export const checkedResult = checkedApp.run([], { args: { file: "input" } });
export const erasedApp: AnyCrust = checkedApp;
export const dynamicResult = erasedApp.run([], { args: { file: "input" } });
export function dynamicCommand(name: string) {
	return defineCommand(name, (command) => command.action(() => name));
}

// Inferred defineFlag element type remains structurally nameable
export const configFlag = defineFlag("config", {
	type: "string",
	description: "Path to config file",
});

export const flags = [
	configFlag,
	defineFlag("quiet", { type: "boolean", short: "q", description: "Quiet mode" }),
] as const;

// Inferred builder type exposes the accumulated spelling-literal union
export const flagged = new Crust("flagged").flags(...flags);

export const apiKey = defineFlag("api-key", { type: "string", short: "k" });
// An unfinished fluent Context builder is itself a nameable exported type
export const authBuilder = defineContext("auth").flags(apiKey);
export const auth = authBuilder.setup(({ flags }) => ({
	apiKey: flags["api-key"],
}));

// Inferred setup input exposes the declared lazy Context bag and typed options
export const authenticatedApi = defineContext("authenticated-api")
	.use(auth)
	.setup(async ({ ctx }, options: { region: string } = { region: "us" }) => ({
		apiKey: (await ctx.auth).apiKey,
		region: options.region,
	}));

// A declared Context bag preserves the factory's value type; .use() chains
// accumulate demand and the transitive dependency closure
export const deploy = defineCommand("deploy", (cmd) =>
	cmd
		.use(auth)
		.use(authenticatedApi)
		.action(async ({ ctx }) => {
			void (await ctx.auth).apiKey;
			void (await ctx["authenticated-api"]).apiKey;
		}),
);

// An exported Extension carries evaluated dependency intersections,
// ContextInstance tuples, and its contributed CommandDefinition tuple; a
// TS2742 regression here must fail emission.
export const telemetry = defineExtension(defineExtensionId("telemetry"))
	.use(authenticatedApi)
	.provide(auth())
	.add(deploy)
	.preRun(async ({ ctx }) => void (await ctx.auth));

// Inferred builder type references accumulated Context-owned flag shapes
export const app = new Crust("consumer-cli")
	.flags(...flags)
	.provide(auth(), authenticatedApi())
	.add(defineCommand("build", (cmd) => cmd.action(() => {})))
	.add(deploy);

// Metadata requirements must remain nameable through exported factories and builders.
export const stamp = defineExtension<"version">(defineExtensionId("stamp")).factory(
	(extension, prefix: string) =>
		extension
			.flags({ name: "prefix", type: "string", default: prefix })
			.preRun(({ rootCommand, stdout }) => stdout(rootCommand.meta.version)),
);
export const versionedApp = new Crust("versioned", { version: "1.2.3" })
	.extend(stamp("release"))
	.command("show", (cmd) => cmd.action(() => 42));

// ~30 chained inline commands with chained .use() demands: generic depth
// must stay bounded (no TS2589) and every intermediate builder type must
// remain nameable in the emitted declarations.
export const inlineApp = new Crust("inline-cli")
	.provide(auth(), authenticatedApi())
${Array.from(
	{ length: 30 },
	(_, index) => `	.command("inline-${index}", (cmd) =>
		cmd
			.use(auth)
			.use(authenticatedApi)
			.flags({ name: "inline-${index}-verbose", type: "boolean" })
			.args({ name: "inline-${index}-target", type: "string" })
			.action(async ({ args, flags, ctx }) => {
				void args["inline-${index}-target"];
				void flags["inline-${index}-verbose"];
				void (await ctx.auth).apiKey;
				return ${index};
			}),
	)`,
).join("\n")}
;
`;

// Demand checks must hold against dist exactly as in source; each directive
// turns into TS2578 if the shipped declarations stop rejecting its line.
const DEMAND_PROOF_SOURCE = `import { Crust, defineCommand, defineContext, defineExtension, defineExtensionId } from "@crustjs/core";

const db = defineContext("db").setup(() => "ok");
const extension = defineExtension(defineExtensionId("demands"))
	.use(db)
	.preRun(async ({ ctx }) => void (await ctx.db).toUpperCase());
const base = new Crust("app").provide(db());
const extended = base.extend(extension);
// @ts-expect-error -- Extension demands make the builder no longer a plain provider root
export const substituted: typeof base = extended;

const config = defineContext("config").setup(() => ({ url: "memory://" }));
const pool = defineContext("pool")
	.use(config)
	.setup(async ({ ctx }) => await ctx.config);
const query = defineCommand("query", (cmd) =>
	cmd.use(pool).action(async ({ ctx }) => void (await ctx.pool)),
);
// @ts-expect-error -- pool's transitive config dependency is unmet at .add()
new Crust("cli").provide(pool.of({ url: "fake" })).add(query);
// @ts-expect-error -- inline .use(pool) demand is unmet at the call site
new Crust("cli").command("query", (cmd) => cmd.use(pool).action(() => {}));

// Controls: the same shapes compile once demands are met, so the directives above only
// pass for the unmet demand, not for an unrelated error on their line.
new Crust("cli").provide(config(), pool()).add(query);
new Crust("cli").provide(config(), pool()).command("query", (cmd) => cmd.use(pool).action(() => {}));
export const sameDemands: typeof extended = base.extend(extension);
`;

let fixtureDir: string;

beforeAll(() => {
	// Declaration emission must be checked against dist, where types live in a private chunk.
	ensureDist();

	fixtureDir = mkdtempSync(join(tmpdir(), "crust-dts-consumer-"));
	// Consume like a real dependency (package.json exports map in effect),
	// mirroring link:/node_modules resolution.
	mkdirSync(join(fixtureDir, "node_modules/@crustjs"), { recursive: true });
	symlinkSync(corePkg, join(fixtureDir, "node_modules/@crustjs/core"));

	writeFileSync(join(fixtureDir, "consumer.ts"), CONSUMER_SOURCE);
	writeFileSync(join(fixtureDir, "demand-proof.ts"), DEMAND_PROOF_SOURCE);
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
	writeFileSync(join(fixtureDir, "optional-tail.ts"), OPTIONAL_TAIL_SOURCE);
	writeFileSync(
		join(fixtureDir, "tsconfig.loose.json"),
		JSON.stringify({
			extends: "./tsconfig.json",
			compilerOptions: {
				declaration: false,
				emitDeclarationOnly: false,
				noEmit: true,
				strictNullChecks: false,
			},
			include: ["optional-tail.ts"],
		}),
	);
	// Strictest consumer settings: shipped declarations are checked, not skipped.
	writeFileSync(
		join(fixtureDir, "tsconfig.exact.json"),
		JSON.stringify({
			extends: "./tsconfig.json",
			compilerOptions: {
				declaration: false,
				emitDeclarationOnly: false,
				noEmit: true,
				exactOptionalPropertyTypes: true,
				skipLibCheck: false,
			},
		}),
	);
	writeFileSync(
		join(fixtureDir, "tsconfig.demands.json"),
		JSON.stringify({
			extends: "./tsconfig.json",
			compilerOptions: { declaration: false, emitDeclarationOnly: false, noEmit: true },
			include: ["demand-proof.ts"],
		}),
	);
});

// Without strictNullChecks, an explicit provider tuple can end in an optional element; the
// required Contexts before it must still type the action's ctx and flags.
const OPTIONAL_TAIL_SOURCE = `import { Crust, defineContext, defineExtension, defineExtensionId, defineFlag } from "@crustjs/core";

const a = defineContext("a").flags(defineFlag("verbose", { type: "boolean" })).setup(() => 1);
const b = defineContext("b").setup(() => "b");
type Contexts = readonly [ReturnType<typeof a>, ReturnType<typeof b>?];

export function direct(contexts: Contexts) {
	return new Crust("app").provide<Contexts>(...contexts).action(({ ctx, flags }) => {
		const value: Promise<number> = ctx.a;
		void [value, flags.verbose];
	});
}

export function viaExtension(contexts: Contexts) {
	const extension = defineExtension(defineExtensionId("optional-tail")).provide<Contexts>(...contexts);
	return new Crust("app").extend(extension).action(({ ctx, flags }) => {
		const value: Promise<number> = ctx.a;
		void [value, flags.verbose];
	});
}
`;

describe("declaration emission for consumers", () => {
	it("emits declarations for exported inferred builder types without TS2742/TS4058", () => {
		const result = spawnSync(tscBin, ["-p", "."], { cwd: fixtureDir, timeout: 60_000 });
		const output = result.stdout.toString() + result.stderr.toString();
		expect(output).toBe("");
		expect(result.status).toBe(0);
	});

	it("type-checks shipped declarations under exactOptionalPropertyTypes", () => {
		const result = spawnSync(tscBin, ["-p", "tsconfig.exact.json"], {
			cwd: fixtureDir,
			timeout: 60_000,
		});
		const output = result.stdout.toString() + result.stderr.toString();
		expect(output).toBe("");
		expect(result.status).toBe(0);
	});

	it("keeps required Contexts before an optional provider tuple tail", () => {
		const result = spawnSync(tscBin, ["-p", "tsconfig.loose.json"], {
			cwd: fixtureDir,
			timeout: 60_000,
		});
		const output = result.stdout.toString() + result.stderr.toString();
		expect(output).toBe("");
		expect(result.status).toBe(0);
	});

	it("rejects unmet Context and Extension demands against shipped declarations", () => {
		const result = spawnSync(tscBin, ["-p", "tsconfig.demands.json"], {
			cwd: fixtureDir,
			timeout: 60_000,
		});
		const output = result.stdout.toString() + result.stderr.toString();
		expect(output).toBe("");
		expect(result.status).toBe(0);
	});
});
