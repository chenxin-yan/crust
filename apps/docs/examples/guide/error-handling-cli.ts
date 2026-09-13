import { Crust } from "@crustjs/core";

const app = new Crust("deploy").action(() => {
  throw new Error("Could not connect to api.example.com. Check your network connection.");
});

await app.execute();
