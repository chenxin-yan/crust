import type { StandardSchema } from "@crustjs/utils/schema";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { executeCrust, unwrap } from "../../tests/helpers.ts";

type StandardInput = Parameters<StandardSchema["~standard"]["validate"]>[0];

import { defineExtension } from "../api/extension.ts";
import { Crust } from "../command/crust.ts";
import { CrustError } from "../errors.ts";
import { defineExtensionId } from "../identity.ts";

/** Minimal hand-rolled Standard Schema (no vendor dependency). */
function schema<Input, Output>(
	validate: (value: Input) => { value: Output } | { issues: { message: string }[] },
): StandardSchema<Input, Output> {
	return {
		"~standard": {
			version: 1,
			vendor: "crust-test",
			validate: (value: StandardInput) => validate(value as Input),
		},
	};
}

const port = () =>
	schema<string | undefined, number>((raw) => {
		if (raw === undefined) return { issues: [{ message: "port is required" }] };
		const value = Number(raw);
		return Number.isInteger(value) && value > 0
			? { value }
			: { issues: [{ message: "expected a positive integer" }] };
	});

describe("Standard Schema on arg definitions", () => {
	it("schema owns requiredness: a missing arg reaches the schema as undefined", async () => {
		const app = new Crust("cli").args({ name: "port", schema: port() }).action(() => {});

		await expect(unwrap(app.run([]))).rejects.toMatchObject({
			code: "VALIDATION",
			details: { issues: [{ message: "port is required", path: "args.port" }] },
		});
	});

	it("variadic schema args receive the raw string array", async () => {
		let received: string[] | undefined;
		const upper = schema<string[], string[]>((raw) => ({
			value: raw.map((s) => s.toUpperCase()),
		}));

		const app = new Crust("cli")
			.args({ name: "files", variadic: true, schema: upper })
			.action(({ args }) => {
				received = args.files;
			});

		await unwrap(app.run([], { args: { files: ["a.txt", "b.txt"] } }));
		expect(received).toEqual(["A.TXT", "B.TXT"]);
	});

	it("supports async schema validation", async () => {
		let received: string | undefined;
		const asyncUpper = schema<string | undefined, string>((raw) => ({
			value: String(raw).toUpperCase(),
		}));
		const asyncSchema: StandardSchema<string | undefined, string> = {
			"~standard": {
				version: 1,
				vendor: "crust-test",
				validate: async (value: StandardInput) => asyncUpper["~standard"].validate(value),
			},
		};

		const app = new Crust("cli").args({ name: "name", schema: asyncSchema }).action(({ args }) => {
			received = args.name;
		});

		await unwrap(app.run([], { args: { name: "chenxin" } }));
		expect(received).toBe("CHENXIN");
	});
});

describe("Standard Schema on flag definitions", () => {
	it("string flags consume a token and pass the raw string to the schema", async () => {
		let received: number | undefined;
		const app = new Crust("cli")
			.flags({ port: { type: "string", schema: port() } })
			.action(({ flags }) => {
				received = flags.port;
			});

		await unwrap(app.run([], { flags: { port: "9090" } }));
		expect(received).toBe(9090);

		received = undefined;
		const result = await executeCrust(app, ["--port", "9090"]);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(received).toBe(9090);
	});

	it("boolean flags do not consume a token and pass the raw boolean to the schema", async () => {
		let received: "on" | "off" | undefined;
		let positional: string | undefined;
		const onOff = schema<boolean | undefined, "on" | "off">((raw) => ({
			value: raw === true ? "on" : "off",
		}));
		const app = new Crust("cli")
			.flags({ loud: { type: "boolean", schema: onOff } })
			.args({ name: "sentinel", type: "string" })
			.action(({ args, flags }) => {
				received = flags.loud;
				positional = args.sentinel;
			});

		await unwrap(app.run([], { flags: { loud: true } }));
		expect(received).toBe("on");

		await unwrap(app.run([]));
		expect(received).toBe("off");

		received = undefined;
		const result = await executeCrust(app, ["--loud", "sentinel"]);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(received).toBe("on");
		expect(positional).toBe("sentinel");
	});

	it("aggregates issues across args and flags into one VALIDATION error", async () => {
		const app = new Crust("cli")
			.args({ name: "input", schema: port() })
			.flags({ port: { type: "string", schema: port() } })
			.action(() => {});

		const outcome = await app.run([], { args: { input: "oops" }, flags: { port: "nope" } });
		expect(outcome.status).toBe("failed");
		if (outcome.status !== "failed") throw new Error("Expected failure");
		expect(outcome.error).toBeInstanceOf(CrustError);
		if (!(outcome.error instanceof CrustError) || !outcome.error.is("VALIDATION"))
			throw outcome.error;
		expect(outcome.error.details?.issues.map((issue) => issue.path).sort()).toEqual([
			"args.input",
			"flags.port",
		]);
	});

	it("multiple schema flags receive the raw value array", async () => {
		let received: string | undefined;
		const csv = schema<string[] | undefined, string>((raw) => ({
			value: (raw ?? []).join(","),
		}));
		const app = new Crust("cli")
			.flags({ tag: { type: "string", multiple: true, schema: csv } })
			.action(({ flags }) => {
				received = flags.tag;
			});

		await unwrap(app.run([], { flags: { tag: ["a", "b"] } }));
		expect(received).toBe("a,b");
	});
});

describe("Standard Schema on json flags", () => {
	const user = z.object({ name: z.string(), role: z.enum(["admin", "member"]).optional() });
	function bodyApp() {
		const received: { body?: z.output<typeof user> } = {};
		const app = new Crust("cli")
			.flags({ body: { type: "json", schema: user.optional() } })
			.action(({ flags }) => {
				received.body = flags.body;
			});
		return { app, received };
	}

	it("parses the argv token as JSON and passes the parsed value to the schema", async () => {
		const { app, received } = bodyApp();
		const result = await executeCrust(app, ["--body", '{"name":"a","role":"admin"}']);
		expect(result.exitCode, result.stderr).toBe(0);
		expect(received.body).toEqual({ name: "a", role: "admin" });
	});

	it("takes a JSON value from run() and rejects one the schema refuses, naming the flag", async () => {
		const { app, received } = bodyApp();
		await unwrap(app.run([], { flags: { body: { name: "a" } } }));
		expect(received.body).toEqual({ name: "a" });

		await expect(
			unwrap(app.run([], { flags: { body: JSON.parse('{"role":"owner"}') } })),
		).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("flags.body.role:"),
		});
		await expect(
			// @ts-expect-error -- a URL is no JSON value
			unwrap(app.run([], { flags: { body: [new URL("https://a.test")] } })),
		).rejects.toMatchObject({
			code: "PARSE",
			message: "Expected a JSON value for --body.",
		});
	});

	it("rejects a run() value that is not JSON data, even when the schema input allows it", async () => {
		let reached = false;
		const app = new Crust("cli")
			.flags({ data: { type: "json", schema: z.unknown() } })
			.action(() => {
				reached = true;
			});
		const notJson = [
			new Date(0),
			1n,
			() => {},
			new Map(),
			{ site: new URL("https://a.test") },
			[undefined],
		];
		for (const data of notJson) {
			await expect(unwrap(app.run([], { flags: { data } }))).rejects.toMatchObject({
				code: "PARSE",
				message: "Expected a JSON value for --data.",
			});
		}
		expect(reached).toBe(false);
	});

	it("reports invalid JSON text without echoing it", async () => {
		const { app } = bodyApp();
		const result = await executeCrust(app, ["--body", "{secret"]);
		expect(result.exitCode).toBe(2);
		expect(result.stderr).toContain("Invalid JSON for --body");
		expect(result.stderr).not.toContain("secret");
	});
});

describe("schema interaction with Extensions", () => {
	it("pre-run hooks observe raw values while the action sees schema outputs", async () => {
		let preRunSaw: unknown;
		let actionSaw: unknown;

		const probe = defineExtension(defineExtensionId("probe")).preRun((ctx) => {
			preRunSaw = (ctx.flags as Record<string, unknown>).port;
		});

		const app = new Crust("cli")
			.flags({ port: { type: "string", schema: port() } })
			.extend(probe)
			.action(({ flags }) => {
				actionSaw = flags.port;
			});

		await unwrap(app.run([], { flags: { port: "8080" } }));

		expect(preRunSaw).toBe("8080"); // raw, pre-validation
		expect(actionSaw).toBe(8080); // schema output
	});

	it("a flag handler skips schema validation entirely", async () => {
		let validated = false;
		const spy = schema<string | undefined, string>((raw) => {
			validated = true;
			return { value: String(raw) };
		});
		const gate = defineExtension(defineExtensionId("gate"))
			.flags({ stop: { type: "boolean" } })
			.handle("stop", () => {});

		const app = new Crust("cli")
			.flags({ x: { type: "string", schema: spy } })
			.extend(gate)
			.action(() => {});

		await unwrap(app.run([], { flags: { x: "whatever", stop: true } }));
		expect(validated).toBe(false);
	});
});
