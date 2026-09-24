import { Crust } from "@crustjs/core";
import { help } from "@crustjs/extensions";

// [!code highlight:3]
export const app = new Crust("my-cli", {
	description: "Print greetings",
}).extend(help());
