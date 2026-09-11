import {
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

function makeVersion<K extends RootMetaKey>(
	resolve: (context: ExtensionContext<[], {}, K>) => string,
	options: VersionOptions,
): VersionRegistration<K> {
	const { format } = options;
	return defineExtension<K>()(VERSION, {
		flags: versionFlags,
		hooks: {
			preRun(context) {
				if (context.commandPath.length !== 1 || context.flags.version !== true) return;
				const resolvedVersion = resolve(context);
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

function createVersion(value: VersionValue, options?: VersionOptions): VersionRegistration<never>;
function createVersion(
	value?: VersionValue,
	options?: VersionOptions,
): VersionRegistration<"version">;
function createVersion(
	value?: VersionValue,
	options: VersionOptions = {},
): VersionRegistration<"version"> {
	if (value === undefined) {
		return makeVersion<"version">((context) => context.rootCommand.meta.version, options);
	}
	return makeVersion<never>(() => {
		// oxlint-disable-next-line anti-slop/no-runtime-typeof -- discriminating a typed options union.
		return typeof value === "function" ? value() : value;
	}, options);
}

export const version: VersionExtension = Object.assign(createVersion, { id: VERSION });
