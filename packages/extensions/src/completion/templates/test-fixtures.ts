import type { CompletionCommand } from "../spec.ts";

/** A flat subcommand (`build`), a nested aliased one (`deploy prod`), and flags with choices. */
export const fixture: CompletionCommand = {
	name: "mycli",
	description: "Test CLI",
	flags: [
		{ name: "help", spellings: ["-h", "--help"], type: "boolean", takesValue: false },
		{ name: "version", spellings: ["-v", "--version"], type: "boolean", takesValue: false },
	],
	args: [],
	subCommands: [
		{
			name: "build",
			description: "Build artifact",
			flags: [
				{ name: "release", spellings: ["--release"], type: "boolean", takesValue: false },
				{
					name: "target",
					spellings: ["--target"],
					type: "string",
					takesValue: true,
					choices: ["browser", "bun", "node"],
				},
			],
			args: [],
			subCommands: [],
		},
		{
			name: "deploy",
			aliases: ["dep"],
			description: "Deploy",
			flags: [],
			args: [],
			subCommands: [
				{
					name: "prod",
					description: "Production deploy",
					flags: [
						{
							name: "env",
							spellings: ["--env"],
							type: "string",
							takesValue: true,
							choices: ["dev", "staging", "prod"],
						},
					],
					args: [],
					subCommands: [],
				},
			],
		},
	],
};

/** A path flag (`--out`), url/json flags (`--endpoint`, `--config`), and a plain string flag. */
export const valueTypeFixture: CompletionCommand = {
	name: "mycli",
	flags: [
		{
			name: "out",
			spellings: ["--out"],
			type: "string",
			takesValue: true,
			valueCompletion: "files",
		},
		{
			name: "endpoint",
			spellings: ["--endpoint"],
			type: "string",
			takesValue: true,
			valueCompletion: "none",
		},
		{
			name: "config",
			spellings: ["--config"],
			type: "string",
			takesValue: true,
			valueCompletion: "none",
		},
		{ name: "name", spellings: ["--name"], type: "string", takesValue: true },
	],
	args: [],
	subCommands: [],
};

/** A path positional (slot 0) followed by url/json positionals (slots 1 and 2). */
export const posFixture: CompletionCommand = {
	name: "mycli",
	flags: [],
	args: [
		{ name: "src", type: "string", required: true, variadic: false, valueCompletion: "files" },
		{ name: "endpoint", type: "string", required: true, variadic: false, valueCompletion: "none" },
		{ name: "payload", type: "string", required: true, variadic: false, valueCompletion: "none" },
	],
	subCommands: [],
};
