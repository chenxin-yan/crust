import { defineCommand, runCommand } from "citty";

const result = await runCommand(
	defineCommand({ args: { tag: { type: "string", alias: "t" } }, run: ({ args }) => args }),
	{ rawArgs: ["--tag", "a", "--tag", "b", "--unknown"] },
);
console.log(JSON.stringify(result.result));
