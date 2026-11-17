import {
	type ContextInstance,
	type ExtensionFactory,
	type ExtensionId,
	defineContext,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";

const QUIET: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:quiet");

type QuietFlags = {
	readonly quiet: {
		readonly type: "boolean";
		readonly short: "q";
		readonly description: string;
		readonly env?: { readonly name: string };
	};
};

export interface QuietOptions {
	/** Environment variable read when the flag is omitted: `1` or `true` turns quiet on, any other value leaves it off. */
	readonly env?: string;
}

/**
 * Provides the `quiet` Context, a boolean read from `--quiet` / `-q`, then the
 * `env` variable, then `false`. Commands that `.use(quiet)` await `ctx.quiet` and
 * skip their own optional output; nothing else reads it.
 */
export const quiet: ExtensionFactory<
	[options?: QuietOptions],
	{},
	readonly [ContextInstance<"quiet", boolean, QuietFlags, {}>]
> = /* @__PURE__ */ defineExtension(QUIET).factory((extension, options: QuietOptions = {}) => {
	const quietFlags: QuietFlags = {
		quiet: {
			type: "boolean",
			short: "q",
			description: "Print less output",
			// Not noNegate: an environment value other than `1` or `true` must read as false, not fail.
			...(options.env === undefined ? {} : { env: { name: options.env } }),
		},
	};
	return extension.provide(
		defineContext("quiet")
			.flags(quietFlags)
			.setup(({ flags }) => flags.quiet === true)(),
	);
});
