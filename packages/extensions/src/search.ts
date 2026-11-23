import {
	type CommandDefinition,
	type CommandShape,
	type Extension,
	type ExtensionFactory,
	type ExtensionId,
	defineCommand,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import type { StandardJSONSchema, StandardSchema } from "@crustjs/utils/schema";

const SEARCH: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:search");

/** One command `search` found, as it prints under `--json` and returns as its result. */
export interface SearchMatch {
	/** The command line without its arguments, e.g. `acme keys rotate`. */
	readonly command: string;
	readonly description?: string;
	/** `false` for a command that only groups subcommands. */
	readonly hasAction: boolean;
}

const MATCHES_JSON_SCHEMA = {
	type: "array",
	items: {
		type: "object",
		properties: {
			command: { type: "string", description: "The command line without its arguments" },
			description: { type: "string" },
			hasAction: {
				type: "boolean",
				description: "false for a command that only groups subcommands",
			},
		},
		required: ["command", "hasAction"],
		additionalProperties: false,
	},
};

const matchesSchema: StandardSchema<readonly SearchMatch[]> &
	StandardJSONSchema<readonly SearchMatch[]> = {
	"~standard": {
		version: 1,
		vendor: "crust",
		// SAFETY: only the action below returns here, and TypeScript checks that it returns matches.
		validate: (value) => ({ value: value as readonly SearchMatch[] }),
		jsonSchema: { input: () => MATCHES_JSON_SCHEMA, output: () => MATCHES_JSON_SCHEMA },
	},
};

const TASK_ARG_DESCRIPTION = "What you want to do, in words";

/** The contributed `search <task...>` command, spelled out because the exported factory needs a declared type. */
type SearchCommandDefinition<Name extends string = "search"> = CommandDefinition<
	Name,
	readonly [],
	CommandShape<
		readonly [
			{
				readonly name: "task";
				readonly type: "string";
				readonly required: true;
				readonly variadic: true;
				readonly description: typeof TASK_ARG_DESCRIPTION;
			},
		],
		{},
		{},
		readonly SearchMatch[],
		{}
	>
>;

/** Options for {@link search}. */
export interface SearchOptions {
	/**
	 * Command name. Override only if `search` conflicts with a command of the application.
	 * A literal name keeps the host's command tree type-checked; a dynamic `string` opens it.
	 *
	 * @default "search"
	 */
	readonly command?: string;
}

/**
 * {@link search}'s signature: a `command` that is always present flows into the host's
 * command tree, an absent one is `search`, and a possibly absent one stays open.
 */
export interface SearchExtension {
	<const Name extends string>(
		options: SearchOptions & { command: Name },
	): string extends Name
		? Extension<{}, [], {}>
		: Extension<{}, [], {}, readonly [SearchCommandDefinition<Name>]>;
	(
		options?: SearchOptions & { command?: undefined },
	): Extension<{}, [], {}, readonly [SearchCommandDefinition]>;
	// Omitted `Commands` is the open command namespace.
	(options?: SearchOptions): Extension<{}, [], {}>;
	readonly id: ExtensionId;
}

const searchFactory: ExtensionFactory<
	[options?: SearchOptions],
	{},
	[],
	{},
	readonly [SearchCommandDefinition<string>]
> = /* @__PURE__ */ defineExtension(SEARCH).factory((extension, options = {}) => {
	const name = options.command ?? "search";
	return extension
		.sections((root) => [
			{ command: [], title: "Find a command", body: `${root.meta.name} ${name} "<task>"` },
		])
		.add(
			defineCommand(
				name,
				{ description: "Find the commands that best match a task described in words" },
				(cmd) =>
					cmd
						.args({
							name: "task",
							type: "string",
							required: true,
							variadic: true,
							description: TASK_ARG_DESCRIPTION,
						})
						.output(matchesSchema)
						.action(async ({ args, rootCommand, stdout }) => {
							// The index loads only when the command runs.
							const { searchCommands, formatMatches } = await import("./search-render.ts");
							const task = args.task.join(" ");
							const matches = searchCommands(rootCommand, task);
							stdout(formatMatches(matches, task));
							return matches;
						}),
			),
		);
});

/**
 * Contributes a `search <task...>` command (renamed with `command`) that finds the five
 * visible commands, groups and Extension commands included, that best match a task
 * described in words, prints them one per line, and returns them as its result. Adds a
 * "Find a command" section to the root command's documentation.
 *
 * @see https://crustjs.com/docs/modules/extensions/search
 */
// SAFETY: the runtime command name is `options.command ?? "search"`, which each overload restates.
export const search = searchFactory as SearchExtension;
