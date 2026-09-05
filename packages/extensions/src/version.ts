import {
	CrustError,
	type ExtensionFactory,
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

export const version: ExtensionFactory<[versionValue?: VersionValue, options?: VersionOptions]> =
	defineExtension(VERSION, (versionValue, options = {}) => {
		const { format } = options;

		return {
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

					// oxlint-disable-next-line anti-slop/no-runtime-typeof -- discriminating a typed options union.
					const override = typeof versionValue === "function" ? versionValue() : versionValue;
					const resolvedVersion = override ?? context.rootCommand.meta.version;
					if (resolvedVersion === undefined) {
						throw new CrustError(
							"DEFINITION",
							"The version extension requires a version in new Crust(name, { version }) or version(value)",
						);
					}
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
		};
	});
