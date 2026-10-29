// Toasts and dialogs.

import { h, icon } from "./dom";

type Kind = "info" | "success" | "warning" | "error";

const toasts = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
document.body.appendChild(toasts);

export function toast(message: string, kind: Kind = "info", timeoutMillis = 4000): void {
    const iconName = { info: "bolt", success: "check", warning: "warning", error: "error" }[kind];
    const element = h("div", { class: `toast toast-${kind}` }, icon(iconName), h("span", {}, message));
    toasts.appendChild(element);
    requestAnimationFrame(() => element.classList.add("shown"));
    setTimeout(() => {
        element.classList.remove("shown");
        setTimeout(() => element.remove(), 250);
    }, timeoutMillis);
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
