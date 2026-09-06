import { describe, expect, it } from "bun:test";

import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineFlag } from "../api/flags.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";
import { Crust, defineCommand } from "./crust.ts";
import { createCommandNode, registerFlag } from "./node.ts";
import { snapshotCommand } from "./snapshot.ts";

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
		const apiKey = defineFlag("api-key", { type: "string", short: "k" });
		const auth = defineContext("auth", { flags: [apiKey] }, () => ({}));
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
	it("rejects a dynamic section carrying both only and except", () => {
		const agentDocs = defineExtensionId("agent-docs");
		// Dynamic path: the SectionAudience union owns literals, but a
		// config-built object can carry both fields — runtime must reject it.
		const section = JSON.parse(
			JSON.stringify({ title: "T", body: "B", only: [agentDocs], except: [agentDocs] }),
		) as { title: string; body: string };
		expect(() => new Crust("cli", { sections: [section] })).toThrow(
			"contains invalid documentation sections",
		);
	});

	it("appends targeted Extension sections after authored sections in registration order", async () => {
		const first = defineExtension(defineExtensionId("first"), {
			sections(snapshot) {
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
			},
		});
		const second = defineExtension(defineExtensionId("second"), {
			commands: [defineCommand("generated", (command) => command)],
			sections: () => [{ command: [], title: "Second root", body: "Second body" }],
		});
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

	it("normalizes object and mixed section consumers for authored and contributed sections", async () => {
		const agentDocs = defineExtension(defineExtensionId("agent-docs"), {});
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
				defineExtension(defineExtensionId("docs"), {
					sections: () => [
						{
							command: ["build"],
							title: "Human notes",
							body: "Human body",
							except: [agentDocs.id, { id: terminal }],
						},
					],
				}),
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
					defineExtension(defineExtensionId("docs"), {
						sections: () => [{ command, title: "Notes", body: "Body" }],
					}),
				)
				.add(defineCommand("build", { aliases: ["b"] }, (builder) => builder));

			await expect(app.snapshot()).rejects.toMatchObject({
				code: "DEFINITION",
				details: {
					subject: "extension",
					name: "docs",
					reason: "invalid-section-path",
				},
			});
		}
	});

	it("rejects malformed authored section data", () => {
		const badSections: unknown[] = [
			[{ title: "", body: "Body" }],
			[{ title: "   ", body: "Body" }],
			[{ title: "Notes", body: "" }],
			[{ title: 1, body: "Body" }],
			[{ title: "Notes", body: null }],
			[{ title: "Notes", body: "Body", only: [], except: ["terminal"] }],
			[{ title: "Notes", body: "Body", only: "terminal" }],
			[{ title: "Notes", body: "Body", only: [] }],
			[{ title: "Notes", body: "Body", except: [] }],
			[{ title: "Notes", body: "Body", only: [{}] }],
			[{ title: "Notes", body: "Body", only: [{ id: "" }] }],
			[{ title: "Notes", body: "Body", only: [{ id: " terminal " }] }],
			[{ title: "Notes", body: "Body", except: [1] }],
			[{ title: "Notes", body: "Body", only: ["   "] }],
			[null],
		];
		for (const sections of badSections) {
			expect(() => new Crust("cli", { sections: sections as never })).toThrow(
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

	it("rejects malformed Extension section contributions", async () => {
		const badReturns: unknown[] = [
			{ command: [], title: "Notes", body: "Body" }, // not an array
			[{ title: "Notes", body: "Body" }], // missing command
			[{ command: "build", title: "Notes", body: "Body" }],
			[{ command: [1], title: "Notes", body: "Body" }],
			[{ command: [], title: "", body: "Body" }],
			[{ command: [], title: "Notes", body: "   " }],
			[{ command: [], title: "Notes", body: "Body", only: [], except: [] }],
			[{ command: [], title: "Notes", body: "Body", only: "terminal" }],
			[{ command: [], title: "Notes", body: "Body", only: [] }],
			[{ command: [], title: "Notes", body: "Body", only: [null] }],
			[{ command: [], title: "Notes", body: "Body", only: [{ id: 1 }] }],
		];
		for (const contributions of badReturns) {
			const app = new Crust("cli").extend(
				defineExtension(defineExtensionId("docs"), {
					sections: () => contributions as never,
				}),
			);
			await expect(app.snapshot()).rejects.toMatchObject({
				code: "DEFINITION",
				details: {
					subject: "extension",
					name: "docs",
					reason: "invalid-sections",
				},
			});
		}
	});

	it("rejects CR/LF in authored and contributed section titles", async () => {
		expect(
			() => new Crust("cli", { sections: [{ title: "Injected\nheading", body: "Body" }] }),
		).toThrow(CrustError);
		const contributed = new Crust("cli").extend(
			defineExtension(defineExtensionId("docs"), {
				sections: () => [{ command: [], title: "Injected\rheading", body: "Body" }],
			}),
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
