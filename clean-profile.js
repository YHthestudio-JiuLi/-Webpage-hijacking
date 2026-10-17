#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ALL = process.argv.includes('--all');

function readConfig() {
  const p = path.join(__dirname, 'config.json');
  if (!fs.existsSync(p)) { console.error(`✗ 找不到 ${p}`); process.exit(1); }
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch (e) { console.error(`✗ config.json 解析失败: ${e.message}`); process.exit(1); }
}

const cfg = readConfig();
const profileDir = path.resolve(__dirname, cfg.userDataDir || './chrome-profile');

const TARGETS = [{ name: 'Chrome profile', path: profileDir }];
if (ALL) {
  TARGETS.push(
    { name: '旧 profile 备份', path: path.resolve(__dirname, 'chrome-profile.bak') },
    { name: '运行日志',       path: path.resolve(__dirname, 'logs') },
    { name: '截图/录屏',      path: path.resolve(__dirname, 'screenshots') },
  );
}

function isDangerous(p) {
  const resolved = path.resolve(p);
  const root = path.parse(resolved).root;
  if (resolved === root) return true;
  if (resolved === __dirname) return true;
  if (resolved === path.dirname(__dirname)) return true;
  const rel = path.relative(__dirname, resolved);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return true;
  return false;
}

function dirSize(dir) {
  let total = 0, files = 0;
  const walk = (d) => {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const fp = path.join(d, e.name);
      try {
        if (e.isDirectory()) walk(fp);
        else { total += fs.statSync(fp).size; files++; }
      } catch {}
    }
  };
  walk(dir);
  return { total, files };
}

function human(bytes) {
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(2)} ${u[i]}`;
}

console.log(`模式: ${DRY ? 'DRY-RUN' : '实际删除'}${ALL ? ' | --all' : ''}`);
console.log(`项目目录: ${__dirname}\n`);

let removed = 0, skipped = 0, totalBytes = 0;
for (const t of TARGETS) {
  const label = `[${t.name}] ${t.path}`;
  if (isDangerous(t.path)) { console.log(`⏭  跳过（危险路径）: ${label}`); skipped++; continue; }
  if (!fs.existsSync(t.path)) { console.log(`⏭  不存在: ${label}`); skipped++; continue; }
  const { total, files } = dirSize(t.path);
  totalBytes += total;
  console.log(`🗑  ${DRY ? '将删除' : '删除中'}: ${label}  (${files} 文件, ${human(total)})`);
  if (!DRY) {
    try { fs.rmSync(t.path, { recursive: true, force: true }); removed++; }
    catch (e) { console.log(`   ✗ 删除失败: ${e.message}`); skipped++; }
  } else removed++;
}

console.log(`\n汇总: 处理 ${removed} 项, 跳过 ${skipped} 项, 共 ${human(totalBytes)}${DRY ? '（未实际删除）' : '（已释放）'}`);

const SENSITIVE = ['.env', 'auth.json', 'cookies.json', 'storageState.json', 'token.txt'];
const hits = SENSITIVE.filter(f => fs.existsSync(path.join(__dirname, f)));
if (hits.length) {
  console.log(`\n⚠ 检测到可能含敏感信息的文件，请手动确认后删除：`);
  hits.forEach(f => console.log(`   - ${f}`));
}
if (DRY) console.log('\n提示：去掉 --dry 才会真正删除。');