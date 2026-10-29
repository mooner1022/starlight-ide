// Replaces each compressible file of the build with a .gz, which the backend sends as is to browsers accepting gzip
// and decompresses for the others. index.html stays plain, so a missing build is easy to spot.
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync, constants } from "node:zlib";

const outDir = process.env.WEB_OUT_DIR ?? "dist";
const compressible = /\.(js|css|html|svg|json|ttf|map)$/;
const minBytes = 1024;

let original = 0;
let compressed = 0;
for (const file of walk(outDir)) {
    if (!compressible.test(file) || statSync(file).size < minBytes || file.endsWith("index.html")) continue;
    const bytes = readFileSync(file);
    const gz = gzipSync(bytes, { level: constants.Z_BEST_COMPRESSION });
    writeFileSync(`${file}.gz`, gz);
    unlinkSync(file);
    original += bytes.length;
    compressed += gz.length;
}
console.log(`gzip: ${(original / 1024).toFixed(0)} KB -> ${(compressed / 1024).toFixed(0)} KB`);

function* walk(dir) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) yield* walk(path);
        else yield path;
    }
}
