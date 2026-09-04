import { describe, expect, it } from "bun:test";

import type { ArgDef, CommandSection, FlagDef } from "@crustjs/core";
import { Crust, defineCommand, defineExtensionId } from "@crustjs/core";

import { SKILLS } from "./extension.ts";
import { buildManifest } from "./manifest.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helper — builds a CommandNode for introspection tests
// ────────────────────────────────────────────────────────────────────────────

function makeCommand(opts: {
	meta: {
		name: string;
		description?: string;
		usage?: string;
		hidden?: boolean;
		sections?: readonly CommandSection[];
	};
	args?: readonly ArgDef[];
	flags?: Record<string, FlagDef>;
	run?: () => void;
	subCommands?: Record<string, CommandFixture>;
}): CommandFixture {
	return opts;
}

type CommandFixture = Parameters<typeof makeCommand>[0];

function configureFixture(command: Crust, fixture: CommandFixture): Crust {
	let configured = command;
	if (fixture.args) configured = configured.args(...fixture.args);
	if (fixture.flags) {
		const flags = Object.entries(fixture.flags).map(([name, def]) => ({ name, ...def }));
		configured = configured.flags(...(flags as never[]));
	}
	if (fixture.run) configured = configured.action(fixture.run);
	for (const child of Object.values(fixture.subCommands ?? {})) {
		const { name, ...meta } = child.meta;
		configured = configured.add(
			defineCommand(
				name as never,
				meta as never,
				(builder) =>
					// SAFETY: command recipes receive Crust's configure-only runtime builder.
					// oxlint-disable-next-line anti-slop/no-chained-type-assertions -- the public recipe interface intentionally hides the Crust class identity.
					configureFixture(builder as unknown as Crust, child) as never,
			),
		);
	}
	return configured;
}

async function snapshotFixture(fixture: CommandFixture | Crust) {
	if (fixture instanceof Crust) return await fixture.snapshot();
	const { name, ...meta } = fixture.meta;
	return await configureFixture(new Crust(name, meta), fixture).snapshot();
}

// ────────────────────────────────────────────────────────────────────────────
// buildManifest — basic root command behavior
// ────────────────────────────────────────────────────────────────────────────

describe("buildManifest", () => {
	describe("root command basics", () => {
		it("rejects a direct subcommand that would overwrite the root command file", async () => {
			const child = makeCommand({ meta: { name: "demo" }, run: () => {} });
			const root = makeCommand({ meta: { name: "demo" }, subCommands: { demo: child } });

			const snapshot = await snapshotFixture(root);
			expect(() => buildManifest(snapshot)).toThrow(
				'Cannot generate skills when a direct subcommand has the root command name "demo"',
			);
		});

		it("ignores hidden same-named children, which are never rendered", async () => {
			const child = makeCommand({ meta: { name: "demo", hidden: true }, run: () => {} });
			const root = makeCommand({ meta: { name: "demo" }, subCommands: { demo: child } });

			expect(buildManifest(await snapshotFixture(root)).children).toEqual([]);
		});

		it("returns a ManifestNode with name and path from meta", async () => {
			const cmd = makeCommand({
				meta: { name: "my-cli", description: "A test CLI" },
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.name).toBe("my-cli");
			expect(node.path).toEqual(["my-cli"]);
			expect(node.description).toBe("A test CLI");
		});

		it("normalizes command name to lowercase and trimmed", async () => {
			const cmd = makeCommand({
				meta: { name: "  My-CLI  " },
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.name).toBe("my-cli");
			expect(node.path).toEqual(["my-cli"]);
		});

		it("includes usage when provided", async () => {
			const cmd = makeCommand({
				meta: { name: "build", usage: "build [options] <entry>" },
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.usage).toBe("build [options] <entry>");
		});

		it("resolves generated usage when custom usage is not provided", async () => {
			const cmd = makeCommand({
				meta: { name: "app" },
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.description).toBeUndefined();
			expect(node.usage).toBe("app");
		});

		it("returns empty args and flags arrays when none defined", async () => {
			const cmd = makeCommand({
				meta: { name: "app" },
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.args).toEqual([]);
			expect(node.flags).toEqual([]);
			expect(node.children).toEqual([]);
		});

		it("includes command metadata sections", async () => {
			const cmd = makeCommand({
				meta: {
					name: "deploy",
					sections: [
						{ title: "Safety", body: "Confirm destructive operations before execution." },
						{ title: "Preview", body: "Prefer dry-run flags when available." },
					],
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.sections).toEqual([
				{ title: "Safety", body: "Confirm destructive operations before execution." },
				{ title: "Preview", body: "Prefer dry-run flags when available." },
			]);
		});

		it("honors only and except section audiences", async () => {
			const other = defineExtensionId("acme:other");
			const cmd = makeCommand({
				meta: {
					name: "deploy",
					sections: [
						{ title: "Skills only", body: "visible", only: [SKILLS] },
						{ title: "Other only", body: "hidden", only: [other] },
						{ title: "Not skills", body: "hidden", except: [SKILLS] },
					],
				},
			});

			expect(buildManifest(await snapshotFixture(cmd)).sections).toEqual([
				{ title: "Skills only", body: "visible" },
			]);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Positional arguments
	// ────────────────────────────────────────────────────────────────────────

	describe("positional arguments", () => {
		it("normalizes a required string arg", async () => {
			const cmd = makeCommand({
				meta: { name: "greet" },
				args: [
					{
						name: "name",
						type: "string",
						description: "Name to greet",
						required: true,
					},
				] as ArgDef[],
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.args).toEqual([
				{
					name: "name",
					type: "string",
					description: "Name to greet",
					required: true,
					variadic: false,
				},
			]);
		});

		it("normalizes an optional arg with default value", async () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				args: [
					{
						name: "port",
						type: "number",
						default: 3000,
					},
				] as ArgDef[],
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const [arg] = node.args;

			expect(node.args).toHaveLength(1);
			expect(arg?.name).toBe("port");
			expect(arg?.type).toBe("number");
			expect(arg?.required).toBe(false);
			expect(arg?.variadic).toBe(false);
			expect(arg?.default).toBe("3000");
		});

		it("normalizes a variadic arg", async () => {
			const cmd = makeCommand({
				meta: { name: "install" },
				args: [
					{
						name: "packages",
						type: "string",
						description: "Packages to install",
						variadic: true,
					},
				] as ArgDef[],
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const [arg] = node.args;

			expect(node.args).toHaveLength(1);
			expect(arg?.name).toBe("packages");
			expect(arg?.variadic).toBe(true);
			expect(arg?.required).toBe(false);
		});

		it("omits description when not provided on arg", async () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				args: [{ name: "file", type: "string" }] as ArgDef[],
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const [arg] = node.args;

			expect(arg?.description).toBeUndefined();
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Named flags
	// ────────────────────────────────────────────────────────────────────────

	describe("named flags", () => {
		it("normalizes a simple boolean flag", async () => {
			const cmd = makeCommand({
				meta: { name: "build" },
				flags: {
					verbose: {
						type: "boolean",
						description: "Enable verbose output",
					},
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.flags).toEqual([
				{
					name: "verbose",
					spellings: ["--verbose", "--no-verbose"],
					type: "boolean",
					description: "Enable verbose output",
					required: false,
					multiple: false,
				},
			]);
		});

		it("omits negation spellings for a noNegate boolean flag", async () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				flags: {
					quiet: { type: "boolean", noNegate: true },
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));

			expect(node.flags[0]?.spellings).toEqual(["--quiet"]);
		});

		it("normalizes a required string flag with short alias", async () => {
			const cmd = makeCommand({
				meta: { name: "deploy" },
				flags: {
					target: {
						type: "string",
						description: "Deploy target",
						required: true,
						short: "t",
					},
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const [flag] = node.flags;

			expect(flag?.name).toBe("target");
			expect(flag?.required).toBe(true);
		});

		it("preserves documentation-order flag spellings", async () => {
			const cmd = makeCommand({
				meta: { name: "run" },
				flags: {
					output: {
						type: "string",
						short: "o",
						aliases: ["out", "dest"],
					},
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const [flag] = node.flags;

			expect(flag?.spellings).toEqual(["-o", "--output", "--out", "--dest"]);
		});

		it("normalizes a multiple flag", async () => {
			const cmd = makeCommand({
				meta: { name: "lint" },
				flags: {
					ignore: {
						type: "string",
						multiple: true,
						description: "Patterns to ignore",
					},
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const [flag] = node.flags;

			expect(flag?.name).toBe("ignore");
			expect(flag?.multiple).toBe(true);
		});

		it("formats flag defaults like core help", async () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				flags: {
					port: {
						type: "number",
						default: 8080,
					},
					host: {
						type: "string",
						default: "localhost",
					},
					watch: {
						type: "boolean",
						default: true,
					},
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const flagMap = Object.fromEntries(node.flags.map((f) => [f.name, f]));

			expect(flagMap.port?.default).toBe("8080");
			expect(flagMap.host?.default).toBe('"localhost"');
			expect(flagMap.watch?.default).toBe("true");
		});

		it("formats multiple flag defaults as comma-separated values", async () => {
			const cmd = makeCommand({
				meta: { name: "build" },
				flags: {
					entry: {
						type: "string",
						multiple: true,
						default: ["src/index.ts", "src/cli.ts"],
					},
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const [flag] = node.flags;

			expect(flag?.default).toBe("src/index.ts, src/cli.ts");
		});

		it("omits description and default when not provided on flag", async () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				flags: {
					quiet: { type: "boolean" },
				},
				run() {},
			});

			const node = buildManifest(await snapshotFixture(cmd));
			const [flag] = node.flags;

			expect(flag?.description).toBeUndefined();
			expect(flag?.default).toBeUndefined();
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Subcommand tree traversal
	// ────────────────────────────────────────────────────────────────────────

	describe("subcommand tree traversal", () => {
		it("omits hidden commands from generated agent documentation", async () => {
			const root = makeCommand({
				meta: { name: "app" },
				subCommands: {
					visible: makeCommand({ meta: { name: "visible" }, run() {} }),
					hidden: makeCommand({ meta: { name: "hidden", hidden: true }, run() {} }),
				},
			});
			expect(
				buildManifest(await snapshotFixture(root)).children.map((child) => child.name),
			).toEqual(["visible"]);
		});

		it("sorts children alphabetically at every level", async () => {
			const zeta = makeCommand({
				meta: { name: "zeta" },
				run() {},
			});
			const alpha = makeCommand({
				meta: { name: "alpha" },
				run() {},
			});
			const beta = makeCommand({
				meta: { name: "beta" },
				run() {},
			});

			const group = makeCommand({
				meta: { name: "group" },
				subCommands: { zeta, alpha, beta },
			});

			const root = makeCommand({
				meta: { name: "app" },
				subCommands: { group },
			});

			const node = buildManifest(await snapshotFixture(root));
			const groupNode = node.children[0];

			expect(groupNode?.children.map((c) => c.name)).toEqual(["alpha", "beta", "zeta"]);
		});

		it("correctly marks runnable vs group commands in deep trees", async () => {
			const leaf = makeCommand({
				meta: { name: "leaf" },
				run() {},
			});

			const middle = makeCommand({
				meta: { name: "middle" },
				subCommands: { leaf },
			});

			const root = makeCommand({
				meta: { name: "root" },
				subCommands: { middle },
			});

			const node = buildManifest(await snapshotFixture(root));
			const middleNode = node.children[0];
			const leafNode = middleNode?.children[0];

			expect(node.runnable).toBe(false);
			expect(middleNode?.runnable).toBe(false);
			expect(leafNode?.runnable).toBe(true);
		});

		it("preserves metadata sections on nested commands", async () => {
			const deploy = makeCommand({
				meta: {
					name: "deploy",
					sections: [
						{ title: "Safety", body: "Ask for explicit confirmation before production deploys." },
					],
				},
				run() {},
			});

			const root = makeCommand({
				meta: { name: "app" },
				subCommands: { deploy },
			});

			const node = buildManifest(await snapshotFixture(root));
			const child = node.children[0];

			expect(child?.sections).toEqual([
				{ title: "Safety", body: "Ask for explicit confirmation before production deploys." },
			]);
		});

		it("preserves metadata sections across Crust builder cloning", async () => {
			const deploy = defineCommand(
				"deploy",
				{
					description: "Deploy command",
					sections: [
						{ title: "Environment", body: "Read the environment carefully before execution." },
					],
				},
				(command) => command.action(() => {}),
			);
			const root = new Crust("app").add(deploy);

			const node = buildManifest(await snapshotFixture(root));
			const child = node.children[0];

			expect(child?.sections).toEqual([
				{ title: "Environment", body: "Read the environment carefully before execution." },
			]);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Complex fixture — full command tree
	// ────────────────────────────────────────────────────────────────────────

	describe("complex command tree fixture", () => {
		it("builds a full manifest from a realistic command tree", async () => {
			// Simulate a git-like CLI
			const clone = makeCommand({
				meta: { name: "clone", description: "Clone a repository" },
				args: [
					{
						name: "url",
						type: "string",
						required: true,
						description: "Repository URL",
					},
					{
						name: "directory",
						type: "string",
						description: "Target directory",
					},
				] as ArgDef[],
				flags: {
					branch: {
						type: "string",
						short: "b",
						description: "Branch to clone",
					},
					depth: {
						type: "number",
						description: "Shallow clone depth",
					},
					bare: {
						type: "boolean",
						description: "Create a bare repository",
					},
				},
				run() {},
			});

			const remoteAdd = makeCommand({
				meta: { name: "add", description: "Add a remote" },
				args: [
					{ name: "name", type: "string", required: true },
					{ name: "url", type: "string", required: true },
				] as ArgDef[],
				run() {},
			});

			const remoteRemove = makeCommand({
				meta: { name: "remove", description: "Remove a remote" },
				args: [{ name: "name", type: "string", required: true }] as ArgDef[],
				run() {},
			});

			const remote = makeCommand({
				meta: { name: "remote", description: "Manage remotes" },
				flags: {
					verbose: { type: "boolean", short: "v" },
				},
				subCommands: { add: remoteAdd, remove: remoteRemove },
				run() {},
			});

			const root = makeCommand({
				meta: {
					name: "git",
					description: "A distributed version control system",
				},
				subCommands: { clone, remote },
			});

			const manifest = buildManifest(await snapshotFixture(root));

			// Root
			expect(manifest.name).toBe("git");
			expect(manifest.path).toEqual(["git"]);
			expect(manifest.runnable).toBe(false);
			expect(manifest.children).toHaveLength(2);

			// clone (alphabetically first)
			const cloneNode = manifest.children[0];
			expect(cloneNode?.name).toBe("clone");
			expect(cloneNode?.path).toEqual(["git", "clone"]);
			expect(cloneNode?.runnable).toBe(true);
			expect(cloneNode?.args).toHaveLength(2);
			expect(cloneNode?.args[0]?.name).toBe("url");
			expect(cloneNode?.args[0]?.required).toBe(true);
			expect(cloneNode?.args[1]?.name).toBe("directory");
			expect(cloneNode?.args[1]?.required).toBe(false);
			expect(cloneNode?.flags).toHaveLength(3);
			// Flags sorted: bare, branch, depth
			expect(cloneNode?.flags.map((f) => f.name)).toEqual(["bare", "branch", "depth"]);

			// remote
			const remoteNode = manifest.children[1];
			expect(remoteNode?.name).toBe("remote");
			expect(remoteNode?.path).toEqual(["git", "remote"]);
			expect(remoteNode?.runnable).toBe(true);
			expect(remoteNode?.children).toHaveLength(2);
			// remote children sorted: add, remove
			expect(remoteNode?.children[0]?.name).toBe("add");
			expect(remoteNode?.children[0]?.path).toEqual(["git", "remote", "add"]);
			expect(remoteNode?.children[1]?.name).toBe("remove");
			expect(remoteNode?.children[1]?.path).toEqual(["git", "remote", "remove"]);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles deeply nested commands (4 levels)", async () => {
			const deep = makeCommand({
				meta: { name: "deep" },
				run() {},
			});
			const level3 = makeCommand({
				meta: { name: "level3" },
				subCommands: { deep },
			});
			const level2 = makeCommand({
				meta: { name: "level2" },
				subCommands: { level3 },
			});
			const root = makeCommand({
				meta: { name: "root" },
				subCommands: { level2 },
			});

			const node = buildManifest(await snapshotFixture(root));
			const deepNode = node.children[0]?.children[0]?.children[0];

			expect(deepNode?.name).toBe("deep");
			expect(deepNode?.path).toEqual(["root", "level2", "level3", "deep"]);
		});
	});
});
