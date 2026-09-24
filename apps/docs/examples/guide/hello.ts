import { Crust } from "@crustjs/core";

// [!code highlight]
const app = new Crust("hello").action(({ stdout }) => {
	stdout("Hello!");
	// ^?
});

// [!code highlight]
await app.execute();
