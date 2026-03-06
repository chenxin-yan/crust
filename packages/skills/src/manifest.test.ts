import { describe, expect, it } from "bun:test";
import type { ArgDef, CommandNode, FlagDef } from "@crustjs/core";
import { Crust } from "@crustjs/core";
import { buildManifest } from "./manifest.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helper — builds a CommandNode for introspection tests
// ────────────────────────────────────────────────────────────────────────────

function makeCommand(opts: {
	meta: { name: string; description?: string; usage?: string };
	args?: readonly ArgDef[];
	flags?: Record<string, FlagDef>;
	run?: () => void;
	preRun?: () => void;
	postRun?: () => void;
	subCommands?: Record<string, CommandNode>;
}): CommandNode {
	const node = new Crust(opts.meta.name)._node;
	Object.assign(node.meta, opts.meta);
	if (opts.args) node.args = opts.args as ArgDef[];
	if (opts.flags) {
		node.localFlags = { ...opts.flags };
		node.effectiveFlags = { ...opts.flags };
	}
	if (opts.run) node.run = opts.run;
	if (opts.preRun) node.preRun = opts.preRun;
	if (opts.postRun) node.postRun = opts.postRun;
	if (opts.subCommands) {
		node.subCommands = opts.subCommands;
	}
	return node;
}

// ────────────────────────────────────────────────────────────────────────────
// buildManifest — basic root command behavior
// ────────────────────────────────────────────────────────────────────────────

describe("buildManifest", () => {
	describe("root command basics", () => {
		it("returns a ManifestNode with name and path from meta", () => {
			const cmd = makeCommand({
				meta: { name: "my-cli", description: "A test CLI" },
			});

			const node = buildManifest(cmd);

			expect(node.name).toBe("my-cli");
			expect(node.path).toEqual(["my-cli"]);
			expect(node.description).toBe("A test CLI");
		});

		it("normalizes command name to lowercase and trimmed", () => {
			const cmd = makeCommand({
				meta: { name: "  My-CLI  " },
			});

			const node = buildManifest(cmd);

			expect(node.name).toBe("my-cli");
			expect(node.path).toEqual(["my-cli"]);
		});

		it("sets runnable to true when command has a run handler", () => {
			const cmd = makeCommand({
				meta: { name: "serve" },
				run() {},
			});

			const node = buildManifest(cmd);

			expect(node.runnable).toBe(true);
		});

		it("sets runnable to false when command has no run handler", () => {
			const cmd = makeCommand({
				meta: { name: "app" },
			});

			const node = buildManifest(cmd);

			expect(node.runnable).toBe(false);
		});

		it("includes usage when provided", () => {
			const cmd = makeCommand({
				meta: { name: "build", usage: "build [options] <entry>" },
			});

			const node = buildManifest(cmd);

			expect(node.usage).toBe("build [options] <entry>");
		});

		it("omits description and usage when not provided", () => {
			const cmd = makeCommand({
				meta: { name: "app" },
			});

			const node = buildManifest(cmd);

			expect(node.description).toBeUndefined();
			expect(node.usage).toBeUndefined();
		});

		it("returns empty args and flags arrays when none defined", () => {
			const cmd = makeCommand({
				meta: { name: "app" },
			});

			const node = buildManifest(cmd);

			expect(node.args).toEqual([]);
			expect(node.flags).toEqual([]);
			expect(node.children).toEqual([]);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Positional arguments
	// ────────────────────────────────────────────────────────────────────────

	describe("positional arguments", () => {
		it("normalizes a required string arg", () => {
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

			const node = buildManifest(cmd);

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

		it("normalizes an optional arg with default value", () => {
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

			const node = buildManifest(cmd);
			const [arg] = node.args;

			expect(node.args).toHaveLength(1);
			expect(arg?.name).toBe("port");
			expect(arg?.type).toBe("number");
			expect(arg?.required).toBe(false);
			expect(arg?.variadic).toBe(false);
			expect(arg?.default).toBe("3000");
		});

		it("normalizes a variadic arg", () => {
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

			const node = buildManifest(cmd);
			const [arg] = node.args;

			expect(node.args).toHaveLength(1);
			expect(arg?.name).toBe("packages");
			expect(arg?.variadic).toBe(true);
			expect(arg?.required).toBe(false);
		});

		it("preserves positional order of multiple args", () => {
			const cmd = makeCommand({
				meta: { name: "copy" },
				args: [
					{ name: "source", type: "string", required: true },
					{ name: "dest", type: "string", required: true },
					{ name: "extras", type: "string", variadic: true },
				] as ArgDef[],
				run() {},
			});

			const node = buildManifest(cmd);
			const [first, second, third] = node.args;

			expect(node.args).toHaveLength(3);
			expect(first?.name).toBe("source");
			expect(second?.name).toBe("dest");
			expect(third?.name).toBe("extras");
			expect(third?.variadic).toBe(true);
		});

		it("normalizes a boolean arg with default", () => {
			const cmd = makeCommand({
				meta: { name: "toggle" },
				args: [
					{ name: "enabled", type: "boolean", default: false },
				] as ArgDef[],
				run() {},
			});

			const node = buildManifest(cmd);
			const [arg] = node.args;

			expect(arg?.type).toBe("boolean");
			expect(arg?.default).toBe("false");
		});

		it("omits description when not provided on arg", () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				args: [{ name: "file", type: "string" }] as ArgDef[],
				run() {},
			});

			const node = buildManifest(cmd);
			const [arg] = node.args;

			expect(arg?.description).toBeUndefined();
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Named flags
	// ────────────────────────────────────────────────────────────────────────

	describe("named flags", () => {
		it("normalizes a simple boolean flag", () => {
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

			const node = buildManifest(cmd);

			expect(node.flags).toEqual([
				{
					name: "verbose",
					type: "boolean",
					description: "Enable verbose output",
					required: false,
					multiple: false,
					aliases: [],
				},
			]);
		});

		it("normalizes a required string flag with short alias", () => {
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

			const node = buildManifest(cmd);
			const [flag] = node.flags;

			expect(flag?.name).toBe("target");
			expect(flag?.required).toBe(true);
			expect(flag?.short).toBe("t");
			expect(flag?.aliases).toEqual([]);
		});

		it("normalizes a flag with long aliases sorted alphabetically", () => {
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

			const node = buildManifest(cmd);
			const [flag] = node.flags;

			expect(flag?.short).toBe("o");
			expect(flag?.aliases).toEqual(["dest", "out"]);
		});

		it("normalizes a multiple flag", () => {
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

			const node = buildManifest(cmd);
			const [flag] = node.flags;

			expect(flag?.name).toBe("ignore");
			expect(flag?.multiple).toBe(true);
		});

		it("serializes flag default values as strings", () => {
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

			const node = buildManifest(cmd);
			const flagMap = Object.fromEntries(node.flags.map((f) => [f.name, f]));

			expect(flagMap.port?.default).toBe("8080");
			expect(flagMap.host?.default).toBe("localhost");
			expect(flagMap.watch?.default).toBe("true");
		});

		it("serializes multiple flag array defaults as JSON", () => {
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

			const node = buildManifest(cmd);
			const [flag] = node.flags;

			expect(flag?.default).toBe('["src/index.ts","src/cli.ts"]');
		});

		it("sorts flags alphabetically by name", () => {
			const cmd = makeCommand({
				meta: { name: "app" },
				flags: {
					zoo: { type: "string" },
					alpha: { type: "boolean" },
					middle: { type: "number" },
				},
				run() {},
			});

			const node = buildManifest(cmd);

			expect(node.flags.map((f) => f.name)).toEqual(["alpha", "middle", "zoo"]);
		});

		it("omits description and default when not provided on flag", () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				flags: {
					quiet: { type: "boolean" },
				},
				run() {},
			});

			const node = buildManifest(cmd);
			const [flag] = node.flags;

			expect(flag?.description).toBeUndefined();
			expect(flag?.default).toBeUndefined();
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Subcommand tree traversal
	// ────────────────────────────────────────────────────────────────────────

	describe("subcommand tree traversal", () => {
		it("builds children from subCommands", () => {
			const serve = makeCommand({
				meta: { name: "serve", description: "Start server" },
				run() {},
			});

			const build = makeCommand({
				meta: { name: "build", description: "Build project" },
				run() {},
			});

			const root = makeCommand({
				meta: { name: "app" },
				subCommands: { serve, build },
			});

			const node = buildManifest(root);
			const [first, second] = node.children;

			expect(node.children).toHaveLength(2);
			// Children sorted alphabetically
			expect(first?.name).toBe("build");
			expect(second?.name).toBe("serve");
		});

		it("constructs correct paths for nested subcommands", () => {
			const add = makeCommand({
				meta: { name: "add", description: "Add a remote" },
				args: [{ name: "name", type: "string", required: true }] as ArgDef[],
				run() {},
			});

			const remove = makeCommand({
				meta: { name: "remove", description: "Remove a remote" },
				args: [{ name: "name", type: "string", required: true }] as ArgDef[],
				run() {},
			});

			const remote = makeCommand({
				meta: { name: "remote", description: "Manage remotes" },
				subCommands: { add, remove },
			});

			const root = makeCommand({
				meta: { name: "git" },
				subCommands: { remote },
			});

			const node = buildManifest(root);
			const remoteNode = node.children[0];
			const [addNode, removeNode] = remoteNode?.children ?? [];

			expect(node.path).toEqual(["git"]);
			expect(remoteNode?.path).toEqual(["git", "remote"]);
			expect(addNode?.path).toEqual(["git", "remote", "add"]);
			expect(removeNode?.path).toEqual(["git", "remote", "remove"]);
		});

		it("sorts children alphabetically at every level", () => {
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

			const node = buildManifest(root);
			const groupNode = node.children[0];

			expect(groupNode?.children.map((c) => c.name)).toEqual([
				"alpha",
				"beta",
				"zeta",
			]);
		});

		it("correctly marks runnable vs group commands in deep trees", () => {
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

			const node = buildManifest(root);
			const middleNode = node.children[0];
			const leafNode = middleNode?.children[0];

			expect(node.runnable).toBe(false);
			expect(middleNode?.runnable).toBe(false);
			expect(leafNode?.runnable).toBe(true);
		});

		it("handles a command that is both runnable and has subcommands", () => {
			const sub = makeCommand({
				meta: { name: "sub" },
				run() {},
			});

			const parent = makeCommand({
				meta: { name: "parent" },
				subCommands: { sub },
				run() {},
			});

			const node = buildManifest(parent);
			const [child] = node.children;

			expect(node.runnable).toBe(true);
			expect(node.children).toHaveLength(1);
			expect(child?.runnable).toBe(true);
		});

		it("handles commands with no subCommands returning empty children", () => {
			const cmd = makeCommand({
				meta: { name: "solo" },
				run() {},
			});

			const node = buildManifest(cmd);

			expect(node.children).toEqual([]);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Determinism — same input produces identical output
	// ────────────────────────────────────────────────────────────────────────

	describe("deterministic output", () => {
		it("produces identical manifests from the same command tree", () => {
			const leaf = makeCommand({
				meta: { name: "deploy", description: "Deploy the app" },
				args: [{ name: "env", type: "string", required: true }] as ArgDef[],
				flags: {
					force: { type: "boolean", short: "f" },
					target: { type: "string", default: "production" },
				},
				run() {},
			});

			const root = makeCommand({
				meta: { name: "app" },
				subCommands: { deploy: leaf },
			});

			const first = buildManifest(root);
			const second = buildManifest(root);

			expect(JSON.stringify(first)).toBe(JSON.stringify(second));
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Complex fixture — full command tree
	// ────────────────────────────────────────────────────────────────────────

	describe("complex command tree fixture", () => {
		it("builds a full manifest from a realistic command tree", () => {
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

			const manifest = buildManifest(root);

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
			expect(cloneNode?.flags.map((f) => f.name)).toEqual([
				"bare",
				"branch",
				"depth",
			]);
			expect(cloneNode?.flags[1]?.short).toBe("b");
			expect(cloneNode?.flags[1]?.aliases).toEqual([]);

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
			expect(remoteNode?.children[1]?.path).toEqual([
				"git",
				"remote",
				"remove",
			]);
		});
	});

	// ────────────────────────────────────────────────────────────────────────
	// Edge cases
	// ────────────────────────────────────────────────────────────────────────

	describe("edge cases", () => {
		it("handles command with preRun/postRun but no run as not runnable", () => {
			const cmd = makeCommand({
				meta: { name: "hook-only" },
				preRun() {},
				postRun() {},
			});

			const node = buildManifest(cmd);

			// Only `run` determines runnable, not preRun/postRun
			expect(node.runnable).toBe(false);
		});

		it("handles deeply nested commands (4 levels)", () => {
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

			const node = buildManifest(root);
			const deepNode = node.children[0]?.children[0]?.children[0];

			expect(deepNode?.name).toBe("deep");
			expect(deepNode?.path).toEqual(["root", "level2", "level3", "deep"]);
		});

		it("handles empty flags record", () => {
			const cmd = makeCommand({
				meta: { name: "test" },
				flags: {},
				run() {},
			});

			const node = buildManifest(cmd);

			expect(node.flags).toEqual([]);
		});
	});
});
