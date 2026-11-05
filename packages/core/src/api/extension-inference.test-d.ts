import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineExtensionId } from "../identity.ts";
import type { ParsedFlagValue } from "../types.ts";
import { defineExtension, type InferExtensionFlags } from "./extension.ts";

type Port = { type: "number"; default: number };
type Host = { type: "string"; default: string };
// Hooks run before validation, so an invalid value leaves even a defaulted flag unset.
type _fixed = Expect<Equal<InferExtensionFlags<{ port: Port }>["port"], number | undefined>>;
type _dynamic = Expect<Equal<InferExtensionFlags<Record<string, Port>>["port"], ParsedFlagValue>>;
type _recordUnion = Expect<
	Equal<InferExtensionFlags<{ port: Port } | { host: Host }>["port"], ParsedFlagValue>
>;
type _optional = Expect<Equal<InferExtensionFlags<{ port?: Port }>["port"], ParsedFlagValue>>;
type _requiredBesideOptional = Expect<
	Equal<InferExtensionFlags<{ port?: Port; host: Host }>["host"], string | undefined>
>;
type _keyUnion = Expect<
	Equal<InferExtensionFlags<Record<"port" | "host", Port>>["port"], number | undefined>
>;
type _open = Expect<
	Equal<InferExtensionFlags<Record<`port-${string}`, Port>>["port-x"], ParsedFlagValue>
>;
type _true = Expect<
	Equal<InferExtensionFlags<{ port: Port & { recursive: true } }>["port"], number | undefined>
>;
type _optionalTrue = Expect<
	Equal<InferExtensionFlags<{ port: Port & { recursive?: true } }>["port"], number | undefined>
>;
type _false = Expect<
	Equal<InferExtensionFlags<{ port: Port & { recursive: false } }>["port"], number | undefined>
>;
type _boolean = Expect<
	Equal<InferExtensionFlags<{ port: Port & { recursive: boolean } }>["port"], number | undefined>
>;
type _optionalScope = Expect<
	Equal<InferExtensionFlags<{ port: Port & { recursive?: boolean } }>["port"], number | undefined>
>;

type Strict = {
	type: "boolean";
	default: true;
	noNegate: true;
	env: { name: "COLOR" };
};
// Argv booleans cannot be invalid; only an env `false` under `noNegate` leaves one unset.
type _defaultedBoolean = Expect<
	Equal<InferExtensionFlags<{ quiet: { type: "boolean"; default: false } }>["quiet"], boolean>
>;
type _strictBoolean = Expect<
	Equal<InferExtensionFlags<{ color: Strict }>["color"], boolean | undefined>
>;

type Toggle = { type: "boolean"; schema: StandardSchema<unknown, number> };
type _scalar = Expect<
	Equal<InferExtensionFlags<{ toggle: Toggle }>["toggle"], boolean | undefined>
>;
type _multiple = Expect<
	Equal<
		InferExtensionFlags<{ toggle: Toggle & { multiple: true } }>["toggle"],
		boolean[] | undefined
	>
>;
type _optionalMultiple = Expect<
	Equal<
		InferExtensionFlags<{ toggle: Toggle & { multiple?: true } }>["toggle"],
		boolean | boolean[] | undefined
	>
>;

function _contextual(
	recursive: boolean,
	flags: Record<string, Port>,
	toggle: Toggle & { multiple?: true },
) {
	const optional: { port?: Port } = {};
	defineExtension(defineExtensionId("optional"))
		.flags(optional)
		.preRun(({ flags }) => {
			// @ts-expect-error An absent definition lets a peer own this name with another value type.
			flags.port?.toFixed();
		})
		.postRun(({ flags }) => {
			// @ts-expect-error Post-run hooks have the same uncertain ownership.
			flags.port?.toFixed();
		});
	defineExtension(defineExtensionId("defaulted"))
		.flags({ port: { type: "number", default: 123 } })
		.preRun(({ flags }) => {
			// @ts-expect-error `--port abc` leaves a defaulted flag unset until validation reports it.
			flags.port.toFixed();
		})
		.postRun(({ flags }) => {
			// @ts-expect-error A failed invocation's post-run hooks see the same unvalidated value.
			flags.port.toFixed();
		});
	defineExtension(defineExtensionId("scope"))
		.flags({ port: { type: "number", default: 123, recursive } })
		.preRun(({ flags }) => {
			// @ts-expect-error A false-capable scope may omit this flag on descendants.
			const value: number = flags.port;
			void value;
		});
	defineExtension(defineExtensionId("collection"))
		.flags(flags)
		.preRun(({ flags }) => {
			// @ts-expect-error A dynamic record permits other extensions to supply another value type.
			const value: number | undefined = flags.port;
			void value;
		});
	defineExtension(defineExtensionId("multiple"))
		.flags({ toggle })
		.preRun(({ flags }) => {
			// @ts-expect-error Optional multiplicity permits an array before schema validation.
			const value: boolean | undefined = flags.toggle;
			void value;
		});
}
