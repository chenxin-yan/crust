import { Crust, type FactoryValueOf } from "@crustjs/core";

import { defineEnv, type EnvOptions, type EnvVarDef } from "./index.ts";

type Equal<A, B> =
	(<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

type StandardInput = Parameters<NonNullable<EnvVarDef["schema"]>["~standard"]["validate"]>[0];

interface LengthSchema {
	readonly "~standard": {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (value: StandardInput) => Promise<{ value: number }>;
		readonly types?: { readonly input: string | undefined; readonly output: number };
	};
}

const upper: LengthSchema = {
	"~standard": {
		version: 1,
		vendor: "d",
		validate: async (value) => ({ value: String(value).length }),
	},
};

const vars = {
	DATABASE_URL: { type: "url", required: true },
	PORT: { type: "number", default: 3000 },
	LOG_LEVEL: { type: "string", choices: ["debug", "info"], default: "info" },
	TAGS: { type: "string", multiple: true, delimiter: "," },
	ID: { type: "string", parse: (raw: string) => BigInt(raw) },
	LENGTH: { type: "string", schema: upper },
	DEBUG: { type: "boolean" },
} as const;

// Compile-time regression checks; intentionally never invoked.
function _typecheckInfersValidatedValuesLikeFlags() {
	const env = defineEnv("env", vars);
	type Value = FactoryValueOf<typeof env>;
	type _Value = Expect<
		Equal<
			Value,
			Readonly<{
				DATABASE_URL: URL;
				PORT: number;
				LOG_LEVEL: "debug" | "info";
				TAGS: string[] | undefined;
				ID: bigint | undefined;
				LENGTH: number;
				DEBUG: boolean | undefined;
			}>
		>
	>;

	new Crust("cli").provide(env()).action(async ({ ctx }) => {
		const { PORT } = await ctx.env;
		type _Port = Expect<Equal<typeof PORT, number>>;
	});
}

function _typecheckSkipValidationTyping(options: EnvOptions) {
	type Raw = Readonly<{
		DATABASE_URL: string | undefined;
		PORT: string | undefined;
		LOG_LEVEL: string | undefined;
		TAGS: string | undefined;
		ID: string | undefined;
		LENGTH: string | undefined;
		DEBUG: string | undefined;
	}>;
	const raw = defineEnv("env", vars, { skipValidation: true });
	type _Raw = Expect<Equal<FactoryValueOf<typeof raw>, Raw>>;

	const validated = defineEnv("env", vars, { skipValidation: false });
	type _Validated = Expect<Equal<FactoryValueOf<typeof validated>["PORT"], number>>;

	const dynamic = defineEnv("env", vars, options);
	type _Dynamic = Expect<
		Equal<FactoryValueOf<typeof dynamic>["PORT"], number | string | undefined>
	>;
}

function _typecheckOptionalRawOptionsIncludeValidatedValues(
	raw: { skipValidation: true } | undefined,
	optional: EnvOptions | undefined,
) {
	const maybeRaw = defineEnv("env", vars, raw);
	type _MaybeRaw = Expect<
		Equal<FactoryValueOf<typeof maybeRaw>["PORT"], number | string | undefined>
	>;

	const maybeOptions = defineEnv("env", vars, optional);
	type _MaybeOptions = Expect<
		Equal<FactoryValueOf<typeof maybeOptions>["PORT"], number | string | undefined>
	>;

	const omitted = defineEnv("env", vars, undefined);
	type _Omitted = Expect<Equal<FactoryValueOf<typeof omitted>["PORT"], number>>;

	const sourceOnly = defineEnv("env", vars, { source: {} });
	type _SourceOnly = Expect<Equal<FactoryValueOf<typeof sourceOnly>["PORT"], number>>;
}

function _typecheckExplicitRawOptionsRequireAnArgument() {
	// @ts-expect-error -- raw-only output requires skipValidation at runtime
	defineEnv<"env", typeof vars, { skipValidation: true }>("env", vars);

	const raw = defineEnv<"env", typeof vars, { skipValidation: true }>("env", vars, {
		skipValidation: true,
	});
	type _Raw = Expect<Equal<FactoryValueOf<typeof raw>["PORT"], string | undefined>>;

	const optional = defineEnv<"env", typeof vars, { skipValidation: true } | undefined>("env", vars);
	type _Optional = Expect<
		Equal<FactoryValueOf<typeof optional>["PORT"], number | string | undefined>
	>;
}

function _typecheckDefineEnvRejectsFlagOnlyKeys() {
	// @ts-expect-error -- negation opt-out would change boolean env parsing
	defineEnv("env", { DEBUG: { type: "boolean", noNegate: true } });
	// @ts-expect-error -- env bindings are not environment vocabulary
	defineEnv("env", { KEY: { type: "string", env: { name: "OTHER" } } });
	// @ts-expect-error -- argv spellings are not environment vocabulary
	defineEnv("env", { KEY: { type: "string", short: "k" } });
	// @ts-expect-error -- argv spellings are not environment vocabulary
	defineEnv("env", { KEY: { type: "string", aliases: ["k"] } });
	// @ts-expect-error -- help visibility is argv-only
	defineEnv("env", { KEY: { type: "string", hidden: true } });
	// @ts-expect-error -- negation is argv-only
	defineEnv("env", { KEY: { type: "boolean", negatable: true } });

	const declared = { DEBUG: { type: "boolean", noNegate: true } } as const;
	// @ts-expect-error -- a pre-declared record is checked at the call too
	defineEnv("env", declared);
}

function _typecheckRejectsFlagOnlyKeysAndPreservesVariants() {
	// @ts-expect-error -- argv spellings are not environment vocabulary
	const _short: EnvVarDef = { type: "string", short: "s" };
	// @ts-expect-error -- env bindings are not environment vocabulary
	const _env: EnvVarDef = { type: "string", env: { name: "X" } };
	// @ts-expect-error -- negation is argv-only
	const _noNegate: EnvVarDef = { type: "boolean", noNegate: true };
	// @ts-expect-error -- a single-value variable cannot declare a delimiter
	const _delimiter: EnvVarDef = { type: "string", delimiter: "," };
	// @ts-expect-error -- schema-backed variables cannot mix in core defaults
	const _schemaDefault: EnvVarDef = { type: "string", schema: upper, default: "x" };
	// @ts-expect-error -- defaults follow the declared type
	const _default: EnvVarDef = { type: "number", default: "3000" };
}
