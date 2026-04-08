import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  sourcemap: true,
  target: "chrome120",
  format: "esm",
};

const entryPoints = [
  { in: "src/background/service-worker.ts", out: "background/service-worker" },
  { in: "src/popup/popup.ts", out: "popup/popup" },
  { in: "src/options/options.ts", out: "options/options" },
];

async function build() {
  const ctx = await esbuild.context({
    ...common,
    entryPoints: entryPoints.map((e) => e.in),
    outdir: "dist",
    outbase: "src",
  });

  if (watch) {
    await ctx.watch();
    console.log("Watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
    console.log("Build complete.");
  }
}

build().catch((e) => {
  console.error(e);
  process.exit(1);
});
