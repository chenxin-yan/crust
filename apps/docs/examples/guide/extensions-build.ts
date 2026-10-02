import { Crust, defineExtension, defineExtensionId } from "@crustjs/core";

export const manifest = defineExtension(defineExtensionId("acme:manifest")).build(
	({ snapshot }) => [
		// [!code highlight]
		{ path: "acme-manifest/manifest.json", content: JSON.stringify(snapshot) },
	],
);

export const app = new Crust("my-cli").extend(manifest).action(() => {});

await app.execute();
