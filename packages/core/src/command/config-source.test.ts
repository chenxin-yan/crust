import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { unwrap } from "../../tests/helpers.ts";
import { defineExtension, type ExtensionContext } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import type { ExecuteOptions, RunInputPayload } from "../types.ts";
import { Crust } from "./crust.ts";

const origin = (name: string) => `/repo/acme.config.json key "${name}"`;

/** One app per row: `config` binds as config, `bound` as plain bindInput, both in setup. */
function app(options: {
	config?: NonNullable<RunInputPayload["flags"]>;
	bound?: RunInputPayload;
	order?: "config-first" | "bound-first";
}) {
	const seen: { flags: unknown; sources: ExtensionContext["sources"] }[] = [];
	const configBinder = defineExtension(defineExtensionId("config")).setup((ctx) => {
		if (!options.config) return;
		const from = Object.fromEntries(
			Object.keys(options.config).map((name) => [name, origin(name)]),
		);
		ctx.bindInput({ flags: options.config }, { source: "config", from });
	});
	const plainBinder = defineExtension(defineExtensionId("input")).setup((ctx) => {
		if (options.bound) ctx.bindInput(options.bound);
	});
	const recorder = defineExtension(defineExtensionId("recorder")).preRun(
		(ctx) => void seen.push({ flags: { ...ctx.flags }, sources: ctx.sources }),
	);
	const extensions =
		options.order === "bound-first"
			? ([plainBinder, configBinder] as const)
			: ([configBinder, plainBinder] as const);
	const crust = new Crust("acme")
		.flags({
			org: { type: "string", env: { name: "ACME_ORG" }, config: "org", default: "dflt" },
			port: { type: "number", config: "port" },
			tags: { type: "string", multiple: true, delimiter: ",", config: "tags", default: ["d"] },
			region: { type: "string", config: "region", schema: z.enum(["eu", "us"]).optional() },
			zone: { type: "string", env: { name: "ACME_ZONE" }, schema: z.enum(["a", "b"]).optional() },
		})
		.extend(...extensions, recorder)
		.action(({ flags }) => flags);
	return { crust, seen };
}

async function execute(
	crust: { execute(options: ExecuteOptions): Promise<number> },
	argv: string[],
	env = {},
) {
	const stderr: string[] = [];
	const code = await crust.execute({
		argv,
		env,
		io: { stdout: () => {}, stderr: (line) => void stderr.push(line) },
	});
	return { code, stderr: stderr.join("\n") };
}

describe('bindInput(input, { source: "config" })', () => {
	// execute(): argv > bound > env > config > default
	it.each([
		["argv", ["--org", "a"], { flags: { org: "b" } }, { ACME_ORG: "e" }, "a"],
		["bound", [], { flags: { org: "b" } }, { ACME_ORG: "e" }, "b"],
		["env", [], undefined, { ACME_ORG: "e" }, "e"],
		["config", [], undefined, {}, "c"],
	] as const)("execute(): %s wins", async (source, argv, bound, env, value) => {
		const { crust, seen } = app({ config: { org: "c" }, ...(bound && { bound }) });
		expect(await execute(crust, [...argv], env)).toEqual({ code: 0, stderr: "" });
		expect(seen[0]?.flags).toMatchObject({ org: value });
		expect(seen[0]?.sources.flags.org).toBe(source);
	});

	it("execute(): default when nothing else supplies a value", async () => {
		const { crust, seen } = app({});
		await execute(crust, []);
		expect(seen[0]?.flags).toMatchObject({ org: "dflt" });
		expect(seen[0]?.sources.flags).toEqual({ org: "default", tags: "default" });
	});

	// run(): bound > run > env > config > default
	it.each([
		["bound", { org: "r" }, { flags: { org: "b" } }, { ACME_ORG: "e" }, "b"],
		["run", { org: "r" }, undefined, { ACME_ORG: "e" }, "r"],
		["env", {}, undefined, { ACME_ORG: "e" }, "e"],
		["config", {}, undefined, {}, "c"],
		["default", {}, undefined, {}, "dflt"],
	] as const)("run(): %s wins", async (source, flags, bound, env, value) => {
		const { crust, seen } = app({
			...(source !== "default" && { config: { org: "c" } }),
			...(bound && { bound }),
		});
		await unwrap(crust.run([], { flags }, { env }));
		expect(seen[0]?.flags).toMatchObject({ org: value });
		expect(seen[0]?.sources.flags.org).toBe(source);
	});

	it.each(["config-first", "bound-first"] as const)(
		"plain bindInput beats config whatever the Extension order (%s)",
		async (order) => {
			const { crust, seen } = app({
				config: { org: "c", port: 1 },
				bound: { flags: { org: "b" } },
				order,
			});
			await execute(crust, []);
			expect(seen[0]?.flags).toMatchObject({ org: "b", port: 1 });
			expect(seen[0]?.sources.flags).toMatchObject({ org: "bound", port: "config" });
		},
	);

	it.each(["config-first", "bound-first"] as const)(
		"converts a plain bind once, however many config binds follow (%s)",
		async (order) => {
			let calls = 0;
			const crust = new Crust("acme")
				.flags({
					x: { type: "string", parse: () => ++calls },
					y: { type: "string", config: "y" },
				})
				.extend(
					defineExtension(defineExtensionId("binder")).setup((ctx) => {
						const bindConfig = () =>
							ctx.bindInput({ flags: { y: "config" } }, { source: "config", from: {} });
						if (order === "config-first") bindConfig();
						ctx.bindInput({ flags: { x: "bound" } });
						if (order === "bound-first") bindConfig();
						bindConfig();
					}),
				)
				.action(({ flags }) => flags);
			expect(await unwrap(crust.run([]))).toMatchObject({ result: { x: 1, y: "config" } });
			expect(calls).toBe(1);
		},
	);

	it("a second call replaces only its own layer", async () => {
		const seen: unknown[] = [];
		const crust = new Crust("acme")
			.flags({ org: { type: "string", config: "org" }, port: { type: "number", config: "port" } })
			.extend(
				defineExtension(defineExtensionId("binder")).setup((ctx) => {
					ctx.bindInput({ flags: { org: "c1", port: 1 } }, { source: "config", from: {} });
					ctx.bindInput({ flags: { org: "b1" } });
					ctx.bindInput({ flags: { port: 2 } }, { source: "config", from: {} });
					seen.push({ ...ctx.flags }, ctx.sources.flags);
					ctx.bindInput({ flags: { port: 9 } });
					seen.push({ ...ctx.flags }, ctx.sources.flags);
				}),
			)
			.action(() => {});
		await unwrap(crust.run([]));
		expect(seen).toEqual([
			// The second config call drops org's config value; the plain bind still holds org.
			{ org: "b1", port: 2 },
			{ org: "bound", port: "config" },
			// The second plain call drops org's bound value; no config value is left for it.
			{ org: undefined, port: 9 },
			{ port: "bound" },
		]);
	});

	it("multiple flags: an array fills, an empty array is omitted, explicit argv wins", async () => {
		const rows: unknown[] = [];
		for (const [config, argv] of [
			[["x", "y"], []],
			[[], []],
			[["x"], ["--tags", ""]],
		] as const) {
			const { crust, seen } = app({ config: { tags: [...config] } });
			await execute(crust, [...argv]);
			rows.push([seen[0]?.flags, seen[0]?.sources.flags.tags]);
		}
		expect(rows).toEqual([
			[expect.objectContaining({ tags: ["x", "y"] }), "config"],
			[expect.objectContaining({ tags: ["d"] }), "default"],
			// `--tags ""` is an explicit empty list: argv keeps it, so the default applies, not config.
			[expect.objectContaining({ tags: ["d"] }), "argv"],
		]);
	});

	it("a schema-backed flag gets the config value as typed input", async () => {
		const ok = app({ config: { region: "eu" } });
		expect(await execute(ok.crust, [])).toEqual({ code: 0, stderr: "" });
		expect(ok.seen[0]?.sources.flags.region).toBe("config");
	});

	it("names the env or config origin in a schema issue, and nothing for argv", async () => {
		const fromConfig = await execute(app({ config: { region: "mars" } }).crust, []);
		expect(fromConfig.code).toBe(1);
		expect(fromConfig.stderr).toContain(`  - flags.region (from ${origin("region")}): `);
		const fromEnv = await execute(app({}).crust, [], { ACME_ZONE: "mars" });
		expect(fromEnv.stderr).toContain("  - flags.zone (from $ACME_ZONE): ");
		const fromArgv = await execute(app({}).crust, ["--zone", "mars"]);
		expect(fromArgv.stderr).toContain("  - flags.zone: ");
		// A plain bind replaces the config value, and its origin with it.
		const bound = app({ config: { region: "eu" }, bound: { flags: { region: "mars" } } });
		expect((await execute(bound.crust, [])).stderr).toContain("  - flags.region: ");
	});

	it.each([
		["port", "s3cret", `Expected a number for --port (from ${origin("port")}).`],
		["tags", "s3cret", `Expected an occurrence array for --tags (from ${origin("tags")})`],
		["region", 7, `Expected a string for --region (from ${origin("region")}).`],
		["port", null, `Expected a number for --port (from ${origin("port")}).`],
	] as const)(
		"defers an invalid %s value (%s), naming its origin and never the value",
		async (flag, value, message) => {
			const { crust, seen } = app({ config: { [flag]: value } });
			const { code, stderr } = await execute(crust, []);
			expect({ code, stderr }).toEqual({ code: 1, stderr: `Error: ${message}` });
			if (value !== null) expect(stderr).not.toContain(String(value));
			// Like an invalid env value: undefined before validation, which then fails.
			expect(seen[0]?.flags).toMatchObject({ [flag]: undefined });
			expect(seen[0]?.sources.flags[flag]).toBe("config");
		},
	);

	it("defers a config value error so a flag handler still runs", async () => {
		const handled: string[] = [];
		const crust = new Crust("acme")
			.flags({ port: { type: "number", config: "port" } })
			.extend(
				defineExtension(defineExtensionId("config")).setup((ctx) =>
					ctx.bindInput({ flags: { port: "abc" } }, { source: "config", from: { port: "f" } }),
				),
				defineExtension(defineExtensionId("help"))
					.flags({ help: { type: "boolean" } })
					.handle("help", () => void handled.push("help")),
			)
			.action(() => {});
		expect(await crust.execute({ argv: ["--help"] })).toBe(0);
		expect(handled).toEqual(["help"]);
	});

	it("never masks an invalid env value, and a plain bind clears a config error", async () => {
		const crust = new Crust("acme")
			.flags({ port: { type: "number", env: { name: "PORT" }, config: "port" } })
			.extend(
				defineExtension(defineExtensionId("config")).setup((ctx) =>
					ctx.bindInput({ flags: { port: 1 } }, { source: "config", from: { port: "f" } }),
				),
			)
			.action(() => {});
		expect(await execute(crust, [], { PORT: "nope" })).toEqual({
			code: 1,
			stderr: "Error: Expected a number for --port (from $PORT).",
		});
		const cleared = app({ config: { port: "abc" }, bound: { flags: { port: 2 } } });
		expect(await execute(cleared.crust, [])).toEqual({ code: 0, stderr: "" });
	});

	it("fills a required flag, which typed run() input may omit", async () => {
		const crust = new Crust("acme")
			.flags({ org: { type: "string", required: true, config: "org" } })
			.extend(
				defineExtension(defineExtensionId("config")).setup((ctx) =>
					ctx.bindInput({ flags: { org: "c" } }, { source: "config", from: {} }),
				),
			)
			.action(({ flags }) => flags.org);
		expect(await unwrap(crust.run([], {}))).toMatchObject({ result: "c" });
	});

	it("rejects args or raw and undeclared flags", async () => {
		const bindWith = (bind: (ctx: ExtensionContext) => void) =>
			new Crust("acme")
				.flags({ org: { type: "string", config: "org" } })
				.extend(defineExtension(defineExtensionId("config")).setup(bind))
				.action(() => {})
				.run([]);
		await expect(
			// @ts-expect-error -- config binds flags only
			bindWith((ctx) => ctx.bindInput({ args: { a: "x" } }, { source: "config", from: {} })),
		).resolves.toMatchObject({
			status: "failed",
			error: { code: "DEFINITION", details: { reason: "config-bind-args" } },
		});
		await expect(
			bindWith((ctx) => ctx.bindInput({ flags: { nope: "x" } }, { source: "config", from: {} })),
		).resolves.toMatchObject({ status: "failed", error: { message: 'Unknown flag "--nope"' } });
	});
});
