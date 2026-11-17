/**
 * OpenAPI documents registered for typed `call()`s, by name. Empty unless a content mapper such as
 * inspex adds `"<name>": { paths; components; operations }` for each `<name>.openapi.jsonc` in the
 * program, in openapi-typescript's shapes.
 */
export interface Specs {}

type Scalar = string | number | boolean;
/** A path, query or header parameter value: a scalar, an array of scalars, or an object of scalars. */
type ParamValue = Scalar | readonly Scalar[] | { readonly [key: string]: Scalar | undefined };

/** What `call()` takes for an operation it has no types for. */
export interface CallInput {
	readonly path?: Readonly<Record<string, ParamValue>>;
	readonly query?: Readonly<Record<string, ParamValue | undefined>>;
	readonly header?: Readonly<Record<string, ParamValue | undefined>>;
	/** Sent as JSON. */
	readonly body?: unknown;
}

/** `call()` of an untyped client: any operationId, and an `unknown` result. */
export interface UntypedCall {
	(operationId: string, input?: CallInput): Promise<unknown>;
}

type IsUnion<T, U = T> = [T] extends [never]
	? false
	: T extends unknown
		? [U] extends [T]
			? false
			: true
		: never;
type OperationsOf<Spec> = Spec extends { readonly operations: infer Operations }
	? Operations
	: unknown;

/**
 * The operations of the registered spec `Id`, or with no `Id` of the only registered spec;
 * `unknown` (untyped) when there is none, several and no `Id`, or `Id` is not registered.
 */
export type SpecOperationsOf<Registry, Id extends string> = [Id] extends [never]
	? [keyof Registry] extends [never]
		? unknown
		: IsUnion<keyof Registry> extends true
			? unknown
			: OperationsOf<Registry[keyof Registry]>
	: Id extends keyof Registry
		? OperationsOf<Registry[Id]>
		: unknown;

type Defined<T> = Exclude<T, undefined>;
type JsonMediaType =
	| "application/json"
	| `application/json;${string}`
	| `application/${string}+json`
	| `application/${string}+json;${string}`;

type ParamPart<Parameters, In extends "path" | "query" | "header"> = In extends keyof Parameters
	? [Defined<Parameters[In]>] extends [never]
		? {}
		: undefined extends Parameters[In]
			? { readonly [_ in In]?: Defined<Parameters[In]> }
			: { readonly [_ in In]: Parameters[In] }
	: {};
// The JSON media type's schema; without one, every media type's.
type MediaOf<Content> = [Extract<keyof Content, JsonMediaType>] extends [never]
	? Content[keyof Content]
	: Content[Extract<keyof Content, JsonMediaType>];
// Read by index, not `infer`: inferring from an optional property drops its `undefined`.
type BodyPart<Op> = BodyOf<Op extends { requestBody?: unknown } ? Op["requestBody"] : undefined>;
type BodyOf<Body> = [Defined<Body>] extends [never]
	? {}
	: Defined<Body> extends { content: infer Content }
		? undefined extends Body
			? { readonly body?: MediaOf<Content> }
			: { readonly body: MediaOf<Content> }
		: {};
type Flatten<T> = { [K in keyof T]: T[K] } & {};

/** The input of a typed operation: each of `path`, `query`, `header` and `body` it takes. */
type OperationInput<Op> = Flatten<
	(Op extends { parameters: infer Parameters }
		? ParamPart<Parameters, "path"> &
				ParamPart<Parameters, "query"> &
				ParamPart<Parameters, "header">
		: {}) &
		BodyPart<Op>
>;

type IsSuccess<Status> = `${Status & (string | number)}` extends `2${string}` ? true : false;
type ResponseData<Response> = Response extends { content?: infer Content }
	? [Defined<Content>] extends [never]
		? undefined
		: [Extract<keyof Defined<Content>, JsonMediaType>] extends [never]
			? unknown
			: Defined<Content>[Extract<keyof Defined<Content>, JsonMediaType>]
	: undefined;
type OrUnknown<T> = [T] extends [never] ? unknown : T;
/** The JSON body of the operation's 2xx responses; `undefined` without content, else `unknown`. */
type OperationResult<Op> = Op extends { responses: infer Responses }
	? OrUnknown<
			{
				[Status in keyof Responses]: IsSuccess<Status> extends true
					? ResponseData<Responses[Status]>
					: never;
			}[keyof Responses]
		>
	: unknown;

type RequiredKeys<T> = { [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T];
// `{}` would accept any property and even a primitive, so an operation without input takes `{}` only.
type InputArgs<Op> = [keyof OperationInput<Op>] extends [never]
	? [input?: Record<string, never>]
	: [RequiredKeys<OperationInput<Op>>] extends [never]
		? [input?: OperationInput<Op>]
		: [input: OperationInput<Op>];
// After an unknown id, TypeScript checks `call` again with `Id` as every id; computing every input
// then exceeds the instantiation limit on large specs (TS2589) instead of reporting the id (TS2345).
// A spec with one operation has no such union, so its input is still checked.
type InputFor<Operations, Id extends keyof Operations> = [keyof Operations] extends [Id]
	? IsUnion<Id> extends true
		? [input?: unknown]
		: InputArgs<Operations[Id]>
	: InputArgs<Operations[Id]>;

/** `call()` typed by a registered spec's operations. */
export interface TypedCall<Operations> {
	<const Id extends keyof Operations & string>(
		operationId: Id,
		...input: InputFor<Operations, Id>
	): Promise<OperationResult<Operations[Id]>>;
}
