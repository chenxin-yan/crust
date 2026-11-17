import {
	type CommandDefinition,
	type CommandShape,
	type ContextBag,
	type ContextFactory,
	type ContextInstance,
	type ContextMap,
	type Extension,
	type ExtensionId,
	type MergeContext,
	type UseSource,
	type UsedContexts,
	CrustError,
	defineExtension,
	defineExtensionId,
} from "@crustjs/core";
import { resolveArtifactDir } from "@crustjs/utils/artifacts";

import {
	type ApiCommandDefinition,
	type ApiRequest,
	type OpenApiSpec,
	createApiCommand,
} from "./api-command.ts";
import { type ApiClient, type ApiClientOptions, apiClientContext } from "./client.ts";
import { type AddedCommands, type GeneratedDefinition, generateCommands } from "./commands.ts";
import { type CommandPlan, planCommands } from "./lint.ts";
import { type ApiManifest, manifest } from "./manifest.ts";
import { type Diagnostic, type Operation, operationLabel, operations } from "./operations.ts";
import type { OperationOverride, OverrideEntry } from "./overrides.ts";
import { isPlainObject } from "./request.ts";
import { BUILT_SPEC_FILE, readSpec } from "./spec-source.ts";
import type { SpecOperationsOf, Specs } from "./typed-client.ts";

const API: ExtensionId = /* @__PURE__ */ defineExtensionId("crust:openapi");

export interface DefineApiOptions<Id extends string = string> extends ApiClientOptions {
	/**
	 * The pinned OpenAPI document: a `file:` URL, such as
	 * `new URL("./acme.openapi.jsonc", import.meta.url)`, read when a command first needs it, with
	 * comments and trailing commas allowed; or the document as an object, kept in memory. `crust build`
	 * copies a URL's document into the build as plain JSON, so it stays out of the bundle.
	 */
	readonly spec: URL | OpenApiSpec;
	/**
	 * The registered spec in `Specs` that types `call()`, needed only when several are registered,
	 * and the directory `crust build` writes a URL's document to. Default: `"openapi"`.
	 */
	readonly id?: Id;
	/**
	 * The next page's request for `--paginate`, or `undefined` after the last page.
	 * Receives a copy of each successful response, so it may read the body. The next page
	 * must be http(s); off the base URL's origin it is requested without credential headers.
	 * Returning the previous request again (same URL and method, `init` reused) fails instead of looping.
	 */
	readonly paginate?: (
		response: Response,
	) => ApiRequest | undefined | Promise<ApiRequest | undefined>;
}

type OperationIdOf<Operations> = unknown extends Operations ? string : keyof Operations & string;

/** `.override()` entries by operationId: those of the registered spec, else any. */
type Overrides<Operations, Deps extends ContextMap> = unknown extends Operations
	? { readonly [operationId: string]: OverrideEntry<Deps> }
	: { readonly [Id in keyof Operations & string]?: OverrideEntry<Deps, Operations[Id]> };

// The Contexts each definition declares, intersected one by one; `any` matches every definition, as in `Crust.add()`.
type AddedDeps<Ds extends readonly unknown[]> = Ds extends readonly [infer D, ...infer Rest]
	? (D extends CommandDefinition<any, any, any, infer Deps> ? Deps : {}) & AddedDeps<Rest>
	: {};

/**
 * What {@link defineApi} returns: the Extension to register, the client Context commands use, and
 * the commands generated from the spec's operations. Every chain method returns a new frozen handle.
 */
export interface Api<
	Operations = unknown,
	Deps extends ContextMap = { api: ApiClient<Operations> },
	// The Contexts of the `.add()`ed commands, which the generated commands do not `.use()`.
	Added extends ContextMap = {},
> {
	/** Contributes the `api` command and provides the `api` Context; pass it to `.extend()`. */
	readonly extension: Extension<
		{ api: ApiClient<Operations> },
		readonly [ContextInstance<"api", ApiClient<Operations>, {}, {}>],
		{},
		readonly [ApiCommandDefinition<Operations>],
		never,
		{}
	>;
	/** The `api` Context: `.use(acme.client)` in a command, then `await ctx.api`. */
	readonly client: ContextFactory<"api", void, ApiClient<Operations>>;
	/**
	 * A command per operation, in its group, with the commands `.add()` put there: the root
	 * commands and the top-level groups, to pass to `.add()`. An operation with a lint error is
	 * left out. Reads the spec.
	 */
	readonly commands: readonly CommandDefinition<
		string,
		readonly string[],
		CommandShape,
		MergeContext<Deps, Added>
	>[];
	/** Context factories or Extensions every generated command `.use()`s, which types `ctx` in the callbacks after it. */
	use<const Us extends readonly [UseSource, ...UseSource[]]>(
		...sources: Us
	): Api<Operations, MergeContext<Deps, UsedContexts<Us>>, Added>;
	/** Asks to confirm an operation's `confirm` message before its request; resolves when confirmed, throws otherwise. */
	onConfirm(
		handler: (ctx: ContextBag<Deps>, message: string) => void | Promise<void>,
	): Api<Operations, Deps, Added>;
	/** The override for every operation, synchronous and pure; replaces the previous rule. */
	each(
		rule: (
			operation: Operation & { readonly id: OperationIdOf<Operations> },
		) => OperationOverride<Deps> | undefined,
	): Api<Operations, Deps, Added>;
	/** Overrides by operationId, whose fields replace the rule's; an entry for the same operationId replaces the previous one's fields. */
	override(entries: Overrides<Operations, Deps>): Api<Operations, Deps, Added>;
	/** Puts the app's own commands in a group path, such as `"dns records"` (`""` is the root), creating the group when no operation maps to it. */
	add<const Ds extends readonly CommandDefinition<any, any, any, any>[]>(
		group: string,
		...definitions: Ds
	): Api<Operations, Deps, Added & AddedDeps<Ds>>;
	/** Every problem with turning the operations into commands; an error leaves its operation out. Reads the spec. */
	lint(): Diagnostic[];
	/** The generated command surface, sorted, with the lint errors. Reads the spec. */
	manifest(): ApiManifest;
}

/** The configuration a handle's chain adds. */
interface ApiState {
	readonly sources: readonly UseSource[];
	readonly onConfirm?: (ctx: ContextBag, message: string) => void | Promise<void>;
	readonly each?: (operation: Operation) => OperationOverride | undefined;
	readonly override: Readonly<Record<string, OverrideEntry>>;
	readonly added: readonly AddedCommands[];
}

/** What every handle of one `defineApi()` call shares. */
interface ApiBase {
	readonly id: string;
	readonly spec: URL | OpenApiSpec;
	readonly baseUrl: string;
	readonly paginate?: DefineApiOptions["paginate"];
	readonly client: ContextFactory<"api", void, ApiClient>;
	/** The spec, read once. */
	readonly document: () => OpenApiSpec;
}

/**
 * Sets up a CLI's HTTP API from its pinned OpenAPI document: an Extension that contributes the
 * `api` command, the `api` Context whose `call()` is typed by the registered spec in `Specs`
 * (by `id`, or the only one), else untyped, and a command per operation.
 */
export function defineApi<const Id extends string = never>(
	options: DefineApiOptions<Id>,
): Api<SpecOperationsOf<Specs, Id>>;
export function defineApi(options: DefineApiOptions): Api {
	const { spec, id = "openapi", paginate, ...clientOptions } = options;
	const isUrl = spec instanceof URL;
	if (isUrl ? spec.protocol !== "file:" : !isPlainObject(spec)) {
		throw new CrustError(
			"DEFINITION",
			"defineApi: `spec` must be a file: URL or the OpenAPI document as an object; specs are pinned, never fetched",
			{ subject: "extension", name: API, reason: "invalid-spec" },
		);
	}

	let loaded: OpenApiSpec | undefined;
	const document = (): OpenApiSpec => (loaded ??= isUrl ? readSpec(spec, id) : spec);
	let byId: Map<string, Operation[]> | undefined;
	const findOperation = async (operationId: string): Promise<Operation> => {
		byId ??= Map.groupBy(operations(document()).operations, (op) => op.id);
		const found = byId.get(operationId) ?? [];
		if (found.length !== 1) {
			throw new Error(
				found.length === 0
					? `api: no operation "${operationId}" in the OpenAPI document`
					: `api: the operationId "${operationId}" is ambiguous (${found.map((op) => operationLabel(op.method, op.path)).join(", ")})`,
			);
		}
		return found[0]!;
	};

	const client = apiClientContext(clientOptions, findOperation);
	return createApi(
		{ id, spec, baseUrl: clientOptions.baseUrl, paginate, client, document },
		{ sources: [], override: {}, added: [] },
	);
}

// Untyped by the spec, like the `defineApi` implementation; its overload adds the spec's names.
function createApi<Deps extends ContextMap, Added extends ContextMap>(
	base: ApiBase,
	state: ApiState,
): Api<unknown, Deps, Added> {
	let planned: ReturnType<typeof planCommands> | undefined;
	const plan = () =>
		(planned ??= planCommands({
			spec: base.document(),
			each: state.each,
			override: state.override,
			added: Object.fromEntries(
				Map.groupBy(state.added, ({ group }) => group)
					.entries()
					.map(([group, adds]) => [
						group,
						adds.flatMap(({ definitions }) => definitions.map(({ name }) => name)),
					]),
			),
			extensionCommands: ["api"],
			hasConfirmHandler: state.onConfirm !== undefined,
			hasPaginate: base.paginate !== undefined,
		}));
	// An operation with a lint error is never built: the CLI works without it.
	const built = (): CommandPlan[] => {
		const { diagnostics, commands } = plan();
		const failed = new Set(
			diagnostics.flatMap(({ level, operationId }) => (level === "error" ? [operationId] : [])),
		);
		return commands.filter(({ op }) => !failed.has(op.id));
	};
	// By `METHOD path`: an operation without an operationId is left out too.
	const unavailable = (): Map<string, string> => {
		const codes = new Map<string, string>();
		for (const { level, method, path, code } of plan().diagnostics) {
			if (level !== "error" || method === undefined || path === undefined) continue;
			const label = operationLabel(method, path);
			if (!codes.has(label)) codes.set(label, code);
		}
		return codes;
	};
	let extension: Api["extension"] | undefined;
	let commands: readonly GeneratedDefinition[] | undefined;
	const handle = Object.freeze({
		get extension() {
			return (extension ??= apiExtension(base, unavailable));
		},
		client: base.client,
		get commands() {
			return (commands ??= generateCommands(built(), state.added, {
				spec: base.document(),
				client: base.client,
				sources: state.sources,
				onConfirm: state.onConfirm,
				baseUrl: base.baseUrl,
				paginate: base.paginate,
			}));
		},
		use: <const Us extends readonly [UseSource, ...UseSource[]]>(...sources: Us) =>
			createApi<MergeContext<Deps, UsedContexts<Us>>, Added>(base, {
				...state,
				sources: [...state.sources, ...sources],
			}),
		onConfirm: (onConfirm: NonNullable<ApiState["onConfirm"]>) =>
			createApi<Deps, Added>(base, { ...state, onConfirm }),
		each: (each: NonNullable<ApiState["each"]>) => createApi<Deps, Added>(base, { ...state, each }),
		override: (entries: Readonly<Record<string, OverrideEntry>>) =>
			createApi<Deps, Added>(base, {
				...state,
				override: Object.fromEntries([
					...Object.entries(state.override),
					...Object.entries(entries).map(([id, entry]) => [
						id,
						{ ...(Object.hasOwn(state.override, id) ? state.override[id] : {}), ...entry },
					]),
				]),
			}),
		add: <const Ds extends readonly GeneratedDefinition[]>(group: string, ...definitions: Ds) =>
			createApi<Deps, Added & AddedDeps<Ds>>(base, {
				...state,
				added: [...state.added, { group, definitions }],
			}),
		lint: () => [...plan().diagnostics],
		manifest: () => manifest(base.document(), built(), plan().diagnostics),
	});
	// The callbacks are stored with an erased `ctx`: each generated command passes them its own,
	// which has every Context `Deps` lists, since it `.use()`s the client and the same sources.
	return handle as Api<unknown, Deps, Added>;
}

/** The `api` Extension of a handle: `api --list` marks the operations it leaves out. */
function apiExtension(
	base: ApiBase,
	unavailable: () => ReadonlyMap<string, string>,
): Api["extension"] {
	const { id, spec } = base;
	const loadSpec = async () => base.document();
	const extension = defineExtension(API)
		.provide(base.client())
		.add(
			createApiCommand(base.client, loadSpec, {
				baseUrl: base.baseUrl,
				paginate: base.paginate,
				unavailable,
			}),
		);
	return spec instanceof URL
		? extension.build(async () => {
				// Fails for an `id` the built CLI could not look up, by the lookup's own rule.
				resolveArtifactDir(id);
				return [{ path: `${id}/${BUILT_SPEC_FILE}`, content: JSON.stringify(await loadSpec()) }];
			})
		: extension;
}
