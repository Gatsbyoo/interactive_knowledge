/* =====================================================================
 *  Lab · 系统工具训练场 —— 全局配置
 *  这个文件只放"框架级"信息。具体课程内容在 perf.js / valgrind.js。
 *  新增一个工具：复制一份课程文件，push 进 LAB_DATA.tools，
 *  再到 index.html 里加一行 <script src="data/xxx.js"></script> 即可。
 * ===================================================================== */
window.LAB_DATA = {
  meta: {
    brand: 'Lab',
    title: '系统工具训练场',
    subtitle: '给会敲 Linux 命令、但还没系统学过性能与内存工具的 C++ 工程师',
    version: '1.0',
    audience: [
      '会 cd / ls / grep / gcc 这类基础命令',
      '看得懂 C++ 代码，但没做过性能剖析',
      '想在真实项目里定位"哪里慢""哪里漏"，而不是背命令'
    ]
  },

  /* 通用积木类型说明 —— 网页内的「扩展指南」会直接读这份数据 */
  blockDocs: [
    { type: 'prose',      desc: '正文段落，支持 **粗体** 与 `行内代码`', fields: 'title, lead, paras[], note{kind,title,text}' },
    { type: 'cards',      desc: '概念卡片网格，用来建立心智模型', fields: 'title, items[{icon,title,text,tone}]' },
    { type: 'roadmap',    desc: '学习路线图（编号步骤）', fields: 'title, items[{title,text,mins}]' },
    { type: 'steps',      desc: '编号操作流程，可带命令', fields: 'title, items[{title,text,cmd}]' },
    { type: 'code',       desc: '多标签源码块，带复制按钮', fields: 'title, tabs[{name,lang,code}], note' },
    { type: 'terminal',   desc: '可敲命令的模拟终端，输入命令返回预录输出', fields: 'id, prompt, commands[{cmd,out[]}], suggestions[]' },
    { type: 'output',     desc: '可点击逐行解读的真实工具输出', fields: 'title, subtitle, lines[{t,c,note}]' },
    { type: 'cmdtable',   desc: '命令速查表，支持页内搜索与复制', fields: 'title, rows[{cmd,desc,tip,tag}]' },
    { type: 'builder',    desc: '勾选参数拼装命令，并动态解释每条参数的作用', fields: 'title, base, groups[{label,opts[{flag,label,desc,on,effect}]}]' },
    { type: 'mission',    desc: '实战任务向导：每一步选出"下一条该敲的命令"', fields: 'title, scenario, steps[{goal,hint,choices[{cmd,correct,why}]}], debrief' },
    { type: 'pitfalls',   desc: '折叠式常见坑', fields: 'title, items[{q,a,fix}]' },
    { type: 'compare',    desc: '对比表格', fields: 'title, head[], rows[][]' },
    { type: 'quiz',       desc: '选择题，即时判分与解析', fields: 'id, title, questions[{q,options[],answer,explain}]' },
    { type: 'checklist',  desc: '可勾选的结业清单，进度会保存', fields: 'id, title, items[{text,hint}]' }
  ],

  /* 工具清单由各课程文件自行 push */
  tools: [],

  /* 新工具模板（扩展指南里可一键复制） */
  template: `/* data/gdb.js —— 复制本文件，改完内容后 push 进来 */
(function () {
  const COURSE = {
    id: 'gdb',                        // 唯一标识，进度按 id 存储
    name: 'gdb',
    tagline: '一句话说明这个工具解决什么问题',
    color: '#7c3aed',                 // 主题色
    level: '入门 → 能独立排查崩溃',
    minutes: 40,
    icon: 'G',
    summary: '这个工具的定位、典型使用场景、学完能做什么。',
    goals: ['目标一', '目标二', '目标三'],
    prereq: ['环境前提一', '环境前提二'],
    sections: [
      {
        id: 'start',                  // 章节 id，工具内唯一
        title: '开始之前',
        kicker: 'ORIENTATION',
        minutes: 3,
        blocks: [
          { type: 'prose', title: '它到底在干什么',
            paras: ['用 **粗体** 强调概念，用一对反引号写行内命令。'] },
          { type: 'roadmap', title: '这一课怎么走',
            items: [ { title: '建立模型', text: '...', mins: 5 } ] }
        ]
      }
      // 更多章节…… 直接组合上面 14 种积木即可，无需改 app.js
    ]
  };
  window.LAB_DATA.tools.push(COURSE);
})();`
};
