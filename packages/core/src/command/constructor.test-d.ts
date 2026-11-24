import { Crust, type AnyCrust } from "./crust.ts";

// Names are checked when the CLI runs from source and by `crust build`, not by the types.
function _constructorNames() {
	const broad: Crust = new Crust("literal");
	const anyCrust: AnyCrust = new Crust("literal");
	function identity<T extends AnyCrust>(app: T): T {
		return app;
	}
	identity(new Crust("literal").flags({ ok: { type: "boolean" } }));
	void [broad, anyCrust];
}
