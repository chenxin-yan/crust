import {
	progress,
	progressGroup,
	spinner,
	type TerminalOutput,
	withTerminalIO,
} from "@crustjs/progress";

//#region spinner
await spinner({
	message: "Building",
	task: async ({ updateMessage }) => {
		updateMessage("Running checks");
	},
});
//#endregion

//#region progress
const bar = progress({ total: 2, message: "Files" });
bar.start();
bar.advance(1);
bar.advance(1);
bar.stop("success", "Files complete");
//#endregion

//#region group
const group = progressGroup();
const layers = ["a3ed95caeb02", "6c33745f49b4"].map((id) => group.add({ total: 3, message: id }));
for (const layer of layers) layer.start();
layers[0]?.advance(3);
layers[0]?.stop("success", "a3ed95caeb02: Pull complete");
layers[1]?.advance(1);
layers[1]?.stop("error", "6c33745f49b4: Pull failed");
//#endregion

//#region sink
const transcript: string[] = [];
const sink: TerminalOutput = { isTTY: false, write: (text) => transcript.push(text) };
await withTerminalIO({ output: sink }, () =>
	spinner({ message: "Deploying", task: async () => {} }),
);
//#endregion
