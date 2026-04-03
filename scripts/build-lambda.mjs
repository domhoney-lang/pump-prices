import { mkdir } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const outdir = path.resolve("dist/lambda");

await mkdir(outdir, { recursive: true });

await build({
  entryPoints: ["src/lambda/sync-fuel-data.ts"],
  outfile: path.join(outdir, "sync-fuel-data.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});

console.log("Built Lambda bundle at dist/lambda/sync-fuel-data.js");
