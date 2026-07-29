import { type Extension, extension } from "@crustjs/core";
import { getGlobalColorMode, setGlobalColorMode } from "@crustjs/style";

export function noColorExtension(): Extension {
	return extension("no-color", {
		flags: {
			color: {
				type: "boolean",
				inherit: true,
				description: "Enable colored output",
			},
		},
		async intercept(context, next) {
			const flagValue = context.flags.color;
			if (typeof flagValue !== "boolean") {
				await next();
				return;
			}

			const previousMode = getGlobalColorMode();
			setGlobalColorMode(flagValue ? "always" : "never");

			try {
				await next();
			} finally {
				setGlobalColorMode(previousMode);
			}
		},
	});
}
