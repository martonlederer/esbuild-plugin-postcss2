const { build } = require("esbuild"),
  { copyFile } = require("fs");

const production = process.env.NODE_ENV === "production";

build({
  entryPoints: ["./src/index.ts"],
  watch: !production,
  format: "cjs",
  outfile: `./dist/index.js`
}).catch(() => process.exit(1));

// copy module declarations
copyFile("./src/modules.d.ts", "./dist/modules.d.ts", (err) => {
  if (err) throw err;
  console.log("[modules.d.ts] copied");
});
