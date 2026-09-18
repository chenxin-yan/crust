import type { StandardSchema } from "@crustjs/utils/schema";

import type { Equal, Expect } from "../../tests/helpers.ts";
import { defineExtensionId } from "../identity.ts";
import type { ParsedFlagValue } from "../types.ts";
import { defineExtension, type InferExtensionFlags } from "./extension.ts";

type Port = { name: "port"; type: "number"; default: number };
type Host = { name: "host"; type: "string"; default: string };
type Flags<D extends readonly (Port | Host)[]> = InferExtensionFlags<D>;
type _fixed = Expect<Equal<Flags<readonly [Port]>["port"], number>>;
type _array = Expect<Equal<Flags<Port[]>["port"], ParsedFlagValue>>;
type _tupleUnion = Expect<Equal<Flags<readonly [Port] | readonly [Host]>["port"], ParsedFlagValue>>;
type _memberUnion = Expect<Equal<Flags<readonly [Port | Host]>["port"], ParsedFlagValue>>;
type _nameUnion = Expect<
	Equal<
		InferExtensionFlags<
			readonly [{ name: "port" | "host"; type: "number"; default: number }]
		>["port"],
		ParsedFlagValue
	>
>;
type _open = Expect<
	Equal<
		InferExtensionFlags<
			readonly [{ name: `port-${string}`; type: "number"; default: number }]
		>["port-x"],
		ParsedFlagValue
	>
>;
type _true = Expect<
	Equal<InferExtensionFlags<readonly [Port & { recursive: true }]>["port"], number>
>;
type _optionalTrue = Expect<
	Equal<InferExtensionFlags<readonly [Port & { recursive?: true }]>["port"], number>
>;
type _false = Expect<
	Equal<InferExtensionFlags<readonly [Port & { recursive: false }]>["port"], number | undefined>
>;
type _boolean = Expect<
	Equal<InferExtensionFlags<readonly [Port & { recursive: boolean }]>["port"], number | undefined>
>;
type _optionalScope = Expect<
	Equal<InferExtensionFlags<readonly [Port & { recursive?: boolean }]>["port"], number | undefined>
>;

type Toggle = { name: "toggle"; type: "boolean"; schema: StandardSchema<unknown, number> };
type Token = { name: "token"; type: "string"; schema: StandardSchema<unknown, number> };
type _scalar = Expect<Equal<InferExtensionFlags<readonly [Toggle]>["toggle"], boolean | undefined>>;
type _multiple = Expect<
	Equal<
		InferExtensionFlags<readonly [Toggle & { multiple: true }]>["toggle"],
		boolean[] | undefined
	>
>;
type _optionalMultiple = Expect<
	Equal<
		InferExtensionFlags<readonly [Toggle & { multiple?: true }]>["toggle"],
		boolean | boolean[] | undefined
	>
>;
type _optionalTokens = Expect<
	Equal<
		InferExtensionFlags<readonly [Token & { multiple?: true }]>["token"],
		string | string[] | undefined
	>
>;

function _contextual(recursive: boolean, flags: Port[], toggle: Toggle & { multiple?: true }) {
	defineExtension(defineExtensionId("scope"), {
		flags: [{ name: "port", type: "number", default: 123, recursive }],
		hooks: {
			preRun({ flags }) {
				// @ts-expect-error A false-capable scope may omit this flag on descendants.
				const value: number = flags.port;
				void value;
			},
			postRun({ flags }) {
				// @ts-expect-error Post hooks have the same raw flag contract.
				const value: number = flags.port;
				void value;
			},
		},
	});
	defineExtension(defineExtensionId("collection"), {
		flags,
		hooks: {
			preRun({ flags }) {
				// @ts-expect-error An absent definition permits other extensions to supply another value type.
				const value: number | undefined = flags.port;
				void value;
			},
		},
	});
	defineExtension(defineExtensionId("multiple"), {
		flags: [toggle],
		hooks: {
			preRun({ flags }) {
				// @ts-expect-error Optional multiplicity permits an array before schema validation.
				const value: boolean | undefined = flags.toggle;
				void value;
			},
		},
	});
}
