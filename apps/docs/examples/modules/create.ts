import { runSteps, scaffold } from "@crustjs/create";

await scaffold({
  template: new URL("../templates/base", import.meta.url),
  dest: "./my-project",
  context: { name: "my-app" },
});

await runSteps([{ type: "install" }, { type: "git-init" }], "./my-project");
