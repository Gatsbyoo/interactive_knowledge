/* 数据自检：在项目根目录运行 `node validate.js`
 * 新增工具课程后跑一次，可检查积木类型、测验答案、
 * 实战任务正确答案数、模拟终端的建议命令是否都有预录输出等。 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const dir = __dirname;
const sandbox = { window: {}, console };
vm.createContext(sandbox);
['data/core.js', 'data/perf.js', 'data/valgrind.js'].forEach(f => {
  vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f });
});
const D = sandbox.window.LAB_DATA;
const known = new Set(D.blockDocs.map(d => d.type));
const errors = [];
const warn = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

ok(D.tools.length >= 1, '至少需要一个工具课程');
D.tools.forEach(t => {
  ok(!!t.id && !!t.name && !!t.color, `${t.id}: 缺少基础字段`);
  ok(/^#[0-9a-fA-F]{6}$/.test(t.color), `${t.id}: color 不是合法 hex`);
  const ids = new Set();
  ok(t.sections.length >= 5, `${t.id}: 章节太少`);
  t.sections.forEach((s, si) => {
    ok(!ids.has(s.id), `${t.id}: 章节 id 重复 ${s.id}`); ids.add(s.id);
    ok(s.blocks && s.blocks.length > 0, `${t.id}/${s.id}: 无 blocks`);
    s.blocks.forEach((b, bi) => {
      const tag = `${t.id}/${s.id}[${bi}]`;
      ok(known.has(b.type), `${tag}: 未知积木 ${b.type}`);
      switch (b.type) {
        case 'terminal': {
          ok(Array.isArray(b.commands) && b.commands.length, `${tag}: 无 commands`);
          const keys = new Set(b.commands.map(c => c.cmd.trim().replace(/\s+/g, ' ')));
          b.commands.forEach(c => {
            ok(Array.isArray(c.out), `${tag}: ${c.cmd} 的 out 不是数组`);
            (c.out || []).forEach((o, i) => {
              if (typeof o === 'string') return;
              ok(o && typeof o === 'object' && typeof o.t === 'string', `${tag}: ${c.cmd} out[${i}] 不是 {t,c}`);
            });
          });
          (b.suggestions || []).forEach(sg => {
            ok(keys.has(sg.trim().replace(/\s+/g, ' ')), `${tag}: 建议命令无预录输出 → ${sg}`);
          });
          break;
        }
        case 'output':
          ok(b.lines && b.lines.length > 0, `${tag}: 无输出行`);
          ok(b.lines.filter(l => l.note).length >= 3, `${tag}: 可解读行太少`);
          b.lines.forEach((l, i) => ok(typeof l.t === 'string', `${tag}: line[${i}].t 非字符串`));
          break;
        case 'quiz':
          ok(b.questions && b.questions.length, `${tag}: 无题目`);
          b.questions.forEach((q, i) => {
            ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, `${tag}: Q${i + 1} answer 越界`);
            ok(!!q.explain, `${tag}: Q${i + 1} 缺解析`);
          });
          break;
        case 'mission':
          b.steps.forEach((s, i) => {
            ok(s.choices.filter(c => c.correct).length === 1, `${tag}: step${i + 1} 正确答案数不是 1`);
            s.choices.forEach(c => ok(!!c.why, `${tag}: step${i + 1} 选项缺 why`));
          });
          ok(!!b.debrief, `${tag}: 缺复盘`);
          break;
        case 'builder':
          ok(b.groups && b.groups.length, `${tag}: 无 groups`);
          b.groups.forEach(g => g.opts.forEach(o => {
            ok(!!o.flag && !!o.desc, `${tag}: 选项缺 flag/desc`);
            if (!o.effect) warn.push(`${tag}: ${o.flag} 缺 effect`);
          }));
          break;
        case 'cmdtable':
          ok(b.rows && b.rows.length, `${tag}: 无命令行`);
          b.rows.forEach(r => ok(!!r.cmd && !!r.desc, `${tag}: 命令行缺字段`));
          break;
        case 'code':
          b.tabs.forEach(tab => ok(typeof tab.code === 'string' && tab.code.length > 20, `${tag}: ${tab.name} 代码为空`));
          break;
        case 'checklist': ok(b.items && b.items.length, `${tag}: 无清单项`); break;
        case 'pitfalls': ok(b.items && b.items.length, `${tag}: 无坑`); break;
        case 'compare': ok(b.head && b.rows, `${tag}: 对比表缺字段`); break;
        case 'cards': case 'roadmap': case 'steps': ok(b.items && b.items.length, `${tag}: 无条目`); break;
        case 'prose': ok(b.paras && b.paras.length, `${tag}: 无段落`); break;
      }
    });
  });
  console.log(`  ${t.id}: ${t.sections.length} 章 / ${t.sections.reduce((n, s) => n + s.blocks.length, 0)} 个积木 / ${t.sections.reduce((n, s) => n + (s.blocks || []).filter(b => b.type === 'cmdtable').reduce((m, b) => m + b.rows.length, 0), 0)} 条速查命令`);
});
const cmds = D.tools.reduce((n, t) => n + t.sections.reduce((m, s) => m + s.blocks.filter(b => b.type === 'cmdtable').reduce((k, b) => k + b.rows.length, 0), 0), 0);
console.log('  全局命令索引:', cmds, '条');
console.log('  测验题数:', D.tools.reduce((n, t) => n + t.sections.reduce((m, s) => m + s.blocks.filter(b => b.type === 'quiz').reduce((k, b) => k + b.questions.length, 0), 0), 0));
if (warn.length) { console.log('\n提醒:'); warn.forEach(w => console.log('  ! ' + w)); }
if (errors.length) { console.log('\n错误:'); errors.forEach(e => console.log('  x ' + e)); process.exit(1); }
console.log('\n数据完整性校验通过');
