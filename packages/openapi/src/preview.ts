// `api preview`: the request a generated command or a request path would send, without sending it.
import {
	type CommandDefinition,
	type CommandShape,
	CrustError,
	defineCommand,
} from "@crustjs/core";
import type { JsonValue } from "@crustjs/utils/json";
import type { StandardJSONSchema, StandardSchema } from "@crustjs/utils/schema";

import { type ApiRequestFlags, passThroughRequest, requestFlags } from "./api-command.ts";
import { baseOriginUrl } from "./client.ts";
import { isJsonMediaType } from "./operations.ts";
import { type OperationRequest, encode } from "./request.ts";

/**
 * What `api preview` returns: the request as it would be sent, without the credentials the client
 * adds. Credential headers given on the command line are `<redacted>`; a bound value is the
 * placeholder `{name}`, its name listed in `bound`.
 */
export interface ApiPreview {
	readonly method: string;
	/** The absolute URL with its query. */
	readonly url: string;
	/** By lower-case name. */
	readonly headers: Readonly<Record<string, string>>;
	/** `json` for a JSON body, `bytes` for any other (as text), `none` without one. */
	readonly bodyKind: "json" | "bytes" | "none";
	/** The JSON body as data, any other as text, or `null` without one. */
	readonly body: JsonValue;
	/** The parameters and body fields `bind` would fill, when there are any. */
	readonly bound?: readonly string[];
}

/** A generated command's request, as its Extension built it for this invocation's `api preview`. */
export interface GeneratedPreview {
	readonly request: OperationRequest;
	readonly bound: readonly string[];
}

const REDACTED_HEADERS = new Set(["authorization", "proxy-authorization", "cookie", "x-api-key"]);

/** The largest `--body @file` a preview reads. */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** `api <path>`'s `--paginate`, which a preview takes to show the first page's request. */
const paginateFlag = {
	paginate: {
		type: "boolean",
		noNegate: true,
		description: "Preview the first request of --paginate",
	},
} as const;

// A preview never reads stdin, so its help does not offer `-`.
const bodyFlag = { type: "string", description: "Request body: inline or @file" } as const;
type PreviewFlags = Omit<ApiRequestFlags, "body"> & {
	readonly body: typeof bodyFlag;
} & typeof paginateFlag;
const previewFlags: PreviewFlags = { ...requestFlags, body: bodyFlag, ...paginateFlag };

const targetArg = {
	name: "target",
	type: "string",
	variadic: true,
	required: true,
	description: "A generated command's path, or a request path below the API base URL, e.g. /users",
} as const;

const argvArg = {
	name: "argv",
	type: "string",
	variadic: "afterDoubleDash",
	description: "The generated command's arguments and flags, after --",
} as const;

const previewSchema: StandardSchema<unknown, ApiPreview> & StandardJSONSchema = (() => {
	const jsonSchema = {
		type: "object",
		properties: {
			method: { type: "string" },
			url: { type: "string" },
			headers: { type: "object", additionalProperties: { type: "string" } },
			bodyKind: { enum: ["json", "bytes", "none"] },
			body: {},
			bound: { type: "array", items: { type: "string" } },
		},
		required: ["method", "url", "headers", "bodyKind", "body"],
	};
	return {
		"~standard": {
			version: 1,
			vendor: "@crustjs/openapi",
			// SAFETY: only the action's own return value, an ApiPreview, reaches it; the schema publishes its shape.
			validate: (value) => ({ value: value as ApiPreview }),
			jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
		},
	};
})();

/** The shape of `api preview`, a child of the `api` command's. */
export type PreviewShape = CommandShape<
	readonly [typeof targetArg, typeof argvArg],
	PreviewFlags,
	{},
	ApiPreview,
	{},
	undefined
>;

/** The `api preview` command, spelled out because `defineApi()` needs a declared type. */
export type PreviewCommandDefinition = CommandDefinition<"preview", readonly [], PreviewShape>;

/**
 * The `api preview` command, which sets up no Context: a request path is built here, with the
 * `api` command's flags; a generated command's request is the one its Extension's `preRun` put in
 * `generated` for this invocation's `target`.
 */
export function createPreviewCommand({
	baseUrl,
	paginates,
	generated,
}: {
	readonly baseUrl: string;
	/** Whether `defineApi` has a `paginate`, without which `--paginate` fails as for `api <path>`. */
	readonly paginates: boolean;
	readonly generated: WeakMap<readonly string[], GeneratedPreview>;
}): PreviewCommandDefinition {
	return defineCommand(
		"preview",
		{
			description:
				"Print the request a generated command or a request path would send, without sending it",
		},
		(command) =>
			command
				.args(targetArg, argvArg)
				.flags(previewFlags)
				.output(previewSchema)
				.action(async ({ args, flags, signal, stdout }) => {
					const found = generated.get(args.target);
					let preview: ApiPreview;
					if (found !== undefined) {
						const [given] =
							Object.entries(flags).find(
								([name, value]) => value !== undefined && Object.hasOwn(previewFlags, name),
							) ?? [];
						if (given !== undefined) {
							throw new CrustError(
								"PARSE",
								`api preview: --${given} is for a request path; put the command's own flags after --`,
								{ flag: given },
							);
						}
						const { request } = found;
						// A bound value is its placeholder, encoded in the URL as any value is.
						const url = found.bound.reduce(
							(href, name) => href.replaceAll(encode(`{${name}}`), `{${name}}`),
							baseOriginUrl(baseUrl, request.path).href,
						);
						preview = previewOf(request.init.method, url, request.init.headers, request.init.body);
						if (found.bound.length > 0) preview = { ...preview, bound: found.bound };
					} else {
						const [path, ...rest] = args.target;
						if (rest.length > 0 || (args.argv ?? []).length > 0) {
							throw new CrustError(
								"PARSE",
								`api preview: "${args.target.join(" ")}" is neither one request path nor a generated command`,
								{ argument: "target" },
							);
						}
						if (flags.paginate && !paginates) {
							throw new Error("--paginate: this CLI does not configure pagination");
						}
						const request = await passThroughRequest(baseUrl, path, flags, signal, previewBody);
						preview = previewOf(request.method, request.url.href, request.headers, request.body);
					}
					stdout(JSON.stringify(preview, null, 2));
					return preview;
				}),
	);
}

/**
 * `--body` for a preview: inline text, or the text of a regular file, opened without blocking and
 * at most {@link MAX_BODY_BYTES}. Never stdin, which would take what an MCP client or a pipe sends
 * next: neither `-` nor a file such as `/dev/stdin` or a FIFO.
 */
async function previewBody(value: string): Promise<string> {
	if (value === "-") {
		throw new CrustError(
			"PARSE",
			"api preview: --body - would read stdin; pass the body inline or as @file",
			{ flag: "body" },
		);
	}
	if (!value.startsWith("@")) return value;
	const file = (await import("@crustjs/utils/path")).expandHome(value.slice(1));
	const fs = process.getBuiltinModule("node:fs");
	let fd: number;
	try {
		// Non-blocking, so opening a FIFO without a writer returns at once; Windows has no such flag.
		fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
	} catch (cause) {
		const reason = cause instanceof Error ? ` (${cause.message})` : "";
		throw new CrustError("PARSE", `--body: cannot read "${file}"${reason}`, {
			flag: "body",
		}).withCause(cause);
	}
	try {
		const stats = fs.fstatSync(fd);
		if (!stats.isFile()) {
			throw new CrustError(
				"PARSE",
				`api preview: --body @${file} is not a regular file; pass the body inline or as a file`,
				{ flag: "body" },
			);
		}
		if (stats.size > MAX_BODY_BYTES) {
			throw new CrustError(
				"PARSE",
				`api preview: --body @${file} is larger than ${MAX_BODY_BYTES} bytes`,
				{ flag: "body" },
			);
		}
		return fs.readFileSync(fd, "utf8");
	} finally {
		fs.closeSync(fd);
	}
}

/** The preview of a request, with credential headers redacted. */
function previewOf(
	method: string,
	url: string,
	headers: Headers,
	body: RequestInit["body"],
): ApiPreview {
	const shown = Object.fromEntries(
		[...headers].map(([name, value]) => [name, REDACTED_HEADERS.has(name) ? "<redacted>" : value]),
	);
	if (typeof body !== "string")
		return { method, url, headers: shown, bodyKind: "none", body: null };
	const type = headers.get("content-type");
	if (type !== null && isJsonMediaType(type)) {
		try {
			return { method, url, headers: shown, bodyKind: "json", body: JSON.parse(body) };
		} catch {
			// Sent as the text it is.
		}
	}
	return { method, url, headers: shown, bodyKind: "bytes", body };
}
