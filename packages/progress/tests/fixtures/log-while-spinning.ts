// A task that prints a line to stdout while the default spinner animates on stderr.
// Usage: bun log-while-spinning.ts <message>
import { spinner } from "../../src/index.ts";

const [message = "Building"] = process.argv.slice(2);

await spinner({
	message,
	spinner: { frames: ["-", "+"], interval: 10 },
	sigint: false,
	task: async () => {
		await Bun.sleep(60);
		console.log("downloaded");
		await Bun.sleep(60);
	},
});
