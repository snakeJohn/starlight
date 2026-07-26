import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build as bundle } from 'esbuild';
import { buildPlugin } from '@songloft/plugin-builder';

const root = resolve(import.meta.dirname, '..');
const stage = mkdtempSync(join(root, '.build-stage-'));

try {
  cpSync(join(root, 'src'), join(stage, 'src'), { recursive: true });
  cpSync(join(root, 'static'), join(stage, 'static'), { recursive: true });
  cpSync(join(root, 'plugin.json'), join(stage, 'plugin.json'));
  if (existsSync(join(root, 'icon.png'))) cpSync(join(root, 'icon.png'), join(stage, 'icon.png'));
  if (existsSync(join(root, 'bin'))) cpSync(join(root, 'bin'), join(stage, 'bin'), { recursive: true });

  const staticJs = join(stage, 'static', 'js');
  const bundlePath = join(stage, 'static', 'app.bundle.js');
  await bundle({
    entryPoints: [join(staticJs, 'app.js')],
    outfile: bundlePath,
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2020',
    minify: true,
  });

  rmSync(staticJs, { recursive: true, force: true });
  mkdirSync(staticJs, { recursive: true });
  renameSync(bundlePath, join(staticJs, 'app.bundle.js'));

  const indexPath = join(stage, 'static', 'index.html');
  const html = readFileSync(indexPath, 'utf8');
  const rewritten = html.replace(
    /<script\b[^>]*\bsrc="(?:static\/)?js\/app\.js"[^>]*><\/script>/,
    '<script src="static/js/app.bundle.js"></script>',
  );
  if (rewritten === html) throw new Error('static/index.html does not reference static/js/app.js');
  writeFileSync(indexPath, rewritten);

  await buildPlugin({ cwd: stage, outDir: join(root, 'dist'), mode: 'production' });
} finally {
  rmSync(stage, { recursive: true, force: true });
}
