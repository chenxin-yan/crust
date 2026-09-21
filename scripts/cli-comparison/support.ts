import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
export const here = import.meta.dirname;
export const env: NodeJS.ProcessEnv = {
	...process.env,
	NO_COLOR: "1",
	FORCE_COLOR: "0",
	TERM: "dumb",
	CI: "1",
};
for (const key of Object.keys(env)) if (key.startsWith("CRUST_")) delete env[key];
export const runtimes = { bun: process.env.BUN_BIN ?? "bun", node: process.env.NODE_BIN ?? "node" };
export function child(runtime: string, args: string[], timeout = 30_000, cwd = here) {
	const result = spawnSync(runtime, args, {
		cwd,
		env,
		encoding: "utf8",
		timeout,
		maxBuffer: 4 * 1024 * 1024,
	});
	if (result.error || result.signal)
		throw new Error(`Child failure ${runtime} ${args.join(" ")}: ${result.error ?? result.signal}`);
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
export function checked(runtime: string, args: string[], timeout?: number, cwd?: string) {
	const result = child(runtime, args, timeout, cwd);
	if (result.status !== 0)
		throw new Error(
			`${runtime} ${args.join(" ")} failed (${result.status})\n${result.stderr}\n${result.stdout}`,
		);
	return result;
}
export function fingerprint(): string {
	const hash = createHash("sha256");
	function visit(dir: string) {
		for (const e of readdirSync(join(here, dir), { withFileTypes: true }).sort((a, b) =>
			a.name.localeCompare(b.name),
		)) {
			if (["node_modules", ".generated", "results"].includes(e.name)) continue;
			const path = join(dir, e.name);
			if (e.isDirectory()) visit(path);
			else hash.update(path).update(readFileSync(join(here, path)));
		}
	}
	visit(".");
	return hash.digest("hex");
}
export function version(binary: string) {
	return execFileSync(binary, ["--version"], { env, encoding: "utf8" }).trim();
}
export function shuffled<T>(items: readonly T[], seed: number): T[] {
	const result = [...items];
	let state = seed >>> 0;
	for (let i = result.length - 1; i > 0; i--) {
		// Seeded Fisher–Yates keeps measurement order reproducible across runtimes.
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		const j = Math.floor((state / 4294967296) * (i + 1));
		[result[i], result[j]] = [result[j]!, result[i]!];
	}
	return result;
}
export function stats(samples: number[]) {
	const sorted = [...samples].sort((a, b) => a - b);
	if (!sorted.length || sorted.some((value) => !Number.isFinite(value)))
		throw new Error("Expected finite samples");
	const quantile = (q: number) => {
		const index = (sorted.length - 1) * q;
		const lower = sorted[Math.floor(index)];
		const upper = sorted[Math.ceil(index)];
		if (lower === undefined || upper === undefined) throw new Error("Invalid quantile");
		return lower + (upper - lower) * (index % 1);
	};
	return {
		median: quantile(0.5),
		p05: quantile(0.05),
		p95: quantile(0.95),
		min: quantile(0),
		max: quantile(1),
	};
}
