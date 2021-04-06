import { Plugin } from "esbuild";
import { Plugin as PostCSSPlugin } from "postcss";
import { ensureDir, readFile, writeFile } from "fs-extra";
import { TextDecoder } from "util";
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
import resolveFile from "resolve-file";

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

    const modulesPlugin = postcssModules({
      generateScopedName: "[name]__[local]___[hash:base64:5]",
      ...(typeof modules !== "boolean" ? modules : {}),
      getJSON(filepath, json, outpath) {
        // Make sure to replace json map instead of pushing new map everytime with edit file on watch
        const mapIndex = modulesMap.findIndex((m) => m.path === filepath);
        if (mapIndex !== -1) {
          modulesMap[mapIndex].map = json;
        } else {
          modulesMap.push({
            path: filepath,
            map: json
          });
        }

        if (
          typeof modules !== "boolean" &&
          typeof modules.getJSON === "function"
        )
          return modules.getJSON(filepath, json, outpath);
      }
    });

    build.onResolve(
      { filter: /.\.(css|sass|scss|less|styl)$/ },
      async (args) => {
        // Namespace is empty when using CSS as an entrypoint
        if (args.namespace !== "file" && args.namespace !== "")
          return { path: args.path }; // quick fix for https://github.com/martonlederer/esbuild-plugin-postcss2/pull/6#issuecomment-813598304 I don't know why esbuild can't resolve a file that is actually there but returning the full path after he was not able to resolve fixes the issue (might be some async write file problems but honestly I don't know)

        // Resolve files from node_modules (ex: npm install normalize.css)
        let sourceFullPath = resolveFile(args.path);
        if (!sourceFullPath)
          sourceFullPath = path.resolve(args.resolveDir, args.path);

        const sourceExt = path.extname(sourceFullPath);
        const sourceBaseName = path.basename(sourceFullPath, sourceExt);
        const sourceDir = path.dirname(sourceFullPath);
        const sourceRelDir = path.relative(path.dirname(rootDir), sourceDir);
        const isModule = sourceBaseName.match(/\.module$/);
        const tmpDir = path.resolve(tmpDirPath, sourceRelDir);

        let tmpFilePath = path.resolve(
          tmpDir,
          `${Date.now()}-${sourceBaseName}.css`
        );

        // When CSS is an entry-point we don't want to append Date.now()
        if (args.kind === "entry-point")
          tmpFilePath = path.resolve(tmpDir, `${sourceBaseName}.css`);

        await ensureDir(tmpDir);

        const fileContent = await readFile(sourceFullPath);
        let css = sourceExt === ".css" ? fileContent : "";

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
        const result = await postcss(
          isModule ? [modulesPlugin, ...plugins] : plugins
        ).process(css, {
          from: sourceFullPath,
          to: tmpFilePath
        });

        // Write result CSS
        await writeFile(tmpFilePath, result.css);

        return {
          namespace: isModule ? "postcss-module" : "file",
          path: tmpFilePath,
          watchFiles: [sourceFullPath],
          pluginData: {
            originalPath: sourceFullPath
          }
        };
      }
    );

    // load css modules
    build.onLoad(
      { filter: /.*/, namespace: "postcss-module" },
      async (args) => {
        const mod = modulesMap.find(
            ({ path }) => path === args?.pluginData?.originalPath
          ),
          resolveDir = path.dirname(args.path);

        return {
          resolveDir,
          contents: `import ${JSON.stringify(
            args.path
          )};\nexport default ${JSON.stringify(mod && mod.map ? mod.map : {})};`
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
