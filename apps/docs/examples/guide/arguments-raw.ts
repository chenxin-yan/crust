import { Crust } from "@crustjs/core";

const wrap = new Crust("wrap").action(({ rawArgs, stdout }) => stdout(rawArgs.join(" ")));

await wrap.execute();
