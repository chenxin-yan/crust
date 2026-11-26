import {
	type Extension,
	type RootMetaKey,
	type ExtensionId,
	type ExtensionContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const VERSION: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:version");

export type VersionValue = string | (() => string);

export interface VersionOptions {
	/**
	 * Output format. `"plain"` prints the bare version (script-friendly:
	 * `$(cli --version)`); a function receives the resolved version and the
	 * extension context and returns the line to print.
	 *
	 * @default `${rootName} v${version}`
	 */
	readonly format?:
		| ("plain" | ((version: string, context: ExtensionContext) => string))
		| undefined;
	/**
	 * Short spelling of `--version`: `"V"` where the application uses `-v` for
	 * something else, such as `--verbose`, or `false` for none.
	 *
	 * @default "v"
	 */
	readonly short?: "v" | "V" | false | undefined;
}

const versionFlag = {
	type: "boolean",
	description: "Show version number",
	recursive: false,
} as const;

type VersionFlags = { readonly version: typeof versionFlag & { readonly short?: "v" | "V" } };

type VersionRegistration<K extends RootMetaKey> = Extension<{}, [], VersionFlags, [], K>;

/** Explicit values supply their own version; omitted values require root metadata. */
export interface VersionExtension {
	(value: VersionValue, options?: VersionOptions): VersionRegistration<never>;
	(value?: VersionValue, options?: VersionOptions): VersionRegistration<"version">;
	readonly id: ExtensionId;
}

// The builder requires no metadata so one factory serves both overloads; the
// `VersionExtension` annotation narrows omitted values to require root `version`.
export const version: VersionExtension = /* @__PURE__ */ defineExtension(VERSION).factory(
	(extension, value?: VersionValue, options: VersionOptions = {}) => {
		const { format, short = "v" } = options;
		const flags: VersionFlags = { version: short ? { ...versionFlag, short } : versionFlag };
		return extension.flags(flags).handle(
			"version",
			(context) => {
				// SAFETY: the `VersionExtension` overloads require root `version` metadata when `value` is omitted.
				const resolvedVersion =
					typeof value === "function" ? value() : (value ?? context.rootCommand.meta.version!);
				const line =
					format === "plain"
						? resolvedVersion
						: format
							? format(resolvedVersion, context)
							: `${context.rootCommand.meta.name} v${resolvedVersion}`;
				context.stdout(line);
			},
			{ eager: true },
		);
	},
);
