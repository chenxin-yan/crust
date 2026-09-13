//#region runtime-secret
import { Crust } from "@crustjs/core";

const deploy = new Crust("deploy").action(({ stdout }) => {
  const token = process.env.API_TOKEN;
  if (!token) throw new Error("Missing API_TOKEN");
  stdout("Deploying");
});
//#endregion

//#region build-constant
const app = deploy.command("origin", (command) =>
  command.action(({ stdout }) => {
    stdout(process.env.PUBLIC_API_ORIGIN ?? "No public origin configured");
  }),
);

await app.execute();
//#endregion
