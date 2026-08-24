/**
 * Per-shell quoting and validation helpers used by the completion
 * templates and by the extension's output-path handling.
 *
 * Why this exists: the completion templates inline a lot of CLI-author
 * provided text — command names, flag names, descriptions, choice values,
 * `binName`, `version` — into emitted shell scripts. Those scripts are
 * routinely installed via `eval "$(mycli completion bash)"` (it is the
 * documented install path), so any unsanitised interpolation is at
 * minimum a foot-gun and at worst arbitrary code execution at install
 * time. Centralising the escaping rules in one module keeps the templates
 * pure rendering code and gives us a single place to test the adversarial
 * inputs.
 *
 * Two complementary strategies are used:
 *
 * 1. **Validate identifiers** — command/flag/alias/bin names are
 *    programmer-controlled identifiers in the source CLI definition.
 *    They have no business containing whitespace, quotes, semicolons, or
 *    control characters. We reject those at spec/render time with a
 *    clear error rather than try to escape them through three different
 *    shell grammars.
 * 2. **Escape free-form text** — descriptions, choice values, version
 *    strings, and the embedded comment headers are user-facing prose.
 *    Those go through per-shell escape helpers so the templates can
 *    interpolate them safely.
 */

/**
 * Choice-value shape accepted for `flags[].choices` and `args[].choices`.
 *
 * Looser than {@link IDENT_PATTERN} so legitimate enumerated values like
 * `us-east-1`, `1.0`, `text/plain`, or `node@20` flow through unchanged,
 * but still excludes whitespace, quotes, and shell metacharacters that
 * would force per-shell escaping inside the emitted action lists
 * (`compgen -W`, zsh `(...)` action, fish `-a`).
 *
 * If a CLI legitimately needs choice values containing whitespace or
 * shell-special characters, we'd need a richer per-shell escaping scheme;
 * that's out of scope for v1. We fail fast with a clear message rather
 * than silently mis-quote.
 */
// Require an alphanumeric first character so values can never be confused
// with flags by completion shells (e.g. bash's `compgen` treating `-x` as
// an option). Subsequent chars allow the broader safe set.
const CHOICE_VALUE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.+:@/-]*$/;

export function assertSafeChoiceValue(value: string): string {
	if (!CHOICE_VALUE_PATTERN.test(value)) {
		throw new Error(
			`completion extension: unsupported choice value ${JSON.stringify(value)} — ` +
				`must match /^[A-Za-z0-9_.+:@/-]+$/. ` +
				`Whitespace and shell metacharacters are not supported in v1.`,
		);
	}
	return value;
}

/**
 * Identifier shape accepted for command names, flag names, flag aliases,
 * short flags, and arg names.
 *
 * - First char must be alphanumeric (avoids leading `-` which `complete`
 *   would interpret as an option in bash/fish).
 * - Subsequent chars: alphanumeric, `_`, `.`, or `-`.
 * - Single-character names are allowed (covers single-char short flags).
 *
 * This is deliberately conservative. CLI authors who want a command
 * named `foo:bar` or `it's` are out of scope for v1 — every shell would
 * need bespoke escaping for `case` patterns, `compdef`, and fish
 * predicate code.
 */
const IDENT_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*)?$/;

/** Throw if `name` is not a safe identifier; otherwise return it. */
export function assertSafeIdentifier(name: string, kind: string): string {
	if (!IDENT_PATTERN.test(name)) {
		throw new Error(
			`completion extension: invalid ${kind} ${JSON.stringify(name)} — ` +
				`must match /^[A-Za-z0-9][A-Za-z0-9._-]*$/. ` +
				`Whitespace, quotes, and shell metacharacters are not supported.`,
		);
	}
	return name;
}

/**
 * Validate `binName` for use as the program name in generated scripts and
 * as a filesystem basename when `--output-dir` is set.
 *
 * Stricter than {@link assertSafeIdentifier} because `binName` also
 * becomes a filename and a `complete -F`/`compdef` argument that's
 * easier to break than option names.
 */
/** Map a validated CLI identifier to a shell function identifier. */
export function toShellIdent(name: string): string {
	return name.replace(/[^A-Za-z0-9_]/g, "_");
}

export function assertSafeBinName(binName: string): string {
	if (binName.length === 0) {
		throw new Error("completion extension: binName must not be empty");
	}
	if (binName.includes("/") || binName.includes("\\") || binName === ".." || binName === ".") {
		throw new Error(
			`completion extension: invalid binName ${JSON.stringify(binName)} — ` +
				`path separators and "."/".." are not allowed (used as a filename in --output-dir mode).`,
		);
	}
	return assertSafeIdentifier(binName, "binName");
}

// ── Free-form text sanitisation ────────────────────────────────────────────

/**
 * Strip control characters from `value` so it can be safely embedded in
 * a shell comment line or shell-quoted string without smuggling a
 * newline that would terminate the comment / break the quote nesting.
 *
 * Replaces NUL, CR, LF, vertical-tab, form-feed, and other C0/C1 controls
 * with a single space. We keep horizontal tab as-is (descriptions
 * occasionally use it for alignment).
 */
export function sanitizeFreeText(value: string): string {
	// Range covers C0 controls (NUL–BS, LF–US) plus DEL. We deliberately
	// keep horizontal tab (0x09) since descriptions occasionally use it
	// for alignment; everything else — including LF and CR — collapses
	// to a single space so callers can safely embed values in shell
	// comment lines and shell-quoted strings.
	// oxlint-disable-next-line no-control-regex -- deliberately match controls
	return value.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, " ");
}

// ── Bash ──────────────────────────────────────────────────────────────────

/**
 * Wrap `value` as a bash single-quoted shell word.
 *
 * Single quotes have no escape sequence in bash, so embedded single quotes
 * close-and-reopen the quote: `'foo'\''bar'`. This is the canonical
 * `printf %q`-style safe form: the result is always exactly one shell
 * token regardless of the input bytes (after sanitisation).
 *
 * Callers should pass values that have already had control characters
 * scrubbed via {@link sanitizeFreeText} when the value is free-form
 * (description, version, choice value).
 */
export function bashSingleQuote(value: string): string {
	return `'${value.replace(/'/g, "'\\''")}'`;
}

/**
 * Escape a single value for inclusion as a literal-matched key in a bash
 * `case` pattern, when the entire pattern is wrapped in double quotes.
 *
 * Inside `"..."` quotes, bash treats `*?[]{}|()` as literals, so the only
 * remaining concern is the double-quote characters in the active set:
 * `\`, `$`, `` ` ``, `"`. We escape those.
 *
 * The result is meant to be placed inside `"..."`; callers add the outer
 * quotes themselves so they can build patterns like
 * `"<path>|<word>"` from multiple escaped pieces.
 */
export function bashDoubleQuoteInner(value: string): string {
	return value.replace(/[\\$`"]/g, "\\$&");
}

// ── Zsh ───────────────────────────────────────────────────────────────────

/** Wrap `value` as a zsh single-quoted shell word. */
export const zshSingleQuote: typeof bashSingleQuote = bashSingleQuote;

/**
 * Escape free-form text for use inside the `[...]` description bracket of
 * a zsh `_arguments` spec.
 *
 * `_arguments` parses spec strings with `:` as the field separator and
 * `[...]` as the description bracket; backslash escapes both. We also
 * scrub newlines (descriptions are one-liners in completion menus) and
 * single quotes (the spec is wrapped in single quotes by the caller).
 */
export function zshArgsDescription(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/\[/g, "\\[")
		.replace(/]/g, "\\]")
		.replace(/:/g, "\\:")
		.replace(/'/g, "'\\''")
		.replace(/[\r\n]+/g, " ");
}

/**
 * Escape a value for inclusion as the **name** field of a `_describe`
 * item (the part before the `:` description separator). `_describe`
 * splits each item on the first un-escaped `:`, so embedded colons
 * must be escaped. Backslashes also need escaping because they're the
 * escape character.
 *
 * The result is meant to be placed inside zsh single quotes by the
 * caller (we do NOT include outer quotes); call {@link zshSingleQuote}
 * on the assembled `name:desc` string when emitting.
 */
export function zshDescribeField(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/:/g, "\\:")
		.replace(/[\r\n]+/g, " ");
}

// ── Fish ──────────────────────────────────────────────────────────────────

/**
 * Wrap `value` as a fish single-quoted shell word. Fish single quotes
 * only escape `\\` and `\'`; everything else is literal.
 */
export function fishSingleQuote(value: string): string {
	return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
