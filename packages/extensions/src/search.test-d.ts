import { Crust } from "@crustjs/core";

import type * as extensions from "./index.ts";
import { type SearchMatch, search } from "./search.ts";

async function _searchRunIsTyped() {
	const app = new Crust("app").extend(search());
	const outcome = await app.run(["search"], { args: { task: ["rotate", "key"] } });
	if (outcome.status === "completed") {
		const matches: readonly SearchMatch[] = outcome.result;
		void matches;
	}
	// @ts-expect-error The task is a list of words.
	void app.run(["search"], { args: { task: "rotate key" } });
}

// The ranking and the renderer load inside the action; neither is part of the package API.
// @ts-expect-error -- not exported from @crustjs/extensions
export type NoCreateSearchIndex = typeof extensions.createSearchIndex;
// @ts-expect-error -- not exported from @crustjs/extensions
export type NoSearchCommands = typeof extensions.searchCommands;
