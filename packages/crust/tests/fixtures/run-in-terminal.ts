// Drives a compiled binary in Bun's pseudo-terminal and prints what it observed;
// tests/tui-build.smoke.test.ts spawns this with bun and owns every assertion.
// Node has no built-in PTY, and the test runner lives on Node.
// Usage: bun run-in-terminal.ts <binary> <ready marker> <cwd>
const [binary, readyMarker, cwd] = process.argv.slice(2);
if (!binary || !readyMarker || !cwd) throw new Error("usage: <binary> <ready marker> <cwd>");

let output = "";
const terminal = new Bun.Terminal({
	cols: 140,
	rows: 40,
	data: (_terminal, chunk) => {
		output += new TextDecoder().decode(chunk);
	},
});
const proc = Bun.spawn([binary], {
	cwd,
	env: { ...process.env, TERM: "xterm-256color" },
	terminal,
});
const deadline = Date.now() + 10_000;
while (!output.includes(readyMarker) && Date.now() < deadline) await Bun.sleep(100);
terminal.write("q");
const exitCode = await Promise.race([proc.exited, Bun.sleep(6_000).then(() => null)]);
if (exitCode === null) proc.kill(9);
terminal.close();
console.log(JSON.stringify({ exitCode, output }));
