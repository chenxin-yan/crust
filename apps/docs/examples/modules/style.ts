import { bold, createStyle, fg, green, link, padEnd, style, table } from "@crustjs/style";

//#region styling
console.log(green("OK"), bold("Build complete"));
console.log(style.bold.red("Build failed"));
console.log(fg("brand", "#4fa83d"));
//#endregion

//#region control
const color = createStyle({ mode: "always" });
const plain = createStyle({ mode: "never" });
console.log(JSON.stringify(color.red("error"))); // "\\u001b[31merror\\u001b[39m"
console.log(JSON.stringify(plain.red("error"))); // "error"
//#endregion

//#region layout
console.log(padEnd(style.bold("Name"), 10));
console.log(table(["Name", "State"], [["build", "ok"]]));
console.log(link("docs", "https://crustjs.com"));
//#endregion
