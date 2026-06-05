import { describe, expect, it } from "bun:test";

import { Crust, CrustError } from "@crustjs/core";
import { z } from "zod";

import { commandValidator } from "./command.ts";
import type { InferValidatedArgs } from "./schema-types.ts";
import { arg, flag } from "./schema.ts";

type Expect<T extends true> = T;
type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function capture<T>() {
	const box: { value: T | undefined } = { value: undefined };
	return {
		box,
		set: (value: T) => {
			box.value = value;
		},
	};
}

describe("arg() — raw schema-backed definitions", () => {
	it("does not infer type, required, or description from schemas", () => {
		const def = arg("port", z.coerce.number().describe("Port"));
		expect(def.name).toBe("port");
		expect(def.type).toBeUndefined();
		expect(def.required).toBeUndefined();
		expect(def.description).toBeUndefined();
	});

	it("preserves explicit Crust metadata", () => {
		const def = arg("port", z.coerce.number(), {
			type: "number",
			required: true,
			description: "Port",
		});
		expect((def as { type?: string }).type).toBe("number");
		expect(def.required).toBe(true);
		expect(def.description).toBe("Port");
	});

	it("throws DEFINITION for empty names", () => {
		expect(() => arg("", z.string())).toThrow(CrustError);
	});
});

describe("flag() — schema-backed definitions", () => {
	it("requires explicit parser type and does not infer description", () => {
		const def = flag(z.boolean().default(false).describe("Verbose"), {
			type: "boolean",
		});
		expect(def.type).toBe("boolean");
		expect(def.description).toBeUndefined();
	});

	it("preserves explicit metadata", () => {
		const def = flag(z.boolean(), {
			type: "boolean",
			short: "v",
			aliases: ["loud"],
			inherit: true,
			description: "Verbose",
		});
		expect(def.type).toBe("boolean");
		expect(def.short).toBe("v");
		expect(def.aliases).toEqual(["loud"]);
		expect(def.inherit).toBe(true);
		expect(def.description).toBe("Verbose");
	});

	it("throws DEFINITION when parser type is missing at runtime", () => {
		expect(() => flag(z.boolean(), {} as never)).toThrow(CrustError);
		expect(() => flag(z.boolean(), {} as never)).toThrow(
			'flag(): options.type is required and must be "string", "number", or "boolean"',
		);
	});
});

describe("commandValidator — raw schema-backed runtime", () => {
	it("coerces positional strings through schemas", async () => {
		const received = capture<{ port: number }>();
		const app = new Crust("serve")
			.args([arg("port", z.coerce.number().int().min(1))])
			.run(commandValidator(({ args }) => received.set(args)));

		await app.execute({ argv: ["3000"] });
		expect(received.box.value).toEqual({ port: 3000 });
	});

	it("passes missing positional values as undefined", async () => {
		const optional = capture<{ name: string | undefined }>();
		await new Crust("optional")
			.args([arg("name", z.string().optional())])
			.run(commandValidator(({ args }) => optional.set(args)))
			.execute({ argv: [] });
		expect(optional.box.value).toEqual({ name: undefined });

		const withDefault = capture<{ name: string }>();
		await new Crust("default")
			.args([arg("name", z.string().default("world"))])
			.run(commandValidator(({ args }) => withDefault.set(args)))
			.execute({ argv: [] });
		expect(withDefault.box.value).toEqual({ name: "world" });
	});

	it("surfaces validation errors for missing required schema values", async () => {
		const app = new Crust("hello").args([arg("name", z.string())]).run(commandValidator(() => {}));
		await app.execute({ argv: [] });
		expect(process.exitCode).toBe(1);
		process.exitCode = 0;
	});

	it("supports boolean flags with explicit parser grammar", async () => {
		const received = capture<{ verbose: boolean }>();
		const app = new Crust("run")
			.flags({
				verbose: flag(z.boolean().default(false), {
					type: "boolean",
					short: "v",
				}),
			})
			.run(commandValidator(({ flags }) => received.set(flags)));

		await app.execute({ argv: [] });
		expect(received.box.value).toEqual({ verbose: false });
		await app.execute({ argv: ["--verbose"] });
		expect(received.box.value).toEqual({ verbose: true });
		await app.execute({ argv: ["--no-verbose"] });
		expect(received.box.value).toEqual({ verbose: false });
		await app.execute({ argv: ["-v"] });
		expect(received.box.value).toEqual({ verbose: true });
	});

	it("supports schema-coerced value flags with string parser grammar", async () => {
		const received = capture<{ port: number }>();
		const app = new Crust("serve")
			.flags({ port: flag(z.coerce.number().int().min(1), { type: "string" }) })
			.run(commandValidator(({ flags }) => received.set(flags)));

		await app.execute({ argv: ["--port", "3000"] });
		expect(received.box.value).toEqual({ port: 3000 });
		await app.execute({ argv: ["--port=3001"] });
		expect(received.box.value).toEqual({ port: 3001 });
	});

	it("supports parser-coerced number flags", async () => {
		const received = capture<{ port: number }>();
		const app = new Crust("serve")
			.flags({ port: flag(z.number(), { type: "number", short: "p" }) })
			.run(commandValidator(({ flags }) => received.set(flags)));

		await app.execute({ argv: ["-p", "3000"] });
		expect(received.box.value).toEqual({ port: 3000 });
	});

	it("supports explicit multiple flags", async () => {
		const received = capture<{ tag: string[] }>();
		const app = new Crust("tag")
			.flags({
				tag: flag(z.array(z.string()), { type: "string", multiple: true }),
			})
			.run(commandValidator(({ flags }) => received.set(flags)));

		await app.execute({ argv: ["--tag", "a", "--tag=b"] });
		expect(received.box.value).toEqual({ tag: ["a", "b"] });
	});
});

describe("type-level inference", () => {
	it("infers schema output types", () => {
		const args = [arg("port", z.coerce.number())] as const;
		type Args = InferValidatedArgs<typeof args>;
		type _Arg = Expect<Equal<Args, { port: number }>>;

		void (null as unknown as _Arg);
		expect(true).toBe(true);
	});
});
