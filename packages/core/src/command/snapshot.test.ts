import { describe, expect, it } from "vite-plus/test";

import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";
import { prepareInvocation } from "./invocation.ts";
import { createCommandNode, registerFlag } from "./node.ts";
import { snapshotCommand, type CommandSnapshot } from "./snapshot.ts";

function buildTree() {
	const root = createCommandNode("cli");
	root.meta.description = "root cli";
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
	it("projects meta, args, flags, and subcommands recursively", () => {
		const snapshot = snapshotCommand(buildTree());

		expect(snapshot.meta.name).toBe("cli");
		expect(snapshot.meta.description).toBe("root cli");
		expect(snapshot.hasAction).toBe(true);
		expect(snapshot.args).toEqual([{ name: "file", type: "string", required: true }]);
		expect(snapshot.flags.verbose).toEqual({
			type: "boolean",
			short: "v",
			description: "Verbose output",
			negatable: true,
		});
		expect(snapshot.flags.endpoint?.negatable).toBe(false);
		expect(snapshot.subCommands.build?.meta.aliases).toEqual(["b"]);
		expect(snapshot.subCommands.build?.meta.hidden).toBe(true);
		expect(snapshot.subCommands.build?.hasAction).toBe(false);
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

	it("projects Context-owned flags at the provider and later descendants", async () => {
		const apiKey = defineFlag({ type: "string", short: "k" });
		const auth = defineContext("auth")
			.flags({ "api-key": apiKey })
			.setup(() => ({}));
		const app = new Crust("cli")
			.provide(auth())
			.add(defineCommand("deploy", (command) => command.action(() => {})));

		const snapshot = await app.snapshot();
		expect(snapshot.flags["api-key"]).toEqual({
			type: "string",
			short: "k",
			negatable: false,
		});
		expect(snapshot.subCommands.deploy?.flags["api-key"]).toEqual(snapshot.flags["api-key"]);
		expect(Object.isFrozen(snapshot.subCommands.deploy?.flags["api-key"])).toBe(true);
		expect(() => structuredClone(snapshot)).not.toThrow();
	});

	it("owns frozen env bindings and independent delimiters without exposing environment values", () => {
		const root = createCommandNode("cli");
		registerFlag(root, "token", { type: "string", env: { name: "HOME" }, required: true }, "local");
		const env = { name: "CLI_TAGS", delimiter: ":" };
		Object.defineProperty(env, "name", { enumerable: false });
		registerFlag(root, "tags", { type: "string", multiple: true, env, delimiter: "," }, "local");
		env.name = "CHANGED";
		env.delimiter = ";";
		const snapshot = snapshotCommand(root);

		expect(snapshot.flags.token).toEqual({
			type: "string",
			required: true,
			negatable: false,
			env: { name: "HOME" },
		});
		expect(snapshot.flags.tags).toMatchObject({
			env: { name: "CLI_TAGS", delimiter: ":" },
			delimiter: ",",
		});
		expect(Object.isFrozen(snapshot.flags.tags?.env)).toBe(true);
		expect(Object.isFrozen(root.effectiveFlags.tags?.env)).toBe(true);
		// HOME is set in every test environment; the snapshot must not leak it.
		expect(process.env.HOME).toBeTruthy();
		expect(JSON.stringify(snapshot)).not.toContain(JSON.stringify(process.env.HOME));
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

	it("freezes callback-free trees and shares one pre-contribution snapshot across callbacks", async () => {
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

		// No callback: the prepared tree is still frozen and the snapshot is purely authored.
		const prepared = prepareInvocation(plain._node, () => {
			throw new Error("no Extension commands to materialize");
		}).rootNode;
		expect(Object.isFrozen(prepared)).toBe(true);
		expect(Object.isFrozen(prepared.meta.sections)).toBe(true);
		expect(Object.isFrozen(prepared.subCommands.build)).toBe(true);
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
		const badSections = [
			[{ title: "   ", body: "Body" }],
			[{ title: "Notes", body: "" }],
			[{ title: "Notes", body: "Body", only: [] }],
			[{ title: "Notes", body: "Body", except: [] }],
		];
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
			// @ts-expect-error -- known-invalid static contract; runtime regression deliberately exercises the consuming check.
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
