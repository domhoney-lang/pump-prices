import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { build } from "esbuild";

const outdir = path.resolve("dist/lambda");
const outNodeModulesDir = path.join(outdir, "node_modules");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
await mkdir(outNodeModulesDir, { recursive: true });

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

await cp("node_modules/.prisma", path.join(outNodeModulesDir, ".prisma"), {
  recursive: true,
});
await cp("node_modules/@prisma/client", path.join(outNodeModulesDir, "@prisma/client"), {
  recursive: true,
});

const prismaClientDir = path.join(outNodeModulesDir, ".prisma/client");
const runtimeDir = path.join(outNodeModulesDir, "@prisma/client/runtime");

for (const file of await readdir(prismaClientDir)) {
  if (file.endsWith(".map") || file.includes("darwin")) {
    await rm(path.join(prismaClientDir, file), { force: true });
  }
}

for (const file of await readdir(runtimeDir)) {
  if (file.endsWith(".map")) {
    await rm(path.join(runtimeDir, file), { force: true });
  }
}

console.log("Built Lambda bundle at dist/lambda/sync-fuel-data.js");
