import {
	type CommandDefinition,
	type CommandShape,
	defineCommand,
	defineExtension,
	defineExtensionId,
	type ExtensionFactory,
	type ExtensionId,
} from "@crustjs/core";
import { isCompiledExecutable } from "@crustjs/utils/artifacts";
import { shellQuote } from "@crustjs/utils/process";
import type { StandardJSONSchema, StandardSchema } from "@crustjs/utils/schema";

import { type McpServerOptions, serveFromSnapshot } from "./server.ts";
import { MCP_COMMAND_NAME, type McpToolAnnotations } from "./tools.ts";

declare module "@crustjs/core" {
	interface CommandExtras {
		/**
		 * Read only by `mcp()`: `false` keeps the command and everything under it out of the MCP
		 * tools; an object's hints become the tool's `annotations`.
		 */
		mcp?: false | McpToolAnnotations;
	}
}

export const MCP: ExtensionId = defineExtensionId("crust:mcp");

export const MCP_CLIENTS = ["claude", "cursor", "vscode"] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export interface McpExtensionOptions extends McpServerOptions {
	/** Explicit client launch, including `mcp`; use for custom runtime setup. */
	readonly launch?: McpLaunch;
}

/** How an MCP client starts this CLI: the executable plus all arguments, including `mcp`. */
export interface McpLaunch {
	readonly command: string;
	readonly args: readonly string[];
}

/**
 * Compiled executables (`bun build --compile`, Node SEA) are their own
 * launcher; source files and Node bundles relaunch through the runtime running
 * them, with runtime options before the entry path.
 */
export function resolveLaunch(
	execPath: string,
	entry: string | undefined,
	compiled: boolean,
	execArgv: readonly string[] = [],
): McpLaunch {
	return compiled || entry === undefined
		? { command: execPath, args: [MCP_COMMAND_NAME] }
		: { command: execPath, args: [...execArgv, entry, MCP_COMMAND_NAME] };
}

/** Launch identity of the current process. */
export function currentLaunch(): McpLaunch {
	return resolveLaunch(process.execPath, process.argv[1], isCompiledExecutable(), process.execArgv);
}

/**
 * Client configuration snippet. Claude Code, Claude Desktop, and Cursor read
 * `mcpServers`; VS Code's `.vscode/mcp.json` reads `servers`.
 */
export function renderClientConfig(client: McpClient, name: string, launch: McpLaunch): string {
	const entry = { type: "stdio", command: launch.command, args: launch.args };
	const config =
		client === "vscode" ? { servers: { [name]: entry } } : { mcpServers: { [name]: entry } };
	return JSON.stringify(config, null, 2);
}

/** `claude mcp add <name> -- <command> <args…>` registers the server without editing config files by hand. */
export function renderClaudeAddCommand(name: string, launch: McpLaunch): string {
	return ["claude", "mcp", "add", name, "--", launch.command, ...launch.args]
		.map(shellQuote)
		.join(" ");
}

const CLIENT_FLAG_DESCRIPTION = "Client whose configuration format to print";

const TEXT_JSON_SCHEMA = { type: "string" };

/** `mcp config` returns the snippet it prints, so `--json` prints it once, as a JSON string. */
const textOutput: StandardSchema<string> & StandardJSONSchema<string> = {
	"~standard": {
		version: 1,
		vendor: "crust",
		// SAFETY: only the `mcp config` action returns here, and TypeScript checks that it returns text.
		validate: (value) => ({ value: value as string }),
		jsonSchema: { input: () => TEXT_JSON_SCHEMA, output: () => TEXT_JSON_SCHEMA },
	},
};

/** Flags of `mcp config`. */
export type McpConfigFlags = {
	readonly client: {
		readonly type: "string";
		readonly choices: typeof MCP_CLIENTS;
		readonly default: "claude";
		readonly description: typeof CLIENT_FLAG_DESCRIPTION;
	};
};

/**
 * The contributed `mcp` command, spelled out because the exported factory needs
 * a declared type: a closed name keeps the host's command tree precise after
 * `.extend()`, unlike an open `CommandDefinition[]` contribution.
 */
export type McpCommandDefinition = CommandDefinition<
	typeof MCP_COMMAND_NAME,
	readonly [],
	CommandShape<[], {}, { config: CommandShape<[], McpConfigFlags, {}, string, {}> }, void, {}>
>;

/**
 * Adds `mcp`, which serves the application's commands as MCP tools over stdio,
 * and `mcp config`, which prints a client configuration snippet. Owns the `mcp`
 * key on command metadata.
 */
export const mcp: ExtensionFactory<
	[options?: McpExtensionOptions],
	{},
	[],
	{},
	readonly [McpCommandDefinition]
> = defineExtension(MCP)
	.owns("mcp")
	.factory((extension, options = {}) =>
		extension.add(
			defineCommand(
				MCP_COMMAND_NAME,
				{ description: "Serve this CLI's commands as MCP tools over stdio", mcp: false },
				(command) =>
					command
						.add(
							defineCommand(
								"config",
								{ description: "Print the MCP client configuration for this CLI" },
								(sub) =>
									sub
										.flags({
											client: {
												type: "string",
												choices: MCP_CLIENTS,
												default: "claude",
												description: CLIENT_FLAG_DESCRIPTION,
											},
										})
										.output(textOutput)
										.action((context) => {
											const name = context.rootCommand.meta.name;
											const launch = options.launch ?? currentLaunch();
											const client = context.flags.client;
											const config = renderClientConfig(client, name, launch);
											context.stdout(config);
											if (client === "claude") {
												context.stderr(`Or run: ${renderClaudeAddCommand(name, launch)}`);
											}
											return config;
										}),
							),
						)
						.action(async ({ rootCommand, runCommand }) => {
							await serveFromSnapshot(rootCommand, runCommand, options);
						}),
			),
		),
	);
