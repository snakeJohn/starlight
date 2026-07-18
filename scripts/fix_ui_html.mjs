import fs from 'fs';

const path = 'static/index.html';
const raw = fs.readFileSync(path, 'utf8');
const nl = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);

function findLine(predicate, from = 0) {
  for (let i = from; i < lines.length; i++) {
    if (predicate(lines[i], i)) return i;
  }
  return -1;
}

function isBlankOrOnlyCloseDiv(line) {
  return line.trim() === '</div>';
}

// --- 1. Search: remove duplicate source-count block after panel-heading closed
{
  const first = findLine((l) => l.includes('data-role="source-count"'));
  const second = findLine((l) => l.includes('data-role="source-count"'), first + 1);
  if (first >= 0 && second >= 0 && second - first <= 5) {
    // Remove second source-count line and following orphan </div> if present
    const remove = [second];
    if (second + 1 < lines.length && isBlankOrOnlyCloseDiv(lines[second + 1])) {
      remove.push(second + 1);
    }
    for (let i = remove.length - 1; i >= 0; i--) lines.splice(remove[i], 1);
    console.log('ok search-heading: removed lines', remove.map((i) => i + 1).join(','));
  } else {
    console.log('skip search-heading');
  }
}

// --- 2. Speaker: remove duplicate refresh button + orphan </div>
{
  const first = findLine((l) => l.includes('data-action="refresh-speaker"'));
  const second = findLine((l) => l.includes('data-action="refresh-speaker"'), first + 1);
  if (first >= 0 && second >= 0 && second - first <= 5) {
    const remove = [second];
    if (second + 1 < lines.length && isBlankOrOnlyCloseDiv(lines[second + 1])) {
      remove.push(second + 1);
    }
    for (let i = remove.length - 1; i >= 0; i--) lines.splice(remove[i], 1);
    console.log('ok speaker-heading: removed lines', remove.map((i) => i + 1).join(','));
  } else {
    console.log('skip speaker-heading');
  }
}

// --- 3. Rankings: remove premature empty close right after rankings open
{
  const open = findLine((l) => l.includes('data-discover-panel="rankings"'));
  if (open >= 0) {
    // If next non-empty-ish line is just </div>, remove it
    let j = open + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j < lines.length && lines[j].trim() === '</div>') {
      lines.splice(j, 1);
      console.log('ok rankings-open: removed premature close at', j + 1);
    } else {
      console.log('skip rankings-open premature close');
    }
  }
}

// Ensure ranking content is closed with discover-section before tab-playlists.
// After ranking-pagination section + split-view </div>, need one more </div> for rankings panel.
{
  const pag = findLine((l) => l.includes('data-role="ranking-pagination"'));
  const playlists = findLine((l) => l.includes('id="tab-playlists"'));
  if (pag >= 0 && playlists > pag) {
    // Count </div> between pagination and playlists tab open
    const slice = lines.slice(pag, playlists);
    console.log('rankings end region:');
    slice.forEach((l, i) => console.log(`  ${pag + i + 1}|${l}`));
  }
}

// --- 4. Sources: remove premature close after file-button so following sections stay inside panel
{
  const sources = findLine((l) => l.includes('data-settings-panel="sources"'));
  if (sources >= 0) {
    // Find file-button close area: look for </label> after source-file, then </div> that closes panel early
    const fileInput = findLine((l) => l.includes('data-role="source-file"'), sources);
    if (fileInput >= 0) {
      // After "导入文件" </label>, if next is </div> and then <section class="surface-section"> with 已导入音源,
      // remove that </div>
      const afterLabel = findLine((l) => l.includes('导入文件'), fileInput);
      // walk forward a few lines
      for (let i = afterLabel; i < afterLabel + 8 && i < lines.length; i++) {
        if (lines[i].trim() === '</div>') {
          // peek next non-empty
          let k = i + 1;
          while (k < lines.length && lines[k].trim() === '') k++;
          if (k < lines.length && lines[k].includes('<section') && lines.slice(k, k + 8).some((x) => x.includes('已导入音源'))) {
            lines.splice(i, 1);
            console.log('ok sources-wrap: removed premature close at', i + 1);
            break;
          }
        }
      }
    }
  }
}

// --- 5. Logs: remove premature close after inline-actions so diagnostics stay inside panel
{
  const logs = findLine((l) => l.includes('data-settings-panel="logs"'));
  if (logs >= 0) {
    for (let i = logs; i < logs + 15 && i < lines.length; i++) {
      if (lines[i].trim() === '</div>') {
        let k = i + 1;
        while (k < lines.length && lines[k].trim() === '') k++;
        if (k < lines.length && lines[k].includes('<section') && lines.slice(k, k + 8).some((x) => x.includes('音源诊断'))) {
          lines.splice(i, 1);
          console.log('ok logs-wrap: removed premature close at', i + 1);
          break;
        }
      }
    }
  }
}

// --- 6. Favicon
{
  const i = findLine((l) => l.includes('rel="icon"'));
  if (i >= 0) {
    lines[i] = '    <link rel="icon" type="image/png" href="static/icon.png">';
    console.log('ok favicon');
  }
}

const out = lines.join(nl);
// Preserve trailing newline if original had one
const final = raw.endsWith('\n') && !out.endsWith('\n') ? out + nl : out;
fs.writeFileSync(path, final);
console.log('wrote', path);

// Validate
const html = fs.readFileSync(path, 'utf8');
const openDiv = (html.match(/<div\b/g) || []).length;
const closeDiv = (html.match(/<\/div>/g) || []).length;
const openSec = (html.match(/<section\b/g) || []).length;
const closeSec = (html.match(/<\/section>/g) || []).length;
console.log({ openDiv, closeDiv, openSec, closeSec, deltaDiv: openDiv - closeDiv, deltaSec: openSec - closeSec });

function panelHtml(id) {
  const marker = `id="tab-${id}"`;
  const pos = html.indexOf(marker);
  if (pos < 0) return '';
  const start = html.lastIndexOf('<section', pos);
  const next = html.indexOf('<section class="tab-panel', pos + 10);
  const end = next > pos ? next : html.indexOf('</main>', pos);
  return html.slice(start, end);
}

function settingsSection(section) {
  const settings = panelHtml('settings');
  const start = settings.indexOf(`data-settings-panel="${section}"`);
  if (start < 0) return '';
  const nextMarkers = ['sync', 'sources', 'automation', 'ai', 'logs']
    .filter((s) => s !== section)
    .map((s) => settings.indexOf(`data-settings-panel="${s}"`, start + 1))
    .filter((i) => i > start);
  const end = nextMarkers.length ? Math.min(...nextMarkers) : settings.length;
  return settings.slice(start, end);
}

const discover = panelHtml('discover');
const rankStart = discover.indexOf('data-discover-panel="rankings"');
const rankChunk = rankStart >= 0 ? discover.slice(rankStart) : '';

const checks = {
  searchSourceCount: (panelHtml('search').match(/data-role="source-count"/g) || []).length === 1,
  speakerRefresh: (panelHtml('speaker').match(/data-action="refresh-speaker"/g) || []).length === 1,
  rankingsHasList: rankChunk.includes('data-role="ranking-list"'),
  rankingsHasPagination: rankChunk.includes('data-role="ranking-pagination"'),
  sourcesHasDownload: settingsSection('sources').includes('data-role="download-settings-form"'),
  sourcesHasList: settingsSection('sources').includes('data-role="source-list"'),
  sourcesHasProgress: settingsSection('sources').includes('data-role="download-progress"'),
  logsHasDiagnostics: settingsSection('logs').includes('data-role="source-log-list"'),
  automationHasVoice: settingsSection('automation').includes('data-role="voice-command-list"'),
  aiHasForm: settingsSection('ai').includes('data-role="ai-config-form"'),
  faviconPng: html.includes('href="static/icon.png"'),
  balancedDiv: openDiv === closeDiv,
  balancedSec: openSec === closeSec,
};

console.log(checks);
const failed = Object.entries(checks).filter(([, v]) => !v);
if (failed.length) {
  console.error('VALIDATION FAILED', failed.map(([k]) => k));
  process.exit(1);
}
console.log('OK');
