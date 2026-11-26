import { runSteps, scaffold } from "@crustjs/create";

await scaffold({
	copy: new URL("../templates/base", import.meta.url),
	dest: "./my-project",
	write: { "README.md": "# my-project\n" },
});

await runSteps([{ type: "install" }, { type: "git-init" }], "./my-project");
