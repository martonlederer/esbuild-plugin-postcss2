import {ensureDir, readFile, writeFile} from "fs-extra";
import {TextDecoder} from "util";
import path from "path";
import tmp from "tmp";
import postcss from "postcss";
import postcssModules from "postcss-modules";
import less from "less";
import stylus from "stylus";
import resolveFile from "resolve-file";
const postCSSPlugin = ({
  plugins = [],
  modules = true,
  rootDir = process.cwd()
}) => ({
  name: "postcss2",
  setup(build) {
    const tmpDirPath = tmp.dirSync().name, modulesMap = [];
    const modulesPlugin = postcssModules({
      generateScopedName: "[name]__[local]___[hash:base64:5]",
      ...typeof modules !== "boolean" ? modules : {},
      getJSON(filepath, json, outpath) {
        modulesMap.push({
          path: filepath,
          map: json
        });
        if (typeof modules !== "boolean" && typeof modules.getJSON === "function")
          return modules.getJSON(filepath, json, outpath);
      }
    });
    build.onResolve({filter: /.\.(css|sass|scss|less|styl)$/}, async (args) => {
      if (args.namespace !== "file" && args.namespace !== "")
        return;
      let sourceFullPath = resolveFile(args.path);
      if (!sourceFullPath)
        sourceFullPath = path.resolve(args.resolveDir, args.path);
      const sourceExt = path.extname(sourceFullPath);
      const sourceBaseName = path.basename(sourceFullPath, sourceExt);
      const sourceDir = path.dirname(sourceFullPath);
      const sourceRelDir = path.relative(path.dirname(rootDir), sourceDir);
      const isModule = sourceBaseName.match(/\.module$/);
      const tmpDir = path.resolve(tmpDirPath, sourceRelDir);
      let tmpFilePath = path.resolve(tmpDir, `${Date.now()}-${sourceBaseName}.css`);
      if (args.kind === "entry-point")
        tmpFilePath = path.resolve(tmpDir, `${sourceBaseName}.css`);
      await ensureDir(tmpDir);
      const fileContent = await readFile(sourceFullPath);
      let css = sourceExt === ".css" ? fileContent : "";
      if (sourceExt === ".sass" || sourceExt === ".scss")
        css = (await renderSass({file: sourceFullPath})).css.toString();
      if (sourceExt === ".styl")
        css = await renderStylus(new TextDecoder().decode(fileContent), {
          filename: sourceFullPath
        });
      if (sourceExt === ".less")
        css = (await less.render(new TextDecoder().decode(fileContent), {
          filename: sourceFullPath,
          rootpath: path.dirname(args.path)
        })).css;
      const result = await postcss(isModule ? [modulesPlugin, ...plugins] : plugins).process(css, {
        from: sourceFullPath,
        to: tmpFilePath
      });
      await writeFile(tmpFilePath, result.css);
      return {
        namespace: isModule ? "postcss-module" : "file",
        path: tmpFilePath,
        watchFiles: [sourceFullPath],
        pluginData: {
          originalPath: sourceFullPath
        }
      };
    });
    build.onLoad({filter: /.*/, namespace: "postcss-module"}, async (args) => {
      const mod = modulesMap.find(({path: path2}) => path2 === args?.pluginData?.originalPath), resolveDir = path.dirname(args.path);
      return {
        resolveDir,
        contents: `import ${JSON.stringify(args.path)};
export default ${JSON.stringify(mod && mod.map ? mod.map : {})};`
      };
    });
  }
});
function renderSass(options) {
  return new Promise((resolve, reject) => {
    getSassImpl().render(options, (e, res) => {
      if (e)
        reject(e);
      else
        resolve(res);
    });
  });
}
function renderStylus(str, options) {
  return new Promise((resolve, reject) => {
    stylus.render(str, options, (e, res) => {
      if (e)
        reject(e);
      else
        resolve(res);
    });
  });
}
function getSassImpl() {
  let impl = "sass";
  try {
    require.resolve("sass");
  } catch {
    try {
      require.resolve("node-sass");
      impl = "node-sass";
    } catch {
      throw new Error('Please install "sass" or "node-sass" package');
    }
  }
  return require(impl);
}
var src_default = postCSSPlugin;
export {
  src_default as default
};
