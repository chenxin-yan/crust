// @types: bun
import { expect, test } from "bun:test";

import { Crust } from "@crustjs/core";
import { defineApi } from "@crustjs/openapi";

const acme = defineApi({
	spec: new URL("./acme.openapi.jsonc", import.meta.url),
	baseUrl: "https://api.acme.example/v1",
});
const app = new Crust("acme").extend(acme.extension).add(...acme.commands);

//#region surface
// Every command, the generated ones too, with its arguments, flags and output schema.
test("the CLI's commands follow the pinned spec", async () => {
	expect(await app.snapshot()).toMatchSnapshot();
});
//#endregion
