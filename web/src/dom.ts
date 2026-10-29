// A small element builder instead of a framework: the page is a handful of panels.

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined || value === null || value === false) continue;
        if (key.startsWith("on") && typeof value === "function") {
            element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
        } else if (key === "class") {
            element.className = String(value);
        } else if (key in element && key !== "style" && key !== "list") {
            (element as unknown as Record<string, unknown>)[key] = value;
        } else {
            element.setAttribute(key, value === true ? "" : String(value));
        }
    }
    append(element, ...children);
    return element;
}

export function append(parent: Node, ...children: Child[]): void {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
    }
}

export function clear(element: Element): void {
    element.replaceChildren();
}

// Icons: 16px strokes in the style of the editor's codicons.
const ICONS: Record<string, string> = {
    file: "M4 1.5h5l3.5 3.5v9.5h-8.5zM9 1.5V5h3.5",
    folder: "M1.5 3.5h4.5l1.5 1.5h7v8.5h-13z",
    folderOpen: "M1.5 3.5h4.5l1.5 1.5h6v2M1.5 13.5l2-6.5h11.5l-2 6.5z",
    chevronRight: "M6 3.5l4.5 4.5-4.5 4.5",
    chevronDown: "M3.5 6l4.5 4.5 4.5-4.5",
    chevronUp: "M3.5 10l4.5-4.5 4.5 4.5",
    play: "M4.5 2.5v11l9-5.5z",
    save: "M2.5 2.5h9l2 2v9h-11zM5 2.5v3.5h5.5V2.5M4.5 13.5v-4.5h7v4.5",
    refresh: "M13 3.5v3.5h-3.5M13 7a5 5 0 1 0 -1.5 4.5",
    plus: "M8 3v10M3 8h10",
    trash: "M3 4.5h10M6.5 4.5V2.5h3v2M4.5 4.5l.5 9h6l.5-9",
    edit: "M10 2.5l3.5 3.5-8 8H2.5v-3.5z",
    search: "M7 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zM10.5 10.5l3.5 3.5",
    terminal: "M2.5 3.5l4 4.5-4 4.5M8 12.5h5.5",
    chat: "M2.5 3h11v7.5h-6.5l-3 2.5v-2.5h-1.5z",
    power: "M8 1.5v6M4.5 3.5a5.5 5.5 0 1 0 7 0",
    logout: "M6 2.5h-3.5v11h3.5M10 5l3 3-3 3M13 8H6",
    bolt: "M9 1.5l-5 7.5h4l-1 5.5 5-7.5h-4z",
    send: "M2 8l12-5.5-4 12-2.5-4.5z",
    close: "M4 4l8 8M12 4l-8 8",
    sun: "M8 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zM8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1",
    moon: "M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5z",
    gear: "M8 5.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4",
    warning: "M8 2l6.5 11.5h-13zM8 6.5v3.5M8 11.5v.5",
    error: "M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13zM5.5 5.5l5 5M10.5 5.5l-5 5",
    check: "M3 8.5l3 3 7-7",
    clear: "M3 13h10M5 9.5l5.5-5.5 2.5 2.5-5.5 5.5H5z",
    sort: "M5 3v10M2.5 10.5L5 13l2.5-2.5M11 13V3M8.5 5.5L11 3l2.5 2.5",
    panelLeft: "M2.5 3h11v10h-11zM6.5 3v10",
    panelRight: "M2.5 3h11v10h-11zM9.5 3v10",
};

export function icon(name: keyof typeof ICONS | string, size = 16): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("icon");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", ICONS[name] ?? ICONS.file);
    svg.appendChild(path);
    return svg;
}

/** StarLight's logo: four notched arms of two petals each, as in the app. */
export function logo(size = 20): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "-12 -12 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("logo");
    for (let arm = 0; arm < 4; arm++) {
        // Each arm is a pair of parallelograms with a notch at the tip, like the app's mark.
        for (const side of [-1, 1]) {
            const petal = document.createElementNS("http://www.w3.org/2000/svg", "path");
            petal.setAttribute("d", `M ${0.55 * side} -1.3 L ${4.2 * side} -4.6 L ${4.2 * side} -11.2 L ${0.55 * side} -7.9 Z`);
            petal.setAttribute("transform", `rotate(${arm * 90})`);
            svg.appendChild(petal);
        }
    }
    return svg;
}

/** The ✦ sparkle the app puts before titles and on chosen items. */
export function sparkle(size = 12): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("aria-hidden", "true");
    svg.classList.add("sparkle");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M8 0c.5 4.3 3.7 7.5 8 8-4.3.5-7.5 3.7-8 8-.5-4.3-3.7-7.5-8-8 4.3-.5 7.5-3.7 8-8z");
    svg.appendChild(path);
    return svg;
}

export function button(label: string | Node, onClick: () => void, props: Props = {}): HTMLButtonElement {
    return h("button", { type: "button", ...props, onClick }, label);
}

export function iconButton(name: string, title: string, onClick: () => void, props: Props = {}): HTMLButtonElement {
    return h("button", { type: "button", title, "aria-label": title, ...props, class: "icon-button " + (props.class ?? ""), onClick }, icon(name));
}

export function formatTime(millis: number): string {
    const date = new Date(millis);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}
