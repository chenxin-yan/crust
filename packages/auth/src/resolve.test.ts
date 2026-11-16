import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { inspect } from "node:util";

import { withLock } from "@crustjs/store";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { holdLock, login, tokenWorld } from "../tests/helpers.ts";
import { defineServers } from "./config.ts";
import { credentialStoreInternals } from "./credentials.ts";
import { CredentialMismatchError, LoginRequiredError, OAuthConfigError } from "./errors.ts";
import {
	fromEnv,
	fromEnvFile,
	fromFlag,
	fromStdin,
	fromStore,
	resolveCredential,
} from "./resolve.ts";
import { createTokenSource } from "./token-source.ts";

const roots: string[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function world(options: Parameters<typeof tokenWorld>[0] = {}) {
	const created = tokenWorld(options);
	roots.push(created.root);
	return created;
}

/** Stdin replaced by a pipe that is not a terminal. */
function pipeStdin(): PassThrough {
	const stdin = new PassThrough();
	vi.spyOn(process, "stdin", "get").mockReturnValue(stdin as unknown as typeof process.stdin);
	return stdin;
}

const docs = () =>
	readFileSync(
		join(import.meta.dirname, "../../../apps/docs/content/docs/modules/auth.mdx"),
		"utf8",
	);

describe("resolveCredential", () => {
	it("picks the first source in order and lists the later ones that have a value", async () => {
		const w = world();
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		const names = ["flag", "stdin", "env", "env-file", "store"] as const;
		for (let subset = 1; subset < 1 << names.length; subset += 1) {
			const present = names.filter((_, index) => subset & (1 << index));
			vi.restoreAllMocks();
			const stdin = pipeStdin();
			stdin.end(present.includes("stdin") ? "STDIN\n" : "");
			const sources = [
				fromFlag(present.includes("flag") ? "FLAG" : undefined),
				fromStdin({ enabled: true }),
				fromEnv("ACME_TOKEN", present.includes("env") ? { ACME_TOKEN: "ENV" } : {}),
				fromEnvFile(present.includes("env-file") ? { ACME_TOKEN: "FILE" } : {}, "ACME_TOKEN"),
				...(present.includes("store") ? [fromStore(tokens)] : []),
			];
			const resolved = await resolveCredential(sources);
			const winner = present[0]!;
			expect(resolved.source).toBe(winner);
			expect(resolved.value).toBe(
				{ flag: "FLAG", stdin: "STDIN", env: "ENV", "env-file": "FILE", store: "AT1" }[winner],
			);
			// Stdin is never read to find out whether it shadows anything.
			expect(resolved.shadowed).toEqual(present.slice(1).filter((name) => name !== "stdin"));
		}
	});

	it("reads nothing until called, and asks for a login when no source has a value", async () => {
		const w = world();
		const internals = credentialStoreInternals(w.store);
		const read = vi.spyOn(internals, "read");
		const sources = [fromEnv("ACME_TOKEN", {}), fromStore(w.source())];
		expect(read).not.toHaveBeenCalled();
		await expect(resolveCredential(sources)).rejects.toMatchObject({
			code: "login-required",
			reason: "missing",
		});
		expect(existsSync(w.dir)).toBe(false);
	});

	it("never stores, refreshes or revokes an environment token", async () => {
		const w = world();
		const tokens = w.source();
		const resolved = await resolveCredential([
			fromEnv("ACME_TOKEN", { ACME_TOKEN: "ENV_TOKEN" }),
			fromStore(tokens),
		]);
		expect(resolved).toMatchObject({ source: "env", value: "ENV_TOKEN", shadowed: [] });
		expect(resolved.refresh).toBeUndefined();
		await tokens.logout();
		expect(JSON.stringify(w.document())).not.toContain("ENV_TOKEN");
		expect(w.requests).toHaveLength(0);
	});

	it("reads a token from piped stdin without its newline, and refuses an endless pipe at maxBytes", async () => {
		pipeStdin().end("SENTINEL_STDIN\r\n");
		await expect(resolveCredential([fromStdin({ enabled: true })])).resolves.toMatchObject({
			source: "stdin",
			value: "SENTINEL_STDIN",
		});

		vi.restoreAllMocks();
		const endless = pipeStdin();
		const pending = resolveCredential([fromStdin({ enabled: true, maxBytes: 64 })]);
		endless.write("SENTINEL_STDIN".repeat(10));
		const error = await pending.catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(RangeError);
		expect(inspect(error)).not.toContain("SENTINEL");

		vi.restoreAllMocks();
		pipeStdin().end("PIPED");
		await expect(resolveCredential([fromStdin({ enabled: false })])).rejects.toBeInstanceOf(
			LoginRequiredError,
		);
	});

	it("documents env and stdin before the flag, and that a flag shows on the command line", () => {
		const text = docs();
		const section = text.slice(text.indexOf("## Choosing a credential"));
		expect(section.indexOf("fromEnv")).toBeLessThan(section.indexOf("fromFlag"));
		expect(section.indexOf("fromStdin")).toBeLessThan(section.indexOf("fromFlag"));
		expect(section).toContain("visible to other users");
	});

	it("reads an environment variable when it resolves, not when the source is built", async () => {
		const env: Record<string, string | undefined> = {};
		const file: Record<string, string | undefined> = {};
		const sources = [fromEnv("ACME_TOKEN", env), fromEnvFile(file, "ACME_TOKEN")];
		file.ACME_TOKEN = "FROM_FILE";
		await expect(resolveCredential(sources)).resolves.toMatchObject({ source: "env-file" });
		env.ACME_TOKEN = "FROM_SHELL";
		await expect(resolveCredential(sources)).resolves.toMatchObject({
			source: "env",
			value: "FROM_SHELL",
			shadowed: ["env-file"],
		});
	});

	it("an exported variable wins over the same variable from an env file", async () => {
		const file = { ACME_TOKEN: "FROM_FILE" };
		await expect(
			resolveCredential([
				fromEnv("ACME_TOKEN", { ACME_TOKEN: "FROM_SHELL" }),
				fromEnvFile(file, "ACME_TOKEN"),
			]),
		).resolves.toMatchObject({ source: "env", value: "FROM_SHELL", shadowed: ["env-file"] });
		await expect(
			resolveCredential([fromEnv("ACME_TOKEN", {}), fromEnvFile(file, "ACME_TOKEN")]),
		).resolves.toMatchObject({ source: "env-file", value: "FROM_FILE" });
	});

	it("an API or issuer override from env meets the same checks as code, before any request", async () => {
		const w = world();
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		await expect(
			resolveCredential([fromStore(tokens)], { baseUrl: "https://api.b.example" }),
		).rejects.toBeInstanceOf(CredentialMismatchError);

		const config = defineServers({
			servers: [{ issuer: "http://127.0.0.1:8000", clientId: "cli", allowInsecureLoopback: true }],
		});
		for (const issuer of ["http://127.0.0.1:9000", "http://localhost:8000"]) {
			expect(() =>
				createTokenSource({
					config,
					identity: { issuer, clientId: "cli", apiOrigins: ["http://127.0.0.1:9000"] },
					store: w.store,
				}),
			).toThrow(OAuthConfigError);
		}
		expect(() =>
			createTokenSource({
				config,
				identity: {
					issuer: "http://127.0.0.1:8000",
					clientId: "cli",
					apiOrigins: ["http://127.0.0.1:9000"],
				},
				store: w.store,
			}),
		).toThrow(OAuthConfigError);
		expect(w.requests).toHaveLength(0);
	});

	it("probes the store without waiting for its locks", async () => {
		const w = world({ lockTimeout: 60_000 });
		const tokens = w.source();
		await login(tokens, { expiresAt: undefined });
		const locks = [
			await holdLock((fn) => credentialStoreInternals(w.store).lockIdentity(tokens.key, fn)),
			await holdLock((fn) => withLock(w.file, fn)),
		];
		const resolved = await resolveCredential([
			fromEnv("ACME_TOKEN", { ACME_TOKEN: "ENV" }),
			fromStore(tokens),
		]);
		expect(resolved.shadowed).toEqual(["store"]);
		for (const lock of locks) await lock.release();

		await tokens.logout();
		await expect(
			resolveCredential([fromEnv("ACME_TOKEN", { ACME_TOKEN: "ENV" }), fromStore(tokens)]),
		).resolves.toMatchObject({ shadowed: [] });
	});

	it("prints a resolved credential without its value", async () => {
		const resolved = await resolveCredential([fromFlag("SENTINEL_FLAG")]);
		expect(JSON.stringify(resolved)).not.toContain("SENTINEL");
		expect(inspect(resolved)).not.toContain("SENTINEL");
		expect(resolved.value).toBe("SENTINEL_FLAG");
	});
});
