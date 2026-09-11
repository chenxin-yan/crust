//#region styling
import { bold, fg, green, style } from "@crustjs/style";

console.log(green("OK"), bold("Build complete")); // OK Build complete
console.log(style.bold.red("Build failed")); // Build failed
console.log(fg("brand", "#4fa83d")); // brand
//#endregion

//#region control
import { createStyle } from "@crustjs/style";

const color = createStyle({ mode: "always" });
const plain = createStyle({ mode: "never" });
console.log(JSON.stringify(color.red("error"))); // "\u001b[31merror\u001b[39m"
console.log(JSON.stringify(plain.red("error"))); // "error"
//#endregion

//#region layout
import { link, padEnd, style as layoutStyle, table } from "@crustjs/style";

console.log(padEnd(layoutStyle.bold("Name"), 10)); // "Name      "
console.log(table(["Name", "State"], [["build", "ok"]]));
// | Name  | State |
// |-------|-------|
// | build | ok    |
console.log(link("docs", "https://crustjs.com")); // docs
//#endregion
