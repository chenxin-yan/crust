import { join } from "node:path";

import { createStore, configDir, CrustStoreError, stateDir, withLock } from "@crustjs/store";

//#region store
const store = createStore({
	dirPath: configDir("my-cli"),
	name: "config",
	fields: {
		theme: { type: "string", default: "light" },
		verbose: { type: "boolean", default: false },
	},
});
const initial = await store.read(); // { theme: "light", verbose: false }
await store.write({ theme: "dark", verbose: false });
await store.patch({ verbose: true });
await store.reset();
console.log(initial);
//#endregion

//#region validate
const ports = createStore({
	dirPath: configDir("my-cli"),
	name: "ports",
	fields: {
		port: {
			type: "number",
			default: 3000,
			validate(value) {
				if (value < 1 || value > 65535) throw new Error("Port must be 1-65535");
			},
		},
	},
});
await ports.read();
//#endregion

//#region strict
const credentials = createStore({
	dirPath: stateDir("my-cli"),
	name: "credentials",
	fields: { token: { type: "string" } },
	strict: true,
});
try {
	await credentials.patch({ token: "abc" }, { signal: AbortSignal.timeout(60_000) });
} catch (error) {
	if (error instanceof CrustStoreError && error.is("LOCK")) {
		console.error(error.details.manualStep);
	}
	throw error;
}

// A lock on a path with no store document, for work that spans several steps.
await withLock(join(stateDir("my-cli"), "refresh-default"), async () => {
	await credentials.update((current) => ({ ...current, token: "def" }));
});
//#endregion
