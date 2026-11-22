import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { createPkce, pkceChallenge, randomState } from "./pkce.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createPkce", () => {
	it("creates unique 43-character verifiers from crypto.getRandomValues only", async () => {
		const getRandomValues = vi.spyOn(crypto, "getRandomValues");
		const verifiers = await Promise.all(Array.from({ length: 1000 }, () => createPkce()));
		const unique = new Set(verifiers.map((pkce) => pkce.verifier));
		expect(unique.size).toBe(1000);
		for (const verifier of unique) expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43}$/);
		expect(getRandomValues).toHaveBeenCalledTimes(1000);
	});

	it("computes the RFC 7636 Appendix B challenge", async () => {
		const challenge = await pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
		expect(challenge).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
		const { challenge: fresh } = await createPkce();
		expect(fresh).not.toMatch(/[+/=]/);
	});

	it("always uses S256 and returns a frozen pair", async () => {
		const pkce = await createPkce();
		expect(pkce.method).toBe("S256");
		expect(Object.isFrozen(pkce)).toBe(true);
		expect(pkce.challenge).toBe(await pkceChallenge(pkce.verifier));
	});
});

describe("randomState", () => {
	it("returns an opaque 256-bit base64url value", () => {
		const states = new Set(Array.from({ length: 100 }, () => randomState()));
		expect(states.size).toBe(100);
		for (const state of states) expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});
});
