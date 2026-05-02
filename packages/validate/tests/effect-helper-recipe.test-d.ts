// Type-only test: the README's `earg` / `eflag` recipe for bridging Effect
// schemas to `@crustjs/validate` must preserve Effect output types `A` (and
// input types `I`) through to the handler signature exposed by
// `commandValidator(...)`.

import { Crust } from "@crustjs/core";
import * as Schema from "effect/Schema";
import {
	type ArgDef,
	type ArgOptions,
	arg,
	commandValidator,
	type FlagDef,
	type FlagOptions,
	flag,
} from "../src/index.ts";
import type { StandardSchema } from "../src/types.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Recipe: map a raw Effect schema's `A`/`I` onto Standard Schema's view, then
// forward all other generics (Name, Variadic, Short, …) into the root builder.
// ─────────────────────────────────────────────────────────────────────────────

type EffectAsStandardSchema<S> =
	S extends Schema.Schema<infer A, infer I>
		? StandardSchema<I, A>
		: StandardSchema;

const earg = <
	Name extends string,
	S extends Schema.Schema.AnyNoContext,
	const Variadic extends true | undefined = undefined,
>(
	name: Name,
	schema: S,
	options?: ArgOptions & { variadic?: Variadic },
) =>
	arg(
		name,
		Schema.standardSchemaV1(
			schema as Parameters<typeof Schema.standardSchemaV1>[0],
		),
		options,
	) as unknown as ArgDef<Name, EffectAsStandardSchema<S>, Variadic>;

const eflag = <
	S extends Schema.Schema.AnyNoContext,
	const Short extends string | undefined = undefined,
	const Aliases extends readonly string[] | undefined = undefined,
	const Inherit extends true | undefined = undefined,
>(
	schema: S,
	options?: FlagOptions & {
		short?: Short;
		aliases?: Aliases;
		inherit?: Inherit;
	},
) =>
	flag(
		Schema.standardSchemaV1(
			schema as Parameters<typeof Schema.standardSchemaV1>[0],
		),
		options,
	) as unknown as FlagDef<EffectAsStandardSchema<S>, Short, Aliases, Inherit>;

// ─────────────────────────────────────────────────────────────────────────────
// Build a command using the helpers and assert handler types are precise.
// ─────────────────────────────────────────────────────────────────────────────

new Crust("demo")
	.args([
		earg("env", Schema.Literal("dev", "staging", "prod")),
		earg("count", Schema.Number),
	])
	.flags({
		force: eflag(Schema.UndefinedOr(Schema.Boolean)),
		replicas: eflag(
			Schema.UndefinedOr(
				Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(1)),
			),
		),
	})
	.run(
		commandValidator(({ args, flags }) => {
			const _env: "dev" | "staging" | "prod" = args.env;
			const _count: number = args.count;
			const _force: boolean | undefined = flags.force;
			const _replicas: number | undefined = flags.replicas;
			void _env;
			void _count;
			void _force;
			void _replicas;
		}),
	);
