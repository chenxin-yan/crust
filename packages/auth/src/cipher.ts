// AES-256-GCM through Web Crypto: a non-extractable key, a fresh 96-bit IV per encryption and
// a 128-bit tag. The AAD binds a ciphertext to the record it was written for.

/** An encrypted secret as stored: base64url IV, and ciphertext with its tag. */
export interface SealedSecret {
	readonly iv: string;
	readonly ciphertext: string;
}

const encoder = new TextEncoder();

/** The canonical AAD: the UTF-8 JSON array of `fields`. */
const aadOf = (fields: readonly string[]) => encoder.encode(JSON.stringify(fields));

/** Imports 32 key bytes as a non-extractable AES-GCM key. */
export const importKey = (bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> =>
	crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);

export async function seal(
	key: CryptoKey,
	plaintext: string,
	aad: readonly string[],
): Promise<SealedSecret> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ciphertext = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv, additionalData: aadOf(aad), tagLength: 128 },
		key,
		encoder.encode(plaintext),
	);
	return {
		iv: Buffer.from(iv).toString("base64url"),
		ciphertext: Buffer.from(ciphertext).toString("base64url"),
	};
}

/** The plaintext of `sealed`; rejects when the key, AAD, IV or ciphertext differ. */
export async function unseal(
	key: CryptoKey,
	sealed: SealedSecret,
	aad: readonly string[],
): Promise<string> {
	const plaintext = await crypto.subtle.decrypt(
		{
			name: "AES-GCM",
			iv: Buffer.from(sealed.iv, "base64url"),
			additionalData: aadOf(aad),
			tagLength: 128,
		},
		key,
		Buffer.from(sealed.ciphertext, "base64url"),
	);
	return new TextDecoder().decode(plaintext);
}
