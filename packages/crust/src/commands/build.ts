import { defineCommand } from "@crustjs/core";

import { build } from "../build.ts";
import { ARTIFACT_KINDS } from "../distribute.ts";
import { HOST_TARGET } from "../targets.ts";

/**
 * The `crust build` command: {@link build} with its flags mapped onto
 * its `BuildOptions`, printing progress as it goes. Kept apart from
 * `build.ts` so the programmatic library never constructs this definition.
 *
 * @example
 * ```sh
 * crust build --artifact package               # Stage a root-only runtime package
 * crust build --artifact binary                # Stage binaries for every target of the compiler
 * crust build --artifact binary --target host  # Stage only this machine's target
 * crust build --target bun-linux-x64           # Stage only Linux x64 (crust.artifact: binary)
 * crust build --no-minify                      # Disable minification
 * crust build --env-file .env.production       # Inline PUBLIC_* constants from a file
 * ```
 */
export const buildCommand = defineCommand(
	"build",
	{ description: "Build your CLI for Bun, Deno, or Node" },
	(command) =>
		command
			.flags(
				{
					name: "artifact",
					type: "string",
					choices: ARTIFACT_KINDS,
					description:
						"package: a JavaScript bundle for the installed runtime; binary: standalone executables. Overrides package.json crust.artifact",
				},
				{
					name: "target",
					type: "string",
					multiple: true,
					description: `Canonical compiler target(s) for binaries, or "${HOST_TARGET}" for this machine; repeatable. Omit to stage package.json crust.targets, or every target`,
					short: "t",
				},
				{
					name: "env-file",
					type: "string",
					multiple: true,
					description: "Explicit env file(s) used for build-time constants; repeatable",
				},
				{
					name: "validate",
					type: "boolean",
					description:
						"Materialize command definitions before compiling; --no-validate also skips Extension build hooks",
					default: true,
				},
				{
					name: "minify",
					type: "boolean",
					// No default: deno builds must distinguish an explicit --minify (error)
					// from the implicit bun/node default (true, applied by `build`).
					description: "Minify the output (default for bun and node; unsupported for deno)",
				},
			)
			.action(async ({ flags, stdout, stderr }) => {
				await build({
					cwd: process.cwd(),
					artifact: flags.artifact,
					targets: flags.target,
					envFiles: flags["env-file"],
					minify: flags.minify,
					validate: flags.validate,
					onLog: (line, stream) => (stream === "stderr" ? stderr : stdout)(line),
				});
			}),
);
