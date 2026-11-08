import {
	type CommandDefinition,
	type CommandShape,
	type ExtensionFactory,
	type ExtensionId,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import type { CommandInputSchema } from "@crustjs/core/tooling";

const SCHEMA: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:schema");

/** What `schema [path...]` prints for one command, and returns as its result. */
export interface CommandSchema {
	/** JSON Schema of the command's arguments and flags as one flat object (`commandInputSchema`). */
	readonly input: CommandInputSchema;
	/** Draft 2020-12 JSON Schema of the result; absent without a convertible `.output()` schema. */
	readonly output?: Readonly<Record<string, unknown>>;
}

const PATH_ARG_DESCRIPTION = "Command path, e.g. `remote add`; omit for the root command";

const llmsFlags = {
	llms: {
		type: "boolean",
		noNegate: true,
		recursive: false,
		description: "Print a Markdown index of all commands for LLMs",
	},
} as const;

/** The contributed `schema [path...]` command, spelled out because the exported factory needs a declared type. */
type SchemaCommandDefinition = CommandDefinition<
	"schema",
	readonly [],
	CommandShape<
		readonly [
			{
				readonly name: "path";
				readonly type: "string";
				readonly variadic: true;
				readonly description: typeof PATH_ARG_DESCRIPTION;
			},
		],
		{},
		{},
		CommandSchema,
		{}
	>
>;

/**
 * Contributes a `schema [path...]` command that prints one line of JSON,
 * `{ input, output? }`, for the command at `path` (the root when
 * omitted), and a root-only `--llms` flag that prints a Markdown index of every
 * visible command, including the documentation sections visible to `schema()`.
 */
export const schema: ExtensionFactory<
	[],
	{},
	[],
	typeof llmsFlags,
	readonly [SchemaCommandDefinition]
> = /* @__PURE__ */ defineExtension(SCHEMA).factory((extension) =>
	extension
		.flags(llmsFlags)
		.add(
			defineCommand(
				"schema",
				{ description: "Print a command's input and output JSON Schema" },
				(cmd) =>
					cmd
						.args({
							name: "path",
							type: "string",
							variadic: true,
							description: PATH_ARG_DESCRIPTION,
						})
						.action(async ({ args, rootCommand, stdout }) => {
							// The tooling mapping loads only when the command runs.
							const { commandSchema } = await import("./schema-render.ts");
							const result = commandSchema(rootCommand, args.path);
							stdout(JSON.stringify(result));
							return result;
						}),
			),
		)
		.handle("llms", async ({ rootCommand, stdout }) => {
			const { renderCommandIndex } = await import("./schema-render.ts");
			stdout(renderCommandIndex(rootCommand, SCHEMA));
		}),
);
