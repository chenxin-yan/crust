/** A PKCE pair (RFC 7636). The `verifier` is a secret: never print or log it. */
export interface Pkce {
	readonly verifier: string;
	readonly challenge: string;
	/** Always `"S256"`; there is no `plain` method. */
	readonly method: "S256";
}

/** 32 bytes from the platform CSPRNG, base64url without padding: 43 characters. */
function randomToken(): string {
	return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** BASE64URL(SHA-256(ASCII(verifier))), RFC 7636 §4.2. */
export async function pkceChallenge(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return Buffer.from(digest).toString("base64url");
}

/** Creates a fresh PKCE pair: a 256-bit random verifier and its S256 challenge. */
export async function createPkce(): Promise<Pkce> {
	const verifier = randomToken();
	return Object.freeze({ verifier, challenge: await pkceChallenge(verifier), method: "S256" });
}

/** Creates an unpredictable, opaque OAuth `state` value: 256 random bits, base64url. */
export function randomState(): string {
	return randomToken();
}
