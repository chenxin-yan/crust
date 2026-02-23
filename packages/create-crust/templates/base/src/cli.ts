#!/usr/bin/env bun

import { defineCommand, runMain } from "@crustjs/core";
import { helpPlugin, versionPlugin } from "@crustjs/plugins";
import pkg from "../package.json";

const main = defineCommand({
	meta: {
		name: "{{name}}",
		description: "A CLI built with Crust",
	},
	args: [
		{
			name: "name",
			type: "string",
			description: "Your name",
			default: "world",
		},
	],
	flags: {
		greet: {
			type: "string",
			description: "Greeting to use",
			default: "Hello",
			alias: "g",
		},
	},
	run({ args, flags }) {
		console.log(`${flags.greet}, ${args.name}!`);
	},
});

runMain(main, {
	plugins: [versionPlugin(pkg.version), helpPlugin()],
});
