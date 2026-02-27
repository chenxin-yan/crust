import { afterEach, describe, expect, it, mock } from "bun:test";
import {
	fetchLatestVersion,
	isNewerVersion,
	parseSemver,
} from "./update-notifier.ts";

/** Helper to mock globalThis.fetch without type errors from `preconnect`. */
function mockFetch(
	fn: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>,
) {
	globalThis.fetch = Object.assign(mock(fn), {
		preconnect: globalThis.fetch.preconnect,
	});
}

// ────────────────────────────────────────────────────────────────────────────
// parseSemver
// ────────────────────────────────────────────────────────────────────────────

describe("parseSemver", () => {
	it("parses standard semver", () => {
		expect(parseSemver("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it("parses version with leading v", () => {
		expect(parseSemver("v1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
	});

	it("parses version 0.0.0", () => {
		expect(parseSemver("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
	});

	it("parses large version numbers", () => {
		expect(parseSemver("100.200.300")).toEqual({
			major: 100,
			minor: 200,
			patch: 300,
		});
	});

	it("strips prerelease suffix", () => {
		expect(parseSemver("1.2.3-beta.1")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
		});
	});

	it("strips build metadata", () => {
		expect(parseSemver("1.2.3+build.456")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
		});
	});

	it("strips prerelease and build metadata combined", () => {
		expect(parseSemver("1.2.3-rc.1+sha.abc")).toEqual({
			major: 1,
			minor: 2,
			patch: 3,
		});
	});

	it("returns null for empty string", () => {
		expect(parseSemver("")).toBeNull();
	});

	it("returns null for non-version string", () => {
		expect(parseSemver("not-a-version")).toBeNull();
	});

	it("returns null for two-part version", () => {
		expect(parseSemver("1.2")).toBeNull();
	});

	it("returns null for four-part version", () => {
		expect(parseSemver("1.2.3.4")).toBeNull();
	});

	it("returns null for NaN segments", () => {
		expect(parseSemver("a.b.c")).toBeNull();
	});

	it("returns null for Infinity", () => {
		expect(parseSemver("Infinity.0.0")).toBeNull();
	});

	it("returns null for negative segments", () => {
		expect(parseSemver("-1.0.0")).toBeNull();
	});
});

// ────────────────────────────────────────────────────────────────────────────
// isNewerVersion
// ────────────────────────────────────────────────────────────────────────────

describe("isNewerVersion", () => {
	it("returns true when latest major is higher", () => {
		expect(isNewerVersion("1.0.0", "2.0.0")).toBe(true);
	});

	it("returns true when latest minor is higher", () => {
		expect(isNewerVersion("1.0.0", "1.1.0")).toBe(true);
	});

	it("returns true when latest patch is higher", () => {
		expect(isNewerVersion("1.0.0", "1.0.1")).toBe(true);
	});

	it("returns false for equal versions", () => {
		expect(isNewerVersion("1.2.3", "1.2.3")).toBe(false);
	});

	it("returns false when latest is older (major)", () => {
		expect(isNewerVersion("2.0.0", "1.0.0")).toBe(false);
	});

	it("returns false when latest is older (minor)", () => {
		expect(isNewerVersion("1.2.0", "1.1.0")).toBe(false);
	});

	it("returns false when latest is older (patch)", () => {
		expect(isNewerVersion("1.0.2", "1.0.1")).toBe(false);
	});

	it("returns false when current is unparsable", () => {
		expect(isNewerVersion("invalid", "1.0.0")).toBe(false);
	});

	it("returns false when latest is unparsable", () => {
		expect(isNewerVersion("1.0.0", "invalid")).toBe(false);
	});

	it("returns false when both are unparsable", () => {
		expect(isNewerVersion("invalid", "also-invalid")).toBe(false);
	});

	it("handles prerelease current — compares base only", () => {
		// 1.2.3-beta.1 base is 1.2.3, latest 1.2.3 is not newer
		expect(isNewerVersion("1.2.3-beta.1", "1.2.3")).toBe(false);
	});

	it("handles prerelease latest — compares base only", () => {
		// 1.2.4-rc.1 base is 1.2.4 which is newer than 1.2.3
		expect(isNewerVersion("1.2.3", "1.2.4-rc.1")).toBe(true);
	});

	it("handles v-prefixed versions", () => {
		expect(isNewerVersion("v1.0.0", "v2.0.0")).toBe(true);
	});

	it("handles mixed v-prefix", () => {
		expect(isNewerVersion("v1.0.0", "2.0.0")).toBe(true);
		expect(isNewerVersion("1.0.0", "v2.0.0")).toBe(true);
	});
});

// ────────────────────────────────────────────────────────────────────────────
// fetchLatestVersion
// ────────────────────────────────────────────────────────────────────────────

describe("fetchLatestVersion", () => {
	const originalFetch = globalThis.fetch;

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it("returns latest version from registry response", async () => {
		mockFetch(() =>
			Promise.resolve(
				new Response(
					JSON.stringify({
						"dist-tags": { latest: "2.0.0" },
					}),
					{ status: 200 },
				),
			),
		);

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBe("2.0.0");
	});

	it("constructs correct URL with encoded package name", async () => {
		let capturedUrl = "";
		mockFetch((input) => {
			capturedUrl = typeof input === "string" ? input : input.toString();
			return Promise.resolve(
				new Response(JSON.stringify({ "dist-tags": { latest: "1.0.0" } }), {
					status: 200,
				}),
			);
		});

		await fetchLatestVersion(
			"@scope/my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(capturedUrl).toBe("https://registry.npmjs.org/%40scope%2Fmy-cli");
	});

	it("strips trailing slashes from registry URL", async () => {
		let capturedUrl = "";
		mockFetch((input) => {
			capturedUrl = typeof input === "string" ? input : input.toString();
			return Promise.resolve(
				new Response(JSON.stringify({ "dist-tags": { latest: "1.0.0" } }), {
					status: 200,
				}),
			);
		});

		await fetchLatestVersion("my-cli", "https://registry.npmjs.org///", 5000);
		expect(capturedUrl).toBe("https://registry.npmjs.org/my-cli");
	});

	it("returns null on non-OK response", async () => {
		mockFetch(() =>
			Promise.resolve(new Response("Not Found", { status: 404 })),
		);

		const result = await fetchLatestVersion(
			"nonexistent-package",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null on network error", async () => {
		mockFetch(() => Promise.reject(new Error("Network failure")));

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null when dist-tags is missing", async () => {
		mockFetch(() =>
			Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
		);

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null when latest is not a string", async () => {
		mockFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ "dist-tags": { latest: 123 } }), {
					status: 200,
				}),
			),
		);

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null when latest is empty string", async () => {
		mockFetch(() =>
			Promise.resolve(
				new Response(JSON.stringify({ "dist-tags": { latest: "" } }), {
					status: 200,
				}),
			),
		);

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null on malformed JSON response", async () => {
		mockFetch(() => Promise.resolve(new Response("not json", { status: 200 })));

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			5000,
		);
		expect(result).toBeNull();
	});

	it("returns null on timeout (abort)", async () => {
		mockFetch(
			(_input, init) =>
				new Promise<Response>((_resolve, reject) => {
					// Listen for abort and reject like a real fetch would
					if (init?.signal) {
						init.signal.addEventListener("abort", () => {
							reject(
								new DOMException("The operation was aborted.", "AbortError"),
							);
						});
					}
				}),
		);

		const result = await fetchLatestVersion(
			"my-cli",
			"https://registry.npmjs.org",
			50, // Very short timeout
		);
		expect(result).toBeNull();
	});
});
