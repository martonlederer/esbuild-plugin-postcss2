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

type StylusRenderOptions = Parameters<typeof stylus.render>[1]; // The Stylus.RenderOptions interface doesn't seem to be exported... So next best

interface PostCSSPluginOptions {
  plugins: PostCSSPlugin[];
  modules: boolean | any;
  rootDir?: string;
  sassOptions?: SassOptions;
  lessOptions?: Less.Options;
  stylusOptions?: StylusRenderOptions;
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
  rootDir = process.cwd(),
  sassOptions = {},
  lessOptions = {},
  stylusOptions = {}
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
        if (args.namespace !== "file" && args.namespace !== "") return;

        // Resolve files from node_modules (ex: npm install normalize.css)
        let sourceFullPath = resolveFile(args.path);
        if (!sourceFullPath)
          sourceFullPath = path.resolve(args.resolveDir, args.path);

        const sourceExt = path.extname(sourceFullPath);
        const sourceBaseName = path.basename(sourceFullPath, sourceExt);
        const isModule = sourceBaseName.match(/\.module$/);

        let tmpFilePath: string;
        if (args.kind === "entry-point") {
          // For entry points, we use <tempdir>/<path-within-project-root>/<file-name>.css
          const sourceRelDir = path.relative(
            path.dirname(rootDir),
            path.dirname(sourceFullPath)
          );
          tmpFilePath = path.resolve(
            tmpDirPath,
            sourceRelDir,
            `${sourceBaseName}.css`
          );
          await ensureDir(path.dirname(tmpFilePath));
        } else {
          // For others, we use <tempdir>/<unique-directory-name>/<file-name>.css
          //
          // This is a workaround for the following esbuild issue:
          // https://github.com/evanw/esbuild/issues/1101
          //
          // esbuild is unable to find the file, even though it does exist. This only
          // happens for files in a directory with several other entries, so by
          // creating a unique directory name per file on every build, we guarantee
          // that there will only every be a single file present within the directory,
          // circumventing the esbuild issue.
          const uniqueTmpDir = path.resolve(tmpDirPath, uniqueId());
          tmpFilePath = path.resolve(uniqueTmpDir, `${sourceBaseName}.css`);
        }
        await ensureDir(path.dirname(tmpFilePath));

        const fileContent = await readFile(sourceFullPath);
        let css = sourceExt === ".css" ? fileContent : "";

        // parse files with preprocessors
        if (sourceExt === ".sass" || sourceExt === ".scss")
          css = (
            await renderSass({ ...sassOptions, file: sourceFullPath })
          ).css.toString();
        if (sourceExt === ".styl")
          css = await renderStylus(new TextDecoder().decode(fileContent), {
            ...stylusOptions,
            filename: sourceFullPath
          });
        if (sourceExt === ".less")
          css = (
            await less.render(new TextDecoder().decode(fileContent), {
              ...lessOptions,
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

function renderStylus(
  str: string,
  options: StylusRenderOptions
): Promise<string> {
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

let idCounter = 0;

/**
 * Generates an id that is guaranteed to be unique for the Node.JS instance.
 */
function uniqueId(): string {
  return Date.now().toString(16) + (idCounter++).toString(16);
}

export default postCSSPlugin;
