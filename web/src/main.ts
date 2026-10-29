import "./styles.css";
import { api, ApiError, setUnauthorizedHandler } from "./api";
import { h, logo, sparkle } from "./dom";
import { applyCssVariables, preferredTheme, type ThemeName } from "./theme";

const app = document.getElementById("app")!;
applyCssVariables((localStorage.getItem("ide.theme") as ThemeName | null) ?? preferredTheme());

async function boot(): Promise<void> {
    const session = await api.session();
    if (!session.authenticated) return showLogin(session.version);
    // Monaco is loaded only after logging in.
    const { Ide } = await import("./ide");
    const ide = new Ide(async () => {
        await api.logout().catch(() => {});
        location.reload();
    });
    setUnauthorizedHandler(() => location.reload());
    app.replaceChildren(ide.root);
    await ide.start();
}

function showLogin(version: string): void {
    const input = h("input", { type: "password", placeholder: "접근 토큰", autocomplete: "current-password", required: true, "aria-label": "접근 토큰" });
    const error = h("p", { class: "login-error", role: "alert" });
    const submit = h("button", { type: "submit", class: "primary" }, "시작하기");
    const form = h("form", { class: "login-card" },
        h("div", { class: "login-brand" },
            h("div", { class: "login-logo" }, logo(58)),
            h("span", { class: "login-overline" }, "IDE", sparkle(16)),
            h("h1", {}, "StarLight"),
            h("p", {}, "PC에서 편집하고, 컴파일하고,", h("br"), "바로 대화해 보는 봇 개발"),
            h("span", { class: "login-version" }, `v${version}`, sparkle(11))),
        input,
        error,
        submit,
        h("p", { class: "login-hint" }, "토큰은 StarLight 앱의 플러그인 설정 › 웹 IDE › 보안에서 정해요."));
    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
            await api.login(input.value);
            await boot();
        } catch (err) {
            error.textContent = err instanceof ApiError && err.status === 401 ? (err.message === "Wrong token" ? "토큰이 맞지 않아요." : err.message) : String(err);
            input.select();
        } finally {
            submit.disabled = false;
        }
    });
    const field = sky();
    app.replaceChildren(h("div", { class: "login" }, field, form));
    input.focus();
    meteors(field);
}

/** A meteor every few seconds while the login is shown, unless the user prefers reduced motion. */
function meteors(field: HTMLElement): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const launch = () => {
        if (!field.isConnected) return;
        const meteor = h("span", { class: "meteor", style: `left:${35 + Math.random() * 60}%;top:${Math.random() * 45}%` });
        meteor.addEventListener("animationend", () => meteor.remove());
        field.appendChild(meteor);
        setTimeout(launch, 3500 + Math.random() * 5000);
    };
    setTimeout(launch, 1200);
}

/** A field of stars behind the login, twinkling unless the user prefers reduced motion. */
function sky(): HTMLElement {
    const field = h("div", { class: "sky", "aria-hidden": "true" }, h("span", { class: "shooting-star" }));
    for (let i = 0; i < 7; i++) {
        const mark = sparkle(6 + Math.random() * 8);
        mark.style.left = `${Math.random() * 100}%`;
        mark.style.top = `${Math.random() * 100}%`;
        field.appendChild(mark);
    }
    for (let i = 0; i < 70; i++) {
        const size = Math.random() < 0.12 ? 2.5 : Math.random() < 0.5 ? 1.5 : 1;
        field.appendChild(h("span", {
            class: "star",
            style: `left:${Math.random() * 100}%;top:${Math.random() * 100}%;width:${size}px;height:${size}px;` +
                `animation-delay:${(Math.random() * 6).toFixed(2)}s;animation-duration:${(3 + Math.random() * 4).toFixed(2)}s`,
        }));
    }
    return field;
}

boot().catch((e) => {
    app.replaceChildren(h("div", { class: "login" }, h("div", { class: "login-card" }, h("h1", {}, "연결할 수 없어요"), h("p", {}, String(e)))));
});
