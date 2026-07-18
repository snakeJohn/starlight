import fs from 'fs';
import path from 'path';

/**
 * Wipe dist/ before packaging so stale hashed CSS/JS from prior builds
 * are not re-zipped into starlight.jsplugin.zip.
 */
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true, force: true });
  console.log('[clean-dist] removed dist/');
} else {
  console.log('[clean-dist] dist/ already clean');
}
