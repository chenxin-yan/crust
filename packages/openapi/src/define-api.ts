import {
	type ContextFactory,
	type ContextInstance,
	type Extension,
	type ExtensionId,
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
import { type Operation, operationLabel, operations } from "./operations.ts";
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

/** What {@link defineApi} returns: the Extension to register and the client Context commands use. */
export interface Api<Operations = unknown> {
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
}

/**
 * Sets up a CLI's HTTP API from its pinned OpenAPI document: an Extension that contributes the
 * `api` command, and the `api` Context whose `call()` is typed by the registered spec in `Specs`
 * (by `id`, or the only one), else untyped.
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

	let loaded: Promise<OpenApiSpec> | undefined;
	const loadSpec = (): Promise<OpenApiSpec> =>
		(loaded ??= isUrl ? Promise.resolve().then(() => readSpec(spec, id)) : Promise.resolve(spec));
	let byId: Promise<Map<string, Operation[]>> | undefined;
	const findOperation = async (operationId: string): Promise<Operation> => {
		byId ??= loadSpec().then((document) =>
			Map.groupBy(operations(document).operations, (op) => op.id),
		);
		const found = (await byId).get(operationId) ?? [];
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
	const extension = defineExtension(API)
		.provide(client())
		.add(createApiCommand(client, loadSpec, { baseUrl: clientOptions.baseUrl, paginate }));
	return Object.freeze({
		extension: isUrl
			? extension.build(async () => {
					// Fails for an `id` the built CLI could not look up, by the lookup's own rule.
					resolveArtifactDir(id);
					return [{ path: `${id}/${BUILT_SPEC_FILE}`, content: JSON.stringify(await loadSpec()) }];
				})
			: extension,
		client,
	});
}
