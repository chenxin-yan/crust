import { Crust } from "@crustjs/core";
import { writeProcessOutput } from "@crustjs/utils/terminal";

import { telemetry } from "../src/telemetry.ts";

// A send that honors its signal: work that would keep the process alive for 10 s.
const app = new Crust("acme")
	.extend(
		telemetry({
			env: "ACME_TELEMETRY",
			enabled: "opt-out",
			send: (_event, { signal }) =>
				new Promise((resolve) => {
					const timer = setTimeout(resolve, 10_000);
					signal.addEventListener("abort", () => {
						clearTimeout(timer);
						writeProcessOutput(2, `send aborted: ${(signal.reason as Error).name}\n`);
						resolve();
					});
				}),
		}),
	)
	.action(async ({ signal }) => {
		if (!process.env.FIXTURE_WAIT) return;
		// Runs until Ctrl-C.
		await new Promise<void>((_resolve, reject) => {
			// Keeps the event loop alive: Node exits early when only a signal listener is left.
			const timer = setTimeout(() => reject(new Error("no SIGINT arrived")), 15_000);
			signal.addEventListener("abort", () => {
				clearTimeout(timer);
				reject(signal.reason);
			});
			writeProcessOutput(1, "ready\n");
		});
	});

await app.execute();
