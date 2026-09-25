import { Crust } from "@crustjs/core";
import { help } from "@crustjs/extensions";

export const app = new Crust("my-cli", {
	description: "Print greetings",
}).extend(help());
