import { Crust, defineContext } from "@crustjs/core";

const api = defineContext("api", () => ({
  get: (path: string) => `https://api.example.com${path}`,
}));

const status = new Crust("status").provide(api()).action(async ({ ctx, stdout }) => {
  stdout((await ctx.api).get("/status"));
});

await status.execute();
