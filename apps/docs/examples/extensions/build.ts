import { Crust, type BuildArtifacts, defineExtension, defineExtensionId } from "@crustjs/core";

export const manifest = defineExtension(defineExtensionId("acme:manifest")).build(
	({ snapshot }) => {
		return [
			{ path: "acme-manifest/manifest.json", content: JSON.stringify(snapshot) },
		] satisfies BuildArtifacts;
	},
);

export const app = new Crust("my-cli").extend(manifest).action(() => {});

await app.execute();
