# @crustjs/crust

CLI tooling for the Crust framework

## Install

```sh
npm install -D @crustjs/crust
```

## Usage

```sh
crust build --artifact package   # stage a runtime package in .crust/
crust build --artifact binary    # stage standalone binaries in .crust/
crust publish                    # publish what crust build staged
```

Every build selects its artifact with `--artifact` or `"crust": { "artifact": "package" | "binary" }` in package.json. Runtime packages for the `deno` runtime are experimental: they need deno 2.5.0 or newer to build, and consumers run them with `deno run npm:<package>/<command>` or `deno install -g`, choosing the permissions themselves.

The same build is available to release scripts:

```ts
import { build } from "@crustjs/crust";

const { stageDir, artifacts, reports } = await build({ artifact: "binary", targets: ["host"] });
```

## Documentation

Full docs: [crustjs.com/docs/modules/crust](https://crustjs.com/docs/modules/crust)
