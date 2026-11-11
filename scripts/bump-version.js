/* =====================================================================
 * 重算站点内容指纹，必要时更新 version.json
 *
 * 用法：
 *   node scripts/bump-version.js                 # 用默认说明
 *   node scripts/bump-version.js "新增 gdb 课程"  # 自定义本次更新说明
 *   COMMIT_NOTE="commit message" node scripts/bump-version.js  # CI 用
 *
 * 只有 index.html / assets / data 下的文件内容真的变了才写文件，
 * 所以重复运行或在 CI 里跑不会产生无意义的提交。
 * ===================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const VERSION_FILE = path.join(root, 'version.json');

function collect(rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true })
    .filter(e => e.isFile() && /\.(js|css|html)$/.test(e.name))
    .map(e => rel + '/' + e.name);
}

const files = ['index.html'].concat(collect('assets'), collect('data')).sort();
if (!files.length) { console.error('没有找到站点文件，请检查目录结构'); process.exit(1); }

const hash = crypto.createHash('sha256');
for (const f of files) {
  hash.update(f + '\0');
  hash.update(fs.readFileSync(path.join(root, f)));
  hash.update('\0');
}
const revision = hash.digest('hex').slice(0, 12);

let v = {};
try { v = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8')); } catch (e) { /* 首次生成 */ }

const rawNote = (process.env.COMMIT_NOTE || process.argv.slice(2).join(' ') || '').trim();
const note = (rawNote.split('\n')[0] || '').replace(/\s+/g, ' ').slice(0, 160) || '课程内容更新';
const courses = fs.readdirSync(path.join(root, 'data'))
  .filter(f => f.endsWith('.js') && f !== 'core.js')
  .map(f => f.replace(/\.js$/, ''))
  .sort();

if (v.revision === revision) {
  console.log('content unchanged, revision =', revision);
  process.exit(0);
}

let version = v.version || '1.0.0';
if (v.version) {
  const parts = version.split('.').map(Number);
  if (parts.length === 3 && parts.every(Number.isFinite)) {
    parts[2] += 1;
    version = parts.join('.');
  }
}
const build = new Date().toISOString();
const next = {
  version,
  build,
  revision,
  note,
  courses,
  history: [{ build, note, revision }].concat(v.history || []).slice(0, 5)
};
fs.writeFileSync(VERSION_FILE, JSON.stringify(next, null, 2) + '\n');
console.log('version.json updated ->', version, revision, '| files:', files.length, '|', note);
