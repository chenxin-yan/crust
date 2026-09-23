import {
	type AnyCrust,
	type CommandDefinition,
	type CommandShape,
	defineCommand,
	defineExtension,
	defineExtensionId,
	type ExtensionFactory,
	type ExtensionId,
} from "@crustjs/core";

import { createMcpServer, serveStdio } from "./server.ts";
import { MCP_COMMAND_NAME, type McpToolsOptions } from "./tools.ts";

export const MCP: ExtensionId = defineExtensionId("crust:mcp");

export const MCP_CLIENTS = ["claude", "cursor", "vscode"] as const;
export type McpClient = (typeof MCP_CLIENTS)[number];

export interface McpExtensionOptions extends McpToolsOptions {
	/**
	 * Returns the completed application to serve. Called when `mcp` runs, not
	 * when the Extension is installed, so it may return the variable the
	 * `.extend()` result is being assigned to: `mcpExtension({ app: (): AnyCrust => app })`.
	 * The return annotation keeps TypeScript from seeing a self-referential initializer.
	 */
	readonly app: () => AnyCrust;
}

/** How an MCP client starts this CLI: the executable plus the arguments before `mcp`. */
export interface McpLaunch {
	readonly command: string;
	readonly args: readonly string[];
}

/**
 * Compiled executables (`bun build --compile`, `deno compile`) are their own
 * launcher; source files and Node bundles relaunch through the runtime running
 * them, with the entry path as the first argument.
 */
export function resolveLaunch(
	execPath: string,
	entry: string | undefined,
	compiled: boolean,
): McpLaunch {
	return compiled || entry === undefined
		? { command: execPath, args: [MCP_COMMAND_NAME] }
		: { command: execPath, args: [entry, MCP_COMMAND_NAME] };
}

type StandaloneGlobals = {
	Deno?: { build?: { standalone?: boolean } };
};

/** Bun serves a compiled entry from `/$bunfs/` (POSIX) or `<drive>:/~BUN/` (Windows); Deno flags standalone builds. */
function isCompiledExecutable(entry: string | undefined): boolean {
	// SAFETY: the global is optional and every access is optional-chained.
	const { Deno } = globalThis as StandaloneGlobals;
	return (
		entry?.startsWith("/$bunfs/") === true ||
		(entry !== undefined && /^[A-Za-z]:[\\/]~BUN[\\/]/.test(entry)) ||
		Deno?.build?.standalone === true
	);
}

/** Launch identity of the current process. */
export function currentLaunch(): McpLaunch {
	const entry = process.argv[1];
	return resolveLaunch(process.execPath, entry, isCompiledExecutable(entry));
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

function shellQuote(token: string): string {
	return /^[A-Za-z0-9_./:=@%+-]+$/.test(token)
		? token
		: `'${token.replaceAll("'", String.raw`'\''`)}'`;
}

/** `claude mcp add <name> -- <command> <args…>` registers the server without editing config files by hand. */
export function renderClaudeAddCommand(name: string, launch: McpLaunch): string {
	return ["claude", "mcp", "add", name, "--", launch.command, ...launch.args]
		.map(shellQuote)
		.join(" ");
}

const CLIENT_FLAG_DESCRIPTION = "Client whose configuration format to print";

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
	CommandShape<[], {}, { config: CommandShape<[], McpConfigFlags, {}, void, {}> }, void, {}>
>;

/**
 * Adds `mcp`, which serves the application's commands as MCP tools over stdio,
 * and `mcp config`, which prints a client configuration snippet.
 */
export const mcpExtension: ExtensionFactory<
	[options: McpExtensionOptions],
	{},
	[],
	[],
	readonly [McpCommandDefinition]
> = defineExtension(MCP, (options) => ({
	commands: [
		defineCommand(
			MCP_COMMAND_NAME,
			{ description: "Serve this CLI's commands as MCP tools over stdio" },
			(command) =>
				command
					.add(
						defineCommand(
							"config",
							{ description: "Print the MCP client configuration for this CLI" },
							(sub) =>
								sub
									.flags({
										name: "client",
										type: "string",
										choices: MCP_CLIENTS,
										default: "claude",
										description: CLIENT_FLAG_DESCRIPTION,
									})
									.action((context) => {
										const name = context.rootCommand.meta.name;
										const launch = currentLaunch();
										const client = context.flags.client;
										context.stdout(renderClientConfig(client, name, launch));
										if (client === "claude") {
											context.stderr(`Or run: ${renderClaudeAddCommand(name, launch)}`);
										}
									}),
						),
					)
					.action(async () => {
						await serveStdio(await createMcpServer(options.app(), options));
					}),
		),
	],
}));
