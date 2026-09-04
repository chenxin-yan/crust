import type { AnyCrust } from "../src/command/crust.ts";
import type { CommandAction, CommandNode } from "../src/command/node.ts";
import { createCommandNode, registerFlag } from "../src/command/node.ts";
import type { ArgsDef, CommandMeta, FlagsDef } from "../src/types.ts";

export type Expect<T extends true> = T;
export type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

export function makeNode<
	const A extends ArgsDef = ArgsDef,
	const F extends FlagsDef = FlagsDef,
>(config: {
	meta: string | CommandMeta;
	args?: A;
	flags?: F;
	subCommands?: Record<string, CommandNode>;
	run?: CommandAction;
}): CommandNode & { args: A; effectiveFlags: F } {
	// oxlint-disable-next-line anti-slop/no-runtime-typeof -- test fixtures intentionally accept either shorthand names or full metadata.
	const meta = typeof config.meta === "string" ? { name: config.meta } : config.meta;
	const node = createCommandNode(meta.name);
	if (meta.description) node.meta.description = meta.description;
	if (meta.usage) node.meta.usage = meta.usage;
	if (config.flags) {
		for (const [name, def] of Object.entries(config.flags)) registerFlag(node, name, def, "local");
	}
	if (config.args) node.args = [...config.args];
	if (config.subCommands) node.subCommands = { ...config.subCommands };
	if (config.run) node.run = config.run;
	// SAFETY: the fixture copies config.args and config.flags into the returned node above.
	return node as CommandNode & { args: A; effectiveFlags: F };
}

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

/**
 * Execute a Crust builder with the given argv and capture all output.
 *
 * Usage:
 *   const result = await executeCrust(myApp, ["--flag", "value"]);
 *   expect(result.stdout).toContain("expected output");
 *   expect(result.exitCode).toBe(0);
 */
export async function executeCrust(builder: AnyCrust, argv?: string[]): Promise<RunResult> {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	let exitCode = 0;
	const originalExitCode = process.exitCode;

	try {
		await builder.execute({
			argv,
			io: {
				stdout: (text) => stdoutChunks.push(text),
				stderr: (text) => stderrChunks.push(text),
			},
		});
	} catch (error) {
		stderrChunks.push(error instanceof Error ? error.message : String(error));
		exitCode = 1;
	} finally {
		if (process.exitCode != null && process.exitCode !== originalExitCode) {
			exitCode = Number(process.exitCode);
		}
		process.exitCode = originalExitCode;
	}

	return {
		stdout: stdoutChunks.join("\n"),
		stderr: stderrChunks.join("\n"),
		exitCode,
	};
}
