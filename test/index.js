const autoprefixer = require("autoprefixer"),
  { build } = require("esbuild"),
  postCSS = require("../dist"),
  { assert } = require("chai");

describe("PostCSS esbuild tests", () => {
  it("Works with basic CSS imports", (done) => {
    test("basic")
      .then((res) => {
        assert(res);
        done();
      })
      .catch(done);
  });
  it("Works with preprocessors", (done) => {
    test("preprocessors")
      .then((res) => {
        assert(res);
        done();
      })
      .catch(done);
  });
});

function test(test) {
  return build({
    entryPoints: [`tests/${test}.ts`],
    bundle: true,
    outdir: "dist",
    plugins: [
      postCSS.default({
        plugins: [autoprefixer]
      })
    ]
  }).catch(() => process.exit(1));
}
