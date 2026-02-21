/**
 * Interpolate `{{var}}` placeholders in a string with values from a context object.
 *
 * Only simple `{{identifier}}` patterns are replaced — no conditionals, loops,
 * or helpers. Whitespace inside the braces is tolerated (e.g. `{{ name }}`).
 * Missing variables are left untouched.
 *
 * @param content - The template string containing `{{var}}` placeholders.
 * @param context - A flat map of variable names to replacement values.
 * @returns The interpolated string.
 *
 * @example
 * ```ts
 * interpolate("Hello, {{name}}!", { name: "world" });
 * // => "Hello, world!"
 * ```
 */
export function interpolate(
	content: string,
	context: Record<string, string>,
): string {
	return content.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
		if (key in context) {
			return context[key] as string;
		}
		return match;
	});
}
