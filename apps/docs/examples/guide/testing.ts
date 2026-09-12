import { expect, test } from "bun:test";

import { Crust } from "@crustjs/core";

//#region capture-output
test("preserves output payloads", async () => {
  const app = new Crust("app").action(({ stdout }) => {
    stdout("first\nsecond");
    stdout("third");
    return 3;
  });

  const captured = await app.run([]);

  expect(captured.stdout).toBe("first\nsecond\nthird");
  expect(captured.stderr).toBe("");
  expect(captured.status).toBe("completed");
  if (captured.status === "completed") expect(captured.result).toBe(3);
});
//#endregion
