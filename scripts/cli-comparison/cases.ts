import type { Result } from "./contract.ts";

const base: Result = {
	command: "deploy",
	target: "api",
	region: "us-east-1",
	replicas: 1,
	force: false,
	tag: [],
};
type Case = { name: string; argv: string[]; expected: Result };
export const valid = [
	{ name: "defaults", argv: ["deploy", "api"], expected: base },
	{
		name: "all flags",
		argv: [
			"deploy",
			"api",
			"--region",
			"eu-west-1",
			"--replicas",
			"3",
			"--force",
			"--tag",
			"blue",
			"--tag",
			"canary",
		],
		expected: { ...base, region: "eu-west-1", replicas: 3, force: true, tag: ["blue", "canary"] },
	},
	{
		name: "aliases",
		argv: ["deploy", "worker", "-r", "eu", "-n", "2", "-f", "-t", "a", "-t", "b"],
		expected: {
			...base,
			target: "worker",
			region: "eu",
			replicas: 2,
			force: true,
			tag: ["a", "b"],
		},
	},
	{
		name: "equals",
		argv: ["deploy", "api", "--region=eu", "--replicas=2.5", "--tag=a", "--tag=b"],
		expected: { ...base, region: "eu", replicas: 2.5, tag: ["a", "b"] },
	},
	{
		name: "string preservation",
		argv: ["deploy", "123", "--region", "001", "--tag", "002"],
		expected: { ...base, target: "123", region: "001", tag: ["002"] },
	},
	{
		name: "config default",
		argv: ["config", "theme"],
		expected: { command: "config", key: "theme", value: null },
	},
	{
		name: "config value",
		argv: ["config", "theme", "--value", "dark"],
		expected: { command: "config", key: "theme", value: "dark" },
	},
	{
		name: "config alias",
		argv: ["config", "theme", "-v", "light"],
		expected: { command: "config", key: "theme", value: "light" },
	},
	{
		name: "config equals",
		argv: ["config", "theme", "--value=dark"],
		expected: { command: "config", key: "theme", value: "dark" },
	},
] satisfies [Case, Case, ...Case[]];
export const invalid: { name: string; argv: string[] }[] = [
	{ name: "unknown command", argv: ["bogus"] },
	{ name: "empty target", argv: ["deploy", ""] },
	{ name: "empty region", argv: ["deploy", "api", "--region="] },
	{ name: "empty tag", argv: ["deploy", "api", "--tag="] },
	{ name: "empty number", argv: ["deploy", "api", "--replicas="] },
	{ name: "empty value", argv: ["config", "theme", "--value="] },
	{ name: "unknown option", argv: ["deploy", "api", "--unknown"] },
	{ name: "unknown short option", argv: ["deploy", "api", "-z"] },
	{ name: "empty key", argv: ["config", ""] },
	{ name: "wrong command option", argv: ["config", "theme", "--region", "eu"] },
	{ name: "missing target", argv: ["deploy"] },
	{ name: "missing key", argv: ["config"] },
	...["region", "replicas", "tag"].map((name) => ({
		name: `missing ${name}`,
		argv: ["deploy", "api", `--${name}`],
	})),
	{ name: "missing value", argv: ["config", "theme", "--value"] },
	...["Infinity", "-Infinity", "NaN", "nope"].map((value) => ({
		name: `invalid number ${value}`,
		argv: ["deploy", "api", `--replicas=${value}`],
	})),
];
export const workload = valid[1];
