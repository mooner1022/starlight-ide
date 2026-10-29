import "./styles.css";
import { api, ApiError, setUnauthorizedHandler } from "./api";
import { h, logo } from "./dom";
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
    const submit = h("button", { type: "submit", class: "primary" }, "로그인");
    const form = h("form", { class: "login-card" },
        h("div", { class: "login-brand" }, logo(36), h("div", {}, h("h1", {}, "StarLight IDE"), h("p", {}, "PC에서 StarLight 프로젝트를 편집하고 실행해요"))),
        h("label", { class: "field" }, h("span", {}, "접근 토큰"), input),
        error,
        submit,
        h("p", { class: "login-hint" }, "토큰은 StarLight 앱의 플러그인 설정 › 웹 IDE › 보안에서 정해요."),
        h("p", { class: "login-version" }, `v${version}`));
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
    app.replaceChildren(h("div", { class: "login" }, form));
    input.focus();
}

boot().catch((e) => {
    app.replaceChildren(h("div", { class: "login" }, h("div", { class: "login-card" }, h("h1", {}, "연결할 수 없어요"), h("p", {}, String(e)))));
});
