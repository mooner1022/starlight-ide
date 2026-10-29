import { defineConfig } from "vite";

export default defineConfig({
    base: "./",
    build: {
        outDir: process.env.WEB_OUT_DIR ?? "dist",
        emptyOutDir: true,
        target: "es2022",
        // Monaco is the bulk of the page; separate chunks stay cached across IDE releases that don't touch it.
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (id.includes("node_modules/monaco-editor")) return "monaco";
                },
            },
        },
        chunkSizeWarningLimit: 4096,
    },
    worker: {
        format: "es",
    },
    server: {
        // `npm run dev` against a device: VITE_DEVICE=http://192.168.0.2:8766 npm run dev
        proxy: process.env.VITE_DEVICE ? { "/api": { target: process.env.VITE_DEVICE, changeOrigin: false } } : undefined,
    },
});
