// Runs a command in Bun's pseudo-terminal and prints the bytes the terminal received;
// tests/spinner-terminal.test.ts spawns this with bun and owns every assertion.
// Node has no built-in PTY, and the test runner lives on Node.
// Usage: bun run-in-terminal.ts <columns> <command...>
const [columns, ...command] = process.argv.slice(2);
if (!columns || command.length === 0) throw new Error("usage: <columns> <command...>");

// Unref'd so a pending deadline does not keep this process alive once the command is done.
const timeout = (ms: number) => new Promise<null>((resolve) => setTimeout(resolve, ms, null).unref());

let output = "";
const decoder = new TextDecoder();
const { promise: closed, resolve: onClose } = Promise.withResolvers<void>();
const terminal = new Bun.Terminal({
	cols: Number(columns),
	rows: 20,
	data: (_terminal, chunk) => {
		output += decoder.decode(chunk, { stream: true });
	},
	exit: () => onClose(),
});
const proc = Bun.spawn(command, {
	env: { ...process.env, TERM: "xterm-256color" },
	terminal,
});
const exitCode = await Promise.race([proc.exited, timeout(10_000)]);
if (exitCode === null) proc.kill(9);
// Read everything the command wrote before its exit, up to the PTY's EOF.
await Promise.race([closed, timeout(1_000)]);
terminal.close();
console.log(JSON.stringify({ exitCode, output }));
