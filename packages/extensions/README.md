# @crustjs/extensions

Official Extensions for the Crust CLI framework

## Install

```sh
bun add @crustjs/extensions
```

## Focused imports

The root export remains available. Applications can import individual Extensions without loading the root barrel:

```ts
import { help } from "@crustjs/extensions/help";
import { version } from "@crustjs/extensions/version";
```

Available subpaths are `completion`, `did-you-mean`, `help`, `no-color`, `update-notifier`, and `version`.

## Documentation

Full docs: [crustjs.com/docs/modules/extensions](https://crustjs.com/docs/modules/extensions)
