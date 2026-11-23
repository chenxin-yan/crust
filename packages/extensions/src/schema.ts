import {
	type CommandDefinition,
	type CommandShape,
	type CommandSnapshot,
	type Extension,
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
		recursive: false,
		description: "Print a Markdown index of all commands for LLMs",
	},
} as const;

/** The contributed `schema [path...]` command, spelled out because the exported factory needs a declared type. */
type SchemaCommandDefinition<Name extends string = "schema"> = CommandDefinition<
	Name,
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

/** Options for {@link schema}. */
export interface SchemaOptions {
	/**
	 * Command name. Override only if `schema` conflicts with a command of the application.
	 * A literal name keeps the host's command tree type-checked; a dynamic `string` opens it.
	 *
	 * @default "schema"
	 */
	readonly command?: string;
}

/**
 * {@link schema}'s signature: a `command` that is always present flows into the host's
 * command tree, an absent one is `schema`, and a possibly absent one stays open.
 */
export interface SchemaExtension {
	<const Name extends string>(
		options: SchemaOptions & { command: Name },
	): string extends Name
		? Extension<{}, [], typeof llmsFlags>
		: Extension<{}, [], typeof llmsFlags, readonly [SchemaCommandDefinition<Name>]>;
	(
		options?: SchemaOptions & { command?: undefined },
	): Extension<{}, [], typeof llmsFlags, readonly [SchemaCommandDefinition]>;
	// Omitted `Commands` is the open command namespace.
	(options?: SchemaOptions): Extension<{}, [], typeof llmsFlags>;
	readonly id: ExtensionId;
}

/**
 * Render the Markdown index `--llms` prints for `root` and every visible command under it,
 * without running the app. The renderer loads on the first call.
 */
export async function renderCommandIndex(root: CommandSnapshot): Promise<string> {
	return (await import("./schema-render.ts")).renderCommandIndex(root, SCHEMA);
}

const schemaFactory: ExtensionFactory<
	[options?: SchemaOptions],
	{},
	[],
	typeof llmsFlags,
	readonly [SchemaCommandDefinition<string>]
> = /* @__PURE__ */ defineExtension(SCHEMA).factory((extension, options = {}) =>
	extension
		.flags(llmsFlags)
		.add(
			defineCommand(
				options.command ?? "schema",
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
		.handle("llms", async ({ rootCommand, stdout }) =>
			stdout(await renderCommandIndex(rootCommand)),
		),
);

/**
 * Contributes a `schema [path...]` command (renamed with `command`) that prints one line
 * of JSON, `{ input, output? }`, for the command at `path` (the root when omitted), and a
 * root-only `--llms` flag that prints a Markdown index of every visible command, including
 * the documentation sections visible to `schema()` ({@link renderCommandIndex}).
 */
// SAFETY: the runtime command name is `options.command ?? "schema"`, which each overload restates.
export const schema = schemaFactory as SchemaExtension;
