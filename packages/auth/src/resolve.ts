import { LoginRequiredError } from "./errors.ts";
import { redacted } from "./token-client.ts";
import { tokenSourceInternals } from "./token-source.ts";
import type {
	CredentialSource,
	ResolvedCredential,
	ResolveOptions,
	SourceValue,
	TokenSource,
} from "./types.ts";

// Credential resolution. Only a stored login refreshes; flag, stdin and env values
// are used as given and never stored, refreshed or revoked.

/** Default `maxBytes` of {@link fromStdin}: far above any token, far below a stray file. */
const STDIN_MAX_BYTES = 16 * 1024;

const nonEmpty = (value: string | undefined): value is string =>
	typeof value === "string" && value !== "";

/** A source whose value `read()` returns, read when the source is resolved or probed. */
function fromValue(name: string, read: () => string | undefined): CredentialSource {
	return Object.freeze({
		name,
		probe: () => nonEmpty(read()),
		async resolve() {
			const value = read();
			return nonEmpty(value) ? { value } : undefined;
		},
	});
}

/**
 * A token flag's value. Anything on the command line is visible to other users (`ps`), and
 * lands in shell history and CI logs: prefer {@link fromEnv} or {@link fromStdin}.
 */
export function fromFlag(value: string | undefined): CredentialSource {
	return fromValue("flag", () => value);
}

/** An environment variable, such as `ACME_TOKEN`, trimmed; a blank one counts as unset. */
export function fromEnv(
	name: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): CredentialSource {
	// A bearer token never contains whitespace; padding comes from how the variable was set.
	return fromValue("env", () => env[name]?.trim());
}

/**
 * A variable from a dotenv file you parsed, trimmed like {@link fromEnv}; a blank one counts as
 * unset. List it after {@link fromEnv} so the shell wins.
 */
export function fromEnvFile(
	values: Readonly<Record<string, string | undefined>>,
	name: string,
): CredentialSource {
	// Dotenv parsers keep a quoted value's padding.
	return fromValue("env-file", () => values[name]?.trim());
}

/**
 * Piped stdin, without its trailing newline, when `enabled` (such as with a `--token-stdin`
 * flag) and stdin is not a terminal. More than `maxBytes` rejects with a `RangeError` while
 * reading. Never probed for `shadowed`, since probing would consume it.
 */
export function fromStdin(options: { enabled: boolean; maxBytes?: number }): CredentialSource {
	return Object.freeze({
		name: "stdin",
		probe: () => false,
		async resolve({ signal }: ResolveOptions) {
			if (!options.enabled || process.stdin.isTTY) return undefined;
			const { readStdin } = await import("@crustjs/utils/process");
			const text = await readStdin(signal ?? new AbortController().signal, {
				maxBytes: options.maxBytes ?? STDIN_MAX_BYTES,
			});
			const value = text.replace(/\r?\n$/, "");
			return nonEmpty(value) ? { value } : undefined;
		},
	});
}

/** The stored login of a token source: refreshed when it expires, and once after a 401. */
export function fromStore(source: TokenSource): CredentialSource {
	const internals = tokenSourceInternals(source);
	return Object.freeze({
		name: "store",
		probe: () => internals.hasCredential(),
		async resolve({ signal, baseUrl }: ResolveOptions) {
			const stored = (token: { value: string; generation: string }): SourceValue => ({
				value: token.value,
				refresh: async (options) =>
					stored(
						await source.forceRefresh({
							signal: options.signal,
							ifGeneration: token.generation,
							baseUrl,
						}),
					),
			});
			try {
				return stored(await source.get({ signal, baseUrl }));
			} catch (error) {
				if (error instanceof LoginRequiredError && error.reason === "missing") return undefined;
				throw error;
			}
		},
	});
}

/**
 * The first source in `sources` that has a value. List them as flag, stdin, env, env-file,
 * store. `shadowed` names the later sources that also have one (stdin is never read for it).
 * Nothing is read before this is called. No source → `LoginRequiredError` (`missing`).
 */
export async function resolveCredential(
	sources: readonly CredentialSource[],
	options: ResolveOptions = {},
): Promise<ResolvedCredential> {
	for (const [index, candidate] of sources.entries()) {
		const found = await candidate.resolve(options);
		if (!found) continue;
		const shadowed: string[] = [];
		for (const later of sources.slice(index + 1)) {
			if (await later.probe()) shadowed.push(later.name);
		}
		const resolved = (value: SourceValue): ResolvedCredential =>
			redacted(
				{
					source: candidate.name,
					value: value.value,
					shadowed,
					refresh: value.refresh && (async (o) => resolved(await value.refresh!(o))),
				},
				["value"],
			);
		return resolved(found);
	}
	throw new LoginRequiredError("missing");
}
