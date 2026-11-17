import {
	type CommandDefinition,
	type CommandShape,
	type CommandSnapshot,
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
import { isSourceRun, resolveArtifactDir } from "@crustjs/utils/artifacts";

import {
	type ApiCommandDefinition,
	type ApiRequest,
	type OpenApiSpec,
	createApiCommand,
} from "./api-command.ts";
import { type ApiClient, type ApiClientOptions, apiClientContext } from "./client.ts";
import {
	type AddedCommands,
	type ConfirmResult,
	type GeneratedDefinition,
	generateCommands,
	operationRequest,
} from "./commands.ts";
import { type CommandPlan, boundNames, planCommands } from "./lint.ts";
import { type ApiManifest, manifest } from "./manifest.ts";
import { type MissingValueHandler, bindMissingValues, canAsk } from "./missing-values.ts";
import { type Diagnostic, type Operation, operationLabel, operations } from "./operations.ts";
import type { OperationOverride, OverrideEntry } from "./overrides.ts";
import { type GeneratedPreview, createPreviewCommand } from "./preview.ts";
import { isPlainObject } from "./request.ts";
import {
	type DataFile,
	INDEX_FILE,
	indexedCommands,
	type SpecIndex,
	isPlannedCommand,
	isSpecIndex,
	missingCommands,
	onlyOperations,
	specDataFiles,
} from "./spec-data.ts";
import { BUILT_SPEC_FILE, builtFilePath, readBuiltFile, readSpec } from "./spec-source.ts";
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
		{ api: ApiClient<Operations> }
	>;
	/** The `api` Context: `.use(acme.client)` in a command, then `await ctx.api`. */
	readonly client: ContextFactory<"api", void, ApiClient<Operations>>;
	/**
	 * A command per operation, in its group, with the commands `.add()` put there: the root
	 * commands and the top-level groups, to pass to `.add()`. An operation with a problem is left
	 * out, and `crust build` fails for one that needs a decision. Reads the spec.
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
	/**
	 * Asks to confirm an operation's `confirm` message before its request: resolving to nothing (or
	 * `true`) confirms it; resolving to `false`, or throwing, declines it, and nothing is sent.
	 */
	onConfirm(
		handler: (ctx: ContextBag<Deps>, message: string) => ConfirmResult | Promise<ConfirmResult>,
	): Api<Operations, Deps, Added>;
	/**
	 * Asks for a required value a generated command was not given, on a terminal outside CI:
	 * resolving to the value as text binds it, converted to the field's `kind`; to `undefined`, the
	 * command fails as without it. Replaces the previous handler. It gets no `ctx`: it runs before
	 * the command's Contexts are set up.
	 */
	onMissing(handler: MissingValueHandler): Api<Operations, Deps, Added>;
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
}

/** The configuration a handle's chain adds. */
interface ApiState {
	readonly sources: readonly UseSource[];
	readonly onConfirm?: (ctx: ContextBag, message: string) => ConfirmResult | Promise<ConfirmResult>;
	readonly onMissing?: MissingValueHandler;
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
	/**
	 * The generated top-level commands of each chain whose `commands` was read, and the plans they
	 * come from. Root commands from `.add("")` are left out: handles share them on purpose.
	 */
	readonly readCommands: Map<
		ApiState,
		{ readonly generated: readonly GeneratedDefinition[]; readonly built: () => CommandPlan[] }
	>;
	/** Why a built CLI's `index.json` could not be read, once `commands` tried. */
	indexFailure?: unknown;
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
		{
			id,
			spec,
			baseUrl: clientOptions.baseUrl,
			paginate,
			client,
			document,
			readCommands: new Map(),
		},
		{ sources: [], override: {}, added: [] },
	);
}

// Untyped by the spec, like the `defineApi` implementation; its overload adds the spec's names.
function createApi<Deps extends ContextMap, Added extends ContextMap>(
	base: ApiBase,
	state: ApiState,
): Api<unknown, Deps, Added> {
	const planFor = (spec: OpenApiSpec) =>
		planCommands({
			spec,
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
		});
	let planned: ReturnType<typeof planCommands> | undefined;
	const plan = () => (planned ??= planFor(base.document()));
	// An operation with a problem is never built: the CLI works without it.
	const built = (): CommandPlan[] => {
		const { diagnostics, commands } = plan();
		const failed = new Set(diagnostics.map(({ operationId }) => operationId));
		return commands.filter(({ op }) => !failed.has(op.id));
	};
	// By `METHOD path`: an operation without an operationId is left out too. Only an app that read
	// `commands` has generated commands to leave one out of: `api` alone marks nothing.
	const unavailable = (): Map<string, string> => {
		const codes = new Map<string, string>();
		if (!base.readCommands.has(state)) return codes;
		for (const { method, path, code } of plan().diagnostics) {
			if (method === undefined || path === undefined) continue;
			const label = operationLabel(method, path);
			if (!codes.has(label)) codes.set(label, code);
		}
		return codes;
	};
	const options = {
		client: base.client,
		sources: state.sources,
		onConfirm: state.onConfirm,
		baseUrl: base.baseUrl,
		paginate: base.paginate,
	};
	// A built CLI's data files, each read once. A command plans only the operations it runs, which
	// plan as from the whole spec: the plan of one does not depend on the others.
	const dataFiles = new Map<string, DataFile>();
	const dataFile = (file: string): DataFile => {
		let data = dataFiles.get(file);
		if (data === undefined) {
			const spec =
				file === BUILT_SPEC_FILE ? base.document() : (readBuiltFile(base.id, file) as OpenApiSpec);
			const mismatch = (operationId: string) =>
				new Error(
					`api: the OpenAPI data "${file}" has no operation "${operationId}": its "${base.id}" directory comes from another build. Ship the one \`crust build\` wrote with this CLI.`,
				);
			data = {
				spec,
				plans: (operationIds) => {
					const byId = new Map(
						planFor(onlyOperations(spec, new Set(operationIds))).commands.map((each) => [
							each.op.id,
							each,
						]),
					);
					return operationIds.map((operationId) => {
						const found = byId.get(operationId);
						if (found === undefined) throw mismatch(operationId);
						return found;
					});
				},
			};
			dataFiles.set(file, data);
		}
		return data;
	};
	// A built CLI's index names the top-level commands; without it there are none, and the
	// Extension reports why.
	let builtIndex: SpecIndex | undefined;
	const indexed = (): readonly GeneratedDefinition[] => {
		try {
			const index = readBuiltFile(base.id, INDEX_FILE);
			if (!isSpecIndex(index)) {
				throw new Error(
					`api: the OpenAPI data "${builtFilePath(base.id, INDEX_FILE)}" is not an index this version of @crustjs/openapi reads. Run \`crust build\`, and ship its "${base.id}" directory with the CLI.`,
				);
			}
			builtIndex = index;
			return indexedCommands(index, state.added, options, dataFile);
		} catch (error) {
			base.indexFailure = error;
			return [];
		}
	};
	// The planned command at `words` below where `commands` are added, from the data its command
	// was built from: the index and the group's file in a built CLI.
	const planAt = (words: readonly string[]): PlannedCommand | undefined => {
		const group = words.slice(0, -1).join(" ");
		const name = words.at(-1);
		const at = (each: CommandPlan) => each.group === group && each.name === name;
		if (builtIndex === undefined) {
			const found = built().find(at);
			return found && { plan: found, spec: base.document() };
		}
		const [top] = words;
		const root =
			words.length === 1 ? builtIndex.commands.find((each) => each.name === top) : undefined;
		if (root !== undefined) {
			const data = dataFile(root.file);
			return { plan: data.plans([root.operationId])[0]!, spec: data.spec };
		}
		const grouped = builtIndex.groups.find((each) => each.name === top);
		if (grouped?.file === undefined) return undefined;
		const data = dataFile(grouped.file);
		const found = data.plans(grouped.operationIds).find(at);
		return found && { plan: found, spec: data.spec };
	};
	let extension: Api["extension"] | undefined;
	let commands: readonly GeneratedDefinition[] | undefined;
	const handle = Object.freeze({
		get extension() {
			return (extension ??= apiExtension(base, state, { unavailable, built, planAt }));
		},
		client: base.client,
		get commands() {
			if (commands === undefined) {
				commands =
					base.spec instanceof URL && !isSourceRun()
						? indexed()
						: generateCommands(built(), state.added, { ...options, spec: base.document() });
				const shared = new Set(
					state.added.flatMap(({ group, definitions }) => (group === "" ? definitions : [])),
				);
				base.readCommands.set(state, {
					generated: commands.filter((definition) => !shared.has(definition)),
					built,
				});
			}
			return commands;
		},
		use: <const Us extends readonly [UseSource, ...UseSource[]]>(...sources: Us) =>
			createApi<MergeContext<Deps, UsedContexts<Us>>, Added>(base, {
				...state,
				sources: [...state.sources, ...sources],
			}),
		onConfirm: (onConfirm: NonNullable<ApiState["onConfirm"]>) =>
			createApi<Deps, Added>(base, { ...state, onConfirm }),
		onMissing: (onMissing: MissingValueHandler) =>
			createApi<Deps, Added>(base, { ...state, onMissing }),
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
	});
	// The callbacks are stored with an erased `ctx`: each generated command passes them its own,
	// which has every Context `Deps` lists, since it `.use()`s the client and the same sources.
	return handle as Api<unknown, Deps, Added>;
}

/**
 * The `api` Extension of a handle with the chain `state`: `api --list` marks the operations it
 * leaves out, and `crust build` fails with the handle's `problems` that need a decision, then
 * writes the data files of its `built` commands.
 */
function apiExtension(
	base: ApiBase,
	state: ApiState,
	{
		unavailable,
		built,
		planAt,
	}: {
		readonly unavailable: () => ReadonlyMap<string, string>;
		readonly built: () => readonly CommandPlan[];
		readonly planAt: (words: readonly string[]) => PlannedCommand | undefined;
	},
): Api["extension"] {
	const { id, spec } = base;
	// Each `api preview` invocation's generated request, by its `api` Context value.
	const previews = new WeakMap<ApiClient, GeneratedPreview>();
	/**
	 * The generated command of this handle at a canonical command path, whose snapshot is `command`,
	 * wherever the app adds `commands`, as often as it does: a tail of the path names a planned
	 * command, and `command` has that plan's shape. Reads no group file a path does not route through.
	 */
	const generatedAt = (
		path: readonly string[],
		command: () => CommandSnapshot,
	): PlannedCommand | undefined => {
		const tops = new Set((base.readCommands.get(state)?.generated ?? []).map(({ name }) => name));
		for (let depth = 1; depth < path.length; depth++) {
			if (!tops.has(path[depth]!)) continue;
			const found = planAt(path.slice(depth));
			if (found !== undefined && isPlannedCommand(command(), found.plan)) return found;
		}
		return undefined;
	};
	const loadSpec = async () => base.document();
	const mismatch = (detail: string) =>
		new CrustError(
			"DEFINITION",
			`defineApi: ${detail}; take \`extension\` and \`commands\` from the same handle, and add \`commands\` whole (\`exclude\` an operation to leave it out)`,
			{ subject: "extension", name: API, reason: "commands-mismatch" },
		);
	const extension = defineExtension(API)
		.use(base.client)
		.provide(base.client())
		.add(
			createApiCommand(base.client, loadSpec, {
				baseUrl: base.baseUrl,
				paginate: base.paginate,
				unavailable,
				preview: createPreviewCommand(base.client, {
					baseUrl: base.baseUrl,
					paginates: base.paginate !== undefined,
					generated: previews,
				}),
			}),
		)
		.setup((ctx) => {
			if (base.indexFailure !== undefined) throw base.indexFailure;
			// A built CLI's commands were checked when it was built.
			if (!isSourceRun()) return;
			for (const [chain, { generated }] of base.readCommands) {
				if (chain === state) continue;
				if (generated.some((definition) => ctx.commandPathOf(definition) !== undefined)) {
					throw mismatch("the app holds generated commands of another chain of this API");
				}
			}
		})
		.preRun(async (ctx) => {
			const [root, api, preview] = ctx.commandPath;
			if (ctx.commandPath.length === 3 && api === "api" && preview === "preview") {
				const { target, argv } = ctx.args;
				// A request path is previewed by the command itself; its values are not checked yet.
				if (!isWords(target) || target.length === 0 || target[0]!.startsWith("/")) return;
				const parsed = await ctx.parseCommandArgv([root!, ...target], isWords(argv) ? argv : []);
				// The target's snapshot: walking the root's builds only the commands on its path.
				const found = generatedAt(parsed.path, () =>
					parsed.path.slice(1).reduce((node, name) => node.subCommands[name]!, ctx.rootCommand),
				);
				if (found === undefined) {
					throw new CrustError(
						"PARSE",
						`api preview: "${target.join(" ")}" is not a command generated from the OpenAPI spec`,
						{ argument: "target" },
					);
				}
				// A binding is never called: its value is the placeholder `{name}`.
				const request = await operationRequest(
					found.spec,
					found.plan,
					{ arg: parsed.args, flag: parsed.flags },
					(name) => `{${name}}`,
				);
				previews.set(await ctx.ctx.api, {
					request,
					bound: [...boundNames(found.plan.fields)],
				});
				return;
			}
			if (state.onMissing === undefined || !canAsk()) return;
			const found = generatedAt(ctx.commandPath, () => ctx.command);
			if (found !== undefined) {
				await bindMissingValues(ctx, found.spec, found.plan, state.onMissing);
			}
		})
		// A broken build fails every invocation with why, also one a missing command fails first.
		.onError((error, ctx) => {
			const failure = base.indexFailure;
			if (failure === undefined || error === failure) return;
			ctx.stderr(`Error: ${failure instanceof Error ? failure.message : String(failure)}`);
			return true;
		});
	return extension.build(async ({ snapshot }) => {
		// The app has this handle's generated commands only if it read its `commands`, the one way to
		// get them; one that never did uses `api` alone, whatever commands of its own it has.
		const holds = base.readCommands.has(state);
		// Before any file: for an app that holds the commands, one that needs a decision fails the build.
		const problem = holds ? problems() : undefined;
		if (problem !== undefined) throw new Error(problem);
		if (!(spec instanceof URL)) return [];
		// Fails for an `id` the built CLI could not look up, by the lookup's own rule.
		resolveArtifactDir(id);
		const document = base.document();
		const text = JSON.stringify(document);
		const files = new Map([[BUILT_SPEC_FILE, text]]);
		const plans = holds ? built() : [];
		// Where the app mounts this handle's commands, or `undefined` when it does not.
		const missing = holds ? missingCommands(snapshot, plans) : undefined;
		// The index claims the app's commands: those of this handle's plan, or none of any.
		if (missing !== undefined && missing.length > 0) {
			throw mismatch(
				`the app's generated commands are not this handle's: missing or different ${missing.map((path) => `"${path}"`).join(", ")}`,
			);
		}
		// This handle's commands are not in the app, or it generates none: another handle's may be.
		if (missing === undefined || plans.length === 0) {
			for (const [chain, other] of base.readCommands) {
				if (chain === state) continue;
				const otherPlans = other.built();
				if (otherPlans.length > 0 && missingCommands(snapshot, otherPlans) !== undefined) {
					throw mismatch("the app's generated commands are those of another handle of this API");
				}
			}
		}
		if (missing !== undefined) {
			for (const [path, content] of specDataFiles(document, text, plans, state.added)) {
				files.set(path, content);
			}
		}
		return [...files].map(([path, content]) => ({ path: `${id}/${path}`, content }));
	});
}

/** A planned command and the spec its schemas resolve in. */
interface PlannedCommand {
	readonly plan: CommandPlan;
	readonly spec: OpenApiSpec;
}

/** Whether an argument value is a list of words, as a variadic string argument's. */
function isWords(value: unknown): value is readonly string[] {
	return Array.isArray(value) && value.every((word) => typeof word === "string");
}
