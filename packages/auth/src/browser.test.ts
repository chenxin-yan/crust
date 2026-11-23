import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const openUrl = vi.hoisted(() => vi.fn(async (_url: string) => true));
vi.mock("@crustjs/utils/process", () => ({ openUrl }));

const { openBrowser } = await import("./browser.ts");

afterEach(() => {
	openUrl.mockClear();
});

describe("openBrowser", () => {
	it.each([
		"file:///etc/passwd",
		"javascript:alert(1)",
		"myapp://callback",
		"http://evil.example/login",
		"http://localhost:9000/authorize",
		"https://user:pass@as.example/authorize",
		"not a url",
	])("refuses %s without launching", async (url) => {
		expect(await openBrowser(url)).toBe(false);
		expect(openUrl).not.toHaveBeenCalled();
	});

	it("opens http only on the given loopback dev origin", async () => {
		expect(
			await openBrowser("http://127.0.0.1:9000/authorize", {
				allowInsecureLoopbackOrigin: "http://127.0.0.1:9000",
			}),
		).toBe(true);
		expect(
			await openBrowser("http://127.0.0.1:9001/authorize", {
				allowInsecureLoopbackOrigin: "http://127.0.0.1:9000",
			}),
		).toBe(false);
		expect(
			await openBrowser("http://localhost:9000/a", {
				allowInsecureLoopbackOrigin: "http://localhost:9000",
			}),
		).toBe(false);
		expect(await openBrowser("http://127.0.0.1:9000/authorize")).toBe(false);
		expect(openUrl).toHaveBeenCalledTimes(1);
	});

	it("hands an accepted URL to the shared launcher and resolves its result", async () => {
		const url = "https://as.example/authorize?a=1&b=2";
		openUrl.mockResolvedValueOnce(false);
		expect(await openBrowser(url)).toBe(false);
		expect(openUrl).toHaveBeenCalledWith(url);
	});
});
