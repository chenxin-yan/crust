import { Popup, PopupContent, PopupTrigger } from "fumadocs-twoslash/ui";
import type { Root } from "hast";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import type { JSX } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

// Twoslash emits <Popup>/<PopupContent>/<PopupTrigger> elements; map them to the real components.
const POPUP_COMPONENTS = { Popup, PopupContent, PopupTrigger };

/** Renders Shiki hast from `virtual:landing-twoslash`, popups included. */
export function Code({ code }: { code: Root }): JSX.Element {
	return <>{toJsxRuntime(code, { Fragment, jsx, jsxs, components: POPUP_COMPONENTS })}</>;
}
