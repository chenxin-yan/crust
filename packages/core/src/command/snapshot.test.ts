import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { defineExtension } from "../api/extension.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import { commandInputSchema } from "./command-input.ts";
import { Crust, defineCommand } from "./crust.ts";
import { createCommandNode, registerFlag } from "./node.ts";
import { snapshotCommand, type CommandSnapshot } from "./snapshot.ts";

function buildTree() {
	const root = createCommandNode("cli");
	root.args = [
		{
			name: "file",
			type: "string",
			required: true,
			parse: (s: string) => s.toUpperCase(),
		},
	];
	registerFlag(
		root,
		"verbose",
		{ type: "boolean", short: "v", description: "Verbose output" },
		"local",
	);
	registerFlag(
		root,
		"endpoint",
		{ type: "url", default: new URL("https://example.com/") },
		"local",
	);
	registerFlag(
		root,
		"mirrors",
		{
			type: "url",
			multiple: true,
			default: [new URL("https://a.example/"), new URL("https://b.example/")],
		},
		"local",
	);
	root.run = () => {};

	const sub = createCommandNode("build");
	sub.meta.aliases = ["b"];
	sub.meta.hidden = true;
	root.subCommands = { build: sub };
	return root;
}

describe("snapshotCommand", () => {
	it("projects the input JSON Schema of schema-backed args and flags, not the schema", async () => {
		const opaque = {
			"~standard": {
				version: 1 as const,
				vendor: "test",
				validate: (value: unknown) => ({ value }),
			},
		};
		const snapshot = await new Crust("cli")
			.args({ name: "level", schema: z.enum(["low", "high"]) })
			.flags({
				port: { type: "string", schema: z.coerce.number() },
				mode: { type: "string", schema: opaque },
				plain: { type: "string" },
			})
			.action(() => {})
			.snapshot();

		expect(snapshot.args[0]).toEqual({
			name: "level",
			required: true,
			inputSchema: {
				$schema: "https://json-schema.org/draft/2020-12/schema",
				type: "string",
				enum: ["low", "high"],
			},
		});
		expect(snapshot.flags.port?.inputSchema).toMatchObject({ type: "number" });
		expect(snapshot.flags.mode).not.toHaveProperty("inputSchema");
		// A schema that rejects a missing value makes it required; one that accepts it does not.
		expect(snapshot.flags.port?.required).toBe(true);
		expect(snapshot.flags.mode).not.toHaveProperty("required");
		expect(snapshot.flags.plain).not.toHaveProperty("inputSchema");
		expect(JSON.parse(JSON.stringify(snapshot)).args).toEqual(snapshot.args);
	});

	it("is serializable: no functions, URL defaults become strings", () => {
		const snapshot = snapshotCommand(buildTree());

		expect(snapshot.flags.endpoint?.default).toBe("https://example.com/");
		expect(snapshot.flags.mirrors?.default).toEqual(["https://a.example/", "https://b.example/"]);
		expect(Object.isFrozen(snapshot.flags.mirrors?.default)).toBe(true);
		// Round-trips through structuredClone (throws on functions)
		const clone = structuredClone(snapshot);
		expect(clone.args[0]?.name).toBe("file");
		expect("parse" in (clone.args[0] as object)).toBe(false);
	});

	it("owns frozen env names and the delimiter without exposing environment values", () => {
		const root = createCommandNode("cli");
		registerFlag(root, "token", { type: "string", env: "HOME", required: true }, "local");
		const env: [string, string] = ["CLI_TAGS", "TAGS"];
		registerFlag(root, "tags", { type: "string", multiple: true, env, delimiter: "," }, "local");
		env[0] = "CHANGED";
		const snapshot = snapshotCommand(root);

		expect(snapshot.flags.token).toEqual({
			type: "string",
			required: true,
			negatable: false,
			env: "HOME",
		});
		expect(snapshot.flags.tags).toMatchObject({ env: ["CLI_TAGS", "TAGS"], delimiter: "," });
		expect(Object.isFrozen(snapshot.flags.tags?.env)).toBe(true);
		expect(Object.isFrozen(root.effectiveFlags.tags?.env)).toBe(true);
		// HOME is set in every test environment; the snapshot must not leak it.
		expect(process.env.HOME).toBeTruthy();
		expect(JSON.stringify(snapshot)).not.toContain(JSON.stringify(process.env.HOME));
	});

	it("projects hidden, deprecated, and an exclusive group's members", async () => {
		const snapshot = await new Crust("cli")
			.flags({
				old: { type: "string", hidden: true, deprecated: "Use --new.", requires: ["scope"] },
				scope: {
					type: "exclusive",
					required: true,
					flags: { "org-id": { type: "string", short: "o" }, all: { type: "boolean" } },
				},
			})
			.add(defineCommand("scan", { deprecated: "Use `scout`." }, (c) => c.action(() => {})))
			.snapshot();
		expect(snapshot.flags).toEqual({
			old: {
				type: "string",
				negatable: false,
				hidden: true,
				deprecated: "Use --new.",
			},
			scope: {
				type: "exclusive",
				required: true,
				negatable: false,
				flags: {
					"org-id": { type: "string", short: "o", negatable: false },
					all: { type: "boolean", negatable: false },
				},
			},
		});
		expect(Object.isFrozen(snapshot.flags.scope?.flags)).toBe(true);
		expect(snapshot.subCommands.scan?.meta.deprecated).toBe("Use `scout`.");
	});

	it("marks the commands and flags an Extension contributes with its id", async () => {
		const tooling = defineExtensionId("tooling");
		const app = new Crust("cli")
			.flags({ verbose: { type: "boolean" } })
			.extend(
				defineExtension(tooling)
					.flags({ trace: { type: "boolean" }, root: { type: "boolean", recursive: false } })
					.add(
						defineCommand("manage", (command) =>
							command.command("sub", (sub) => sub.action(() => {})),
						),
					),
			)
			.add(defineCommand("build", (command) => command.action(() => {})));
		const snapshot = await app.snapshot();
		expect(snapshot.extension).toBeUndefined();
		expect(snapshot.flags.verbose?.extension).toBeUndefined();
		expect(snapshot.flags.root?.extension).toBe(tooling);
		const { build, manage } = snapshot.subCommands;
		expect(build?.extension).toBeUndefined();
		expect(build?.flags.trace?.extension).toBe(tooling);
		expect(manage?.extension).toBe(tooling);
		expect(manage?.subCommands.sub?.extension).toBe(tooling);
	});

	it("is deeply frozen", () => {
		const snapshot = snapshotCommand(buildTree());

		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(Object.isFrozen(snapshot.meta)).toBe(true);
		expect(Object.isFrozen(snapshot.args)).toBe(true);
		expect(Object.isFrozen(snapshot.flags)).toBe(true);
		expect(Object.isFrozen(snapshot.flags.verbose)).toBe(true);
		expect(Object.isFrozen(snapshot.subCommands)).toBe(true);
		expect(Object.isFrozen(snapshot.subCommands.build)).toBe(true);
	});
});

describe("keys packages add", () => {
	// A package's `ArgExtras`/`FlagExtras`/`CommandExtras` augmentation types these keys; core's
	// own sources have none, so the casts stand in for it. `tests/owned-keys.test.ts` checks the types.
	const complete = () => ["a", "b"];
	const flag = { type: "string", complete, choices: ["a", "b"] } as { type: "string" };

	it("passes them through to the snapshot unchanged, and never copies the keys core reads", () => {
		const root = createCommandNode("cli");
		root.meta = { name: "cli", mcp: { readOnly: true } } as typeof root.meta;
		root.args = [{ name: "file", type: "string", complete } as { name: string; type: "string" }];
		registerFlag(root, "mode", flag, "local");
		registerFlag(
			root,
			"scope",
			{ type: "exclusive", flags: { org: flag }, complete } as { type: "exclusive"; flags: {} },
			"local",
		);
		const snapshot = snapshotCommand(root);
		expect(snapshot.meta).toEqual({ name: "cli", mcp: { readOnly: true } });
		expect(snapshot.args).toEqual([{ name: "file", type: "string", complete }]);
		expect(snapshot.flags.mode).toEqual({
			type: "string",
			choices: ["a", "b"],
			negatable: false,
			complete,
		});
		expect(snapshot.flags.scope?.flags?.org).toMatchObject({ complete });
		expect(snapshot.flags.scope).toMatchObject({ complete });
	});

	it("passes them through on lazily projected children and Extension commands", async () => {
		const command = defineCommand("deploy", { mcp: false } as {}, (c) =>
			c.flags({ mode: flag }).action(() => {}),
		);
		const tool = defineExtension(defineExtensionId("tool")).add(
			defineCommand("serve", { mcp: false } as {}, (c) => c.action(() => {})),
		);
		const seen: unknown[] = [];
		const app = new Crust("cli")
			.extend(
				tool,
				// Owns the keys, so the definition check passes.
				defineExtension(defineExtensionId("owner"))
					.owns(...(["mcp", "complete"] as never[]))
					.postRun(({ rootCommand }) => {
						const deploy = rootCommand.subCommands.deploy!;
						seen.push((deploy.meta as { mcp?: unknown }).mcp);
						seen.push((deploy.flags.mode as { complete?: unknown }).complete);
					}),
			)
			.add(command)
			.action(() => {});
		const snapshot = await app.snapshot();
		expect(snapshot.subCommands.deploy?.meta).toMatchObject({ mcp: false });
		expect(snapshot.subCommands.serve?.meta).toMatchObject({ mcp: false });
		await app.run([]);
		expect(seen).toEqual([false, complete]);
	});

	it("leaves an argument's key alone when a flag field has its name", async () => {
		const env = { hint: "local" };
		const owned = { env, aliases: "abc", negatable: false, deprecated: "x" };
		const app = new Crust("cli")
			.extend(defineExtension(defineExtensionId("owner")).owns(...(Object.keys(owned) as never[])))
			.args({ name: "file", type: "string", required: true, ...(owned as object) })
			.action(() => {});
		const snapshot = await app.snapshot();
		expect(snapshot.args[0]).toEqual({ name: "file", type: "string", required: true, ...owned });
		expect(commandInputSchema(snapshot, [])).toEqual({
			type: "object",
			properties: { file: { type: "string" } },
			required: ["file"],
		});
	});

	it("keeps a key named `__proto__` as a field, not the prototype", () => {
		const root = createCommandNode("cli");
		const extra: object = JSON.parse('{"__proto__": {"injected": true}}');
		root.args = [{ name: "file", type: "string", ...extra }];
		registerFlag(root, "mode", { type: "string", ...extra }, "local");
		const snapshot = snapshotCommand(root);
		for (const def of [snapshot.args[0]!, snapshot.flags.mode!]) {
			expect(Object.getPrototypeOf(def)).toBe(Object.prototype);
			expect(Object.hasOwn(def, "__proto__")).toBe(true);
			expect("injected" in def).toBe(false);
		}
	});
});

describe("command metadata sections", () => {
	it("appends targeted Extension sections after authored sections in registration order", async () => {
		const first = defineExtension(defineExtensionId("first")).sections((snapshot) => {
			expect(snapshot.meta.sections).toEqual([{ title: "Root guide", body: "Root body" }]);
			expect(snapshot.subCommands.build).toBeDefined();
			expect(snapshot.subCommands.generated).toBeDefined();
			return [
				{ command: [], title: "First root", body: "First body" },
				{ command: ["build"], title: "First build", body: "Build body" },
				{
					command: ["generated"],
					title: "Generated guide",
					body: "Generated body",
				},
			];
		});
		const second = defineExtension(defineExtensionId("second"))
			.add(defineCommand("generated", (command) => command))
			.sections(() => [{ command: [], title: "Second root", body: "Second body" }]);
		const app = new Crust("cli", {
			sections: [{ title: "Root guide", body: "Root body" }],
		})
			.extend(first)
			.extend(second)
			.add(
				defineCommand(
					"build",
					{ sections: [{ title: "Build guide", body: "Authored body" }] },
					(command) => command.action(() => {}),
				),
			);

		const snapshot = await app.snapshot();

		expect(snapshot.meta.sections).toEqual([
			{ title: "Root guide", body: "Root body" },
			{ title: "First root", body: "First body" },
			{ title: "Second root", body: "Second body" },
		]);
		expect(snapshot.subCommands.build?.meta.sections).toEqual([
			{ title: "Build guide", body: "Authored body" },
			{ title: "First build", body: "Build body" },
		]);
		expect(snapshot.subCommands.generated?.meta.sections).toEqual([
			{ title: "Generated guide", body: "Generated body" },
		]);
		expect(Object.isFrozen(snapshot.meta.sections)).toBe(true);
		expect(Object.isFrozen(snapshot.meta.sections?.[0])).toBe(true);
		expect(() => structuredClone(snapshot)).not.toThrow();
	});

	it("keeps callback-free trees authored and shares one pre-contribution snapshot across callbacks", async () => {
		const authored = [{ title: "Root guide", body: "Root body" }];
		const seen: CommandSnapshot[] = [];
		const contribute = (name: string) =>
			defineExtension(defineExtensionId(name)).sections((snapshot) => {
				seen.push(snapshot);
				return [{ command: [], title: name, body: `${name} body` }];
			});
		const plain = new Crust("cli", { sections: authored })
			.extend(defineExtension(defineExtensionId("silent")).flags({ extra: { type: "boolean" } }))
			.add(defineCommand("build", (command) => command.action(() => {})));
		const contributed = plain.extend(contribute("first")).extend(contribute("second"));

		// No callback: the snapshot is purely authored.
		const plainSnapshot = await plain.snapshot();
		expect(plainSnapshot.meta.sections).toEqual(authored);
		expect(plainSnapshot.flags.extra?.type).toBe("boolean");

		// Callbacks: each one receives the same pre-contribution snapshot; derived builders stay isolated.
		const contributedSnapshot = await contributed.snapshot();
		expect(seen).toHaveLength(2);
		expect(seen[1]).toBe(seen[0]);
		expect(seen[0]?.meta.sections).toEqual(authored);
		expect(seen[0]?.flags.extra?.type).toBe("boolean");
		expect(contributedSnapshot.meta.sections).toEqual([
			...authored,
			{ title: "first", body: "first body" },
			{ title: "second", body: "second body" },
		]);
		expect((await plain.snapshot()).meta.sections).toEqual(authored);
	});

	it("normalizes object and mixed section consumers for authored and contributed sections", async () => {
		const agentDocs = defineExtension(defineExtensionId("agent-docs"));
		const terminal = defineExtensionId("terminal");
		const app = new Crust("cli")
			.add(
				defineCommand(
					"build",
					{
						sections: [{ title: "Agent notes", body: "Agent body", only: [agentDocs] }],
					},
					(command) => command,
				),
			)
			.extend(
				defineExtension(defineExtensionId("docs")).sections(() => [
					{
						command: ["build"],
						title: "Human notes",
						body: "Human body",
						except: [agentDocs.id, { id: terminal }],
					},
				]),
			);

		const snapshot = await app.snapshot();
		const sections = snapshot.subCommands.build?.meta.sections;

		expect(sections).toEqual([
			{ title: "Agent notes", body: "Agent body", only: [agentDocs.id] },
			{ title: "Human notes", body: "Human body", except: [agentDocs.id, terminal] },
		]);
		expect(Object.isFrozen(sections?.[0]?.only)).toBe(true);
		const clonedSections = structuredClone(snapshot).subCommands.build?.meta.sections;
		expect(clonedSections?.[0]?.only).toEqual([agentDocs.id]);
		expect(clonedSections?.[1]?.except).toEqual([agentDocs.id, terminal]);
	});

	it("rejects unknown and aliased contribution paths", async () => {
		for (const command of [["missing"], ["b"], ["constructor"], ["__proto__"], ["toString"]]) {
			const app = new Crust("cli")
				.extend(
					defineExtension(defineExtensionId("docs")).sections(() => [
						{ command, title: "Notes", body: "Body" },
					]),
				)
				.add(defineCommand("build", { aliases: ["b"] }, (builder) => builder));

			const rejection = {
				code: "DEFINITION",
				details: {
					subject: "extension",
					name: "docs",
					reason: "invalid-section-path",
				},
			};
			await expect(app.snapshot()).rejects.toMatchObject(rejection);
			// Contributions are validated at preparation, so an ordinary run fails too.
			expect(await app.run(["build"])).toMatchObject({ status: "failed", error: rejection });
		}
	});

	it("prepares only the routed path when an Extension contributes sections", async () => {
		const configured: string[] = [];
		const failure = new Error("broken recipe");
		const app = new Crust("cli")
			.extend(
				defineExtension(defineExtensionId("docs")).sections((snapshot) => [
					{ command: ["good"], title: "About", body: snapshot.meta.name },
				]),
			)
			.add(
				defineCommand("good", (command) => {
					configured.push("good");
					return command.action(({ command }) => command.meta.sections);
				}),
				defineCommand("bad", () => {
					configured.push("bad");
					throw failure;
				}),
			);

		expect(await app.run(["good"])).toMatchObject({
			status: "completed",
			result: [{ title: "About", body: "cli" }],
		});
		expect(configured).toEqual(["good"]);
		await expect(app.snapshot()).rejects.toBe(failure);
	});

	it("keeps Extension sections out of the authored snapshot, even when read later", async () => {
		let authored: CommandSnapshot | undefined;
		const seen: CommandSnapshot[] = [];
		const app = new Crust("cli", { sections: [{ title: "Root guide", body: "Root body" }] })
			.extend(
				defineExtension(defineExtensionId("docs"))
					.sections((snapshot) => {
						authored = snapshot;
						return [
							{ command: [], title: "Root extra", body: "x" },
							{ command: ["build"], title: "Build extra", body: "y" },
						];
					})
					.preRun((ctx) => {
						seen.push(ctx.rootCommand);
					}),
			)
			.add(defineCommand("build", (command) => command.action(() => {})));

		// Twice: the second run may reuse projections across invocations.
		await app.run(["build"]);
		await app.run(["build"]);

		for (const root of seen) {
			expect(root.meta.sections?.map(({ title }) => title)).toEqual(["Root guide", "Root extra"]);
			expect(root.subCommands.build?.meta.sections).toEqual([{ title: "Build extra", body: "y" }]);
		}
		expect(authored?.meta.sections).toEqual([{ title: "Root guide", body: "Root body" }]);
		expect(authored?.subCommands.build?.meta.sections).toBeUndefined();

		// A childless root is fully built at preparation, so it is eligible for shared projections.
		const solo = new Crust("solo").extend(
			defineExtension(defineExtensionId("docs"))
				.sections(() => [{ command: [], title: "Root extra", body: "x" }])
				.setup((ctx) => {
					seen.push(ctx.rootCommand);
				}),
		);
		await solo.run([]);
		expect(seen.at(-1)?.meta.sections).toEqual([{ title: "Root extra", body: "x" }]);
	});

	it("rejects malformed authored section data", () => {
		const badSections = [[{ title: "   ", body: "Body" }], [{ title: "Notes", body: "" }]];
		for (const sections of badSections) {
			expect(() => new Crust("cli", { sections })).toThrow(
				expect.objectContaining({
					code: "DEFINITION",
					details: {
						subject: "command",
						name: "cli",
						reason: "invalid-sections",
					},
				}),
			);
		}
	});

	it("rejects CR/LF in authored and contributed section titles", async () => {
		expect(
			() => new Crust("cli", { sections: [{ title: "Injected\nheading", body: "Body" }] }),
		).toThrow(CrustError);
		const contributed = new Crust("cli").extend(
			defineExtension(defineExtensionId("docs")).sections(() => [
				{ command: [], title: "Injected\rheading", body: "Body" },
			]),
		);

		await expect(contributed.snapshot()).rejects.toMatchObject({
			code: "DEFINITION",
			details: {
				subject: "extension",
				name: "docs",
				reason: "invalid-sections",
			},
		});
	});
});
