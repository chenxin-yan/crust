// The Node backend on Linux: @napi-rs/keyring connects to the D-Bus session bus synchronously,
// so the bus is probed (asynchronously, within the keyring deadline) before the native module
// touches it. Linux only: no other platform reaches a keyring through D-Bus.
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { busAnswers, keyrings, sessionBusAddress } from "../src/keyring.ts";

const cleanup: (() => void)[] = [];
const deadlineMs = keyrings.deadlineMs;

afterEach(() => {
	keyrings.deadlineMs = deadlineMs;
	vi.unstubAllEnvs();
	vi.doUnmock("@napi-rs/keyring");
	for (const step of cleanup.splice(0)) step();
});

/**
 * A D-Bus method return to the call with serial 1, from the bus, with the body `s` `:1.1`:
 * the reply a bus sends to `Hello` (D-Bus specification, "Message Format").
 */
function helloReply(): Buffer {
	const bytes: number[] = [];
	const align = (size: number) => {
		while (bytes.length % size !== 0) bytes.push(0);
	};
	const uint32 = (value: number) => {
		align(4);
		bytes.push(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24);
	};
	const string = (value: string) => {
		uint32(value.length);
		bytes.push(...Buffer.from(value), 0);
	};
	const body = ":1.1";
	bytes.push("l".charCodeAt(0), 2, 0, 1);
	uint32(4 + body.length + 1);
	uint32(1);
	uint32(0);
	const start = bytes.length;
	align(8);
	bytes.push(5, 1, "u".charCodeAt(0), 0);
	uint32(1);
	align(8);
	bytes.push(8, 1, "g".charCodeAt(0), 0, 1, "s".charCodeAt(0), 0);
	const length = bytes.length - start;
	bytes.splice(12, 4, length & 0xff, (length >>> 8) & 0xff, 0, 0);
	align(8);
	string(body);
	return Buffer.from(bytes);
}

/**
 * A Unix socket at `path` that plays a session bus: `"hello"` authenticates and answers `Hello`;
 * `"auth-only"` authenticates and then answers nothing; `"rejected"` refuses the authentication;
 * none answers nothing at all.
 */
async function bus(path: string, answer?: "hello" | "auth-only" | "rejected"): Promise<Server> {
	const sockets: Socket[] = [];
	const server = createServer((socket) => {
		sockets.push(socket);
		let received = Buffer.alloc(0);
		let authenticated = false;
		let replied = false;
		socket.on("data", (chunk: Buffer) => {
			received = Buffer.concat([received, chunk]);
			const text = received.toString("latin1");
			if (!text.includes("\r\n") || answer === undefined) return;
			if (answer === "rejected") {
				socket.end("REJECTED EXTERNAL\r\n");
				return;
			}
			if (!authenticated) {
				authenticated = true;
				socket.write("OK 0123456789abcdef0123456789abcdef\r\n");
			}
			const begin = text.indexOf("BEGIN\r\n");
			// The Hello call follows BEGIN: its fixed header is 16 bytes.
			if (answer === "hello" && !replied && begin !== -1 && received.length >= begin + 7 + 16) {
				replied = true;
				socket.write(helloReply());
			}
		});
		socket.on("error", () => {});
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
		await bus(path, "hello");
		await expect(busAnswers(`unix:path=${path},guid=0123456789abcdef`)).resolves.toBe(true);
		const name = `crust-bus-${process.pid}-${Date.now()}`;
		await bus(`\0${name}`, "hello");
		await expect(busAnswers(`unix:abstract=${name};unix:path=/nowhere`)).resolves.toBe(true);
	});

	it("fails a bus that never answers, a refusal, or no socket, within the keyring deadline", async () => {
		keyrings.deadlineMs = 300;
		const dir = tempDir();
		await bus(join(dir, "silent"));
		await bus(join(dir, "rejects"), "rejected");
		await bus(join(dir, "auth-only"), "auth-only");
		for (const address of [
			`unix:path=${join(dir, "silent")}`,
			`unix:path=${join(dir, "rejects")}`,
			`unix:path=${join(dir, "missing")}`,
			// Authenticates, then never answers Hello: libdbus would wait 25 s for it.
			`unix:path=${join(dir, "auth-only")}`,
		]) {
			const started = performance.now();
			await expect(busAnswers(address)).resolves.toBe(false);
			expect(performance.now() - started).toBeLessThan(1_000);
		}
	});

	it("a bus that authenticates but never answers Hello is no keyring: the native entry is never made", async () => {
		keyrings.deadlineMs = 300;
		let constructed = 0;
		vi.doMock("@napi-rs/keyring", () => ({
			AsyncEntry: class {
				constructor() {
					constructed += 1;
				}
				getPassword = async () => "value";
				setPassword = async () => {};
			},
		}));
		const path = join(tempDir(), "bus");
		await bus(path, "auth-only");
		vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", `unix:path=${path}`);
		await expect(busAnswers(`unix:path=${path}`)).resolves.toBe(false);
		const backend = (await keyrings.load())!;
		await expect(backend.get("acme", "credentials-key")).rejects.toThrow();
		expect(constructed).toBe(0);
	});

	it("passes a real dbus-daemon: the Hello call is well formed", async (context) => {
		const found = spawnSync("dbus-daemon", ["--version"], { encoding: "utf8" });
		context.skip(found.error !== undefined, "dbus-daemon is not installed on this host.");
		keyrings.deadlineMs = 2_000;
		const dir = tempDir();
		const config = join(dir, "session.conf");
		writeFileSync(
			config,
			`<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig><type>session</type><listen>unix:path=${join(dir, "bus")}</listen>
<policy context="default"><allow send_destination="*" eavesdrop="true"/><allow eavesdrop="true"/><allow own="*"/></policy></busconfig>`,
		);
		const daemon = spawn(
			"dbus-daemon",
			[`--config-file=${config}`, "--nofork", "--print-address"],
			{
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		cleanup.push(() => daemon.kill("SIGKILL"));
		const [address] = (await once(daemon.stdout, "data")) as [Buffer];
		await expect(busAnswers(address.toString().trim())).resolves.toBe(true);
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
		await bus(live, "hello");
		const dead = `unix:path=${join(dir, "missing")}`;
		await expect(busAnswers(`${dead};unix:path=${live}`)).resolves.toBe(true);
		await expect(busAnswers(`unix:path=${live};${dead}`)).resolves.toBe(true);
		await expect(busAnswers(`${dead};${dead}`)).resolves.toBe(false);
		// An address form it does not handle anywhere in the list: not probed, as libdbus may use it.
		await expect(busAnswers(`${dead};tcp:host=127.0.0.1,port=1`)).resolves.toBeUndefined();
	});

	it("without DBUS_SESSION_BUS_ADDRESS, uses libdbus' default: $XDG_RUNTIME_DIR/bus when it is this user's socket", async () => {
		for (const unset of [undefined, ""]) {
			vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", unset);
			// No socket there, or not a socket: libdbus autolaunches, which is not probed.
			vi.stubEnv("XDG_RUNTIME_DIR", tempDir());
			await expect(sessionBusAddress()).resolves.toBeUndefined();
			const file = tempDir();
			writeFileSync(join(file, "bus"), "");
			vi.stubEnv("XDG_RUNTIME_DIR", file);
			await expect(sessionBusAddress()).resolves.toBeUndefined();
			const live = tempDir();
			await bus(join(live, "bus"), "hello");
			vi.stubEnv("XDG_RUNTIME_DIR", live);
			const address = await sessionBusAddress();
			expect(address).toBeDefined();
			await expect(busAnswers(address)).resolves.toBe(true);
		}
		vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", "unix:path=/elsewhere");
		await expect(sessionBusAddress()).resolves.toBe("unix:path=/elsewhere");
		vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", undefined);
		vi.stubEnv("XDG_RUNTIME_DIR", undefined);
		await expect(sessionBusAddress()).resolves.toBeUndefined();
	});

	it("probes the default bus too: a silent $XDG_RUNTIME_DIR/bus is no keyring, not a hang", async () => {
		keyrings.deadlineMs = 500;
		vi.doMock("@napi-rs/keyring", () => ({
			AsyncEntry: class {
				getPassword = async () => "value";
				setPassword = async () => {};
			},
		}));
		const dir = join(tempDir(), "run, with %25 and ;");
		mkdirSync(dir);
		await bus(join(dir, "bus"));
		vi.stubEnv("DBUS_SESSION_BUS_ADDRESS", undefined);
		vi.stubEnv("XDG_RUNTIME_DIR", dir);
		const backend = (await keyrings.load())!;
		await expect(backend.get("acme", "credentials-key")).rejects.toThrow();
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
		await bus(path, "hello");
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
