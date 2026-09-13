import { createStore, configDir } from "@crustjs/store";

//#region store
const store = createStore({
  dirPath: configDir("my-cli"),
  name: "config",
  fields: {
    theme: { type: "string", default: "light" },
    verbose: { type: "boolean", default: false },
  },
});
const initial = await store.read(); // { theme: "light", verbose: false }
await store.write({ theme: "dark", verbose: false });
await store.patch({ verbose: true });
await store.reset();
console.log(initial);
//#endregion

//#region validate
const ports = createStore({
  dirPath: configDir("my-cli"),
  name: "ports",
  fields: {
    port: {
      type: "number",
      default: 3000,
      validate(value) {
        if (value < 1 || value > 65535) throw new Error("Port must be 1-65535");
      },
    },
  },
});
await ports.read();
//#endregion
