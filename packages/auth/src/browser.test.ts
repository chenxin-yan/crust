/** @module-tag windows */
import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));

const { browserCommand, openBrowser } = await import("./browser.ts");

type FakeChild = EventEmitter & { unref: ReturnType<typeof vi.fn> };

function child(event: "spawn" | "error"): FakeChild {
	const fake = Object.assign(new EventEmitter(), { unref: vi.fn() });
	queueMicrotask(() =>
		event === "spawn"
			? fake.emit("spawn")
			: fake.emit("error", Object.assign(new Error("spawn xdg-open ENOENT"), { code: "ENOENT" })),
	);
	return fake;
}

beforeEach(() => {
	spawn.mockReset();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("openBrowser", () => {
	it.each([
		"file:///etc/passwd",
		"javascript:alert(1)",
		"myapp://callback",
		"http://evil.example/login",
		"http://localhost:9000/authorize",
		"https://user:pass@as.example/authorize",
		"https://as.example/authorize\nX",
		"not a url",
	])("SEC-L1 refuses %s without spawning", async (url) => {
		expect(await openBrowser(url)).toBe(false);
		expect(spawn).not.toHaveBeenCalled();
	});

	it("SEC-L1 SEC-DEC-09 opens http only on the given loopback dev origin", async () => {
		spawn.mockImplementation(() => child("spawn"));
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
		expect(spawn).toHaveBeenCalledTimes(1);
	});

	it("SEC-L2 passes the URL as one argv element with no shell", async () => {
		spawn.mockImplementation(() => child("spawn"));
		const url = `https://as.example/authorize?a=1&calc.exe&b="; touch /tmp/pwn; "`;
		expect(await openBrowser(url)).toBe(true);
		const [command, args, options] = spawn.mock.calls[0]!;
		expect(args).toContain(url);
		expect(args).toHaveLength(command === "rundll32" ? 2 : 1);
		expect(options.shell).toBe(false);
		expect(options.detached).toBe(true);
	});

	it("SEC-L2 builds argv launchers for every platform, never cmd /c start", () => {
		const url = "https://as.example/a?x=1&y=2";
		expect(browserCommand(url, "win32")).toEqual([
			"rundll32",
			["url.dll,FileProtocolHandler", url],
		]);
		expect(browserCommand(url, "darwin")).toEqual(["open", [url]]);
		expect(browserCommand(url, "linux")).toEqual(["xdg-open", [url]]);
		expect(browserCommand(url, "freebsd")).toEqual(["xdg-open", [url]]);
	});

	it("SEC-L3 resolves false when the launcher is missing, and detaches when it starts", async () => {
		spawn.mockImplementation(() => child("error"));
		expect(await openBrowser("https://as.example/authorize")).toBe(false);
		const started = child("spawn");
		spawn.mockImplementation(() => started);
		expect(await openBrowser("https://as.example/authorize")).toBe(true);
		expect(started.unref).toHaveBeenCalled();
		spawn.mockImplementation(() => {
			throw new Error("EPERM");
		});
		expect(await openBrowser("https://as.example/authorize")).toBe(false);
	});
});
