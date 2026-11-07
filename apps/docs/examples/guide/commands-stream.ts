import { Crust } from "@crustjs/core";

const app = new Crust("tool").command("sync", (command) =>
	command.action(async function* ({ stdout }) {
		for (const file of ["a.txt", "b.txt"]) {
			stdout(`Syncing ${file}`);
			yield { file };
		}
		return { synced: 2 };
	}),
);

const outcome = await app.run(["sync"], {}, { onEvent: (event) => console.log(event) });
if (outcome.status === "completed") {
	console.log(outcome.events); // => [{ file: "a.txt" }, { file: "b.txt" }]
	console.log(outcome.result); // => { synced: 2 }
}
