// Toasts and dialogs.

import { h, icon } from "./dom";

type Kind = "info" | "success" | "warning" | "error";

const toasts = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
document.body.appendChild(toasts);

/** A short message; with [action], a button that runs it and closes the toast. */
export function toast(message: string, kind: Kind = "info", timeoutMillis = 4000, action?: { label: string; run: () => void }): void {
    const iconName = { info: "bolt", success: "check", warning: "warning", error: "error" }[kind];
    const close = () => {
        element.classList.remove("shown");
        setTimeout(() => element.remove(), 250);
    };
    const element = h("div", { class: `toast toast-${kind}` + (action ? " has-action" : "") }, icon(iconName), h("span", {}, message),
        action ? h("button", { type: "button", class: "toast-action", onClick: () => { close(); action.run(); } }, action.label) : null);
    toasts.appendChild(element);
    requestAnimationFrame(() => element.classList.add("shown"));
    setTimeout(close, timeoutMillis);
}

interface Field {
    name: string;
    label: string;
    value?: string;
    placeholder?: string;
    type?: "text" | "select" | "checkboxes";
    options?: { value: string; label: string; checked?: boolean; hint?: string }[];
}

/** A modal form; resolves with the values by field name, or null when cancelled. */
export function dialog(title: string, fields: Field[], confirmLabel = "확인", description?: string): Promise<Record<string, string | string[]> | null> {
    return new Promise((resolve) => {
        const inputs = new Map<string, () => string | string[]>();
        const form = h("form", { class: "dialog-form" });
        for (const field of fields) {
            if (field.type === "select") {
                const select = h("select", { name: field.name },
                    ...(field.options ?? []).map((o) => h("option", { value: o.value, selected: o.value === field.value }, o.label)));
                inputs.set(field.name, () => select.value);
                form.appendChild(h("label", { class: "field" }, h("span", {}, field.label), select));
            } else if (field.type === "checkboxes") {
                const boxes = (field.options ?? []).map((o) => {
                    const box = h("input", { type: "checkbox", value: o.value, checked: o.checked });
                    return { box, row: h("label", { class: "check-row" }, box, h("span", {}, o.label), o.hint ? h("small", {}, o.hint) : null) };
                });
                inputs.set(field.name, () => boxes.filter((b) => b.box.checked).map((b) => b.box.value));
                form.appendChild(h("fieldset", { class: "field" }, h("legend", {}, field.label), h("div", { class: "check-list" }, ...boxes.map((b) => b.row))));
            } else {
                const input = h("input", { name: field.name, value: field.value ?? "", placeholder: field.placeholder ?? "", autocomplete: "off", spellcheck: false });
                inputs.set(field.name, () => input.value.trim());
                form.appendChild(h("label", { class: "field" }, h("span", {}, field.label), input));
            }
        }
        const close = (result: Record<string, string | string[]> | null) => {
            overlay.remove();
            document.removeEventListener("keydown", onKey, true);
            resolve(result);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                close(null);
            }
        };
        form.addEventListener("submit", (e) => {
            e.preventDefault();
            close(Object.fromEntries([...inputs].map(([name, read]) => [name, read()])));
        });
        form.appendChild(h("div", { class: "dialog-actions" },
            h("button", { type: "button", class: "secondary", onClick: () => close(null) }, "취소"),
            h("button", { type: "submit", class: "primary" }, confirmLabel)));
        const overlay = h("div", { class: "overlay", onMousedown: (e: Event) => { if (e.target === overlay) close(null); } },
            h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": title },
                h("h2", {}, title), description ? h("p", { class: "dialog-description" }, description) : null, form));
        document.body.appendChild(overlay);
        document.addEventListener("keydown", onKey, true);
        (form.querySelector("input, select") as HTMLElement | null)?.focus();
        (form.querySelector("input") as HTMLInputElement | null)?.select();
    });
}

export async function confirmDialog(title: string, description: string, confirmLabel: string): Promise<boolean> {
    return (await dialog(title, [], confirmLabel, description)) !== null;
}

interface PickItem {
    value: string;
    label: string;
    detail?: string;
    icon?: Node;
}

/** A command-palette style picker with filtering; resolves with the chosen value, or null. */
export function pick(items: PickItem[], placeholder: string): Promise<string | null> {
    return new Promise((resolve) => {
        const input = h("input", { class: "palette-input", placeholder, spellcheck: false, autocomplete: "off" });
        const list = h("div", { class: "palette-list", role: "listbox" });
        let shown: PickItem[] = [];
        let index = 0;

        const render = () => {
            const query = input.value.trim().toLowerCase();
            shown = items
                .map((item) => ({ item, score: score(item.label.toLowerCase(), query) }))
                .filter((x) => x.score >= 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, 50)
                .map((x) => x.item);
            index = Math.min(index, Math.max(shown.length - 1, 0));
            list.replaceChildren(...shown.map((item, i) => h("div", {
                class: "palette-item" + (i === index ? " selected" : ""), role: "option", "aria-selected": i === index,
                onMousedown: (e: Event) => { e.preventDefault(); close(item.value); },
                onMousemove: () => { if (index !== i) { index = i; render(); } },
            }, item.icon ?? null, h("span", { class: "palette-label" }, item.label), item.detail ? h("span", { class: "palette-detail" }, item.detail) : null)));
            if (shown.length === 0) list.append(h("div", { class: "palette-empty" }, "일치하는 항목이 없어요"));
            list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
        };
        const close = (value: string | null) => {
            overlay.remove();
            resolve(value);
        };
        input.addEventListener("input", () => { index = 0; render(); });
        input.addEventListener("keydown", (e) => {
            if (e.key === "ArrowDown") { index = Math.min(index + 1, shown.length - 1); render(); e.preventDefault(); }
            else if (e.key === "ArrowUp") { index = Math.max(index - 1, 0); render(); e.preventDefault(); }
            else if (e.key === "Enter") { if (shown[index]) close(shown[index].value); e.preventDefault(); }
            else if (e.key === "Escape") { close(null); e.preventDefault(); }
        });
        const overlay = h("div", { class: "overlay palette-overlay", onMousedown: (e: Event) => { if (e.target === overlay) close(null); } },
            h("div", { class: "palette", role: "dialog", "aria-modal": "true" },
                h("div", { class: "palette-search" }, icon("search", 15), input), list));
        document.body.appendChild(overlay);
        render();
        input.focus();
    });
}

/** Subsequence match, preferring matches at word starts and in the file name; -1 if it doesn't match. */
function score(text: string, query: string): number {
    if (!query) return 0;
    let total = 0;
    let at = 0;
    const nameStart = text.lastIndexOf("/") + 1;
    for (const c of query) {
        const found = text.indexOf(c, at);
        if (found < 0) return -1;
        total += found === at ? 3 : 1;
        if (found >= nameStart) total += 2;
        if (found === 0 || "/.-_ ".includes(text[found - 1])) total += 2;
        at = found + 1;
    }
    return total - text.length * 0.01;
}

/** A small menu under [anchor]; [onPick] gets the chosen value. Closes on choice, outside click or Escape. */
export function menu(anchor: HTMLElement, items: { value: string; label: string }[], selected: string, onPick: (value: string) => void): void {
    document.querySelector(".menu")?.remove();
    const close = () => {
        element.remove();
        document.removeEventListener("mousedown", outside, true);
        document.removeEventListener("keydown", escape, true);
    };
    const outside = (e: MouseEvent) => { if (!element.contains(e.target as Node) && e.target !== anchor) close(); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); anchor.focus(); } };
    const element = h("div", { class: "menu", role: "menu" },
        ...items.map((item) => h("button", {
            type: "button", class: "menu-item" + (item.value === selected ? " selected" : ""), role: "menuitemradio",
            "aria-checked": item.value === selected,
            onClick: () => { close(); onPick(item.value); },
        }, item.value === selected ? icon("check", 14) : h("span", { class: "menu-check" }), item.label)));
    const rect = anchor.getBoundingClientRect();
    element.style.top = `${rect.bottom + 6}px`;
    element.style.left = `${Math.max(8, rect.right - 180)}px`;
    document.body.appendChild(element);
    document.addEventListener("mousedown", outside, true);
    document.addEventListener("keydown", escape, true);
    (element.querySelector(".selected") as HTMLElement | null ?? element.querySelector("button"))?.focus();
}
