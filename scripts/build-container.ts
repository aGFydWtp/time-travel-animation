// Bundle the container renderer into container/dist (consumed by Dockerfile.sandbox).
//   node scripts/build-container.ts
//
// dist/render-page.html + render-page.js  -> page run in headless Chromium (shared src/lib/renderer)
// dist/render-entry.mjs                   -> Node entry (playwright-core stays external, installed in the image)
// dist/*.woff2                            -> every bundled font file (FONT_FILES), loaded by the page via relative URLs
// dist/package.json                       -> pins playwright-core to the repo's installed version
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIST_DIR = join(ROOT, 'container', 'dist');

async function readPlaywrightCoreVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(join(ROOT, 'node_modules', 'playwright-core', 'package.json'), 'utf8')) as {
    version: string;
  };
  return pkg.version;
}

export async function buildContainer(options: { quiet?: boolean } = {}): Promise<string> {
  const { FONT_FILES } = await import('../src/lib/renderer/fonts.ts');
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  await build({
    entryPoints: [join(ROOT, 'container', 'render-page.ts')],
    outfile: join(DIST_DIR, 'render-page.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome120'],
    minify: true,
    legalComments: 'eof',
    logLevel: options.quiet ? 'warning' : 'info',
  });

  await build({
    entryPoints: [join(ROOT, 'container', 'render-entry.ts')],
    outfile: join(DIST_DIR, 'render-entry.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node22'],
    external: ['playwright-core'],
    banner: { js: "import { createRequire as __dcsCreateRequire } from 'node:module'; const require = __dcsCreateRequire(import.meta.url);" },
    legalComments: 'eof',
    logLevel: options.quiet ? 'warning' : 'info',
  });

  await copyFile(join(ROOT, 'container', 'render-page.html'), join(DIST_DIR, 'render-page.html'));
  for (const file of FONT_FILES) {
    await copyFile(join(ROOT, 'assets', 'fonts', file), join(DIST_DIR, file));
  }

  const version = await readPlaywrightCoreVersion();
  const pkg = {
    name: 'dcs-container-renderer',
    private: true,
    type: 'module',
    dependencies: { 'playwright-core': version },
  };
  await writeFile(join(DIST_DIR, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  if (!options.quiet) console.log(`container bundle -> ${DIST_DIR} (playwright-core ${version})`);
  return DIST_DIR;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildContainer().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
