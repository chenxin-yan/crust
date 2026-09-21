import { Cli, Command, Option } from "clipanion";

import { completed, config, deploy, type Result } from "../contract.ts";
export async function invoke(argv: string[]) {
	let result: Result | undefined;
	class Deploy extends Command {
		static override paths = [["deploy"]];
		target = Option.String();
		region = Option.String("-r,--region", "us-east-1");
		replicas = Option.String("-n,--replicas", "1");
		force = Option.Boolean("-f,--force", false);
		tag = Option.Array("-t,--tag", []);
		async execute() {
			result = deploy(this.target, this.region, this.replicas, this.force, this.tag);
		}
	}
	class Config extends Command {
		static override paths = [["config"]];
		key = Option.String();
		value = Option.String("-v,--value");
		async execute() {
			result = config(this.key, this.value);
		}
	}
	const app = Cli.from([Deploy, Config], { binaryName: "cli" });
	if ((await app.run(argv)) !== 0) throw new Error("Clipanion command failed");
	return completed(result);
}
