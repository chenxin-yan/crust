import { readFile } from "node:fs/promises";

import { scaffold } from "@crustjs/create";

import pkg from "../templates/base/package.json" with { type: "json" };

const name = "my-app";
const docker = true;
const index = await readFile(new URL("../templates/base/src/index.ts", import.meta.url), "utf8");

await scaffold({
	copy: new URL("../templates/base", import.meta.url),
	dest: `./${name}`,
	write: {
		// Replaces the copied package.json; `pkg` is typed from that file.
		"package.json": `${JSON.stringify({ ...pkg, name }, null, "\t")}\n`,
		// Changes one line of a copied file.
		"src/index.ts": index.replace('"app"', JSON.stringify(name)),
		// Added only when asked for.
		...(docker ? { Dockerfile: 'FROM node:24\nCOPY . .\nCMD ["node", "src/index.ts"]\n' } : {}),
	},
});
