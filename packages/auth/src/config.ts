import { checkIssuer } from "./endpoint.ts";
import { OAuthConfigError } from "./errors.ts";
import type { AuthConfig, AuthServerEntry, DefineAuthOptions } from "./types.ts";

/** The callback path of a server that declares no `redirectPath`. */
export const DEFAULT_REDIRECT_PATH = "/callback";

// Configs from defineAuth() and the client secrets of their entries. Kept off the frozen
// objects so printing a config never shows a secret (SEC-K1).
const configs = new WeakSet<AuthConfig>();
const clientSecrets = new WeakMap<AuthServerEntry, string>();

function option(message: string): OAuthConfigError {
	return new OAuthConfigError("invalid-option", message);
}

/**
 * An absolute path with no query, fragment, percent-encoding, dot segments, empty segments
 * or backslashes (SEC-C1). It is compared byte for byte with the raw request target (SEC-C6).
 */
export function checkRedirectPath(path: unknown): string {
	if (
		typeof path !== "string" ||
		!path.startsWith("/") ||
		/[?#%\\\s]/.test(path) ||
		path
			.split("/")
			.some(
				(segment, index) => index > 0 && (segment === "" || segment === "." || segment === ".."),
			) ||
		path === "/"
	) {
		throw option(
			"redirectPath must be an absolute path such as /callback, without a query, fragment, %, '.', '..' or empty segments",
		);
	}
	return path;
}

/**
 * Validates the authorization servers your CLI uses (SEC-H8, I6, I7, DEC-09, DEC-11) and
 * returns a frozen config. Each issuer and each `redirectPath` may appear once.
 */
export function defineAuth(options: DefineAuthOptions): AuthConfig {
	if (!Array.isArray(options?.servers) || options.servers.length === 0) {
		throw option("servers must list at least one authorization server");
	}
	if (options.allowCustomIssuers !== undefined && typeof options.allowCustomIssuers !== "boolean") {
		throw option("allowCustomIssuers must be a boolean");
	}
	const issuers = new Set<string>();
	const effectivePaths = options.servers.map(
		(server) => server.redirectPath ?? DEFAULT_REDIRECT_PATH,
	);
	const servers = options.servers.map((server) => {
		const allowInsecureLoopback = server.allowInsecureLoopback ?? false;
		if (typeof allowInsecureLoopback !== "boolean")
			throw option("allowInsecureLoopback must be a boolean");
		checkIssuer(server.issuer, allowInsecureLoopback);
		if (typeof server.clientId !== "string" || server.clientId === "") {
			throw option("clientId must be a non-empty string");
		}
		if (
			server.clientSecret !== undefined &&
			(typeof server.clientSecret !== "string" || server.clientSecret === "")
		) {
			throw option("clientSecret must be a non-empty string");
		}
		if (issuers.has(server.issuer)) {
			throw new OAuthConfigError("duplicate-issuer", "Each issuer may appear once in servers");
		}
		issuers.add(server.issuer);
		// A declared path is a mix-up defense only if no other server listens on it (SEC-I7).
		if (
			server.redirectPath !== undefined &&
			effectivePaths.filter((path) => path === checkRedirectPath(server.redirectPath)).length > 1
		) {
			throw new OAuthConfigError(
				"duplicate-redirect-path",
				"Each redirectPath must be unique among servers (a server without one uses /callback)",
			);
		}
		const entry: AuthServerEntry = Object.freeze({
			issuer: server.issuer,
			clientId: server.clientId,
			redirectPath: server.redirectPath,
			allowInsecureLoopback,
		});
		if (server.clientSecret !== undefined) clientSecrets.set(entry, server.clientSecret);
		return entry;
	});
	const config: AuthConfig = Object.freeze({
		servers: Object.freeze(servers),
		allowCustomIssuers: options.allowCustomIssuers ?? false,
	});
	configs.add(config);
	return config;
}

/** Whether `config` came from `defineAuth()`. */
export function isAuthConfig(config: unknown): config is AuthConfig {
	return typeof config === "object" && config !== null && configs.has(config as AuthConfig);
}

/** The client secret declared for `entry`, if any. */
export function clientSecretOf(entry: AuthServerEntry): string | undefined {
	return clientSecrets.get(entry);
}
