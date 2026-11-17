/**
 * @module-tag windows
 * @module-tag macos
 */
// The real OS keyring, through Bun.secrets and @napi-rs/keyring, in subprocesses with a hard
// deadline. Each run uses a throwaway app name as the keyring service and deletes its entry.
// macOS and Windows must have a keyring. A Linux host may have none (CI has no Secret Service):
// then the result must be the plaintext fallback within the keyring deadline, never a hang.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const script = join(import.meta.dirname, "fixtures", "keyring.ts");

/** One run of the fixture under `runtime`, with its own state directory `root`. */
function run(runtime: string, mode: string, app: string, root: string) {
	const result = spawnSync(runtime, [script, mode, app], {
		encoding: "utf8",
		timeout: 30_000,
		env: { ...process.env, XDG_STATE_HOME: root, LOCALAPPDATA: root },
	});
	expect(result.error).toBeUndefined();
	expect(result.stderr).toBe("");
	const report = JSON.parse(result.stdout);
	// The keyring deadline is 5 seconds per call.
	expect(report.ms).toBeLessThan(12_000);
	return report;
}

/** The Windows Credential Manager listing of the credential whose target contains `target`. */
function credential(target: string): string | undefined {
	const listing = spawnSync("cmdkey", ["/list"], { encoding: "utf8" }).stdout;
	return listing.split(/\r?\n\s*\r?\n/).find((block) => block.includes(target));
}

describe.each(["node", "bun"])("on %s", (runtime) => {
	it("creates the key once, reuses it in another process, and round-trips the login; or falls back within the deadline", () => {
		const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
		const app = `crust-auth-test-${crypto.randomUUID()}`;
		const fixture = (mode: string, own = root) => run(runtime, mode, app, own);
		let kind = "file";
		try {
			const login = fixture("login");
			kind = login.status.kind;
			const read = fixture("read");
			expect(read.value).toBe("CONFORMANCE_AT");
			if (kind === "file") {
				expect(process.platform).toBe("linux");
				expect(login.warnings).toEqual([{ code: "plaintext-storage" }]);
				expect(login.status).toMatchObject({ encryption: "plaintext", plaintextRecords: 1 });
				const strictRoot = mkdtempSync(join(tmpdir(), "crust-auth-"));
				try {
					expect(fixture("strict", strictRoot).outcome).toBe("credential-key:unavailable");
				} finally {
					rmSync(strictRoot, { recursive: true, force: true });
				}
			} else {
				expect(kind).toBe(runtime === "bun" ? "bun-secrets" : "napi-keyring");
				expect(login.warnings).toEqual([]);
				expect(login.status).toEqual({
					kind,
					encryption: "aes-256-gcm",
					keyReadable: true,
					plaintextRecords: 0,
				});
				expect(read.status).toMatchObject({ keyReadable: true });
				if (process.platform === "win32" && runtime === "bun") {
					// Bun 1.4.3+ honors persist: "local"; the CI's Bun is newer.
					expect(credential(`${app}/credentials-key`)).toContain("Local machine persistence");
				}
			}
		} finally {
			if (kind !== "file") fixture("delete");
			rmSync(root, { recursive: true, force: true });
		}
	}, 120_000);
});

describe.each([
	["node", "bun"],
	["bun", "node"],
])("a login stored under %s, read under %s", (writer, reader) => {
	it("is read on macOS, where both reach one Keychain item; elsewhere it asks for a login", () => {
		const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
		const app = `crust-auth-test-${crypto.randomUUID()}`;
		let kind = "file";
		try {
			kind = run(writer, "login", app, root).status.kind;
			const { value } = run(reader, "read", app, root);
			if (kind === "file" || process.platform === "darwin") {
				expect(value).toBe("CONFORMANCE_AT");
			} else if (process.platform === "win32") {
				expect(value).toBe("login-required:key-other-keyring");
			} else {
				// Linux: Bun.secrets also needs libsecret, which a host with a Secret Service may lack.
				expect(["login-required:key-other-keyring", "credential-key:unreadable"]).toContain(value);
			}
		} finally {
			if (kind !== "file") run(writer, "delete", app, root);
			rmSync(root, { recursive: true, force: true });
		}
	}, 120_000);
});
