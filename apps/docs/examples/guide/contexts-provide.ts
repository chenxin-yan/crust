import { Crust, defineContext } from "@crustjs/core";

// [!code highlight:3]
const api = defineContext("api", () => ({
  get: (path: string) => `https://api.example.com${path}`,
}));

const status = new Crust("status")
  .provide(api()) // [!code highlight]
  .action(async ({ ctx, stdout }) => {
    const client = await ctx.api; // [!code highlight]
    stdout(client.get("/status"));
  });

await status.execute();
