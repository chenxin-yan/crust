import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineCommand } from "@crust/core";

/**
 * The `crust dev` command.
 *
 * Starts your CLI in development mode with hot module reload using `bun --hot`.
 * Any arguments after `--` are forwarded to the spawned child process.
 *
 * @example
 * ```sh
 * crust dev                          # Start dev with default entry (src/cli.ts)
 * crust dev --entry src/main.ts      # Custom entry point
 * crust dev -- serve --port 3000     # Forward args to your CLI
 * ```
 */
export const devCommand = defineCommand({
	meta: {
		name: "dev",
		description: "Start your CLI in development mode with hot reload",
	},
	flags: {
		entry: {
			type: String,
			description: "Entry file path",
			default: "src/cli.ts",
			alias: "e",
		},
	},
	async run({ flags, rawArgs }) {
		const cwd = process.cwd();

		// Resolve entry file path relative to cwd
		const entryPath = resolve(cwd, flags.entry);

		// Verify entry file exists
		if (!existsSync(entryPath)) {
			throw new Error(
				`Entry file not found: ${entryPath}\n  Specify a valid entry file with --entry <path>`,
			);
		}

		// Build the bun --hot args, forwarding rawArgs (anything after --)
		const args: string[] = ["--hot", entryPath, ...rawArgs];

		console.log(`Starting dev server with hot reload: ${entryPath}`);

		// Spawn bun --hot with inherited stdio so the child shares the terminal
		const proc = Bun.spawn(["bun", ...args], {
			cwd,
			stdout: "inherit",
			stderr: "inherit",
			stdin: "inherit",
		});

		// Handle graceful shutdown: forward SIGINT and SIGTERM to child
		const handleSignal = () => {
			proc.kill();
		};

		process.on("SIGINT", handleSignal);
		process.on("SIGTERM", handleSignal);

		try {
			// Wait for the child process to exit
			const exitCode = await proc.exited;

			if (exitCode !== 0) {
				throw new Error(`Dev process exited with code ${exitCode}`);
			}
		} finally {
			// Clean up signal handlers
			process.removeListener("SIGINT", handleSignal);
			process.removeListener("SIGTERM", handleSignal);
		}
	},
});
