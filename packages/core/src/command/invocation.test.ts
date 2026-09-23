import { describe, expect, it } from "bun:test";

import type { StandardSchema } from "@crustjs/utils/schema";

import { defineContext } from "../api/context.ts";
import { defineExtension } from "../api/extension.ts";
import { defineExtensionId } from "../identity.ts";
import { bindInput, customBindings } from "../tooling.ts";
import { Crust, defineCommand } from "./crust.ts";

type StandardInput = Parameters<StandardSchema["~standard"]["validate"]>[0];

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

describe("bindInput", () => {
	it("binds argv and structured input identically without entering the invocation lifecycle", async () => {
		const calls: string[] = [];
		const db = defineContext("db", () => {
			calls.push("context");
			return "connected";
		});
		const audit = defineExtension(defineExtensionId("audit"), {
			hooks: {
				preRun: () => {
					calls.push("preRun");
				},
				postRun: () => {
					calls.push("postRun");
				},
				onError: () => {
					calls.push("onError");
					return true;
				},
			},
		});
		const app = new Crust("git")
			.extend(audit)
			.provide(db())
			.add(
				defineCommand("remote-add", (command) =>
					command
						.args(
							{ name: "name", type: "string", required: true },
							{ name: "payload", type: "json" },
							{ name: "files", type: "string", variadic: true },
						)
						.flags(
							{ name: "fetch", type: "boolean" },
							{ name: "tag", type: "string", multiple: true },
							{ name: "config", type: "json" },
							{ name: "offset", type: "number", default: 7 },
						)
						.action(({ stdout }) => {
							calls.push("action");
							stdout("ran");
						}),
				),
			);
		const exitCodeBefore = process.exitCode;

		const fromArgv = await bindInput(app, {
			argv: [
				"remote-add",
				"origin",
				"[1,2]",
				"a.ts",
				"b.ts",
				"--fetch",
				"--tag=one",
				"--tag=-two",
				'--config={"force":true}',
				"--",
				"--literal",
			],
		});
		const fromStructured = await bindInput(app, {
			path: ["remote-add"],
			input: {
				args: { name: "origin", payload: [1, 2], files: ["a.ts", "b.ts"] },
				flags: { fetch: true, tag: ["one", "-two"], config: { force: true } },
				raw: ["--literal"],
			},
		});

		const expected = {
			commandPath: ["git", "remote-add"],
			args: { name: "origin", payload: [1, 2], files: ["a.ts", "b.ts"] },
			flags: { fetch: true, tag: ["one", "-two"], config: { force: true }, offset: 7 },
			rawArgs: ["--literal"],
		};
		expect(fromArgv).toEqual(expected);
		expect(fromStructured).toEqual(expected);
		expect(calls).toEqual([]);
		expect(process.exitCode).toBe(exitCodeBefore);

		// The same fixture observes the lifecycle under run(), so the empty log above is meaningful.
		const outcome = await app.run(["remote-add"], { args: { name: "origin" } });
		expect(outcome).toMatchObject({ status: "completed", stdout: "ran" });
		expect(calls).toEqual(["preRun", "action", "postRun"]);
	});

	it("runs parse and schema callbacks as validators and throws the production errors", async () => {
		const parsed: string[] = [];
		const app = new Crust("cli")
			.args({
				name: "port",
				schema: schema<string | undefined, number>((raw) =>
					raw === "bad" ? { issues: [{ message: "nope" }] } : { value: Number(raw) },
				),
			})
			.flags(
				{ name: "level", type: "string", parse: (raw) => (parsed.push(raw), raw.toUpperCase()) },
				{ name: "name", type: "string", required: true },
			)
			.action(() => {
				throw new Error("action must not run");
			});

		expect(await bindInput(app, { argv: ["8080", "--level=info", "--name=x"] })).toEqual({
			commandPath: ["cli"],
			args: { port: 8080 },
			flags: { level: "INFO", name: "x" },
			rawArgs: [],
		});
		expect(parsed).toEqual(["info"]);

		await expect(bindInput(app, { argv: ["8080"] })).rejects.toMatchObject({
			code: "VALIDATION",
			message: 'Missing required flag "--name"',
		});
		await expect(
			bindInput(app, { path: [], input: { args: { port: "bad" }, flags: { name: "x" } } }),
		).rejects.toMatchObject({
			code: "VALIDATION",
			message: expect.stringContaining("nope"),
		});
		await expect(bindInput(app, { argv: ["--bogus"] })).rejects.toMatchObject({ code: "PARSE" });
		await expect(bindInput(app, { path: ["missing"], input: {} })).rejects.toMatchObject({
			code: "COMMAND_NOT_FOUND",
		});
	});
});

describe("bindInput \u2014 environment", () => {
	it("binds argv against an empty environment while execute() reads process.env", async () => {
		// HOME is set in every environment this suite runs in; the flag must still fall back.
		expect(process.env.HOME).toBeDefined();
		const seen: string[] = [];
		const app = new Crust("cli")
			.flags({ name: "home", type: "string", env: { name: "HOME" }, default: "fallback" })
			.action(({ flags }) => {
				seen.push(flags.home);
			});

		expect((await bindInput(app, { argv: [] })).flags).toEqual({ home: "fallback" });
		expect((await bindInput(app, { path: [], input: {} })).flags).toEqual({ home: "fallback" });
		expect((await bindInput(app, { argv: ["--home=x"] })).flags).toEqual({ home: "x" });
		expect(seen).toEqual([]);

		expect(await app.execute({ argv: [] })).toBe(0);
		expect(seen).toEqual([process.env.HOME!]);
	});
});

describe("customBindings", () => {
	it("names parse- and schema-backed definitions at a typed path", () => {
		const app = new Crust("cli").flags({ name: "plain", type: "string" }).add(
			defineCommand("serve", (command) =>
				command
					.args(
						{
							name: "port",
							schema: schema<string | undefined, number>((raw) => ({ value: Number(raw) })),
						},
						{ name: "host", type: "string" },
					)
					.flags(
						{ name: "level", type: "string", parse: (raw) => raw.toUpperCase() },
						{
							name: "strict",
							type: "boolean",
							schema: schema<boolean | undefined, boolean>((raw) => ({ value: raw === true })),
						},
						{ name: "count", type: "number" },
					)
					.action(() => {}),
			),
		);

		expect(customBindings(app, ["serve"])).toEqual({ args: ["port"], flags: ["level", "strict"] });
		expect(customBindings(app, [])).toEqual({ args: [], flags: [] });
		expect(() => customBindings(app, ["missing"])).toThrow(
			expect.objectContaining({ code: "COMMAND_NOT_FOUND" }),
		);
	});
});
