// The common pairing: tracks what help() and version() cost a shipped CLI, with
// the help renderer reachable only through its lazy import.
import { Crust } from "@crustjs/core";
import { help, version } from "@crustjs/extensions";

await new Crust("probe", { version: "1.0.0" })
	.extend(help(), version())
	.action(() => {})
	.execute();
