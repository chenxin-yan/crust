import type { StandardSchema } from "@crustjs/utils/schema";
import { describe, expect, it } from "vite-plus/test";

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
	it("passes the raw string token to the schema and hands the output to the action", async () => {
		let received: number | undefined;
		const app = new Crust("cli").args({ name: "port", schema: port() }).action(({ args }) => {
			received = args.port;
		});

		await unwrap(app.run([], { args: { port: "8080" } }));
		expect(received).toBe(8080);
	});

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

	it("reports a sensitive field's issues with a fixed message and keeps other issues", async () => {
		const SECRET = "SENTINEL-s3cr3t";
		// Issue messages and paths may quote the value they reject.
		const echoing = schema<string | undefined, string>((raw) => ({
			issues: [{ message: `rejected ${raw}`, path: [String(raw)] }],
		}));
		const app = new Crust("cli")
			.args({ name: "password", schema: echoing, sensitive: true })
			.flags({
				token: { type: "string", schema: echoing, sensitive: true },
				port: { type: "string", schema: port() },
			})
			.action(() => {});

		const outcome = await app.run([], {
			args: { password: SECRET },
			flags: { token: SECRET, port: "nope" },
		});
		if (outcome.status !== "failed") throw new Error("Expected failure");
		const error = outcome.error;
		if (!(error instanceof CrustError) || !error.is("VALIDATION")) throw error;
		expect(error.details?.issues).toEqual([
			{ path: "args.password", message: "Invalid value for <password>." },
			{ path: "flags.token", message: "Invalid value for --token." },
			{ path: "flags.port", message: "expected a positive integer" },
		]);
		expect(error.cause).toBeUndefined();
		expect(JSON.stringify(error.toJSON())).not.toContain(SECRET);

		const result = await executeCrust(app, [SECRET, "--token", SECRET]);
		expect(result.stderr).toContain("Invalid value for --token.");
		expect(result.stdout + result.stderr).not.toContain(SECRET);
	});

	it("reports a sensitive schema that throws or rejects with a fixed message", async () => {
		const SECRET = "SENTINEL-s3cr3t";
		const throwing: StandardSchema<string | undefined, string> = {
			"~standard": {
				version: 1,
				vendor: "crust-test",
				validate: (raw) => {
					throw new Error(String(raw));
				},
			},
		};
		const rejecting: StandardSchema<string | undefined, string> = {
			"~standard": {
				version: 1,
				vendor: "crust-test",
				validate: async (raw) => Promise.reject(new Error(String(raw))),
			},
		};
		for (const secret of [throwing, rejecting]) {
			const app = new Crust("cli")
				.flags({ token: { type: "string", schema: secret, sensitive: true } })
				.action(() => {});
			const outcome = await app.run([], { flags: { token: SECRET } });
			if (outcome.status !== "failed") throw new Error("Expected failure");
			const error = outcome.error;
			if (!(error instanceof CrustError) || !error.is("VALIDATION")) throw error;
			expect(error.details?.issues).toEqual([
				{ path: "flags.token", message: "Invalid value for --token." },
			]);
			expect(error.cause).toBeUndefined();

			const result = await executeCrust(app, ["--token", SECRET]);
			expect(result.stderr).toContain("Invalid value for --token.");
			expect(result.stdout + result.stderr).not.toContain(SECRET);
		}

		// Ordinary fields keep the validator's own error.
		const plain = new Crust("cli")
			.flags({ token: { type: "string", schema: throwing } })
			.action(() => {});
		await expect(unwrap(plain.run([], { flags: { token: "visible" } }))).rejects.toThrow("visible");
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

describe("schema interaction with Extensions", () => {
	it("pre-run hooks observe raw values while the action sees schema outputs", async () => {
		let preRunSaw: unknown;
		let actionSaw: unknown;

		const probe = defineExtension(defineExtensionId("probe")).preRun((ctx) => {
			preRunSaw = ctx.flags.port;
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
