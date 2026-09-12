import { progress, spinner, type ProgressSink, withTerminalIO } from "@crustjs/progress";

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

//#region sink
const transcript: string[] = [];
const sink: ProgressSink = { isTTY: false, write: (text) => transcript.push(text) };
await withTerminalIO({ output: sink }, () =>
  spinner({ message: "Deploying", task: async () => {} }),
);
//#endregion
