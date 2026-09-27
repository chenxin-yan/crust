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

Every build selects its artifact with `--artifact` or `"crust": { "artifact": "package" | "binary" }` in package.json.

The same build is available to release scripts:

```ts
import { build } from "@crustjs/crust";

const { stageDir, artifacts, reports } = await build({ artifact: "binary", targets: ["host"] });
```

## Documentation

Full docs: [crustjs.com/docs/modules/crust](https://crustjs.com/docs/modules/crust)
