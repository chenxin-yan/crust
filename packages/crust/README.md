# @crustjs/crust

CLI tooling for the Crust framework

## Install

```sh
npm install -D @crustjs/crust
```

## Usage

```sh
crust build          # stage the publishable npm tree in .crust/
crust publish        # publish what crust build staged
```

The same build is available to release scripts:

```ts
import { build } from "@crustjs/crust";

const { stageDir, artifacts, reports } = await build({ targets: ["host"] });
```

## Documentation

Full docs: [crustjs.com/docs/modules/crust](https://crustjs.com/docs/modules/crust)
