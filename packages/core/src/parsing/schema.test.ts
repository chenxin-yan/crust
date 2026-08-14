import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import { Crust } from "../command/crust.ts";
import { CrustError } from "../errors.ts";

/** Minimal hand-rolled Standard Schema (no vendor dependency). */
function schema<Input, Output>(
	validate: (value: Input) => { value: Output } | { issues: { message: string }[] },
): StandardSchema<Input, Output> {
	return {
		"~standard": {
			version: 1,
			vendor: "crust-test",
			validate: (value: unknown) => validate(value as Input),
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
		let received: unknown;
		const app = new Crust("cli").args({ name: "port", schema: port() }).action(({ args }) => {
			received = args.port;
		});

		await app.run([], { args: { port: "8080" } });
		expect(received).toBe(8080);
	});

	it("schema owns requiredness: a missing arg reaches the schema as undefined", async () => {
		const app = new Crust("cli").args({ name: "port", schema: port() }).action(() => {});

		await expect(app.run([])).rejects.toMatchObject({
			code: "VALIDATION",
			details: { issues: [{ message: "port is required", path: "args.port" }] },
		});
	});

	it("variadic schema args receive the raw string array", async () => {
		let received: unknown;
		const upper = schema<string[], string[]>((raw) => ({
			value: raw.map((s) => s.toUpperCase()),
		}));

		const app = new Crust("cli")
			.args({ name: "files", variadic: true, schema: upper })
			.action(({ args }) => {
				received = args.files;
			});

		await app.run([], { args: { files: ["a.txt", "b.txt"] } });
		expect(received).toEqual(["A.TXT", "B.TXT"]);
	});

	it("supports async schema validation", async () => {
		let received: unknown;
		const asyncUpper = schema<string | undefined, string>((raw) => ({
			value: String(raw).toUpperCase(),
		}));
		const asyncSchema: StandardSchema<string | undefined, string> = {
			"~standard": {
				version: 1,
				vendor: "crust-test",
				validate: async (value: unknown) => asyncUpper["~standard"].validate(value),
			},
		};

		const app = new Crust("cli").args({ name: "name", schema: asyncSchema }).action(({ args }) => {
			received = args.name;
		});

		await app.run([], { args: { name: "chenxin" } });
		expect(received).toBe("CHENXIN");
	});
});

describe("Standard Schema on flag definitions", () => {
	it("string flags consume a token and pass the raw string to the schema", async () => {
		let received: unknown;
		const app = new Crust("cli")
			.flags({ name: "port", type: "string", schema: port() })
			.action(({ flags }) => {
				received = flags.port;
			});

		await app.run([], { flags: { port: "9090" } });
		expect(received).toBe(9090);
	});

	it("boolean flags do not consume a token and pass the raw boolean to the schema", async () => {
		let received: unknown;
		const onOff = schema<boolean | undefined, "on" | "off">((raw) => ({
			value: raw === true ? "on" : "off",
		}));
		const app = new Crust("cli")
			.flags({ name: "loud", type: "boolean", schema: onOff })
			.action(({ flags }) => {
				received = flags.loud;
			});

		await app.run([], { flags: { loud: true } });
		expect(received).toBe("on");

		await app.run([]);
		expect(received).toBe("off");
	});

	it("aggregates issues across args and flags into one VALIDATION error", async () => {
		const app = new Crust("cli")
			.args({ name: "input", schema: port() })
			.flags({ name: "port", type: "string", schema: port() })
			.action(() => {});

		try {
			await app.run([], { args: { input: "oops" }, flags: { port: "nope" } });
			expect.unreachable("should have thrown");
		} catch (error) {
			expect(error).toBeInstanceOf(CrustError);
			const crustError = error as CrustError<"VALIDATION">;
			expect(crustError.is("VALIDATION")).toBe(true);
			expect(crustError.details?.issues.map((issue) => issue.path).sort()).toEqual([
				"args.input",
				"flags.port",
			]);
		}
	});

	it("--no-<name> negation delivers raw false to a schema boolean flag", async () => {
		let received: unknown;
		const probe = schema<boolean | undefined, string>((raw) => ({ value: String(raw) }));
		const app = new Crust("cli")
			.flags({ name: "loud", type: "boolean", schema: probe })
			.action(({ flags }) => {
				received = flags.loud;
			});

		await app.run([], { flags: { loud: false } });
		expect(received).toBe("false");
	});

	it("multiple schema flags receive the raw value array", async () => {
		let received: unknown;
		const csv = schema<string[] | undefined, string>((raw) => ({
			value: (raw ?? []).join(","),
		}));
		const app = new Crust("cli")
			.flags({ name: "tag", type: "string", multiple: true, schema: csv })
			.action(({ flags }) => {
				received = flags.tag;
			});

		await app.run([], { flags: { tag: ["a", "b"] } });
		expect(received).toBe("a,b");
	});
});

describe("schema interaction with Extensions", () => {
	it("pre-run hooks observe raw values while the action sees schema outputs", async () => {
		const { defineExtension } = await import("../api/extension.ts");
		let preRunSaw: unknown;
		let actionSaw: unknown;

		const probe = defineExtension("probe", {
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

		await app.run([], { flags: { port: "8080" } });

		expect(preRunSaw).toBe("8080"); // raw, pre-validation
		expect(actionSaw).toBe(8080); // schema output
	});

	it("a pre-run finish skips schema validation entirely", async () => {
		let validated = false;
		const spy = schema<string | undefined, string>((raw) => {
			validated = true;
			return { value: String(raw) };
		});
		const { defineExtension } = await import("../api/extension.ts");
		const gate = defineExtension("gate", { hooks: { preRun: (ctx) => ctx.finish() } });

		const app = new Crust("cli")
			.flags({ name: "x", type: "string", schema: spy })
			.extend(gate)
			.action(() => {});

		await app.run([], { flags: { x: "whatever" } });
		expect(validated).toBe(false);
	});
});

describe("schema type inference", () => {
	type Expect<T extends true> = T;
	type Equal<A, B> =
		(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

	it("the schema output type reaches the Command Action", () => {
		new Crust("cli")
			.args({ name: "port", schema: port() })
			.flags({ name: "tag", type: "string", schema: port() })
			.action((_ctx) => {
				type _argOutput = Expect<Equal<(typeof _ctx.args)["port"], number>>;
				type _flagOutput = Expect<Equal<(typeof _ctx.flags)["tag"], number>>;
			});
		expect(true).toBe(true);
	});
});

describe("schema mode exclusivity", () => {
	it("rejects mixing core value options with a schema on args", () => {
		expect(() => new Crust("cli").args({ name: "x", schema: port(), default: "5" } as any)).toThrow(
			CrustError,
		);
	});

	it("rejects a parser type on schema args (raw strings only)", () => {
		expect(() =>
			new Crust("cli").args({ name: "x", type: "number", schema: port() } as any),
		).toThrow(CrustError);
	});

	it("rejects mixing core value options with a schema on flags", () => {
		expect(() =>
			new Crust("cli").flags({
				...({ type: "string", schema: port(), required: true } as any),
				name: "x",
			}),
		).toThrow(CrustError);
	});
});
