import {
	type Extension,
	type ExtensionId,
	type ExtensionContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const VERSION: ExtensionId = defineExtensionId("crust:version");

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

function versionFactory(
	versionValue: VersionValue = "0.0.0",
	options: VersionOptions = {},
): Extension {
	const { format } = options;

	return defineExtension(VERSION, {
		flags: [
			{
				name: "version",
				type: "boolean",
				short: "v",
				noNegate: true,
				description: "Show version number",
				recursive: false,
			},
		],
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

export const version: typeof versionFactory & { readonly id: ExtensionId } = Object.assign(
	versionFactory,
	{ id: VERSION },
);
