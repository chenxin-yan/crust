import { describe, expect, it } from "bun:test";
import { defineCommand } from "./command.ts";
import type { AnyCommand } from "./types.ts";
import { validateCommandTree } from "./validation.ts";

describe("validateCommandTree", () => {
	it("passes commands with required args and flags", () => {
		const cmd = defineCommand({
			meta: { name: "build" },
			args: [
				{ name: "entry", type: "string", required: true },
				{ name: "count", type: "number", required: true },
			],
			flags: {
				output: { type: "string", required: true },
				port: { type: "number", required: true },
				verbose: { type: "boolean", required: true },
			},
		});

		expect(() => validateCommandTree(cmd)).not.toThrow();
	});

	it("throws with command path when parser-level validation fails", () => {
		const cmd: AnyCommand = {
			meta: { name: "root" },
			flags: {
				verbose: { type: "boolean", alias: "v" },
				version: { type: "boolean", alias: "v" },
			},
			subCommands: {},
		};

		expect(() => validateCommandTree(cmd)).toThrow(
			'Command "root" failed runtime validation',
		);
	});

	it("validates nested subcommands", () => {
		const invalidLeaf: AnyCommand = {
			meta: { name: "leaf" },
			flags: {
				out: { type: "string" },
				output: { type: "string", alias: "out" },
			},
			subCommands: {},
		};

		const root = defineCommand({
			meta: { name: "root" },
			subCommands: {
				generate: defineCommand({
					meta: { name: "generate" },
					subCommands: {
						leaf: invalidLeaf,
					},
				}),
			},
		});

		expect(() => validateCommandTree(root)).toThrow(
			'Command "root generate leaf" failed runtime validation',
		);
	});
});
