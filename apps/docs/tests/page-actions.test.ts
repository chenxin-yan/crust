import { afterEach, expect, it, vi } from "vite-plus/test";

import { loadMarkdown } from "../src/components/ai/page-actions";

const fetchSpy = vi.spyOn(globalThis, "fetch");

afterEach(() => {
	fetchSpy.mockReset();
});

it("rejects a failed Markdown response and does not cache its body", async () => {
	const url = "/docs/page-actions-failure.mdx";
	fetchSpy.mockResolvedValueOnce(new Response("Service Unavailable", { status: 503 }));
	await expect(loadMarkdown(url)).rejects.toThrow("503");

	fetchSpy.mockResolvedValueOnce(new Response("# Recovered", { status: 200 }));
	expect(await loadMarkdown(url)).toBe("# Recovered");
	expect(fetchSpy).toHaveBeenCalledTimes(2);
});

it("caches a successful Markdown response per URL", async () => {
	const url = "/docs/page-actions-success.mdx";
	fetchSpy.mockResolvedValueOnce(new Response("# Page", { status: 200 }));
	expect(await loadMarkdown(url)).toBe("# Page");
	expect(await loadMarkdown(url)).toBe("# Page");
	expect(fetchSpy).toHaveBeenCalledTimes(1);
});
