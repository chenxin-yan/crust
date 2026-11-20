import type { ContextBag, ContextMap } from "@crustjs/core";

import type { ApiRequest } from "./api-command.ts";
import type { JsonSchema } from "./schema.ts";
import type { BodyNamesOf, ParamNamesOf } from "./typed-client.ts";

/**
 * How one operation becomes a command; every field left out (or `undefined`) uses the default.
 * Given for every operation by `.each()`, or for one operationId by `.override()`, whose fields
 * replace the rule's. With a registered spec, an `.override()` entry's input names are checked.
 */
export interface OperationOverride<Deps extends ContextMap = {}, Op = unknown> {
	/** Leaves the operation out. Default: the operation's `deprecated`. */
	readonly exclude?: boolean;
	/** A group path as typed on the command line, such as `"dns records"`; `""` is the root. Default: the first tag in kebab case, else `""`. */
	readonly group?: string;
	/** Default: the operationId in kebab case, without a leading `<group>-`. */
	readonly name?: string;
	readonly hidden?: boolean;
	/** Default: the operation's summary. */
	readonly description?: string;
	/** Flag or argument names, by the spec's parameter or top-level body field name. Default: the name in kebab case. */
	readonly flagName?: { readonly [Name in InputNamesOf<Op>]?: string };
	/** Parameters that become positional arguments, in order. Default: the path parameters in template order. */
	readonly positional?: readonly ParamNamesOf<Op>[];
	/** Parameters or top-level body fields the command fills itself, with no input. Called before each request. */
	readonly bind?: {
		readonly [Name in InputNamesOf<Op>]?: (ctx: ContextBag<Deps>) => string | Promise<string>;
	};
	/** The message `.onConfirm()` gets before each request. Without `.onConfirm()`, the operation is left out. */
	readonly confirm?: string | false;
	/** The next page's request for `--paginate`, or `undefined` after the last page. Default: `defineApi`'s `paginate`. */
	readonly paginate?: (
		response: Response,
	) => ApiRequest | undefined | Promise<ApiRequest | undefined>;
	/** The command's result from the response body, such as `(body) => (body as { result: unknown }).result`. */
	readonly unwrap?: (body: unknown, response: Response) => unknown;
	/** The JSON Schema of the result after `unwrap`; without it, an `unwrap`ped command advertises no output schema. */
	readonly outputSchema?: JsonSchema;
}

/** An `.override()` entry: an {@link OperationOverride} and the method and path it was written for. */
export type OverrideEntry<Deps extends ContextMap = {}, Op = unknown> = OperationOverride<
	Deps,
	Op
> & {
	/** Checked by `crust build`: an operation that moved fails it (`override-stale`). */
	readonly expect?: { readonly method: string; readonly path: string };
};

type InputNamesOf<Op> = unknown extends Op ? string : ParamNamesOf<Op> | BodyNamesOf<Op>;

/** The rule's fields, each replaced by the entry's when the entry sets it. */
export function mergeOverride(
	rule: OperationOverride | undefined,
	entry: OperationOverride | undefined,
): OperationOverride {
	return Object.fromEntries(
		[...Object.entries(rule ?? {}), ...Object.entries(entry ?? {})].filter(
			([, value]) => value !== undefined,
		),
	);
}
