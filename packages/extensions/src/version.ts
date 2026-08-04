import { type Extension, type ExtensionContext, defineExtension } from "@crustjs/core";

export type VersionValue = string | (() => string);

export interface VersionExtensionOptions {
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
