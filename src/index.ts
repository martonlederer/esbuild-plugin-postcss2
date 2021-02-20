import { Plugin } from "esbuild";
import { Plugin as PostCSSPlugin } from "postcss";
import { ensureDir, readFile, writeFile } from "fs-extra";
import {
  SassException,
  Result as SassResult,
  Options as SassOptions
} from "sass";
import path from "path";
import tmp from "tmp";
import postcss from "postcss";
import postcssModules from "postcss-modules";
import less from "less";
import stylus from "stylus";
import { TextDecoder } from "util";

interface PostCSSPluginOptions {
  plugins: PostCSSPlugin[];
  modules: boolean | any;
  rootDir?: string;
}

interface CSSModule {
  path: string;
  map: {
    [key: string]: string;
  };
}

const postCSSPlugin = ({
  plugins = [],
  modules = true,
  rootDir = process.cwd()
}: PostCSSPluginOptions): Plugin => ({
  name: "postcss2",
  setup(build) {
    // get a temporary path where we can save compiled CSS
    const tmpDirPath = tmp.dirSync().name,
      modulesMap: CSSModule[] = [];

    build.onResolve(
      { filter: /.\.(css|sass|scss|less|styl)$/, namespace: "file" },
      async (args) => {
        const sourceFullPath = path.resolve(args.resolveDir, args.path),
          sourceExt = path.extname(sourceFullPath),
          sourceBaseName = path.basename(sourceFullPath, sourceExt),
          sourceDir = path.dirname(sourceFullPath),
          sourceRelDir = path.relative(path.dirname(rootDir), sourceDir),
          isModule = sourceBaseName.match(/\.module$/),
          tmpDir = path.resolve(tmpDirPath, sourceRelDir),
          tmpFilePath = path.resolve(
            tmpDir,
            `${sourceBaseName}-tmp-${Date.now()}-${sourceExt.replace(".", "")}${
              isModule ? ".module" : ""
            }.css`
          );

        await ensureDir(tmpDir);

        const fileContent = await readFile(sourceFullPath);
        let css = sourceExt === ".css" ? fileContent : "";

        // parse css modules with postcss-modules
        if (modules !== false && isModule) {
          plugins.unshift(
            postcssModules({
              ...(typeof modules !== "boolean" ? modules : {}),
              getJSON(filepath, json, outpath) {
                modulesMap.push({
                  path: tmpFilePath,
                  map: json
                });

                if (
                  typeof modules !== "boolean" &&
                  typeof modules.getJSON === "function"
                )
                  return modules.getJSON(filepath, json, outpath);
              }
            })
          );
        }

        // parse files with preprocessors
        if (sourceExt === ".sass" || sourceExt === ".scss")
          css = (await renderSass({ file: sourceFullPath })).css.toString();
        if (sourceExt === ".styl")
          css = await renderStylus(new TextDecoder().decode(fileContent), {
            filename: sourceFullPath
          });
        if (sourceExt === ".less")
          css = (
            await less.render(new TextDecoder().decode(fileContent), {
              filename: sourceFullPath,
              rootpath: path.dirname(args.path)
            })
          ).css;

        // wait for plugins to complete parsing & get result
        const result = await postcss(plugins).process(css, {
          from: sourceFullPath,
          to: tmpFilePath
        });

        // Write result CSS
        await writeFile(tmpFilePath, result.css);

        return {
          namespace: isModule ? "postcss-module" : "file",
          path: tmpFilePath
        };
      }
    );

    // load css modules
    build.onLoad(
      { filter: /.*/, namespace: "postcss-module" },
      async (args) => {
        const mod = modulesMap.find(({ path }) => path === args.path),
          resolveDir = path.dirname(args.path);

        console.log(mod);

        return {
          resolveDir,
          contents: `import "${args.path.replace(
            resolveDir,
            "."
          )}"; export default ${JSON.stringify(mod.map)};`
        };
      }
    );
  }
});

function renderSass(options: SassOptions): Promise<SassResult> {
  return new Promise((resolve, reject) => {
    getSassImpl().render(options, (e: SassException, res: SassResult) => {
      if (e) reject(e);
      else resolve(res);
    });
  });
}

function renderStylus(str: string, options): Promise<string> {
  return new Promise((resolve, reject) => {
    stylus.render(str, options, (e, res) => {
      if (e) reject(e);
      else resolve(res);
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

export default postCSSPlugin;
