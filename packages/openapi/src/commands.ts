// The generated commands: one per planned operation, in groups, with the app's own commands added.
import {
	type ArgDef,
	type CommandDefinition,
	type ContextBag,
	type ContextFactory,
	type FlagDef,
	type UseSource,
	CrustError,
	defineCommand,
} from "@crustjs/core";
import type { StandardJSONSchema, StandardSchema } from "@crustjs/utils/schema";

import { type OpenApiSpec, type SentPage, nextPage } from "./api-command.ts";
import { type ApiClient, fetchNextPage } from "./client.ts";
import type { DefineApiOptions } from "./define-api.ts";
import { type CommandPlan, type PlannedInput, boundNames } from "./lint.ts";
import { kebab } from "./names.ts";
import type { Param } from "./operations.ts";
import { buildRequest, isPlainObject, readOperationResponse } from "./request.ts";

/**
 * A generated or added definition. Its shape and Contexts are open: a generated command's are
 * known only at run time, and the handle's types declare its Contexts (the client and the
 * `.use()`d sources) for `Crust.add()` to check.
 */
export type GeneratedDefinition = CommandDefinition<any, any, any, any>;
import { type SchemaField, flagValue, record, standaloneSchema } from "./schema.ts";

/** What every generated command shares. */
export interface GenerateOptions {
	readonly spec: OpenApiSpec;
	readonly client: ContextFactory<"api", void, ApiClient>;
	/** The app's sources from `.use()`, which every generated command `.use()`s too. */
	readonly sources: readonly UseSource[];
	readonly onConfirm?: (ctx: ContextBag, message: string) => void | Promise<void>;
	readonly baseUrl: string;
	readonly paginate?: DefineApiOptions["paginate"];
}

/** The app's own commands for a group path, from `.add()`. */
export interface AddedCommands {
	readonly group: string;
	readonly definitions: readonly GeneratedDefinition[];
}

interface GroupNode {
	readonly commands: GeneratedDefinition[];
	readonly groups: Map<string, GroupNode>;
}

const VENDOR = "@crustjs/openapi";

/**
 * The root commands and top-level groups for `plans` (each a generated command in its group) and
 * `added` (the app's commands in theirs). A group lists its generated commands, then its added
 * ones, then its subgroups.
 */
export function generateCommands(
	plans: readonly CommandPlan[],
	added: readonly AddedCommands[],
	options: GenerateOptions,
): GeneratedDefinition[] {
	const root: GroupNode = { commands: [], groups: new Map() };
	const nodeAt = (group: string): GroupNode => {
		let node = root;
		for (const word of group === "" ? [] : group.split(" ")) {
			let child = node.groups.get(word);
			if (child === undefined) node.groups.set(word, (child = { commands: [], groups: new Map() }));
			node = child;
		}
		return node;
	};
	for (const plan of plans) nodeAt(plan.group).commands.push(operationCommand(plan, options));
	for (const { group, definitions } of added) nodeAt(group).commands.push(...definitions);
	return groupChildren(root, "", options.spec);
}

/** A group's commands, then its subgroups as commands that hold theirs. */
function groupChildren(node: GroupNode, path: string, spec: OpenApiSpec): GeneratedDefinition[] {
	return [
		...node.commands,
		...[...node.groups].map(([word, child]): GeneratedDefinition => {
			const group = path === "" ? word : `${path} ${word}`;
			const description = tagDescription(spec, group);
			return defineCommand(word, description === undefined ? {} : { description }, (command) =>
				command.add(...groupChildren(child, group, spec)),
			);
		}),
	];
}

/** The description of the spec's tag whose kebab-case name is the group path, as a group's. */
function tagDescription(spec: OpenApiSpec, group: string): string | undefined {
	const tags = Array.isArray(spec.tags) ? spec.tags : [];
	const tag = tags
		.map(record)
		.find((entry) => typeof entry?.name === "string" && kebab(entry.name) === group);
	return typeof tag?.description === "string" && tag.description !== ""
		? tag.description
		: undefined;
}

function operationCommand(plan: CommandPlan, options: GenerateOptions): GeneratedDefinition {
	const { op, fields, inputs } = plan;
	const { spec } = options;
	const description = fields.description ?? op.summary;
	const paginate = fields.paginate ?? options.paginate;
	// Set only when the command offers `--paginate`; a spec parameter may also be named `paginate`.
	const paginateFlag = inputs.find(({ target }) => target.in === "paginate")?.name;
	return defineCommand(
		plan.name,
		{
			...(description !== undefined && { description }),
			...(fields.hidden !== undefined && { hidden: fields.hidden }),
		},
		// The recipe runs when the command is first used, so only then are its schemas built.
		(command) => {
			const args: ArgDef[] = [];
			const flags: Record<string, FlagDef> = {};
			for (const input of inputs) {
				if (input.kind === "arg") args.push(argDef(spec, input));
				else flags[input.name] = flagDef(spec, input, plan);
			}
			return (
				command
					// The first `.use()` types `ctx.api`; the second declares the app's sources, known only at run time.
					.use(options.client)
					.use(options.client, ...options.sources)
					.args(...args)
					.flags(flags)
					.output(outputWrapper(advertisedOutput(spec, plan)))
					.action(async ({ args: argValues, flags: flagValues, ctx, stdout }) => {
						// Arguments and flags apart: an inherited flag may share an argument's name.
						const values: Record<PlannedInput["kind"], Readonly<Record<string, unknown>>> = {
							arg: argValues,
							flag: flagValues,
						};
						// Keyed by the spec's names, which may be `__proto__`: without a prototype, it is a key.
						// Cookie parameters get no input and are never sent.
						const input: Record<Param["in"], Record<string, unknown>> = {
							path: Object.create(null),
							query: Object.create(null),
							header: Object.create(null),
							cookie: Object.create(null),
						};
						const bodyFields: Record<string, unknown> = Object.create(null);
						let body: unknown;
						for (const { kind, name, target } of inputs) {
							const value = Object.hasOwn(values[kind], name) ? values[kind][name] : undefined;
							if (value === undefined) continue;
							if (target.in === "param") input[target.param.in][target.param.name] = value;
							else if (target.in === "field") bodyFields[target.field.name] = value;
							else if (target.in === "body") body = value;
						}
						// One value per binding, for every parameter and body field of its name.
						for (const [name, bind] of Object.entries(fields.bind ?? {})) {
							if (bind === undefined) continue;
							const value = await bind(ctx);
							for (const param of op.params) {
								if (param.name === name && param.in !== "cookie") input[param.in][name] = value;
							}
							if (plan.bodyFields.some((field) => field.name === name)) bodyFields[name] = value;
						}
						body = effectiveBody(spec, plan, body, bodyFields);
						const { path, query, header } = input;
						// Built, and so checked, before the confirmation, which a rejected request must not ask for.
						const request = buildRequest(op, { path, query, header, body });
						if (typeof fields.confirm === "string") {
							// Lint leaves out an operation with `confirm` and no handler, so this is set.
							await options.onConfirm?.(ctx, fields.confirm);
						}

						const api = await ctx.api;
						let sent: SentPage = {
							path: request.path,
							init: request.init,
							method: request.init.method,
						};
						let response = await api.fetch(sent.path, sent.init);
						const pages: unknown[] = [];
						for (let pageNumber = 1; ; pageNumber++) {
							// Bun types `clone()` as undici's Response, which lacks Bun's Headers extras.
							const copy =
								paginateFlag !== undefined && flagValues[paginateFlag] === true
									? (response.clone() as Response)
									: undefined;
							let value = await readOperationResponse(op, sent, response);
							if (value instanceof Response) value = await responseText(value);
							if (fields.unwrap !== undefined) value = fields.unwrap(value, response);
							if (copy === undefined || paginate === undefined) return present(value, stdout);
							if (!Array.isArray(value)) {
								throw new Error(
									`${op.id}: --paginate needs each page's result to be a list, and page ${pageNumber}'s is not`,
								);
							}
							pages.push(...value);
							const next = await paginate(copy);
							if (next === undefined) return present(pages, stdout);
							sent = nextPage(options.baseUrl, sent, next, pageNumber + 1);
							// A public operation's next pages are public too.
							if (request.init.auth === false && sent.init?.auth !== false) {
								sent = { ...sent, init: { ...sent.init, auth: false } };
							}
							response = await fetchNextPage(api, sent.path, sent.init);
						}
					})
			);
		},
	);
}

/** The output JSON Schema a planned command advertises: its known result schema, when it can stand alone. */
export function advertisedOutput(
	spec: OpenApiSpec,
	plan: CommandPlan,
): Readonly<Record<string, unknown>> | undefined {
	return plan.outputSchema === undefined
		? undefined
		: record(standaloneSchema(spec, plan.outputSchema));
}

/** Prints the result for humans (JSON pretty-printed) and returns it as the command's result. */
function present(value: unknown, stdout: (text: string) => void): unknown {
	if (typeof value === "string") stdout(value.replace(/\r?\n$/, ""));
	else if (value !== undefined) stdout(JSON.stringify(value, null, 2));
	return value;
}

/** A body of another media type as text; a binary one is an error. */
async function responseText(response: Response): Promise<string> {
	const bytes = new Uint8Array(await response.arrayBuffer());
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		const type = response.headers.get("content-type") ?? "no Content-Type";
		throw new Error(`The response body is binary (${type}); use \`api\` to save it`);
	}
}

/**
 * The request body: `--body` with the body field inputs merged over it. Fails with a `VALIDATION`
 * error for a required body or body field that is missing, or a field value its schema refuses.
 */
function effectiveBody(
	spec: OpenApiSpec,
	plan: CommandPlan,
	body: unknown,
	fieldValues: Readonly<Record<string, unknown>>,
): unknown {
	const { op, inputs } = plan;
	if (Object.keys(fieldValues).length > 0) {
		if (body !== undefined && !isPlainObject(body)) {
			throw new CrustError(
				"VALIDATION",
				`${op.id}: --body must be a JSON object to add fields to it`,
				{
					issues: [{ path: "flags.body", message: "must be a JSON object" }],
				},
			);
		}
		body = { ...body, ...fieldValues };
	}
	if (op.body === undefined || (body === undefined && !op.body.required)) return body;
	const problems: string[] = [];
	const flagOf = (field: SchemaField) =>
		inputs.find(({ target }) => target.in === "field" && target.field === field);
	for (const field of plan.bodyFields) {
		// Own values only: a field may be named like an Object.prototype member.
		const value =
			isPlainObject(body) && Object.hasOwn(body, field.name) ? body[field.name] : undefined;
		const input = flagOf(field);
		if (value === undefined) {
			if (field.required) {
				problems.push(`missing the body field "${field.name}"${input ? ` (--${input.name})` : ""}`);
			}
			continue;
		}
		if (input === undefined) continue;
		const { type, multiple, choices, nullable, itemNullable } = flagValue(spec, field.schema);
		if (value === null && nullable) continue;
		const items = multiple ? value : [value];
		if (
			!Array.isArray(items) ||
			items.some((item: unknown) => typeof item !== type && !(item === null && itemNullable))
		) {
			problems.push(
				`the body field "${field.name}" must be ${multiple ? "a list of " : "a "}${type}`,
			);
		} else if (
			choices &&
			items.some((item: unknown) => typeof item === "string" && !choices.includes(item))
		) {
			problems.push(`the body field "${field.name}" must be one of ${choices.join(", ")}`);
		}
	}
	if (body === undefined && problems.length === 0)
		problems.push("missing the request body (--body)");
	if (problems.length > 0) {
		throw new CrustError("VALIDATION", `${op.id}: ${problems.join("; ")}`, {
			issues: problems.map((message) => ({ path: "flags.body", message })),
		});
	}
	return body;
}

// A list is only ever the last argument: lint reports one before another (`positional-order`).
function argDef(spec: OpenApiSpec, { name, target }: PlannedInput): ArgDef {
	const param = target.in === "param" ? target.param : undefined;
	const { type, multiple } = flagValue(spec, param?.schema);
	return {
		name,
		type,
		...(multiple && { variadic: true }),
		...(param?.required && { required: true }),
		...(param?.description !== undefined && { description: param.description }),
	};
}

function flagDef(spec: OpenApiSpec, { target }: PlannedInput, plan: CommandPlan): FlagDef {
	if (target.in === "paginate") {
		return {
			type: "boolean",
			noNegate: true,
			description: "Fetch every page, and return their results as one list",
		};
	}
	if (target.in === "body") {
		return {
			type: "json",
			schema: bodySchema(spec, plan),
			description: "The request body as JSON; body field flags are merged over it",
		};
	}
	const schema = target.in === "param" ? target.param.schema : target.field.schema;
	const description =
		target.in === "param" ? target.param.description : record(target.field.schema)?.description;
	const { type, multiple, choices } = flagValue(spec, schema);
	const fields = {
		...(target.in === "param" && target.param.required && { required: true as const }),
		...(typeof description === "string" && { description }),
	};
	if (type === "string") {
		const restricted = { ...fields, ...(choices && { choices }) };
		return multiple ? { type, multiple: true, ...restricted } : { type, ...restricted };
	}
	if (type === "number")
		return multiple ? { type, multiple: true, ...fields } : { type, ...fields };
	return multiple ? { type, multiple: true, ...fields } : { type, ...fields };
}

/**
 * The `--body` flag's schema: it accepts no value (body field flags may fill the body) and, for an
 * object body, only a JSON object; the action checks the merged body. It publishes the body's JSON
 * Schema standing alone ({@link standaloneSchema}) without the required fields a flag can fill;
 * one that cannot stand alone is published as its top-level fields, each standing alone or `{}`.
 */
function bodySchema(spec: OpenApiSpec, plan: CommandPlan): StandardSchema & StandardJSONSchema {
	const schema = plan.op.body?.schema;
	const objectBody = plan.bodyFields.length > 0 || record(schema)?.type === "object";
	// Body fields the command fills itself: from a flag, or bound.
	const filled = new Set([
		...plan.inputs.flatMap(({ target }) => (target.in === "field" ? [target.field.name] : [])),
		...[...boundNames(plan.fields)].filter((name) =>
			plan.bodyFields.some((field) => field.name === name),
		),
	]);
	const published =
		record(standaloneSchema(spec, schema)) ??
		(objectBody
			? {
					type: "object",
					properties: Object.fromEntries(
						plan.bodyFields.map((field) => [
							field.name,
							standaloneSchema(spec, field.schema, 100) ?? {},
						]),
					),
					required: plan.bodyFields.filter((field) => field.required).map((field) => field.name),
				}
			: {});
	const jsonSchema = withoutRequired(published, filled);
	return {
		"~standard": {
			version: 1,
			vendor: VENDOR,
			validate: (value) =>
				value === undefined || !objectBody || isPlainObject(value)
					? { value }
					: { issues: [{ message: "must be a JSON object" }] },
			jsonSchema: { input: () => jsonSchema, output: () => jsonSchema },
		},
	};
}

/**
 * `schema` without the `names` in its `required`, and in its `allOf` members' `required`: the body's
 * own fields, as {@link schemaFields} lists them. Nested objects keep theirs.
 */
function withoutRequired(
	schema: Readonly<Record<string, unknown>>,
	names: ReadonlySet<string>,
): Record<string, unknown> {
	const { required, allOf, ...rest } = schema;
	const kept = Array.isArray(required)
		? required.filter((name) => typeof name !== "string" || !names.has(name))
		: [];
	return {
		...rest,
		...(kept.length > 0 && { required: kept }),
		...(Array.isArray(allOf) && {
			allOf: allOf.map((member) => {
				const node = record(member);
				return node === undefined ? member : withoutRequired(node, names);
			}),
		}),
	};
}

/**
 * The `.output()` schema: it passes every result (the API checks its own responses) and
 * advertises `schema` when there is one.
 */
function outputWrapper(advertised: Readonly<Record<string, unknown>> | undefined): StandardSchema {
	return {
		"~standard": {
			version: 1,
			vendor: VENDOR,
			validate: (value) => ({ value }),
			...(advertised && { jsonSchema: { input: () => advertised, output: () => advertised } }),
		},
	};
}
