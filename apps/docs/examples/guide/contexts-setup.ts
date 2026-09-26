import { defineContext } from "@crustjs/core";

//#region disposable
export const database = defineContext("database", ({ stdout }) => {
	stdout("database opened");
	return {
		query: (sql: string) => `${sql}: ok`,
		// [!code highlight:3]
		[Symbol.dispose]() {
			stdout("database closed");
		},
	};
});
//#endregion

//#region cancellation
export const config = defineContext("config", async ({ signal }) => {
	const response = await fetch("https://api.example.com/config", { signal }); // [!code highlight]
	if (!response.ok) throw new Error(`Config request failed: ${response.status}`);
	return response.text();
});
//#endregion
