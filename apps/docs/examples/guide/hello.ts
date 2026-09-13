import { Crust } from "@crustjs/core";

const app = new Crust("hello").action(({ stdout }) => {
  stdout("Hello!");
});

await app.execute();
