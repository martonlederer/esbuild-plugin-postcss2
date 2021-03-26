const autoprefixer = require("autoprefixer"),
  { build } = require("esbuild"),
  postCSS = require("../dist"),
  { assert } = require("chai");

describe("PostCSS esbuild tests", () => {
  it("Works with basic CSS imports", (done) => {
    test(["tests/basic.ts"])
      .then((res) => {
        assert(res);
        done();
      })
      .catch(done);
  });
  it("Works with preprocessors", (done) => {
    test(["tests/preprocessors.ts"])
      .then((res) => {
        assert(res);
        done();
      })
      .catch(done);
  });
  it("Works with CSS modules", (done) => {
    test(["tests/modules.ts"])
      .then((res) => {
        assert(res);
        done();
      })
      .catch(done);
  });
  it("Works with CSS as entrypoint", (done) => {
    test(["tests/styles.css", "tests/styles2.css"])
      .then((res) => {
        assert(res);
        done();
      })
      .catch(done);
  });
  it("Works with node_modules import", (done) => {
    test(["tests/node_modules.ts"])
      .then((res) => {
        assert(res);
        done();
      })
      .catch(done);
  });
});

function test(entryPoint) {
  return build({
    entryPoints: entryPoint,
    bundle: true,
    outdir: "dist",
    plugins: [
      postCSS.default({
        plugins: [autoprefixer]
      })
    ]
  }).catch(() => process.exit(1));
}
