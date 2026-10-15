import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
for (const name of [
  "cocode-data-store",
  "cocode-director",
  "cocode-studio-ui",
]) {
  await build({
    entryPoints: [resolve(root, `plugins/${name}/index.ts`)],
    outfile: resolve(root, `plugins/${name}/lib/index.js`),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    packages: "external",
    sourcemap: true,
  });
}
await mkdir(resolve(root, "dist/client"), { recursive: true });
await build({
  entryPoints: [resolve(root, "plugins/cocode-studio-ui/client/entry.tsx")],
  outfile: resolve(root, "dist/client/app.js"),
  bundle: true,
  platform: "browser",
  format: "esm",
  minify: true,
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
});
for (const f of ["index.html", "app.css", "favicon.svg"])
  await copyFile(
    resolve(root, `plugins/cocode-studio-ui/client/${f}`),
    resolve(root, `dist/client/${f}`),
  );
await build({
  entryPoints: [resolve(root, "plugins/cocode-studio-ui/client/host.tsx")],
  outfile: resolve(root, "plugins/cocode-studio-ui/lib/client.js"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  minify: true,
  target: "es2022",
  define: { "process.env.NODE_ENV": '"production"' },
  banner: {
    js: 'window.__ModuleLoader__.load({id:"cocode-studio-ui",factory:()=>{const module={exports:{}};const exports=module.exports;',
  },
  footer: { js: ";return module.exports;}});" },
});
console.log("cocode 酷码工作室 · Cocode Studio VideoForge — 构建完成");
