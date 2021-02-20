const { build } = require("esbuild"),
  { copyFile } = require("fs");

const production = process.env.NODE_ENV === "production",
  formats = ["cjs", "esm"];

(async () => {
  for (const format of formats) {
    await build({
      entryPoints: ["./src/index.ts"],
      watch: !production,
      format,
      outfile: `./dist/index${format === "cjs" ? "" : "." + format}.js`
    });
  }

  copyFile("./src/modules.d.ts", "./dist/modules.d.ts", (err) => {
    if (err) throw err;
    console.log("[modules.d.ts] copied");
  });
})();
