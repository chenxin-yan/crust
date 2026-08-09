import { type Extension, type ExtensionContext, defineExtension } from "@crustjs/core";

export type VersionValue = string | (() => string);

export interface VersionOptions {
	/**
	 * Output format. `"plain"` prints the bare version (script-friendly:
	 * `$(cli --version)`); a function receives the resolved version and the
	 * extension context and returns the line to print.
	 *
	 * @default `${rootName} v${version}`
	 */
	readonly format?: "plain" | ((version: string, context: ExtensionContext) => string);
}

export function version(
	versionValue: VersionValue = "0.0.0",
	options: VersionOptions = {},
): Extension {
	const { format } = options;

	return defineExtension("version", {
		flags: {
			version: {
				type: "boolean",
				short: "v",
				noNegate: true,
				description: "Show version number",
				recursive: false,
			},
		},
		hooks: {
			preRun(context) {
				// Root invocation with --version only
				if (context.commandPath.length !== 1 || context.flags.version !== true) return;

				const resolvedVersion = typeof versionValue === "function" ? versionValue() : versionValue;
				const line =
					format === "plain"
						? resolvedVersion
						: format
							? format(resolvedVersion, context)
							: `${context.rootCommand.meta.name} v${resolvedVersion}`;
				context.stdout(line);
				return context.finish();
			},
		},
	});
}
