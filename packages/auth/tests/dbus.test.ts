// The Node backend on Linux: @napi-rs/keyring connects to the D-Bus session bus synchronously,
// so the bus is probed (asynchronously, within the keyring deadline) before the native module
// touches it. Linux only: no other platform reaches a keyring through D-Bus.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { busAnswers, keyrings } from "../src/keyring.ts";

const cleanup: (() => void)[] = [];
const deadlineMs = keyrings.deadlineMs;

afterEach(() => {
	keyrings.deadlineMs = deadlineMs;
	vi.unstubAllEnvs();
	vi.doUnmock("@napi-rs/keyring");
	for (const step of cleanup.splice(0)) step();
});

/** A Unix socket at `path` whose connections get `answer`, or nothing at all. */
async function bus(path: string, answer?: string): Promise<Server> {
	const sockets: Socket[] = [];
	const server = createServer((socket) => {
		sockets.push(socket);
		socket.once("data", () => {
			if (answer !== undefined) socket.write(answer);
		});
	}).listen(path);
	await once(server, "listening");
	cleanup.push(() => {
		for (const socket of sockets) socket.destroy();
		server.close();
	});
	return server;
}

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "crust-bus-"));
	cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

describe.runIf(process.platform === "linux")("the session bus probe", () => {
	it("passes a bus that answers the authentication", async () => {
		const path = join(tempDir(), "bus");
		await bus(path, "OK 0123456789abcdef\r\n");
		await expect(busAnswers(`unix:path=${path},guid=0123456789abcdef`)).resolves.toBe(true);
		const name = `crust-bus-${process.pid}-${Date.now()}`;
		await bus(`\0${name}`, "OK 0123456789abcdef\r\n");
		await expect(busAnswers(`unix:abstract=${name};unix:path=/nowhere`)).resolves.toBe(true);
	});

	it("fails a bus that never answers, a refusal, or no socket, within the keyring deadline", async () => {
		keyrings.deadlineMs = 300;
		const dir = tempDir();
		await bus(join(dir, "silent"));
		await bus(join(dir, "rejects"), "REJECTED EXTERNAL\r\n");
		for (const address of [
			`unix:path=${join(dir, "silent")}`,
			`unix:path=${join(dir, "rejects")}`,
			`unix:path=${join(dir, "missing")}`,
		]) {
			const started = performance.now();
			await expect(busAnswers(address)).resolves.toBe(false);
			expect(performance.now() - started).toBeLessThan(1_000);
		}
	});

	it("does not probe an address it does not handle, or none", async () => {
		for (const address of [
			undefined,
			"",
			"tcp:host=127.0.0.1,port=1",
			"autolaunch:",
			"unix:runtime=yes",
			"unix:path=%zz",
		]) {
			await expect(busAnswers(address)).resolves.toBeUndefined();
		}
	});

	it("tries every address of the list in order, within one deadline", async () => {
		keyrings.deadlineMs = 1_000;
		const dir = tempDir();
		const live = join(dir, "live");
		await bus(live, "OK 0123456789abcdef\r\n");
		const dead = `unix:path=${join(dir, "missing")}`;
		await expect(busAnswers(`${dead};unix:path=${live}`)).resolves.toBe(true);
		await expect(busAnswers(`unix:path=${live};${dead}`)).resolves.toBe(true);
		await expect(busAnswers(`${dead};${dead}`)).resolves.toBe(false);
		// An address form it does not handle anywhere in the list: not probed, as libdbus may use it.
		await expect(busAnswers(`${dead};tcp:host=127.0.0.1,port=1`)).resolves.toBeUndefined();
	});

	it("remembers only a bus that answered: one that failed is probed again by the next call", async () => {
		keyrings.deadlineMs = 500;
		vi.doMock("@napi-rs/keyring", () => ({
			AsyncEntry: class {
				getPassword = async () => "value";
				setPassword = async () => {};
			},
		}));
		const path = join(tempDir(), "bus");
		vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", `unix:path=${path}`);
		const backend = (await keyrings.load())!;
		expect(backend.kind).toBe("napi-keyring");
		await expect(backend.get("acme", "credentials-key")).rejects.toThrow();
		// The bus comes back.
		await bus(path, "OK 0123456789abcdef\r\n");
		await expect(backend.get("acme", "credentials-key")).resolves.toBe("value");
	});

	it("a bus that never answers leaves Node's event loop free and the status bounded: no keyring", async () => {
		const dir = tempDir();
		const path = join(dir, "silent");
		await bus(path);
		const child = spawn(
			"node",
			[join(import.meta.dirname, "fixtures", "bus.ts"), "crust-bus-test", "1000"],
			{
				env: { ...process.env, XDG_STATE_HOME: dir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${path}` },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		const timer = setTimeout(() => child.kill("SIGKILL"), 15_000);
		let out = "";
		let errors = "";
		child.stdout.on("data", (chunk: Buffer) => (out += chunk));
		child.stderr.on("data", (chunk: Buffer) => (errors += chunk));
		await once(child, "exit");
		clearTimeout(timer);
		expect(errors).toBe("");
		const lines = out
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		expect(lines).toContainEqual({ timer: expect.any(Number) });
		const result = lines.find((line) => "status" in line);
		expect(result.status).toEqual({
			kind: "file",
			encryption: "plaintext",
			keyReadable: false,
			plaintextRecords: 0,
		});
		expect(result.ms).toBeLessThan(3_000);
		expect(lines[0].timer).toBeLessThan(500);
	}, 30_000);
});
