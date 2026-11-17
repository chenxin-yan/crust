// Generated commands are ordinary app commands: schema(), --llms, skills and MCP describe and run
// them like the commands an app writes.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Crust } from "@crustjs/core";
import { schema } from "@crustjs/extensions";
import { createMcpServer } from "@crustjs/mcp";
import { writeSkills } from "@crustjs/skills";
import { captureExecute } from "@crustjs/testing";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { defineApi } from "../src/index.ts";

const acme = defineApi({
	spec: {
		openapi: "3.1.0",
		paths: {
			"/users": {
				get: {
					operationId: "listUsers",
					tags: ["Users"],
					summary: "List users",
					responses: { "200": { description: "OK" } },
				},
				post: {
					operationId: "createUser",
					tags: ["Users"],
					summary: "Create a user",
					requestBody: {
						required: true,
						content: { "application/json": { schema: { $ref: "#/components/schemas/NewUser" } } },
					},
					responses: {
						"201": {
							description: "Created",
							content: { "application/json": { schema: { $ref: "#/components/schemas/User" } } },
						},
					},
				},
			},
		},
		components: {
			schemas: {
				Profile: { type: "object", properties: { bio: { type: "string" } } },
				NewUser: {
					type: "object",
					required: ["name"],
					properties: {
						name: { type: "string" },
						profile: { $ref: "#/components/schemas/Profile" },
					},
				},
				User: {
					type: "object",
					properties: { id: { type: "string" }, profile: { $ref: "#/components/schemas/Profile" } },
				},
			},
		},
	},
	baseUrl: "https://api.example.com/v1/",
}).override({ listUsers: { hidden: true } });

const app = new Crust("acme", { description: "Acme" })
	.extend(schema(), acme.extension)
	.add(...acme.commands);

const body = {
	description: "The request body as JSON; body field flags are merged over it",
	type: "object",
	properties: {
		name: { type: "string" },
		profile: { type: "object", properties: { bio: { type: "string" } } },
	},
};
const user = {
	type: "object",
	properties: {
		id: { type: "string" },
		profile: { type: "object", properties: { bio: { type: "string" } } },
	},
};

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
	vi.unstubAllGlobals();
	for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("generated commands in their consumers", () => {
	it("schema() prints the standalone body and output schemas", async () => {
		const { stdout } = await captureExecute(app, ["schema", "users", "create-user"]);
		const printed = JSON.parse(stdout) as {
			input: { properties: Record<string, unknown> };
			output: unknown;
		};

		expect(printed.input.properties.body).toEqual(body);
		expect(printed.input.properties.name).toEqual({ type: "string" });
		expect(printed.output).toEqual(user);
	});

	it("--llms indexes the visible generated commands, not a hidden one", async () => {
		const { stdout } = await captureExecute(app, ["--llms"]);

		expect(stdout).toContain("users create-user");
		expect(stdout).not.toContain("list-users");
	});

	it("skills render the visible generated commands", async () => {
		const outDir = join(mkdtempSync(join(tmpdir(), "crust-openapi-skills-")), "skills");
		cleanups.push(() => rmSync(outDir, { recursive: true, force: true }));
		await writeSkills({ app, outDir });
		const text = readdirSync(outDir, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
			.join("\n");

		expect(text).toContain("users create-user");
		expect(text).not.toContain("list-users");
	});

	it("MCP lists the visible generated commands as tools by default and calls one", async () => {
		const calls: { url: string; body: string }[] = [];
		vi.stubGlobal("fetch", async (url: URL, init: RequestInit) => {
			calls.push({ url: url.href, body: String(init.body) });
			return Response.json({ id: "1", profile: { bio: "hi" } }, { status: 201 });
		});
		const server = await createMcpServer(app);
		const client = new Client({ name: "test-client", version: "0.0.0" });
		const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
		await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
		cleanups.push(async () => {
			await client.close();
			await server.close();
		});

		const { tools } = await client.listTools();
		const create = tools.find((tool) => tool.name === "users_create-user");
		const result = await client.callTool({
			name: "users_create-user",
			arguments: { name: "Ada", body: { profile: { bio: "hi" } } },
		});

		// The `api` command is the Extension's, so it is not a tool; the hidden command is left out.
		expect(tools.map((tool) => tool.name)).toEqual(["users_create-user"]);
		expect(create?.inputSchema.properties?.body).toEqual(body);
		expect(create?.outputSchema).toEqual(user);
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toEqual({ id: "1", profile: { bio: "hi" } });
		expect(calls).toEqual([
			{
				url: "https://api.example.com/v1/users",
				body: '{"profile":{"bio":"hi"},"name":"Ada"}',
			},
		]);
	});

	it("MCP lists api preview only when included, as a tool whose result is the preview", async () => {
		vi.stubGlobal("fetch", () => {
			throw new Error("fetch called");
		});
		const connect = async (include?: readonly (readonly string[])[]) => {
			const server = await createMcpServer(app, include === undefined ? {} : { include });
			const client = new Client({ name: "test-client", version: "0.0.0" });
			const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
			await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
			cleanups.push(async () => {
				await client.close();
				await server.close();
			});
			return client;
		};

		const hidden = await (await connect()).listTools();
		const client = await connect([["api", "preview"]]);
		const { tools } = await client.listTools();
		const result = await client.callTool({
			name: "api_preview",
			arguments: { target: ["users", "create-user"], argv: ["--name", "Ada"] },
		});

		expect(hidden.tools.map((tool) => tool.name)).not.toContain("api_preview");
		expect(tools.map((tool) => tool.name)).toContain("api_preview");
		expect(tools.find((tool) => tool.name === "api_preview")?.outputSchema).toMatchObject({
			required: ["method", "url", "headers", "bodyKind", "body"],
		});
		expect(result.isError).toBeUndefined();
		expect(result.structuredContent).toEqual({
			method: "POST",
			url: "https://api.example.com/v1/users",
			headers: { accept: "application/json", "content-type": "application/json" },
			bodyKind: "json",
			body: { name: "Ada" },
		});
	});

	it("schema() describes api preview with the preview's output schema", async () => {
		const { stdout } = await captureExecute(app, ["schema", "api", "preview"]);

		expect(JSON.parse(stdout)).toMatchObject({
			output: { required: ["method", "url", "headers", "bodyKind", "body"] },
		});
	});
});
