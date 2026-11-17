/**
 * @module-tag windows
 * @module-tag macos
 */
// The real OS keyring, through Bun.secrets and @napi-rs/keyring, in subprocesses with a hard
// deadline. Each run uses a throwaway app name as the keyring service and deletes its entry.
// macOS and Windows must have a keyring. A Linux host may have none (CI has no Secret Service):
// then the result must be the plaintext fallback within the keyring deadline, never a hang.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
	// One JSON line per step; the keyring deadline is 5 seconds per call.
	const lines: { ms: number }[] = result.stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	for (const line of lines) expect(line.ms).toBeLessThan(12_000);
	return Object.assign({}, ...lines);
}

/**
 * The lines one run of the fixture printed before it exited or was killed at `killMs`: a
 * keyring that waits for a person (macOS asking to allow another program) never lets it exit.
 */
async function runBounded(runtime: string, args: string[], root: string, killMs: number) {
	const child = spawn(runtime, [script, ...args], {
		env: { ...process.env, XDG_STATE_HOME: root, LOCALAPPDATA: root },
		stdio: ["ignore", "pipe", "pipe"],
	});
	let out = "";
	let errors = "";
	child.stdout.on("data", (chunk: Buffer) => (out += chunk));
	child.stderr.on("data", (chunk: Buffer) => (errors += chunk));
	const kill = setTimeout(() => child.kill("SIGKILL"), killMs);
	if (child.exitCode === null && child.signalCode === null) await once(child, "exit");
	clearTimeout(kill);
	expect(errors).toBe("");
	return out
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown> & { ms: number });
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
	it("on macOS reads it or fails with the key error at the deadline, writing nothing; elsewhere it asks for a login", async () => {
		const root = mkdtempSync(join(tmpdir(), "crust-auth-"));
		const app = `crust-auth-test-${crypto.randomUUID()}`;
		let kind = "file";
		try {
			kind = run(writer, "login", app, root).status.kind;
			if (process.platform === "darwin") {
				// One Keychain item, created by the writer: macOS asks a person to allow the reader,
				// and on this headless host nobody answers. The read must still end at its deadline.
				const file = readFileSync(join(root, app, "credentials.json"), "utf8");
				const lines = await runBounded(reader, ["read", app, "2000"], root, 15_000);
				expect(lines[0]).toBeDefined();
				expect(["CONFORMANCE_AT", "credential-key:unreadable"]).toContain(lines[0]!.value);
				expect(lines[0]!.ms).toBeLessThan(5_000);
				expect(readFileSync(join(root, app, "credentials.json"), "utf8")).toBe(file);
				// The writer's key is still there and still the file's: nothing replaced it.
				expect(run(writer, "read", app, root).value).toBe("CONFORMANCE_AT");
				return;
			}
			const { value } = run(reader, "read", app, root);
			if (kind === "file") {
				expect(value).toBe("CONFORMANCE_AT");
			} else if (process.platform === "win32") {
				expect(value).toBe("login-required:key-other-keyring");
			} else {
				// Linux: Bun.secrets also needs libsecret, which a host with a Secret Service may lack.
				expect(["login-required:key-other-keyring", "credential-key:unreadable"]).toContain(value);
			}
		} finally {
			// Only the writer created an item; the reader only reads.
			if (kind !== "file") run(writer, "delete", app, root);
			rmSync(root, { recursive: true, force: true });
		}
	}, 120_000);
});
