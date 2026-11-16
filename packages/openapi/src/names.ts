// The one place spec names become command, group and input names. Lint, the manifest, the
// per-group spec split and generated commands must all go through it, so they never disagree.
import type { Operation } from "./operations.ts";

/**
 * `value` in kebab case: a capital after a lowercase letter or digit, and the last capital of a
 * capital run followed by a lowercase letter, start a word; every run of other characters than ASCII
 * letters and digits is one separator. So `DeleteWebhook` and `deleteWebhook` both become
 * `delete-webhook`, `notification_url` becomes `notification-url`, `getHTTPResponse` becomes
 * `get-http-response`, and plural acronyms split before their last capital: `CAs` → `c-as`,
 * `AAGUIDs` → `aagui-ds`. A name with no ASCII letter or digit becomes `""`.
 */
export function kebab(value: string): string {
	return value
		.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
		.replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
		.replace(/[^A-Za-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

/** The default group path of an operation: its first tag in kebab case, or `""` (the root) without tags. */
export function defaultGroup(operation: Pick<Operation, "tags">): string {
	const [tag] = operation.tags;
	return tag === undefined ? "" : kebab(tag);
}

/**
 * The default command name of an operation in `group` (a group path as typed, such as
 * `"dns records"`): its operationId in kebab case, without a leading `<group>-` when a name remains.
 */
export function defaultName(operation: Pick<Operation, "id">, group: string): string {
	const name = kebab(operation.id);
	const prefix = `${kebab(group)}-`;
	return group !== "" && name.startsWith(prefix) && name.length > prefix.length
		? name.slice(prefix.length)
		: name;
}
