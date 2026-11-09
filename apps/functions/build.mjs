// Bundles each Lambda handler into a single file under dist/<name>/index.mjs.
// Terraform zips these directories. The AWS SDK v3 ships with the Node.js 22 Lambda runtime,
// so it's left out of the bundles to keep them small and cold starts fast.
import { rm } from "node:fs/promises";
import { build } from "esbuild";

const handlers = ["webhook", "worker", "api"];

await rm("dist", { recursive: true, force: true });

await Promise.all(
  handlers.map((name) =>
    build({
      entryPoints: [`src/handlers/${name}.ts`],
      outfile: `dist/${name}/index.mjs`,
      bundle: true,
      platform: "node",
      target: "node22",
      format: "esm",
      minify: true,
      sourcemap: true,
      external: ["@aws-sdk/*"],
      // Some dependencies are CommonJS and call require(); give them one inside the ESM bundle.
      banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
      logLevel: "warning",
    }),
  ),
);

console.log(`Built ${handlers.length} Lambda bundles in dist/`);
