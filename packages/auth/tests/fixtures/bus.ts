// A child process for tests/dbus.test.ts, on Node with the real @napi-rs/keyring and the session
// bus at DBUS_SESSION_BUS_ADDRESS: prints when a 100 ms timer fires, then the credential store's
// status with the time it took. `<deadline ms>` replaces the keyring deadline.
import { credentialStore } from "../../src/credentials.ts";
import { keyrings } from "../../src/keyring.ts";

const [app, deadlineMs] = process.argv.slice(2) as [string, string];
keyrings.deadlineMs = Number(deadlineMs);
const started = performance.now();
const elapsed = () => Math.round(performance.now() - started);
setTimeout(() => console.log(JSON.stringify({ timer: elapsed() })), 100);
const status = await credentialStore({ app, keyring: {} }).status();
console.log(JSON.stringify({ status, ms: elapsed() }));
