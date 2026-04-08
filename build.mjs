import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  sourcemap: true,
  target: "chrome120",
  format: "esm",
};

async function build() {
  const ctx = await esbuild.context({
    ...common,
    entryPoints: [
      "src/background/service-worker.ts",
      "src/popup/popup.ts",
      "src/options/options.ts",
      "src/tab/tab.ts",
    ],
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
