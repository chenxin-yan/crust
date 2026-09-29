import {
	CrustError,
	type Extension,
	type RootMetaKey,
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

const versionFlags = [
	{
		name: "version",
		type: "boolean",
		short: "v",
		noNegate: true,
		description: "Show version number",
		recursive: false,
	},
] as const;

type VersionRegistration<K extends RootMetaKey> = Extension<{}, [], typeof versionFlags, [], K>;

/** Explicit values supply their own version; omitted values require root metadata. */
export interface VersionExtension {
	(value: VersionValue, options?: VersionOptions): VersionRegistration<never>;
	(value?: VersionValue, options?: VersionOptions): VersionRegistration<"version">;
	readonly id: ExtensionId;
}

// The builder requires no metadata so one factory serves both overloads; the
// `VersionExtension` annotation narrows omitted values to require root `version`.
export const version: VersionExtension = defineExtension(VERSION).factory(
	(extension, value?: VersionValue, options: VersionOptions = {}) => {
		const { format } = options;
		return extension.flags(...versionFlags).preRun((context) => {
			if (context.commandPath.length !== 1 || context.flags.version !== true) return;
			const resolvedVersion =
				// oxlint-disable-next-line anti-slop/no-runtime-typeof -- discriminating a typed options union.
				typeof value === "function" ? value() : (value ?? context.rootCommand.meta.version);
			// Overloads are type-only; Bun and Node builds skip the check.
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
			return context.handled();
		});
	},
);
