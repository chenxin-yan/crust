import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

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
	it("passes the raw string token to the schema and hands the output to the action", async () => {
		let received: number | undefined;
		const app = new Crust("cli").args({ name: "port", schema: port() }).action(({ args }) => {
			received = args.port;
		});

		expect((await app.run([], { args: { port: "8080" } })).status).not.toBe("failed");
		expect(received).toBe(8080);
	});

	it("delivers a successful schema output of literal undefined to the action", async () => {
		let received: string | undefined = "untouched";
		const toUndefined = schema<string, undefined>(() => ({ value: undefined }));
		const app = new Crust("cli").args({ name: "port", schema: toUndefined }).action(({ args }) => {
			received = args.port;
		});

		expect((await app.run([], { args: { port: "8080" } })).status).not.toBe("failed");
		expect(received).toBeUndefined();
	});

	it("schema owns requiredness: a missing arg reaches the schema as undefined", async () => {
		const app = new Crust("cli").args({ name: "port", schema: port() }).action(() => {});

		await expect(app.run([])).resolves.toMatchObject({
			status: "failed",
			error: {
				code: "VALIDATION",
				details: { issues: [{ message: "port is required", path: "args.port" }] },
			},
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

		expect((await app.run([], { args: { files: ["a.txt", "b.txt"] } })).status).not.toBe("failed");
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

		expect((await app.run([], { args: { name: "chenxin" } })).status).not.toBe("failed");
		expect(received).toBe("CHENXIN");
	});
});

describe("Standard Schema on flag definitions", () => {
	it("string flags consume a token and pass the raw string to the schema", async () => {
		let received: number | undefined;
		const app = new Crust("cli")
			.flags({ name: "port", type: "string", schema: port() })
			.action(({ flags }) => {
				received = flags.port;
			});

		expect((await app.run([], { flags: { port: "9090" } })).status).not.toBe("failed");
		expect(received).toBe(9090);
	});

	it("boolean flags do not consume a token and pass the raw boolean to the schema", async () => {
		let received: "on" | "off" | undefined;
		const onOff = schema<boolean | undefined, "on" | "off">((raw) => ({
			value: raw === true ? "on" : "off",
		}));
		const app = new Crust("cli")
			.flags({ name: "loud", type: "boolean", schema: onOff })
			.action(({ flags }) => {
				received = flags.loud;
			});

		expect((await app.run([], { flags: { loud: true } })).status).not.toBe("failed");
		expect(received).toBe("on");

		expect((await app.run([])).status).not.toBe("failed");
		expect(received).toBe("off");
	});

	it("aggregates issues across args and flags into one VALIDATION error", async () => {
		const app = new Crust("cli")
			.args({ name: "input", schema: port() })
			.flags({ name: "port", type: "string", schema: port() })
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

	it("--no-<name> negation delivers raw false to a schema boolean flag", async () => {
		let received: string | undefined;
		const probe = schema<boolean | undefined, string>((raw) => ({ value: String(raw) }));
		const app = new Crust("cli")
			.flags({ name: "loud", type: "boolean", schema: probe })
			.action(({ flags }) => {
				received = flags.loud;
			});

		expect((await app.run([], { flags: { loud: false } })).status).not.toBe("failed");
		expect(received).toBe("false");
	});

	it("multiple schema flags receive the raw value array", async () => {
		let received: string | undefined;
		const csv = schema<string[] | undefined, string>((raw) => ({
			value: (raw ?? []).join(","),
		}));
		const app = new Crust("cli")
			.flags({ name: "tag", type: "string", multiple: true, schema: csv })
			.action(({ flags }) => {
				received = flags.tag;
			});

		expect((await app.run([], { flags: { tag: ["a", "b"] } })).status).not.toBe("failed");
		expect(received).toBe("a,b");
	});
});

describe("schema interaction with Extensions", () => {
	it("pre-run hooks observe raw values while the action sees schema outputs", async () => {
		let preRunSaw: unknown;
		let actionSaw: unknown;

		const probe = defineExtension(defineExtensionId("probe"), {
			hooks: {
				preRun(ctx) {
					preRunSaw = ctx.flags.port;
				},
			},
		});

		const app = new Crust("cli")
			.flags({ name: "port", type: "string", schema: port() })
			.extend(probe)
			.action(({ flags }) => {
				actionSaw = flags.port;
			});

		expect((await app.run([], { flags: { port: "8080" } })).status).not.toBe("failed");

		expect(preRunSaw).toBe("8080"); // raw, pre-validation
		expect(actionSaw).toBe(8080); // schema output
	});

	it("a pre-run finish skips schema validation entirely", async () => {
		let validated = false;
		const spy = schema<string | undefined, string>((raw) => {
			validated = true;
			return { value: String(raw) };
		});
		const gate = defineExtension(defineExtensionId("gate"), {
			hooks: { preRun: (ctx) => ctx.finish() },
		});

		const app = new Crust("cli")
			.flags({ name: "x", type: "string", schema: spy })
			.extend(gate)
			.action(() => {});

		expect((await app.run([], { flags: { x: "whatever" } })).status).not.toBe("failed");
		expect(validated).toBe(false);
	});
});
