import { parseJsonValue } from "@crustjs/utils/json";
import type { StandardSchema } from "@crustjs/utils/schema";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { executeCrust } from "../../tests/helpers.ts";
import {
	Crust,
	CrustError,
	defineExtension,
	defineExtensionId,
	type InvocationOutcome,
} from "../index.ts";
import { standardJsonSchema } from "../tooling.ts";

const user = z.object({ id: z.number(), role: z.string().default("member") });

/** A Standard Schema without Standard JSON Schema support. */
const anything: StandardSchema = {
	"~standard": { version: 1, vendor: "crust-test", validate: (value) => ({ value }) },
};

describe(".output()", () => {
	it("returns the schema output as the run() result", async () => {
		const app = new Crust("cli").output(user).action(() => ({ id: 1 }));

		const outcome = await app.run([]);

		expect(outcome).toMatchObject({ status: "completed", result: { id: 1, role: "member" } });
	});

	it("fails with OUTPUT when the schema rejects the result", async () => {
		// SAFETY: simulates an action whose runtime value escapes its declared type.
		const app = new Crust("cli").output(user).action(() => ({ id: "1" }) as unknown as { id: 1 });

		const outcome = await app.run([]);

		expect(outcome.status).toBe("failed");
		const error = outcome.status === "failed" ? outcome.error : undefined;
		expect(error).toBeInstanceOf(CrustError);
		expect(error).toMatchObject({
			code: "OUTPUT",
			message: "Invalid command result:\n  - id: Invalid input: expected number, received string",
			details: {
				issues: [{ path: "id", message: "Invalid input: expected number, received string" }],
			},
		});
	});

	it("reports a rejected root value without a path", async () => {
		// SAFETY: simulates an action whose runtime value escapes its declared type.
		const app = new Crust("cli").output(z.number()).action(() => "1" as unknown as number);

		const outcome = await app.run([]);

		expect(outcome).toMatchObject({
			status: "failed",
			error: {
				code: "OUTPUT",
				message: "Invalid command result:\n  - Invalid input: expected number, received string",
				details: { issues: [{ path: "" }] },
			},
		});
	});

	it("exits 1 and renders the OUTPUT error under execute()", async () => {
		// SAFETY: simulates an action whose runtime value escapes its declared type.
		const app = new Crust("cli").output(z.number()).action(() => "1" as unknown as number);

		const result = await executeCrust(app, []);

		expect(result.exitCode).toBe(1);
		expect(result.stderr).toContain("Invalid command result:");
	});

	it("passes the validated result or the OUTPUT failure to postRun", async () => {
		const outcomes: InvocationOutcome[] = [];
		const extension = defineExtension(defineExtensionId("observe")).postRun(
			(_ctx, outcome) => void outcomes.push(outcome),
		);
		const app = new Crust("cli")
			.extend(extension)
			.command("ok", (cmd) => cmd.output(user).action(() => ({ id: 1 })))
			.command("bad", (cmd) => cmd.output(z.number()).action(() => "1" as unknown as number));

		await app.run(["ok"]);
		await app.run(["bad"]);

		expect(outcomes[0]).toEqual({ status: "completed", result: { id: 1, role: "member" } });
		expect(outcomes[1]).toMatchObject({ status: "failed", error: { code: "OUTPUT" } });
	});

	it("validates an actionless command's undefined result", async () => {
		expect(await new Crust("cli").output(z.number().default(3)).run([])).toMatchObject({
			status: "completed",
			result: 3,
		});
		expect(await new Crust("cli").output(z.number()).run([])).toMatchObject({
			status: "failed",
			error: { code: "OUTPUT" },
		});
	});

	it("skips validation when a flag handler or noAction takes over", async () => {
		const stop = defineExtension(defineExtensionId("stop"))
			.flags({ stop: { type: "boolean" } })
			.handle("stop", () => {});
		const fallback = defineExtension(defineExtensionId("fallback")).noAction(() => {});

		const handled = await new Crust("cli")
			.extend(stop)
			.output(z.number())
			.action(() => "1" as unknown as number)
			.run([], { flags: { stop: true } });
		const actionless = await new Crust("cli").extend(fallback).output(z.number()).run([]);

		expect(handled).toMatchObject({ status: "handled", by: "stop" });
		expect(actionless).toMatchObject({ status: "handled", by: "fallback" });
	});

	it("awaits a promise the schema outputs, as its result type declares", async () => {
		const app = new Crust("cli").output(z.promise(z.number())).action(async () => 3);

		expect(await app.run([])).toMatchObject({ status: "completed", result: 3 });
	});

	it("validates with schemas that have no JSON Schema converter", async () => {
		const app = new Crust("cli").output(anything).action(() => 42);

		expect(await app.run([])).toMatchObject({ status: "completed", result: 42 });
	});

	it("leaves the builder it was called on unchanged", async () => {
		const base = new Crust("cli").action(() => "plain");
		base.output(z.string().transform((value) => value.length));

		expect(await base.run([])).toMatchObject({ status: "completed", result: "plain" });
	});
});

describe("CommandSnapshot.outputSchema", () => {
	it("carries the output JSON Schema of the root and of subcommands", async () => {
		const app = new Crust("cli")
			.output(user)
			.action(() => ({ id: 1 }))
			.command("count", (cmd) => cmd.output(z.number()).action(() => 1));

		const snapshot = await app.snapshot();

		expect(snapshot.outputSchema).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "object",
			properties: { id: { type: "number" }, role: { type: "string", default: "member" } },
			required: ["id", "role"],
			additionalProperties: false,
		});
		expect(snapshot.subCommands.count!.outputSchema).toMatchObject({ type: "number" });
		expect(JSON.parse(JSON.stringify(snapshot)).outputSchema).toEqual(snapshot.outputSchema);
	});

	it("is plain JSON data, without the converter's non-enumerable keys", async () => {
		// Zod attaches a non-enumerable `~standard` to the JSON Schema it generates.
		const snapshot = await new Crust("cli").output(user).snapshot();

		expect(Object.getOwnPropertyNames(snapshot.outputSchema)).not.toContain("~standard");
		expect(() => parseJsonValue(snapshot.outputSchema)).not.toThrow();
	});

	it("reaches invocation snapshots, including pending subcommands", async () => {
		const seen: unknown[] = [];
		const app = new Crust("cli")
			.output(z.number())
			.action(({ command, rootCommand }) => {
				seen.push(command.outputSchema, rootCommand.subCommands.count!.outputSchema);
				return 1;
			})
			.command("count", (cmd) => cmd.output(z.string()).action(() => "1"));

		await app.run([]);

		expect(seen).toMatchObject([{ type: "number" }, { type: "string" }]);
	});

	it("is absent without .output() or when the schema cannot produce JSON Schema", async () => {
		const app = new Crust("cli")
			.action(() => {})
			.command("opaque", (cmd) => cmd.output(anything).action(() => 1))
			.command("transformed", (cmd) =>
				cmd.output(z.string().transform((value) => value.length)).action(() => "x"),
			);

		const snapshot = await app.snapshot();

		expect("outputSchema" in snapshot).toBe(false);
		expect(snapshot.subCommands.opaque!.outputSchema).toBeUndefined();
		expect(snapshot.subCommands.transformed!.outputSchema).toBeUndefined();
	});
});

describe("CommandSnapshot.output", () => {
	it("is true for a command with .output(), even when the schema cannot produce JSON Schema", async () => {
		const app = new Crust("cli")
			.output(anything)
			.action(() => 1)
			.command("plain", (cmd) => cmd.action(() => 1));

		const snapshot = await app.snapshot();

		expect(snapshot.output).toBe(true);
		expect("outputSchema" in snapshot).toBe(false);
		expect("output" in snapshot.subCommands.plain!).toBe(false);
		expect(JSON.parse(JSON.stringify(snapshot)).output).toBe(true);
	});

	it("reaches routed and pending-child invocation snapshots", async () => {
		const seen: unknown[] = [];
		const app = new Crust("cli")
			.output(anything)
			.action(({ command, rootCommand }) => {
				seen.push(command.output, rootCommand.subCommands.count!.output);
				seen.push(rootCommand.subCommands.plain!.output);
				return 1;
			})
			.command("count", (cmd) => cmd.output(anything).action(() => 1))
			.command("plain", (cmd) => cmd.action(() => 1));

		await app.run([]);

		expect(seen).toEqual([true, true, undefined]);
	});
});

describe("standardJsonSchema", () => {
	it("converts the input or output type to draft 2020-12 JSON Schema", () => {
		const schema = z.string().default("x");

		expect(standardJsonSchema(schema, "input")).toEqual({
			$schema: "https://json-schema.org/draft/2020-12/schema",
			type: "string",
			default: "x",
		});
		expect(standardJsonSchema(user, "output")).toMatchObject({ required: ["id", "role"] });
		expect(standardJsonSchema(user, "input")).toMatchObject({ required: ["id"] });
	});

	it("returns undefined when the converter is missing or throws", () => {
		const throwing: StandardSchema = {
			"~standard": {
				...anything["~standard"],
				// @ts-expect-error jsonSchema is not part of the StandardSchema type
				jsonSchema: {
					input: () => ({}),
					output: () => {
						throw new Error("unrepresentable");
					},
				},
			},
		};

		expect(standardJsonSchema(anything, "output")).toBeUndefined();
		expect(standardJsonSchema(throwing, "output")).toBeUndefined();
		expect(standardJsonSchema(throwing, "input")).toEqual({});
	});
});
