import { describe, expect, it } from "vite-plus/test";

import { importKey, seal, unseal } from "./cipher.ts";

const keyBytes = () => crypto.getRandomValues(new Uint8Array(32));
const aad = ["1", "acme", "default#h", "https://as.example", "cli", "default", "https://a", "g1"];

describe("AES-256-GCM secrets", () => {
	it("round-trips a secret under its AAD with a non-extractable key", async () => {
		const key = await importKey(keyBytes());
		expect(key.extractable).toBe(false);
		expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
		const sealed = await seal(key, "SENTINEL_AT", aad);
		expect(JSON.stringify(sealed)).not.toContain("SENTINEL");
		// A 96-bit IV, and a 128-bit tag after the ciphertext.
		expect(Buffer.from(sealed.iv, "base64url")).toHaveLength(12);
		expect(Buffer.from(sealed.ciphertext, "base64url")).toHaveLength("SENTINEL_AT".length + 16);
		await expect(unseal(key, sealed, aad)).resolves.toBe("SENTINEL_AT");
	});

	it("uses a fresh IV for every encryption, so the same secret never encrypts the same way", async () => {
		const key = await importKey(keyBytes());
		const [first, second] = [await seal(key, "AT", aad), await seal(key, "AT", aad)];
		expect(first.iv).not.toBe(second.iv);
		expect(first.ciphertext).not.toBe(second.ciphertext);
		const ivs = new Set<string>();
		for (let index = 0; index < 10_000; index += 1) ivs.add((await seal(key, "AT", aad)).iv);
		expect(ivs.size).toBe(10_000);
	});

	it.each([
		["another key", async () => ({ key: await importKey(keyBytes()), aad })],
		["another record key", async () => ({ key: undefined, aad: aad.with(2, "work#h") })],
		["another generation", async () => ({ key: undefined, aad: aad.with(aad.length - 1, "g2") })],
		[
			"another API origin",
			async () => ({ key: undefined, aad: [...aad.slice(0, -2), "https://b", "g1"] }),
		],
		["another app", async () => ({ key: undefined, aad: aad.with(1, "other") })],
	])("refuses a secret opened with %s", async (_name, change) => {
		const key = await importKey(keyBytes());
		const sealed = await seal(key, "AT", aad);
		const other = await change();
		await expect(unseal(other.key ?? key, sealed, other.aad)).rejects.toThrow();
	});

	it("refuses a flipped ciphertext or IV byte", async () => {
		const key = await importKey(keyBytes());
		const sealed = await seal(key, "AT", aad);
		const flip = (value: string) => {
			const bytes = Buffer.from(value, "base64url");
			bytes[0]! ^= 1;
			return bytes.toString("base64url");
		};
		await expect(
			unseal(key, { ...sealed, ciphertext: flip(sealed.ciphertext) }, aad),
		).rejects.toThrow();
		await expect(unseal(key, { ...sealed, iv: flip(sealed.iv) }, aad)).rejects.toThrow();
	});
});
