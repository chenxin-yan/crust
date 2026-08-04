import { type Extension, type ExtensionContext, defineExtension } from "@crustjs/core";

export type VersionValue = string | (() => string);

export interface VersionExtensionOptions {
	/**
	 * Short alias for `--version`. Pass `false` to disable the short alias
	 * (e.g. to free `-v` for a verbose flag), or another character such as
	 * `"V"` for Commander-style CLIs.
	 *
	 * @default "v"
	 */
	readonly short?: string | false;
	/**
	 * Output format. `"plain"` prints the bare version (script-friendly:
	 * `$(cli --version)`); a function receives the resolved version and the
	 * extension context and returns the line to print.
	 *
	 * @default `${rootName} v${version}`
	 */
	readonly format?: "plain" | ((version: string, context: ExtensionContext) => string);
}

export function versionExtension(
	versionValue: VersionValue = "0.0.0",
	options: VersionExtensionOptions = {},
): Extension {
	const { short = "v", format } = options;

	return defineExtension("version", {
		flags: {
			version: {
				type: "boolean",
				...(short === false ? {} : { short }),
				noNegate: true,
				description: "Show version number",
				recursive: false,
			},
		},
		hooks: {
			preRun(context) {
				// Root invocation with --version only
				if (context.commandPath.length !== 1 || context.flags.version !== true) return;

				const version = typeof versionValue === "function" ? versionValue() : versionValue;
				const line =
					format === "plain"
						? version
						: format
							? format(version, context)
							: `${context.rootCommand.meta.name} v${version}`;
				context.stdout(line);
				return context.finish();
			},
		},
	});
}
