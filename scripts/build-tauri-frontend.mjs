import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("dist", "tauri-frontend");

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });
await cp("index.html", path.join(outDir, "index.html"));
await cp(path.join("src", "app"), path.join(outDir, "src", "app"), { recursive: true });

console.log(JSON.stringify({
  ok: true,
  outDir: path.relative(process.cwd(), outDir).replaceAll(path.sep, "/"),
}, null, 2));
