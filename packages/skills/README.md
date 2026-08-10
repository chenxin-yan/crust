# @crustjs/skills

Agent skill generation from Crust command definitions

## Install

```sh
bun add @crustjs/skills
```

## Focused imports

The root export remains available. Applications that use one feature can avoid loading the root barrel:

```ts
import { skill } from "@crustjs/skills/extension";
import { generateSkill } from "@crustjs/skills/generate";
```

Available subpaths are `agents`, `annotations`, `bundle`, `extension`, and `generate`.

## Documentation

Full docs: [crustjs.com/docs/modules/skills](https://crustjs.com/docs/modules/skills)
