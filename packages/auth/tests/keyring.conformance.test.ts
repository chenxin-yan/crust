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

describe.each(["node", "bun"])("on %s", (runtime) => {
	it("creates the key once, reuses it in another process, and round-trips the login; or falls back within the deadline", () => {
		const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
		const app = `crust-auth-test-${crypto.randomUUID()}`;
		const run = (mode: string, own = root) => {
			const result = spawnSync(runtime, [script, mode, app], {
				encoding: "utf8",
				timeout: 30_000,
				env: { ...process.env, XDG_STATE_HOME: own, LOCALAPPDATA: own },
			});
			expect(result.error).toBeUndefined();
			expect(result.stderr).toBe("");
			const report = JSON.parse(result.stdout);
			// The keyring deadline is 5 seconds per call.
			expect(report.ms).toBeLessThan(12_000);
			return report;
		};
		let kind = "file";
		try {
			const login = run("login");
			kind = login.status.kind;
			const read = run("read");
			expect(read.value).toBe("CONFORMANCE_AT");
			if (kind === "file") {
				expect(process.platform).toBe("linux");
				expect(login.warnings).toEqual([{ code: "plaintext-storage" }]);
				expect(login.status).toMatchObject({ encryption: "plaintext", plaintextRecords: 1 });
				const strictRoot = mkdtempSync(join(tmpdir(), "crust-auth-"));
				try {
					expect(run("strict", strictRoot).outcome).toBe("credential-key:unavailable");
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
			}
		} finally {
			if (kind !== "file") run("delete");
			rmSync(root, { recursive: true, force: true });
		}
	}, 120_000);
});
