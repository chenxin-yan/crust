import { runSteps, scaffold } from "@crustjs/create";

const result = await scaffold({
  template: new URL("./templates/base", import.meta.url),
  dest: "./my-project",
  context: { name: "my-app" },
});

console.log(result.files);
// => [".gitignore", "package.json", "src/index.ts"]

await runSteps([{ type: "install" }, { type: "git-init" }], "./my-project");
