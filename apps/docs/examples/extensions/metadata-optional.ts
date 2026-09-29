import {
	Crust,
	CrustError,
	defineExtension,
	defineExtensionId,
	type Extension,
	type ExtensionId,
} from "@crustjs/core";

type Stamp<MetaKeys extends "version"> = Extension<{}, [], [], [], MetaKeys>;

export interface StampFactory {
	(version: string): Stamp<never>; // an explicit value needs no root metadata
	(version?: string): Stamp<"version">; // an omitted value requires it
	readonly id: ExtensionId;
}

// [!code highlight]
export const stamp: StampFactory = defineExtension(defineExtensionId("acme:stamp")).factory(
	(extension, version?: string) =>
		extension.preRun((ctx) => {
			const resolved = version ?? ctx.rootCommand.meta.version;
			if (resolved === undefined) throw new CrustError("DEFINITION", "acme:stamp needs a version");
			ctx.stdout(`version ${resolved}`);
		}),
);

new Crust("my-cli").extend(stamp("1.2.3"));
new Crust("my-cli", { version: "1.2.3" }).extend(stamp());
// new Crust("my-cli").extend(stamp());
// Type error: the root metadata does not guarantee "version".
