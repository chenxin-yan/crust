// A child process for tests/keyring.conformance.test.ts, run under Node and Bun with a state
// directory and a throwaway app name (the keyring service) of its own, on the real OS keyring:
// - `login <app>`: logs in with the keyring on; prints the store's status, warnings and time;
// - `read <app>`: prints the stored login's access token (or the error's code and reason), the
//   status and the time;
// - `strict <app>`: logs in with `strict`; prints "ok" or the error code and reason;
// - `delete <app>`: deletes the app's keyring entry.
import { createTokenSource, credentialStore, defineServers } from "../../src/oauth.ts";
import type { AuthWarning, KeyringOptions } from "../../src/types.ts";

const [mode, app] = process.argv.slice(2) as [string, string];
const issuer = "https://as.example";
const warnings: AuthWarning[] = [];

function sourceFor(keyring: KeyringOptions) {
	const store = credentialStore({ app, keyring });
	const source = createTokenSource({
		config: defineServers({ servers: [{ issuer, clientId: "cli" }] }),
		identity: { issuer, clientId: "cli", apiOrigins: ["https://api.example"] },
		store,
	});
	return { store, source };
}

async function login(keyring: KeyringOptions) {
	const { store, source } = sourceFor(keyring);
	await (
		await source.beginLogin()
	).commit({
		accessToken: "CONFORMANCE_AT",
		refreshToken: "CONFORMANCE_RT",
		tokenType: "Bearer",
		expiresAt: undefined,
		scope: undefined,
	});
	return store;
}

const started = performance.now();
const report = (fields: object) =>
	console.log(JSON.stringify({ ...fields, ms: Math.round(performance.now() - started) }));

if (mode === "login") {
	const store = await login({ onWarning: (warning) => warnings.push(warning) });
	report({ status: await store.status(), warnings });
} else if (mode === "read") {
	const { store, source } = sourceFor({});
	const value = await source.get().then(
		(token) => token.value,
		(error: { code?: string; reason?: string }) => `${error.code}:${error.reason}`,
	);
	report({ value, status: await store.status() });
} else if (mode === "strict") {
	try {
		await login({ strict: true });
		report({ outcome: "ok" });
	} catch (error) {
		const { code, reason } = error as { code?: string; reason?: string };
		report({ outcome: `${code}:${reason}` });
	}
} else if (mode === "delete") {
	const bun = (globalThis as { Bun?: { secrets?: { delete(options: object): Promise<boolean> } } })
		.Bun;
	if (bun?.secrets) {
		await bun.secrets.delete({ service: app, name: "credentials-key" });
	} else {
		const { AsyncEntry } = await import("@napi-rs/keyring");
		await new AsyncEntry(app, "credentials-key", {
			linux: { store: "secret-service" },
		}).deletePassword();
	}
	report({ deleted: true });
}
