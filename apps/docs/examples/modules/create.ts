import { runSteps, scaffold } from "@crustjs/create";

await scaffold({
	template: new URL("../templates/base", import.meta.url),
	dest: "./my-project",
	files: { "README.md": "# my-project\n" },
});

await runSteps([{ type: "install" }, { type: "git-init" }], "./my-project");
