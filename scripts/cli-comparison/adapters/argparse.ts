import { ArgumentParser } from "argparse";

import { config, deploy } from "../contract.ts";
export function invoke(argv: string[]) {
	const app = new ArgumentParser({ prog: "cli", add_help: false, exit_on_error: false });
	const commands = app.add_subparsers({ dest: "command", required: true });
	const d = commands.add_parser("deploy", { add_help: false, exit_on_error: false });
	d.add_argument("target");
	d.add_argument("-r", "--region", { default: "us-east-1" });
	d.add_argument("-n", "--replicas", { default: "1" });
	d.add_argument("-f", "--force", { action: "store_true", default: false });
	d.add_argument("-t", "--tag", { action: "append", default: [] });
	const c = commands.add_parser("config", { add_help: false, exit_on_error: false });
	c.add_argument("key");
	c.add_argument("-v", "--value", { default: undefined });
	const p = app.parse_args(argv);
	return p.command === "deploy"
		? deploy(p.target, p.region, p.replicas, p.force, p.tag)
		: config(p.key, p.value ?? undefined);
}
