/* =====================================================================
 *  Lab · 系统工具训练场 —— 渲染引擎
 *  职责：把 data/*.js 里的课程数据渲染成交互界面。
 *  新增工具不需要修改本文件。
 * ===================================================================== */
(function () {
  'use strict';

  const DATA = window.LAB_DATA;
  const TOOLS = DATA.tools;
  const LS_KEY = 'lab-training-state-v1';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------------------------- 状态 ---------------------------- */
  function defaults() {
    return { toolId: TOOLS[0].id, sec: {}, done: {}, checks: {}, quiz: {}, missions: {}, reads: {}, theme: 'light' };
  }
  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return Object.assign(defaults(), JSON.parse(raw));
    } catch (e) { /* file:// 或隐私模式下 localStorage 不可用，静默降级 */ }
    return defaults();
  }
  let state = load();
  function save() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* noop */ }
  }
  const builderState = {};   // 命令拼装器状态（页面生命周期内保留）
  const ALL_CMDS = [];

  /* ---------------------------- 工具函数 ---------------------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function md(s) {
    return esc(s)
      .replace(/`([^`]+)`/g, '<code class="inl">$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  }
  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstElementChild || d;
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, 1900);
  }
  function copyText(text) {
    const ok = () => toast('已复制到剪贴板');
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); ok(); } catch (e) { toast('复制失败，请手动选中'); }
      ta.remove();
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(ok).catch(fallback);
    } else fallback();
  }
  function mixHex(hex, base, ratio) {
    const a = hex.replace('#', ''), b = base.replace('#', '');
    const out = [0, 2, 4].map(i => {
      const v = parseInt(a.slice(i, i + 2), 16) * ratio + parseInt(b.slice(i, i + 2), 16) * (1 - ratio);
      return Math.round(v).toString(16).padStart(2, '0');
    });
    return '#' + out.join('');
  }
  function applyAccent(tool) {
    // 写在 body 的内联样式上，优先级高于 body[data-theme] 里的默认配色
    const root = document.body.style;
    const surface = state.theme === 'dark' ? '#161f2f' : '#ffffff';
    root.setProperty('--accent', tool.color);
    root.setProperty('--accent-soft', mixHex(tool.color, surface, 0.11));
    root.setProperty('--accent-line', mixHex(tool.color, surface, 0.34));
  }
  function getTool() { return TOOLS.find(t => t.id === state.toolId) || TOOLS[0]; }
  function curSecId(tool) {
    const id = state.sec[tool.id];
    return tool.sections.some(s => s.id === id) ? id : tool.sections[0].id;
  }
  function secIndex(tool) { return tool.sections.findIndex(s => s.id === curSecId(tool)); }
  function doneList(tool) { return state.done[tool.id] || (state.done[tool.id] = []); }

  /* 全局复制按钮（事件委托） */
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-copy]');
    if (b) { e.preventDefault(); copyText(b.getAttribute('data-copy')); }
  });

  /* ==================================================================
   *  积木渲染器
   * ================================================================== */
  function renderBlock(block, ctx) {
    switch (block.type) {
      case 'prose': return renderProse(block);
      case 'cards': return renderCards(block);
      case 'roadmap': return renderRoadmap(block);
      case 'steps': return renderSteps(block);
      case 'code': return renderCode(block, ctx);
      case 'terminal': return renderTerminal(block, ctx);
      case 'output': return renderOutput(block, ctx);
      case 'cmdtable': return renderCmdTable(block);
      case 'builder': return renderBuilder(block, ctx);
      case 'mission': return renderMission(block, ctx);
      case 'pitfalls': return renderPitfalls(block);
      case 'compare': return renderCompare(block);
      case 'quiz': return renderQuiz(block);
      case 'checklist': return renderChecklist(block);
      default: return el('<div class="note warn"><span class="note-ico">!</span><div>未知积木类型：' + esc(block.type) + '</div></div>');
    }
  }
  function blockShell(title, lead, bodyHtml) {
    return el('<section class="blk">' +
      (title ? '<h3 class="blk-title">' + esc(title) + '</h3>' : '') +
      (lead ? '<p class="blk-lead">' + md(lead) + '</p>' : '') +
      '<div class="blk-body">' + bodyHtml + '</div></section>');
  }

  function renderProse(b) {
    let h = '<div class="prose">' + (b.paras || []).map(p => '<p>' + md(p) + '</p>').join('') + '</div>';
    if (b.note) {
      const ico = b.note.kind === 'warn' ? '!' : (b.note.kind === 'ok' ? '✓' : 'i');
      h += '<div class="note ' + esc(b.note.kind || 'info') + '"><span class="note-ico">' + ico + '</span><div>' +
        (b.note.title ? '<b>' + esc(b.note.title) + '</b>' : '') + md(b.note.text || '') + '</div></div>';
    }
    return blockShell(b.title, b.lead, h);
  }
  function renderCards(b) {
    const h = '<div class="cards">' + (b.items || []).map(it =>
      '<div class="card ' + esc(it.tone || '') + '"><div class="c-ico">' + esc(it.icon) + '</div>' +
      '<h4>' + esc(it.title) + '</h4><p>' + md(it.text) + '</p></div>').join('') + '</div>';
    return blockShell(b.title, b.lead, h);
  }
  function renderRoadmap(b) {
    const h = '<div class="roadmap">' + (b.items || []).map((it, i) =>
      '<div class="road-item"><div class="road-num">' + String(i + 1).padStart(2, '0') + '</div>' +
      '<div class="road-body"><div><b>' + esc(it.title) + '</b><p>' + md(it.text) + '</p></div>' +
      (it.mins ? '<span class="road-mins">~' + esc(it.mins) + ' min</span>' : '') + '</div></div>').join('') + '</div>';
    return blockShell(b.title, b.lead, h);
  }
  function snippet(text) {
    return '<div class="snippet"><pre><code>' + esc(text) + '</code></pre>' +
      '<button class="copy-btn" data-copy="' + esc(text) + '">复制</button></div>';
  }
  function renderSteps(b) {
    const h = '<div class="steps">' + (b.items || []).map((it, i) =>
      '<div class="step"><div class="step-n">' + (i + 1) + '</div><div class="step-body">' +
      '<b>' + esc(it.title) + '</b><p>' + md(it.text) + '</p>' +
      (it.cmd ? '<div class="step-cmd">' + snippet(it.cmd) + '</div>' : '') + '</div></div>').join('') + '</div>';
    return blockShell(b.title, b.lead, h);
  }
  function renderCode(b, ctx) {
    const tabs = b.tabs || [];
    const key = ctx.key;
    let active = builderState['tab_' + key] || 0;
    if (active >= tabs.length) active = 0;
    const node = el('<section class="blk">' +
      (b.title ? '<h3 class="blk-title">' + esc(b.title) + '</h3>' : '') +
      '<div class="blk-body"><div class="codebox"><div class="codebox-head">' +
      tabs.map((t, i) => '<button class="code-tab' + (i === active ? ' active' : '') + '" data-tab="' + i + '">' + esc(t.name) + '</button>').join('') +
      '<button class="copy-btn" data-copy="">复制代码</button></div>' +
      '<pre><code></code></pre></div>' +
      (b.note ? '<div class="code-note">' + md(b.note) + '</div>' : '') + '</div></section>');
    const pre = $('pre code', node), copyBtn = $('.copy-btn', node);
    function show(i) {
      active = i; builderState['tab_' + key] = i;
      $$('.code-tab', node).forEach((btn, n) => btn.classList.toggle('active', n === i));
      pre.textContent = tabs[i].code;
      copyBtn.setAttribute('data-copy', tabs[i].code);
    }
    $$('.code-tab', node).forEach(btn => btn.addEventListener('click', () => show(+btn.dataset.tab)));
    show(active);
    return node;
  }

  /* --------------------------- 模拟终端 --------------------------- */
  function renderTerminal(b, ctx) {
    const node = el('<section class="blk">' +
      (b.title ? '<h3 class="blk-title">' + esc(b.title) + '</h3>' : '') +
      '<div class="blk-body"><div class="terminal"><div class="term-head">' +
      '<div class="term-dots"><i></i><i></i><i></i></div>' +
      '<span class="ttl">' + esc(b.id || 'shell') + '</span><span class="tag">模拟终端 · 可输入</span></div>' +
      '<div class="term-body"></div>' +
      '<div class="term-input-row"><span class="term-prompt">' + esc(b.prompt || '$') + '</span>' +
      '<input class="term-input" type="text" spellcheck="false" autocomplete="off" placeholder="输入命令后回车，或点下方建议…"></div>' +
      '<div class="term-suggest"><span class="sg-label">试试：</span>' +
      (b.suggestions || []).map(c => '<button class="term-chip" data-cmd="' + esc(c) + '">' + esc(c) + '</button>').join('') +
      '</div></div></div></section>');
    const body = $('.term-body', node), input = $('.term-input', node);
    const norm = s => String(s || '').trim().replace(/\s+/g, ' ');
    const map = new Map((b.commands || []).map(c => [norm(c.cmd), c]));
    const history = []; let hIdx = 0;

    function line(text, cls) {
      const d = document.createElement('div');
      d.className = 't-line' + (cls ? ' c-' + cls : '');
      d.textContent = text === '' ? '\u00a0' : text;
      body.appendChild(d);
      body.scrollTop = body.scrollHeight;
      return d;
    }
    function echo(cmd) {
      const d = document.createElement('div');
      d.className = 't-line cmd-echo';
      const p = document.createElement('span'); p.className = 'pr'; p.textContent = (b.prompt || '$') + ' ';
      d.appendChild(p); d.appendChild(document.createTextNode(cmd));
      body.appendChild(d); body.scrollTop = body.scrollHeight;
    }
    function printOut(out) {
      (out || []).forEach(o => {
        if (typeof o === 'string') line(o, '');
        else line(o.t == null ? '' : o.t, o.c || '');
      });
    }
    function run(raw) {
      const cmd = norm(raw);
      if (!cmd) return;
      echo(cmd);
      history.push(cmd); hIdx = history.length;
      if (cmd === 'clear' || cmd === 'cls') { body.innerHTML = ''; return; }
      if (cmd === 'help' || cmd === '?') {
        line('可用命令（点击终端下方的按钮可直接执行）：', 'head');
        Array.from(map.keys()).forEach((c, i) => line('  ' + String(i + 1).padStart(2, '0') + '  ' + c, 'dim'));
        line('  clear 清空 · ↑/↓ 翻历史', 'accent');
        return;
      }
      const hit = map.get(cmd);
      if (hit) { printOut(hit.out); return; }
      // 宽松匹配：允许命令后带额外说明或大小写不同
      const loose = Array.from(map.keys()).find(k => k.toLowerCase() === cmd.toLowerCase());
      if (loose) { printOut(map.get(loose).out); return; }
      line('lab-shell: 这个实验室只模拟了预录命令，没有「' + cmd + '」的输出。', 'unknown');
      line('输入 help 查看全部可用命令，或点下方的建议按钮。', 'dim');
    }
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { run(input.value); input.value = ''; }
      else if (e.key === 'ArrowUp') { e.preventDefault(); if (hIdx > 0) input.value = history[--hIdx] || ''; }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (hIdx < history.length - 1) input.value = history[++hIdx] || ''; else { hIdx = history.length; input.value = ''; } }
    });
    $$('.term-chip', node).forEach(chip => chip.addEventListener('click', () => { run(chip.dataset.cmd); input.focus(); }));
    node.addEventListener('click', e => { if (e.target.closest('.term-body') || e.target.closest('.term-input-row')) input.focus(); });
    if (b.intro) line(b.intro, 'dim');
    line('输入 help 查看可用命令 · ↑/↓ 翻历史 · clear 清空', 'dim');
    return node;
  }

  /* --------------------------- 输出逐行解读 --------------------------- */
  function renderOutput(b, ctx) {
    const lines = b.lines || [];
    const noted = lines.filter(l => l.note).length;
    const key = ctx.key;
    const readSet = new Set(state.reads[key] || []);
    const node = el('<section class="blk">' +
      (b.title ? '<h3 class="blk-title">' + esc(b.title) + '</h3>' : '') +
      (b.subtitle ? '<p class="blk-lead">' + md(b.subtitle) + '</p>' : '') +
      '<div class="blk-body"><div class="out-reader"><div class="out-panel">' +
      '<div class="out-panel-head"><b>' + esc(b.title || 'OUTPUT') + '</b><span class="legend">带 ● 且下划线的行可点击解读</span></div>' +
      '<div class="out-lines">' + lines.map((l, i) =>
        '<button class="out-line ' + esc(l.c || '') + (l.note ? ' has-note' : '') + '" data-i="' + i + '"' +
        (l.note ? '' : ' disabled') + '>' + (l.t === '' ? '<span class="empty">&nbsp;</span>' : esc(l.t)) + '</button>').join('') +
      '</div></div>' +
      '<div class="out-detail"><div class="d-label">LINE INSIGHT</div>' +
      '<div class="d-empty">点左侧任意带 ● 的行，这里会解释这一行在说什么、以及能推断出什么结论。</div>' +
      '</div></div></div></section>');
    const detail = $('.out-detail', node);
    function setCount() {
      const c = $('.d-count', detail);
      if (c) c.textContent = '已解读 ' + readSet.size + ' / ' + noted + ' 条';
    }
    $$('.out-line.has-note', node).forEach(btn => {
      btn.addEventListener('click', () => {
        const i = +btn.dataset.i, l = lines[i];
        $$('.out-line', node).forEach(x => x.classList.remove('selected'));
        btn.classList.add('selected');
        readSet.add(i); state.reads[key] = Array.from(readSet); save();
        detail.innerHTML = '<div class="d-label">LINE INSIGHT · 第 ' + (i + 1) + ' 行</div>' +
          '<div class="d-code">' + esc(l.t) + '</div>' +
          '<div class="d-text">' + md(l.note) + '</div>' +
          '<div class="d-count"></div>';
        setCount();
      });
    });
    return node;
  }

  /* --------------------------- 命令速查表 --------------------------- */
  function renderCmdTable(b) {
    const rows = b.rows || [];
    const node = el('<section class="blk">' +
      (b.title ? '<h3 class="blk-title">' + esc(b.title) + '</h3>' : '') +
      '<div class="blk-body"><div class="table-tools"><input type="search" placeholder="在本表中筛选命令…" autocomplete="off">' +
      '<span class="cnt"></span></div><div class="cmd-list"></div></div></section>');
    const list = $('.cmd-list', node), input = $('.table-tools input', node), cnt = $('.cnt', node);
    function draw(q) {
      const term = (q || '').toLowerCase();
      const found = rows.filter(r => (r.cmd + ' ' + r.desc + ' ' + (r.tip || '') + ' ' + (r.tag || '')).toLowerCase().includes(term));
      list.innerHTML = found.length ? found.map(r =>
        '<div class="cmd-row"><div class="cmd-main"><code>' + esc(r.cmd) + '</code>' +
        '<button class="cmd-copy" data-copy="' + esc(r.cmd) + '" title="复制">⧉</button></div>' +
        '<div class="cmd-desc">' + esc(r.desc) + (r.tip ? '<small>' + md(r.tip) + '</small>' : '') + '</div>' +
        '<span class="cmd-tag">' + esc(r.tag || '') + '</span></div>').join('')
        : '<div class="empty-state">没有匹配的命令，换个关键词试试</div>';
      cnt.textContent = found.length + ' / ' + rows.length;
    }
    input.addEventListener('input', () => draw(input.value));
    draw('');
    return node;
  }

  /* --------------------------- 命令拼装器 --------------------------- */
  function renderBuilder(b, ctx) {
    const key = ctx.key;
    if (!builderState[key]) {
      builderState[key] = (b.groups || []).map(g => g.opts.map(o => !!o.on));
    }
    const node = el('<section class="blk">' +
      (b.title ? '<h3 class="blk-title">' + esc(b.title) + '</h3>' : '') +
      '<div class="blk-body"><div class="builder"><div class="b-groups">' +
      (b.groups || []).map((g, gi) => {
        const single = g.opts.length > 1 && g.opts.every(o => o.flag.indexOf('--tool=') === 0);
        return '<div class="b-group"><label>' + esc(g.label) + '</label><div class="b-opts">' +
          g.opts.map((o, oi) =>
            '<label class="b-opt' + (builderState[key][gi][oi] ? ' on' : '') + '">' +
            '<input type="' + (single ? 'radio' : 'checkbox') + '" name="' + esc(key + '-' + gi) + '" data-g="' + gi + '" data-o="' + oi + '"' +
            (builderState[key][gi][oi] ? ' checked' : '') + '>' +
            '<span><b>' + esc(o.label || o.flag) + '</b><small>' + esc(o.desc || '') + '</small></span></label>').join('') +
          '</div></div>';
      }).join('') +
      '</div><div class="b-result"><div class="lbl">生成的命令</div><div class="b-cmdline"><code></code><button class="copy-btn" data-copy="">复制</button></div></div>' +
      '<div class="b-effects"><h5>这条命令会给你什么</h5><ul></ul></div></div></div></section>');
    const codeEl = $('.b-cmdline code', node), copyBtn = $('.b-cmdline .copy-btn', node), eff = $('.b-effects ul', node);
    function update() {
      const flags = [];
      const effects = [];
      (b.groups || []).forEach((g, gi) => g.opts.forEach((o, oi) => {
        if (builderState[key][gi][oi]) { flags.push(o.flag); if (o.effect) effects.push(o.effect); }
      }));
      const cmd = [b.base].concat(flags).join(' ');
      codeEl.textContent = cmd;
      copyBtn.setAttribute('data-copy', cmd);
      eff.innerHTML = effects.length ? effects.map(e => '<li>' + md(e) + '</li>').join('')
        : '<li>当前是默认行为：直接运行，没有附加观测项。</li>';
    }
    $$('.b-opt input', node).forEach(inp => inp.addEventListener('change', () => {
      const gi = +inp.dataset.g, oi = +inp.dataset.o;
      const single = inp.type === 'radio';
      if (single) builderState[key][gi] = builderState[key][gi].map(() => false);
      builderState[key][gi][oi] = inp.checked;
      $$('.b-opt', node).forEach((lab, i) => { /* 复位样式 */ });
      // 依据状态刷新所有 opt 的选中样式
      $$('.b-opt', node).forEach(lab => {
        const box = lab.querySelector('input');
        lab.classList.toggle('on', box.checked);
      });
      update();
    }));
    update();
    return node;
  }

  /* --------------------------- 实战任务 --------------------------- */
  function renderMission(b, ctx) {
    const key = ctx.key;
    if (!state.missions[key]) state.missions[key] = { step: 0, wrong: [], finished: false };
    const node = el('<div></div>');
    function draw() {
      const st = state.missions[key];
      const steps = b.steps || [];
      const pct = Math.round((st.finished ? steps.length : st.step) / steps.length * 100);
      let h = '<section class="blk"><h3 class="blk-title">' + esc(b.title) + '</h3>' +
        '<div class="blk-body"><div class="mission"><div class="m-scenario"><b>场景 · </b>' + md(b.scenario) + '</div>' +
        '<div class="m-progress"><i style="width:' + pct + '%"></i></div><div class="m-body">';
      if (st.finished) {
        h += '<div class="m-step-label">MISSION COMPLETE</div><div class="m-goal">四步都走对了。</div>' +
          '<div class="m-debrief" style="border:1px solid var(--border);border-radius:10px"><h4>复盘</h4>' + md(b.debrief || '') + '</div>' +
          '<div class="m-actions"><button class="btn ghost" data-restart="1">重新做一遍</button><span class="m-hint">也可以切换章节，进度会保留</span></div>';
      } else {
        const s = steps[st.step];
        h += '<div class="m-step-label">STEP ' + (st.step + 1) + ' / ' + steps.length + '</div>' +
          '<div class="m-goal">' + md(s.goal) + '</div>' +
          '<div class="m-choices">' + s.choices.map((c, i) =>
            '<button class="m-choice" data-c="' + i + '"><span class="k">' + String.fromCharCode(65 + i) + '</span><code>' + esc(c.cmd) + '</code></button>').join('') + '</div>' +
          (s.hint ? '<div class="m-hint" style="margin-top:10px">提示：' + md(s.hint) + '</div>' : '') +
          '<div class="m-feedback-slot"></div>';
      }
      h += '</div></div></div></section>';
      node.innerHTML = h;
      const root = node.firstElementChild || node;
      $$('.m-choice', root).forEach(btn => btn.addEventListener('click', () => {
        const i = +btn.dataset.c, choice = steps[st.step].choices[i];
        const slot = $('.m-feedback-slot', root);
        $$('.m-choice', root).forEach(x => { x.classList.remove('correct', 'wrong'); });
        btn.classList.add(choice.correct ? 'correct' : 'wrong');
        slot.innerHTML = '<div class="m-feedback ' + (choice.correct ? 'ok' : 'no') + '">' + md(choice.why || '') + '</div>' +
          (choice.correct ? '<div class="m-actions"><button class="btn" data-next="1">' +
            (st.step >= steps.length - 1 ? '完成任务' : '下一步 →') + '</button></div>' : '');
        const next = $('[data-next]', slot);
        if (next) next.addEventListener('click', () => {
          st.step++;
          if (st.step >= steps.length) st.finished = true;
          save(); draw();
        });
      }));
      const restart = $('[data-restart]', root);
      if (restart) restart.addEventListener('click', () => { state.missions[key] = { step: 0, wrong: [], finished: false }; save(); draw(); });
    }
    draw();
    // 必须返回外层容器：draw() 会重写它的 innerHTML，
    // 若返回子节点，重绘后的内容不会出现在页面上。
    return node;
  }

  /* --------------------------- 坑 / 对比 --------------------------- */
  function renderPitfalls(b) {
    const h = '<div class="pitfall-list">' + (b.items || []).map(it =>
      '<details class="pitfall"><summary>' + esc(it.q) + '</summary><div class="pitfall-body">' + md(it.a) +
      (it.fix ? '<div class="fix"><b>解法 · </b>' + md(it.fix) + '</div>' : '') + '</div></details>').join('') + '</div>';
    return blockShell(b.title, b.lead, h);
  }
  function renderCompare(b) {
    const h = '<div class="compare-wrap"><table class="compare"><thead><tr>' +
      (b.head || []).map(x => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody>' +
      (b.rows || []).map(r => '<tr>' + r.map(c => '<td>' + md(c) + '</td>').join('') + '</tr>').join('') +
      '</tbody></table></div>';
    return blockShell(b.title, b.lead, h);
  }

  /* --------------------------- 测验 --------------------------- */
  function renderQuiz(b) {
    const id = b.id;
    if (!state.quiz[id]) state.quiz[id] = { cur: 0, answers: [], done: false };
    const node = el('<div></div>');
    function draw() {
      const st = state.quiz[id], qs = b.questions || [];
      const correct = st.answers.filter((a, i) => a === qs[i].answer).length;
      let h = '<section class="blk"><h3 class="blk-title">' + esc(b.title) + '</h3><div class="blk-body"><div class="quiz-box">';
      if (st.done) {
        const pct = Math.round(correct / qs.length * 100);
        const comment = pct === 100 ? '满分。心智模型已经立住了，可以去真实项目里练手了。'
          : pct >= 75 ? '很稳。把答错的那两题对应的章节再点开看一遍就够。'
            : pct >= 50 ? '框架有了，但读输出和参数选择还需要再过一遍。'
              : '建议回到「心智模型」和「读懂输出」两章重看，再来做一次。';
        h += '<div class="q-result"><div class="big">' + correct + ' / ' + qs.length + '</div>' +
          '<p>' + esc(comment) + '</p><button class="btn ghost" data-retry="1">重做一遍</button></div>';
      } else {
        const q = qs[st.cur], answered = st.answers[st.cur] !== undefined;
        h += '<div class="q-head"><span class="q-num">Q' + String(st.cur + 1).padStart(2, '0') + ' / ' + qs.length + '</span>' +
          '<div class="q-bar"><i style="width:' + Math.round(st.cur / qs.length * 100) + '%"></i></div>' +
          '<span class="q-score">已答对 ' + correct + '</span></div><div class="q-body">' +
          '<div class="q-text">' + md(q.q) + '</div><div class="q-options">' +
          q.options.map((o, i) => {
            let cls = '';
            if (answered) {
              if (i === q.answer) cls = 'correct';
              else if (i === st.answers[st.cur]) cls = 'wrong';
            }
            return '<button class="q-opt ' + cls + '" data-o="' + i + '"' + (answered ? ' disabled' : '') + '>' +
              '<span class="k">' + String.fromCharCode(65 + i) + '</span><span>' + md(o) + '</span></button>';
          }).join('') + '</div>';
        if (answered) {
          h += '<div class="q-explain"><b>' + (st.answers[st.cur] === q.answer ? '答对了 · ' : '再想想 · ') + '</b>' + md(q.explain) + '</div>' +
            '<div class="q-actions"><button class="btn" data-nextq="1">' + (st.cur >= qs.length - 1 ? '查看成绩 →' : '下一题 →') + '</button></div>';
        }
        h += '</div>';
      }
      h += '</div></div></section>';
      node.innerHTML = h;
      const root = node.firstElementChild || node;
      $$('.q-opt:not([disabled])', root).forEach(btn => btn.addEventListener('click', () => {
        st.answers[st.cur] = +btn.dataset.o; save(); draw();
      }));
      const next = $('[data-nextq]', root);
      if (next) next.addEventListener('click', () => { st.cur++; if (st.cur >= qs.length) st.done = true; save(); draw(); });
      const retry = $('[data-retry]', root);
      if (retry) retry.addEventListener('click', () => { state.quiz[id] = { cur: 0, answers: [], done: false }; save(); draw(); });
    }
    draw();
    return node; // 返回外层容器，保证 draw() 重绘能反映到页面
  }

  /* --------------------------- 结业清单 --------------------------- */
  function renderChecklist(b) {
    const id = b.id;
    if (!state.checks[id]) state.checks[id] = [];
    const node = el('<section class="blk"><h3 class="blk-title">' + esc(b.title) + '</h3>' +
      '<div class="blk-body"><div class="checklist">' +
      (b.items || []).map((it, i) =>
        '<label class="check-row' + (state.checks[id].includes(i) ? ' done' : '') + '">' +
        '<input type="checkbox" data-i="' + i + '"' + (state.checks[id].includes(i) ? ' checked' : '') + '>' +
        '<span><b>' + md(it.text) + '</b>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + '</span></label>').join('') +
      '</div></div></section>');
    $$('.check-row input', node).forEach(inp => inp.addEventListener('change', () => {
      const i = +inp.dataset.i, arr = state.checks[id];
      if (inp.checked) { if (!arr.includes(i)) arr.push(i); }
      else state.checks[id] = arr.filter(x => x !== i);
      inp.closest('.check-row').classList.toggle('done', inp.checked);
      save();
    }));
    return node;
  }

  /* ==================================================================
   *  页面骨架
   * ================================================================== */
  function renderTabs() {
    $('#toolTabs').innerHTML = TOOLS.map(t => {
      const d = (state.done[t.id] || []).length;
      return '<button class="tool-tab' + (t.id === state.toolId ? ' active' : '') + '" data-tool="' + esc(t.id) + '">' +
        '<span class="tab-ico">' + esc(t.icon) + '</span><span>' + esc(t.name) + '</span>' +
        '<span class="tab-badge">' + d + '/' + t.sections.length + '</span></button>';
    }).join('');
    $$('.tool-tab').forEach(btn => btn.addEventListener('click', () => {
      state.toolId = btn.dataset.tool; save(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  function renderSidebar(tool) {
    $('#sideToolName').textContent = tool.name + ' · ' + tool.level;
    $('#sideMeta').textContent = tool.sections.length + ' 章 · 约 ' + tool.minutes + ' 分钟';
    const cur = curSecId(tool), done = doneList(tool);
    $('#chapterNav').innerHTML = tool.sections.map((s, i) =>
      '<button class="chap' + (s.id === cur ? ' active' : '') + (done.includes(s.id) ? ' done' : '') + '" data-sec="' + esc(s.id) + '">' +
      '<span class="n">' + String(i + 1).padStart(2, '0') + '</span><span>' + esc(s.title) + '</span>' +
      '<span class="mins">' + (s.minutes || '') + 'm</span><span class="dot"></span></button>').join('');
    $$('.chap').forEach(btn => btn.addEventListener('click', () => {
      state.sec[tool.id] = btn.dataset.sec; save(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
  }

  function renderProgress(tool) {
    const done = doneList(tool), total = tool.sections.length;
    const pct = Math.round(done.length / total * 100);
    $('#sideBar').style.width = pct + '%';
    $('#sidePct').textContent = pct + '%';
    const C = 2 * Math.PI * 16;
    $('#progressWrap').innerHTML =
      '<svg width="40" height="40" viewBox="0 0 40 40">' +
      '<circle cx="20" cy="20" r="16" fill="none" stroke="var(--surface-3)" stroke-width="4"></circle>' +
      '<circle cx="20" cy="20" r="16" fill="none" stroke="var(--accent)" stroke-width="4" stroke-linecap="round" ' +
      'stroke-dasharray="' + C.toFixed(2) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(2) + '"></circle></svg>' +
      '<div class="pct">' + pct + '%</div>';
    $('#progressWrap').title = tool.name + '：已完成 ' + done.length + ' / ' + total + ' 章';
  }

  function renderIntro(tool) {
    return '<div class="section-intro"><div class="intro-top"><div class="intro-ico">' + esc(tool.icon) + '</div>' +
      '<div><h2>' + esc(tool.name) + ' · ' + esc(tool.tagline) + '</h2>' +
      '<p class="tagline">' + esc(tool.level) + '</p></div></div>' +
      '<p class="intro-summary">' + md(tool.summary) + '</p>' +
      '<div class="intro-cols"><div><h4>学完你能</h4><ul>' + (tool.goals || []).map(g => '<li>' + md(g) + '</li>').join('') + '</ul></div>' +
      '<div><h4>需要准备</h4><ul>' + (tool.prereq || []).map(p => '<li>' + md(p) + '</li>').join('') + '</ul></div></div></div>';
  }

  function renderSection(tool) {
    const idx = secIndex(tool), sec = tool.sections[idx];
    const host = $('#content');
    host.innerHTML =
      '<div class="sec-head"><div class="sec-kicker">' + esc(sec.kicker || 'SECTION') + ' · ' + String(idx + 1).padStart(2, '0') + ' / ' + tool.sections.length + '</div>' +
      '<h1>' + esc(sec.title) + '</h1><div class="sec-sub">' + esc(tool.name) + ' 课程 · 约 ' + (sec.minutes || 5) + ' 分钟 · ' + (sec.blocks || []).length + ' 个互动模块</div>' +
      '<div class="sec-tools"><span class="pill">' + esc(DATA.meta.subtitle) + '</span></div></div>' +
      (idx === 0 ? renderIntro(tool) : '') +
      '<div id="blocks"></div>' +
      '<div class="sec-foot"><button class="btn ghost" id="prevSec"' + (idx === 0 ? ' disabled' : '') + '>← 上一章</button>' +
      '<button class="done-btn' + (doneList(tool).includes(sec.id) ? ' is-done' : '') + '" id="doneSec">' +
      (doneList(tool).includes(sec.id) ? '✓ 本章已完成（点击取消）' : '标记本章已完成') + '</button>' +
      '<span class="spacer"></span><button class="btn" id="nextSec">' + nextLabel(tool, idx) + '</button></div>';

    const blocksHost = $('#blocks');
    (sec.blocks || []).forEach((b, i) => {
      const ctx = { key: tool.id + '/' + sec.id + '/' + i };
      try { blocksHost.appendChild(renderBlock(b, ctx)); }
      catch (err) {
        console.error('渲染积木失败', b.type, err);
        blocksHost.appendChild(el('<div class="note warn"><span class="note-ico">!</span><div>模块渲染失败：' + esc(b.type) + '</div></div>'));
      }
    });

    $('#prevSec').addEventListener('click', () => goto(tool, idx - 1));
    $('#nextSec').addEventListener('click', () => {
      if (idx < tool.sections.length - 1) goto(tool, idx + 1);
      else {
        const ni = TOOLS.findIndex(t => t.id === tool.id) + 1;
        if (ni < TOOLS.length) { state.toolId = TOOLS[ni].id; state.sec[state.toolId] = TOOLS[ni].sections[0].id; save(); render(); }
        else { state.sec[tool.id] = tool.sections[0].id; save(); render(); toast('已经是最后一章，回到课程开头'); }
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
    $('#doneSec').addEventListener('click', () => {
      const list = doneList(tool);
      if (list.includes(sec.id)) state.done[tool.id] = list.filter(x => x !== sec.id);
      else list.push(sec.id);
      save(); render();
    });
  }
  function nextLabel(tool, idx) {
    if (idx < tool.sections.length - 1) return '下一章：' + tool.sections[idx + 1].title + ' →';
    const ni = TOOLS.findIndex(t => t.id === tool.id) + 1;
    return ni < TOOLS.length ? '切换到 ' + TOOLS[ni].name + ' 课程 →' : '回到开头 ↺';
  }
  function goto(tool, idx) {
    if (idx < 0 || idx >= tool.sections.length) return;
    state.sec[tool.id] = tool.sections[idx].id; save(); render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ==================================================================
   *  全局命令速查 & 扩展指南
   * ================================================================== */
  function buildCommandIndex() {
    TOOLS.forEach(t => t.sections.forEach(s => (s.blocks || []).forEach(b => {
      if (b.type === 'cmdtable') (b.rows || []).forEach(r => ALL_CMDS.push({
        tool: t.name, cmd: r.cmd, desc: r.desc, tip: r.tip || '', tag: r.tag || ''
      }));
    })));
  }
  function openDrawer(which) {
    $('#overlay').hidden = false;
    $('#drawerSearch').hidden = which !== 'search';
    $('#drawerExtend').hidden = which !== 'extend';
    if (which === 'search') { $('#globalSearch').focus(); drawGlobalSearch($('#globalSearch').value); }
    if (which === 'extend') drawExtend();
  }
  function closeDrawer() {
    $('#overlay').hidden = true;
    $('#drawerSearch').hidden = true;
    $('#drawerExtend').hidden = true;
  }
  function drawGlobalSearch(q) {
    const term = (q || '').trim().toLowerCase();
    const found = ALL_CMDS.filter(c => (c.tool + ' ' + c.cmd + ' ' + c.desc + ' ' + c.tip + ' ' + c.tag).toLowerCase().includes(term));
    $('#searchCount').textContent = found.length + ' 条';
    $('#searchResults').innerHTML = found.length ? found.slice(0, 120).map(c =>
      '<div class="g-result"><div class="g-top"><span class="g-tool">' + esc(c.tool) + '</span><code>' + esc(c.cmd) + '</code>' +
      '<button class="copy-btn" data-copy="' + esc(c.cmd) + '">复制</button></div>' +
      '<div class="g-desc">' + esc(c.desc) + '</div>' + (c.tip ? '<div class="g-tip">💡 ' + md(c.tip) + '</div>' : '') + '</div>').join('')
      : '<div class="empty-state">没有匹配的命令。试试 cache、leak、record、CI、suppress……</div>';
  }
  function drawExtend() {
    const docs = DATA.blockDocs.map(d =>
      '<div class="docs-row"><div><code>' + esc(d.type) + '</code></div><div><span>' + esc(d.desc) + '</span><small>' + esc(d.fields) + '</small></div></div>').join('');
    $('#extendBody').innerHTML =
      '<div class="ext-section"><h3>它是怎么组织的</h3>' +
      '<p><b>界面和内容完全分离。</b><code class="inl">assets/app.js</code> 只负责把 14 种「积木」渲染成交互组件；所有课程内容都在 <code class="inl">data/*.js</code> 里，以纯数据描述。' +
      '所以 <code class="inl">perf.js</code> 和 <code class="inl">valgrind.js</code> 用的是同一套章节骨架，未来的 gdb / strace / sanitizers / eBPF 也可以直接复用。</p>' +
      '<div class="ext-steps">' +
      '<div class="ext-step"><b>1</b><div>新建 <code class="inl">data/gdb.js</code>，复制下面的模板，把 sections 换成新工具的内容。</div></div>' +
      '<div class="ext-step"><b>2</b><div>在 <code class="inl">index.html</code> 底部、<code class="inl">app.js</code> 之前加一行 <code class="inl">&lt;script src="data/gdb.js"&gt;&lt;/script&gt;</code>。</div></div>' +
      '<div class="ext-step"><b>3</b><div>在项目根目录跑 <code class="inl">node validate.js</code> 做一次数据自检（积木类型、测验答案、模拟命令是否都有预录输出等）。</div></div>' +
      '<div class="ext-step"><b>4</b><div>刷新页面。工具切换栏、章节导航、进度、全局命令速查会自动出现，<b style="color:var(--text)">不需要改 app.js 或 CSS</b>。</div></div>' +
      '</div>' +
      '<p style="font-size:11.5px;color:var(--text-3)">纯静态、零依赖、零构建：双击 index.html 就能用。进度按工具 id 存在浏览器 localStorage（key: <code class="inl">' + LS_KEY + '</code>），换工具不会互相干扰。</p></div>' +
      '<div class="ext-section"><h3>可用的积木类型</h3><p>章节里的 <code class="inl">blocks: []</code> 可以自由组合下面任意类型；顺序、数量都不限。</p>' +
      '<div class="docs-table">' + docs + '</div></div>' +
      '<div class="ext-section"><h3>新工具模板（可直接复制）</h3>' +
      '<div class="codebox"><div class="codebox-head"><button class="code-tab active">data/gdb.js</button>' +
      '<button class="copy-btn" data-copy="' + esc(DATA.template) + '">复制模板</button></div>' +
      '<pre><code>' + esc(DATA.template) + '</code></pre></div></div>' +
      '<div class="ext-section"><h3>写内容的建议</h3><p>沿用这两课验证过的节奏：<b>心智模型 → 环境自检 → 最小闭环 → 可复现的 C++ 实验代码 → 逐行读懂真实输出 → 实战任务 → 速查 / 避坑 / 测验 → 带走一张卡</b>。' +
      '「输出逐行解读」和「实战任务」是学员反馈里最有用的两个积木，建议每个工具都保留。</p></div>' +
      '<div class="ext-section"><h3>版本与自动更新</h3><p>课程数据一变，<code class="inl">scripts/bump-version.js</code>（push 后由 GitHub Actions 自动运行）会重算内容指纹并写入 <code class="inl">version.json</code>。' +
      '网页每 30 分钟、标签页重新可见时、以及点右上角「检查更新」时读取它；发现新版本弹出非阻塞提示条，由用户决定何时刷新。' +
      '学习进度和「已见版本」都只存在浏览器 localStorage，不上传、无后端。</p></div>';
  }

  /* ==================================================================
   *  启动
   * ================================================================== */
  function render() {
    const tool = getTool();
    document.body.dataset.theme = state.theme;
    $('#themeIco').textContent = state.theme === 'dark' ? '☀' : '◐';
    applyAccent(tool);
    renderTabs();
    renderSidebar(tool);
    renderSection(tool);
    renderProgress(tool);
  }

  function init() {
    buildCommandIndex();
    $('#btnSearch').addEventListener('click', () => openDrawer('search'));
    $('#btnExtend').addEventListener('click', () => openDrawer('extend'));
    $('#btnTheme').addEventListener('click', () => {
      state.theme = state.theme === 'dark' ? 'light' : 'dark'; save(); render();
    });
    $('#brandHome').addEventListener('click', () => {
      state.sec[state.toolId] = getTool().sections[0].id; save(); render(); window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    $('#brandHome').addEventListener('keydown', e => { if (e.key === 'Enter') $('#brandHome').click(); });
    $('#globalSearch').addEventListener('input', e => drawGlobalSearch(e.target.value));
    $$('[data-close]').forEach(b => b.addEventListener('click', closeDrawer));
    $('#overlay').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDrawer(); });
    render();
  }

  init();
})();
