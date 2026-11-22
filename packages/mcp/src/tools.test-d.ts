import type { CommandSnapshot } from "@crustjs/core";

import { toolsFromSnapshot } from "./tools.ts";

// Discovery changes how a server offers the tools, not which tools a snapshot exposes.
function _typecheckManifestHasNoDiscovery(snapshot: CommandSnapshot) {
	// @ts-expect-error -- `discovery` is a server option
	toolsFromSnapshot(snapshot, { discovery: "progressive" });
}
