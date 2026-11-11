/* =====================================================================
 *  课程 01：perf —— 从「程序有点慢」到「指出是哪一行在烧 CPU」
 * ===================================================================== */
(function () {
  const COURSE = {
    id: 'perf',
    name: 'perf',
    tagline: '不猜、不改代码，直接看见 CPU 时间花在哪',
    color: '#2563eb',
    icon: 'P',
    level: '入门 → 能独立定位 CPU 热点并验证优化',
    minutes: 50,
    summary: 'perf 是 Linux 内核自带的性能剖析器。它有两种截然不同的工作方式：数事件（perf stat）和采样（perf record）。这一课从零建立这个心智模型，用一个真实的 C++ 缓存不友好程序跑完整闭环：测量 → 找热点 → 看汇编 → 改代码 → 复测。',
    goals: [
      '说清 perf stat 和 perf record 的本质区别，知道什么时候用哪个',
      '能独立编译出「perf 看得懂」的 C++ 程序，并采集带调用栈的样本',
      '能读懂 perf stat / perf report 的每一行，解释 IPC、cache-misses 的含义',
      '掌握一套可以搬到任何 C++ 项目上的排查流程和避坑清单'
    ],
    prereq: [
      '一台 Linux（物理机、虚拟机、WSL2、容器均可，容器权限见「常见坑」）',
      'g++ 与基础 shell 操作',
      '能 sudo（只用于安装和改 sysctl，日常使用不需要 root）'
    ],

    sections: [
      /* ---------------------------------------------------------- 0 */
      {
        id: 'start', title: '开始之前', kicker: 'ORIENTATION', minutes: 3,
        blocks: [
          { type: 'prose', title: '你将要解决的那类问题',
            lead: '线上服务响应变慢，代码几万行，日志没报错。你需要的不是「感觉」，而是一份证据。',
            paras: [
              'perf 回答三个层层递进的问题：**整个程序消耗了多少**（cycles、指令数、缓存失效）、**时间花在哪个函数上**（采样 + 符号化）、**具体哪条指令/哪次调用路径最贵**（调用栈、annotate、火焰图）。',
              '它不是 profiler 里的一个「更好用的 gprof」——它不插桩、不需要重新编译成特殊版本、开销通常只有 1%~5%，因此可以直接用在接近生产的构建上。代价是：它给的是**统计意义**上的分布，不是精确计时。',
              '这一课刻意用「最小概念 + 一个可复现的 C++ 例子 + 大量读懂输出」的节奏。你不需要记命令，网页里的模拟终端、速查表和命令拼装器会替你记；你需要练的是**看到一行输出时能推断出什么**。'
            ],
            note: { kind: 'info', title: '关于「0 基础」', text: '默认你会 cd / ls / grep / g++ / 管道。所有新概念都从「它在观测什么」讲起，不假设你懂 PMU、调用栈回溯或 CPU 缓存。' } },
          { type: 'roadmap', title: '这一课的路线', items: [
            { title: '建立心智模型', text: '计数 vs 采样，事件、样本、调用栈到底是什么', mins: 6 },
            { title: '环境自检', text: '装好 perf、放开权限、确认硬件事件可用', mins: 5 },
            { title: '5 分钟最小闭环', text: 'stat → record → report，先跑通一次', mins: 8 },
            { title: 'C++ 实验程序', text: '一个故意制造缓存灾难的程序，编译它', mins: 6 },
            { title: '读懂输出', text: '逐行点开 perf stat 和 perf report 的解释', mins: 12 },
            { title: '实战任务', text: '自己决定下一步敲什么命令', mins: 6 },
            { title: '速查 / 避坑 / 测验', text: '把流程固化成清单，验证掌握程度', mins: 10 }
          ] },
          { type: 'cards', title: '先记住这三个词', items: [
            { icon: '01', title: 'Event 事件', text: '你要观测的东西：cycles、instructions、cache-misses、branch-misses、cpu-clock……一条命令可以同时数多个。' },
            { icon: '02', title: 'Sample 样本', text: '每发生 N 次事件就中断一次，记下当时的指令地址和调用栈。样本越多，热点分布越可信。' },
            { icon: '03', title: 'Symbol 符号', text: '把地址翻译回 C++ 函数名和行号。需要 -g 编译；翻译不了就会显示 [unknown] 或裸地址。' }
          ] }
        ]
      },

      /* ---------------------------------------------------------- 1 */
      {
        id: 'model', title: '心智模型', kicker: 'MENTAL MODEL', minutes: 7,
        blocks: [
          { type: 'prose', title: 'perf 到底是怎么「看见」程序的',
            paras: [
              '内核里有一套叫 **perf_events** 的子系统，它向上提供 `perf_event_open()` 系统调用。事件源有两类：一类是 CPU 里的 **PMU 硬件计数器**（cycles、指令数、缓存失效这类真实硬件信号），另一类是**内核软件事件 / tracepoint**（上下文切换、页错误、调度、系统调用）。perf 这个命令行工具只是把这套能力包装成人能用的界面。',
              '由此产生两种工作方式，理解它们的区别比记住任何参数都重要：'
            ] },
          { type: 'compare', title: '两种模式的本质区别', head: ['', '计数 counting · perf stat', '采样 sampling · perf record'], rows: [
            ['怎么工作', '开一个计数器，程序跑完读一次总数', '设定频率，每次溢出中断并抓一份快照'],
            ['回答什么', '发生了多少次 / 整体效率如何', '这些事件发生在哪个函数、哪条路径'],
            ['输出形态', '一张汇总表（cycles、IPC、miss 率）', '按符号聚合的百分比排行 + 调用栈'],
            ['开销', '极低，几乎可忽略', '低但随频率上升（常用 -F 99）'],
            ['精度', '精确计数', '统计估计：短函数可能一个样本都没有'],
            ['典型第一步', '先判断瓶颈类型：CPU bound 还是 cache bound', '再定位到具体代码位置']
          ] },
          { type: 'cards', title: '采样为什么可信', items: [
            { icon: '⌁', title: '频率 -F 99', text: '每秒每 CPU 采 99 次。用 99 而不是 100，是为了避免和程序里的周期性任务（正好 100Hz）锁步，产生系统性偏差。程序太短就采不到样本，需要循环放大或改用 --repeat。', tone: 'accent' },
            { icon: '↳', title: '调用栈 callchain', text: '-g 会连同栈回溯一起记录，于是你知道「sum_by_col 是被 main 的第二个循环调起来的」，而不只是知道有个热函数。栈回溯依赖帧指针或 DWARF。' },
            { icon: '≈', title: 'Overhead 百分比', text: '不是时间，是该符号被采到的样本数占总样本数的比例。182 个样本里 71% 落在 sum_by_col，就说明约 71% 的 CPU 时间在那里。' }
          ] },
          { type: 'prose', title: '一个常被忽略的推论',
            paras: [
              '采样记录的是**「谁在占用 CPU」**，不是「谁让程序变慢」。一个疯狂等待磁盘 IO、锁竞争或 sleep 的程序，CPU 样本会很少甚至采不到——这时你需要的是 `perf trace`、`perf sched`、off-CPU 分析或 strace，而不是盯着 report 里的热点。',
              '所以正确顺序永远是：先用 `perf stat` 判断"这到底是不是 CPU 问题"，再用 `perf record` 找位置。反过来做，容易在错误的方向上优化半天。'
            ],
            note: { kind: 'warn', title: '别分析 -O0 的代码', text: '优化开关会彻底改变热点分布。要剖析就剖析你实际发布的构建（-O2/-O3），只额外加 -g 和栈回溯相关参数。用 -O0 的 profile 去优化生产代码，结论基本无效。' } }
        ]
      },

      /* ---------------------------------------------------------- 2 */
      {
        id: 'setup', title: '环境自检', kicker: 'SETUP', minutes: 5,
        blocks: [
          { type: 'steps', title: '按序做这四件事', items: [
            { title: '安装与内核版本对齐', text: 'perf 与内核版本强绑定，发行版通常提供匹配包。Ubuntu 上包名带 uname -r。', cmd: 'sudo apt install linux-tools-common linux-tools-$(uname -r)   # Debian/Ubuntu\nsudo dnf install perf                                        # Fedora/RHEL' },
            { title: '放开采样权限', text: 'kernel.perf_event_paranoid 决定非 root 用户能观测什么。设为 1 通常足够做用户态采样；若需要内核符号或全部硬件事件，临时设为 -1。', cmd: 'sudo sysctl -w kernel.perf_event_paranoid=1\nsudo sysctl -w kernel.kptr_restrict=0' },
            { title: '确认能读到硬件事件', text: '跑一个最小命令。能看到 cycles / instructions 的数字说明一切就绪。', cmd: 'perf stat -e cycles,instructions -- sleep 1' },
            { title: '如果显示 <not supported>', text: '多半是虚拟机 / 云主机没把 PMU 透传给 guest。此时改用软件事件 cpu-clock 或 task-clock 仍可做采样，只是拿不到 cache-misses 这类硬件指标。', cmd: 'perf stat -e task-clock,context-switches,page-faults -- sleep 1' }
          ] },
          { type: 'terminal', id: 'perf-setup', title: '自己敲一遍（模拟终端）', prompt: 'dev@lab:~/perf$',
            intro: '输入 help 看可用命令，或直接点下面的建议。上下方向键可以翻历史。',
            suggestions: ['perf --version', 'cat /proc/sys/kernel/perf_event_paranoid', 'perf stat -e cycles,instructions -- sleep 1', 'perf list | head -20', 'uname -r'],
            commands: [
              { cmd: 'perf --version', out: [{ t: "perf version 6.8.12", c: "ok" }] },
              { cmd: 'uname -r', out: ['6.8.0-45-generic'] },
              { cmd: 'cat /proc/sys/kernel/perf_event_paranoid', out: [{ t: "1", c: "accent" }, { t: "→ 1 表示允许用户态 CPU 事件采样；2 及以上会限制，容器里还可能需要额外 capability", c: "dim" }] },
              { cmd: 'sudo sysctl -w kernel.perf_event_paranoid=1', out: ['kernel.perf_event_paranoid = 1', { t: "✓ 权限已放开（真实机器上需要 sudo 密码）", c: "ok" }] },
              { cmd: 'perf stat -e cycles,instructions -- sleep 1', out: [
                { t: " Performance counter stats for 'sleep 1':", c: "head" },
                { t: "", c: "" },
                { t: "         2,418,903      cycles:u", c: "" },
                { t: "         1,204,557      instructions:u            #    0.50  insn per cycle", c: "" },
                { t: "", c: "" },
                { t: "       1.001248210 seconds time elapsed", c: "" },
                { t: "       0.000000000 seconds user", c: "dim" },
                { t: "       0.001082000 seconds sys", c: "dim" },
                { t: "→ sleep 几乎不执行指令：cycles 主要来自内核唤醒过程，这正是「CPU 空转」的样子", c: "ok" }
              ] },
              { cmd: 'perf list | head -20', out: [
                { t: "List of pre-defined events (to be used in -e):", c: "head" },
                '  branch-instructions OR branches                    [Hardware event]',
                '  branch-misses                                      [Hardware event]',
                '  cache-misses                                       [Hardware event]',
                '  cache-references                                   [Hardware event]',
                '  cpu-cycles OR cycles                               [Hardware event]',
                '  instructions                                       [Hardware event]',
                { t: "", c: "" },
                '  context-switches OR cs                             [Software event]',
                '  page-faults OR faults                              [Software event]',
                '  task-clock:u                                       [Software event]',
                { t: "  ... 后面还有 tracepoint、SDT、metric 等上千项", c: "dim" }
              ] },
              { cmd: 'perf stat -e task-clock,context-switches,page-faults -- sleep 1', out: [
                { t: " Performance counter stats for 'sleep 1':", c: "head" },
                { t: "", c: "" },
                { t: "          1.00 msec task-clock:u                #    0.001 CPUs utilized", c: "" },
                { t: "              1      context-switches:u          #    1.000 K/sec", c: "" },
                { t: "             62      page-faults:u                #   62.000 K/sec", c: "" },
                { t: "", c: "" },
                { t: "       1.001320411 seconds time elapsed", c: "" },
                { t: "→ 软件事件不需要 PMU，任何环境都能用", c: "ok" }
              ] },
              { cmd: 'ls', out: ['hot.cpp   fixed.cpp   README.txt', { t: "→ 实验代码已经准备好了，下一章会编译它", c: "dim" }] },
              { cmd: 'cat README.txt', out: ['Lab 01: perf', '目标：找出 hot 程序里真正吃掉 CPU 的那个函数。', { t: "提示：先测量整体，再定位局部。", c: "accent" }] }
            ] },
          { type: 'prose', title: '权限到底在限制什么',
            paras: [
              '`kernel.perf_event_paranoid` 的具体语义随内核版本略有变化，经验规则是：**2 及以上**只允许有限的用户态观测；**1** 允许对用户态做 CPU 事件采样（本课程够用）；**0 / -1** 逐步放开内核态和更多事件，**-1** 生产环境慎用。',
              '在 Docker 里跑 perf 时，即使改了宿主机 sysctl，容器默认仍拿不到 `perf_event_open`，需要 `--cap-add=PERFMON`（新内核）或 `--cap-add=SYS_ADMIN`，且容器内的 perf 版本要和**宿主机内核**匹配，而不是和容器镜像匹配。'
            ] }
        ]
      },

      /* ---------------------------------------------------------- 3 */
      {
        id: 'first', title: '5 分钟最小闭环', kicker: 'QUICK WIN', minutes: 8,
        blocks: [
          { type: 'prose', title: '三条命令，一个闭环',
            lead: '先别管细节。任何 C++ 程序的 perf 排查，骨架都是这三步。',
            paras: [
              '`perf stat ./app` —— 看整体：跑了多少 cycles、IPC 多少、缓存失效高不高。',
              '`perf record -F 99 -g -- ./app` —— 采集带调用栈的样本，生成当前目录下的 `perf.data`。',
              '`perf report` —— 打开交互式报告，按热点排序，选中符号按 `a` 可以做汇编级 annotate。'
            ] },
          { type: 'builder', title: '命令拼装器：先搭一条 perf stat', base: 'perf stat',
            groups: [
              { label: '① 选事件（可多选）', opts: [
                { flag: '-e cycles,instructions', label: 'cycles,instructions', desc: '算 IPC，判断流水线效率', on: true, effect: '得到 cycles 与 instructions，两者相除就是 IPC（每周期指令数）。' },
                { flag: '-e cache-references,cache-misses', label: 'cache 相关', desc: '算缓存失效率', on: false, effect: '得到 cache-references / cache-misses，判断是不是在等内存。' },
                { flag: '-e branches,branch-misses', label: '分支预测', desc: '看分支预测失败率', on: false, effect: '得到 branches / branch-misses，判断乱序执行是否被分支打断了。' },
                { flag: '-e task-clock,context-switches,page-faults', label: '软件事件', desc: '无 PMU 时也能用', on: false, effect: '改用内核软件事件，虚拟机/云主机里也一定能跑。' }
              ] },
              { label: '② 采集方式', opts: [
                { flag: '--repeat 3', label: '重复 3 次', desc: '看波动与方差', on: false, effect: '重复运行 3 次并给出均值/方差，避免只测一次被噪声骗到。' },
                { flag: '-d', label: '详细 -d', desc: '自动附带常用事件', on: false, effect: '自动扩展成一组常用硬件事件并给出派生指标，适合第一次体检。' },
                { flag: '-a', label: '全系统 -a', desc: '观测整个机器', on: false, effect: '采集所有 CPU 上所有进程的事件（通常需要更高权限），适合排查整机问题。' }
              ] },
              { label: '③ 目标程序', opts: [
                { flag: '-- ./hot', label: '-- ./hot', desc: '-- 后是要运行的命令', on: true, effect: '只对 ./hot 这个进程计数；-- 用来分隔 perf 自己的参数和被测程序的参数。' }
              ] }
            ] },
          { type: 'terminal', id: 'perf-first', title: '跑一遍最小闭环', prompt: 'dev@lab:~/perf$',
            intro: '按 stat → record → report 的顺序敲一遍。注意 record 之后多出来的 perf.data。',
            suggestions: ['perf stat -e cycles,instructions -- ./hot', 'perf record -F 99 -g -- ./hot', 'perf report --stdio | head -20', 'ls -lh perf.data'],
            commands: [
              { cmd: 'perf stat -e cycles,instructions -- ./hot', out: [
                { t: " Performance counter stats for './hot':", c: "head" }, { t: "", c: "" },
                { t: "     7,132,456,901      cycles:u", c: "" },
                { t: "     4,980,112,334      instructions:u      #    0.70  insn per cycle", c: "" },
                { t: "", c: "" }, { t: "       1.842330912 seconds time elapsed", c: "" },
                { t: "→ IPC 0.70 偏低：CPU 有大量周期在等东西，值得继续看缓存事件", c: "warn" }
              ] },
              { cmd: 'perf record -F 99 -g -- ./hot', out: [
                { t: "[ perf record: Woken up 12 times to write data ]", c: "dim" },
                { t: "[ perf record: Captured and wrote 0.147 MB perf.data (182 samples) ]", c: "ok" },
                { t: "→ 182 个样本。样本越多结论越稳；程序太短时可以多跑几轮", c: "dim" }
              ] },
              { cmd: 'perf report --stdio | head -20', out: [
                { t: "# Samples: 182  of event 'cycles:u'", c: "head" },
                { t: "# Overhead  Command  Shared Object  Symbol", c: "head" },
                { t: "    71.23%  hot      hot             [.] sum_by_col(...)", c: "warn" },
                { t: "    24.10%  hot      hot             [.] sum_by_row(...)", c: "" },
                { t: "     2.95%  hot      hot             [.] main", c: "" },
                { t: "→ 热点找到了。下一步：perf annotate 看具体是哪条指令", c: "ok" }
              ] },
              { cmd: 'ls -lh perf.data', out: ['-rw------- 1 dev dev 151K Nov 11 20:24 perf.data', { t: "→ perf.data 是二进制采样文件，可以用 perf report / script / diff 反复分析，甚至拷到别的机器", c: "dim" }] },
              { cmd: 'perf annotate -i perf.data -s sum_by_col', out: [
                { t: " sum_by_col(std::vector<float,...> const&)  /  ./hot", c: "head" },
                { t: "  0.12 │      movss  (%rax,%rcx,4),%xmm0", c: "" },
                { t: " 68.40 │  ┌─ addss   %xmm0,%xmm1        ← 累加，但每次跳转 16KB", c: "warn" },
                { t: " 21.03 │  │  add     $0x1000,%rcx", c: "" },
                { t: "→ 每行左侧是该函数内样本占比。地址步长导致每读一个 float 就换一条缓存行", c: "ok" }
              ] },
              { cmd: 'perf script | ./FlameGraph/stackcollapse-perf.pl | ./FlameGraph/flamegraph.pl > flame.svg', out: [
                { t: "✓ 已生成 flame.svg（182 个样本已折叠成调用栈）", c: "ok" },
                { t: "→ 火焰图：横向宽度 = 样本占比，纵向 = 调用深度。找最宽的「平顶」", c: "dim" }
              ] },
              { cmd: 'ls', out: ['hot.cpp   fixed.cpp   hot   perf.data   perf.data.old   flame.svg'] },
              { cmd: 'clear', out: [] }
            ] },
          { type: 'prose', title: '三个参数的含义',
            paras: [
              '`-F 99`：采样频率；`-g`：记录调用栈；`--`：分隔 perf 参数与被测程序自己的参数（如果被测程序也要传参，写成 `perf record ... -- ./app -n 100`）。',
              '采集结果落在 `perf.data`。这是个可复用的文件——`perf report` 看排行、`perf script` 导出原始样本、`perf diff perf.data.old perf.data` 对比优化前后、`perf archive` 打包符号供别的机器分析。'
            ] }
        ]
      },

      /* ---------------------------------------------------------- 4 */
      {
        id: 'code', title: 'C++ 实验程序', kicker: 'THE SUBJECT', minutes: 6,
        blocks: [
          { type: 'prose', title: '故意写一段「缓存灾难」',
            lead: '两个函数做同一件事：把一个 4096×4096 的 float 矩阵求和。唯一区别是遍历顺序。',
            paras: [
              'C++ 的二维数组按**行优先**存储。按行遍历时，一次载入 64 字节缓存行就能连续用掉 16 个 float；按列遍历时，每读一个元素要跳 4096×4 = 16KB，几乎每次访问都 miss 一条新的缓存行。',
              '这是一个绝佳的教学样本：算法复杂度完全一样，指令数也差不多，但 LLC 失效差几十倍，perf 能一眼看穿。',
              '函数上的 `[[gnu::noinline]]` 是为了让它们在 perf report 里保持独立符号——真实项目里如果函数被内联，热点会算到调用者头上（见「常见坑」）。'
            ] },
          { type: 'code', title: 'hot.cpp · 待剖析程序', tabs: [
            { name: 'hot.cpp', lang: 'cpp', code: `#include <vector>
#include <cstdio>
#include <cstddef>

constexpr int N = 4096;
using Matrix = std::vector<float>;

// 禁止内联，保证在 perf report 里能看到独立的符号
[[gnu::noinline]] double sum_by_row(const Matrix& m) {
    double s = 0;
    for (int r = 0; r < N; ++r)
        for (int c = 0; c < N; ++c)
            s += m[static_cast<std::size_t>(r) * N + c];  // 连续访问
    return s;
}

[[gnu::noinline]] double sum_by_col(const Matrix& m) {
    double s = 0;
    for (int c = 0; c < N; ++c)
        for (int r = 0; r < N; ++r)
            s += m[static_cast<std::size_t>(r) * N + c];  // 每次跳 16 KB
    return s;
}

int main() {
    Matrix m(static_cast<std::size_t>(N) * N, 1.0f);
    volatile double sink = 0;          // 防止优化掉整个计算
    for (int i = 0; i < 10; ++i) sink += sum_by_row(m);
    for (int i = 0; i < 10; ++i) sink += sum_by_col(m);
    std::printf("sink = %f\\n", static_cast<double>(sink));
}` },
            { name: 'fixed.cpp', lang: 'cpp', code: `// 修复思路：让内存访问重新变得连续。
// 若业务必须按列处理，用分块（tiling）：让一个小块同时留在缓存里。
constexpr int B = 64;   // 64x64 个 float = 16 KB， comfortably fits in L1

[[gnu::noinline]] double sum_by_col_tiled(const Matrix& m) {
    double s = 0;
    for (int c0 = 0; c0 < N; c0 += B)
        for (int r0 = 0; r0 < N; r0 += B)
            for (int c = c0; c < c0 + B; ++c)
                for (int r = r0; r < r0 + B; ++r)
                    s += m[static_cast<std::size_t>(r) * N + c];
    return s;
}

// 另一种修复：先转置一次（O(N^2)），之后全部按行访问。
// 选哪种取决于这个操作在业务里跑几次。` },
            { name: 'build.sh', lang: 'bash', code: `# 关键：-O2 保持真实优化等级；-g 给行号；-fno-omit-frame-pointer 让栈回溯可靠
g++ -O2 -g -fno-omit-frame-pointer -o hot hot.cpp

# 完整测量（一条命令同时数 6 个事件）
perf stat -e cycles,instructions,cache-references,cache-misses,branches,branch-misses -- ./hot

# 采样 + 调用栈
perf record -F 99 -g --call-graph dwarf,8192 -- ./hot
perf report --stdio --sort comm,dso,symbol | head -40

# 优化后复测：把旧数据留下来做对比
mv perf.data perf.data.old
perf record -F 99 -g -- ./fixed
perf diff perf.data.old perf.data | head -30` }
          ], note: '在自己的机器上把三段代码保存下来跑一遍。如果机器内存较小，把 N 改成 2048 即可，现象依然明显。' },
          { type: 'cards', title: '编译参数为什么是这几个', items: [
            { icon: '-O2', title: '保持真实优化等级', text: '剖析的必须是你实际要发布的那个构建。加 -g 不会改变优化行为，它只往文件里多写调试信息。' },
            { icon: '-g', title: '符号与行号', text: '没有它，perf report 里是一串十六进制地址，annotate 也看不到源码行。发布时用 -g + strip 到单独的 debuginfo 文件也行。' },
            { icon: 'FP', title: '-fno-omit-frame-pointer', text: 'x86-64 上编译器常把 rbp 当通用寄存器用，栈回溯就断了。加这个参数让 -g 的帧指针回溯可靠；或者改用 --call-graph dwarf。' },
            { icon: '≠', title: '别加 -pg', text: '-pg 是给 gprof 用的插桩，会改变程序行为，和 perf 完全无关，甚至会干扰采样。' }
          ] }
        ]
      },

      /* ---------------------------------------------------------- 5 */
      {
        id: 'reading', title: '读懂输出', kicker: 'READ THE EVIDENCE', minutes: 12,
        blocks: [
          { type: 'prose', title: '先读整体体检报告',
            lead: '下面是一份真实的 perf stat 输出。**点任何一行**查看它的含义和推断。',
            paras: ['读表顺序建议：task-clock → cycles/instructions 算 IPC → cache-misses 比例 → 分支预测 → 时间。前三项就足够判断瓶颈类型。'] },
          { type: 'output', title: 'perf stat ./hot', subtitle: '重点看 IPC 0.70 和 cache-misses 78.47% —— 这两个数字直接指向病根', lines: [
            { t: ' Performance counter stats for \'./hot\':', c: 'head', note: '标题行说明这次计数绑定在 ./hot 这个进程上。如果用了 -a 全系统模式，这里会显示 \'system wide\'。' },
            { t: '', c: '' },
            { t: '          1,842.33 msec task-clock:u        #    1.000 CPUs utilized', c: '', note: '程序实际占用 CPU 的总时间。1.000 CPUs utilized 说明它把单核跑满了 —— 这是 CPU bound 的第一个信号。:u 后缀表示只统计用户态（受 perf_event_paranoid 限制的常见表现）。' },
            { t: '                 0      context-switches:u  #    0.000 /sec', c: '', note: '上下文切换为 0，说明没有被频繁抢占，也没有大量阻塞/唤醒。如果这个值很高，要考虑锁竞争或线程过多，而不是去优化热点函数。' },
            { t: '                 0      cpu-migrations:u    #    0.000 /sec', c: '', note: '进程在 CPU 核之间迁移的次数。频繁迁移会破坏缓存局部性；绑定核（taskset）有时能明显改善。' },
            { t: '             2,104      page-faults:u        #    1.14 K/sec', c: '', note: '页错误总数（主要是初次分配 64MB 矩阵时的次缺页）。如果高达每秒几十万次，说明有大量动态内存分配或内存抖动。' },
            { t: '     7,132,456,901      cycles:u            #    3.871 GHz', c: '', note: 'CPU 周期总数。7.13G cycles / 1.842s ≈ 3.87 GHz，正好对应 CPU 频率 —— 这行可以用来核对测量是否自洽。' },
            { t: '     4,980,112,334      instructions:u      #    0.70  insn per cycle', c: 'warn', note: '★ 关键指标 IPC（每周期执行指令数）。现代乱序 CPU 纯计算能到 2~4；0.70 说明大量周期在「等」，通常是在等内存（cache miss）、等分支恢复或等长延迟指令。IPC 低 ≠ 指令写得多，而是流水线空转。' },
            { t: '       512,004,881      cache-references:u  #  277.91 M/sec', c: '', note: '缓存访问次数（通常指 LLC 层级，具体含义随 CPU 型号不同）。单独看这个数没意义，要配合下一行的失效率。' },
            { t: '       401,882,310      cache-misses:u      #   78.47% of all cache refs', c: 'err', note: '★★ 病根在这里：近 8 成缓存访问都 miss。结合代码里的按列遍历（每读一个 float 跨 16KB），几乎每次访问都要从主存重新取一条 64 字节缓存行。这就是 IPC 只有 0.70 的原因。' },
            { t: '       802,113,045      branches:u          #  435.39 M/sec', c: '', note: '分支指令数。两个 4096×4096 的循环自然会有这么多分支。' },
            { t: '         4,009,112      branch-misses:u     #    0.50% of all branches', c: 'ok', note: '★ 分支预测失败率只有 0.50%，非常健康。这行很重要：它排除了「分支预测」这个嫌疑，把结论收敛到内存访问上。若这里 >5%，优化方向就该是消除数据相关的 if/else。' },
            { t: '', c: '' },
            { t: '       1.842330912 seconds time elapsed', c: '', note: '墙上时间。和 task-clock(1.842s) 几乎相等 → 单线程、全程占用 CPU、没有等待 IO 或睡眠。如果 elapsed 远大于 task-clock，说明时间在等待，应该转去查 off-CPU 问题。' },
            { t: '       1.840112000 seconds user', c: 'dim', note: '用户态 CPU 时间。' },
            { t: '       0.002001000 seconds sys', c: 'dim', note: '内核态 CPU 时间（系统调用、缺页处理）。很低，说明瓶颈完全在用户代码。' }
          ] },
          { type: 'prose', title: '结论怎么写',
            paras: [
              '一份合格的 perf 结论长这样：**「程序单核跑满，IPC 0.70，缓存失效率 78%，分支预测正常；瓶颈是内存访问局部性差，不是算法复杂度，也不是分支。」** 有了这句话，才有资格进入下一步——找具体是哪段代码。'
            ],
            note: { kind: 'ok', title: '小技巧', text: '拿不准数字是否稳定，用 perf stat --repeat 5 跑 5 次看方差；也可以只改一个变量重测，做 A/B 对比，这比读十篇调优文章都有效。' } },
          { type: 'output', title: 'perf report --stdio', subtitle: '采样报告：每一行的百分比都是「样本占比」，点开看怎么读', lines: [
            { t: '# Samples: 182  of event \'cycles:u\'', c: 'head', note: '总样本数 182，按 cycles 用户态事件采样。样本数偏少，结论方向可信但百分比会有几个百分点波动；生产排查建议采到几千个样本。' },
            { t: '# Event count (approx.): 1820000000', c: 'dim', note: '按采样周期反推的近似事件总数，仅作参考，不要当精确值。' },
            { t: '#', c: 'dim' },
            { t: '# Overhead  Command  Shared Object      Symbol', c: 'head', note: '列名含义：Overhead = 该符号的样本占比；Command = 进程名；Shared Object = 来自哪个二进制/库；Symbol = 函数符号。' },
            { t: '# ........  .......  ...................  ..............................', c: 'dim' },
            { t: '#', c: 'dim' },
            { t: '    71.23%  hot      hot                 [.] sum_by_col(std::vector<float,...)', c: 'err', note: '★★ 71% 的 CPU 样本落在 sum_by_col。[.] 表示这是用户态 ELF 里的符号；[k] 表示内核符号，[u] 表示用户态动态库。点进去按 a 可以 annotate 到汇编行。' },
            { t: '    24.10%  hot      hot                 [.] sum_by_row(std::vector<float,...)', c: 'warn', note: '同样的计算量，按行遍历只花 24%。两个函数指令数几乎一样，时间差三倍 —— 差距全部来自缓存。这就是最有说服力的 A/B 证据。' },
            { t: '     2.95%  hot      hot                 [.] main', c: '', note: 'main 里的初始化、循环控制和 printf。占比很小，正常。' },
            { t: '     1.02%  hot      [kernel.kallsyms]   [k] native_write_msr', c: '', note: '内核符号，采样和缺页相关。这里占比极低可忽略。如果 [k] 的项排到前面，说明瓶颈在系统调用/内核路径，方向完全不同。' },
            { t: '     0.70%  hot      libc.so.6           [.] __memcpy_avx_unaligned_erms', c: '', note: 'libc 里的 memcpy。若这类库函数占比很高，要检查是不是有大量不必要的对象拷贝（比如传值而不是 const&）。' },
            { t: '     0.00%  hot      hot                 [.] _init', c: 'dim', note: '0.00% 不代表没执行，只是没被采到。采样天然看不到极短的函数 —— 这是采样的固有局限。' }
          ] },
          { type: 'cards', title: 'report 里三个容易误读的点', items: [
            { icon: '%', title: 'Self vs Children', text: '默认百分比是「自身」样本。perf report --children 会把子函数的样本累加到调用者上，两种视图结论可能完全不同，先看默认的再切。' },
            { icon: '?', title: '[unknown]', text: '地址没能符号化：常见原因是没加 -g、PIE/ASLR、strip 掉了符号、或者 JIT 生成的代码。先确认编译参数，再考虑 perf buildid-cache。' },
            { icon: '⇄', title: '验证优化', text: '优化完必须重测：perf diff perf.data.old perf.data 直接看热点占比变化，配合 perf stat --repeat 3 看绝对耗时。没有复测的优化只是猜测。' }
          ] }
        ]
      },

      /* ---------------------------------------------------------- 6 */
      {
        id: 'mission', title: '实战任务', kicker: 'MISSION', minutes: 6,
        blocks: [
          { type: 'mission', title: '任务：一个「没有报错、只是很慢」的服务',
            scenario: '同事丢给你一个 C++ 二进制 ./worker，处理一批数据要 12 秒，预期是 2 秒。代码你还没读过。请按顺序选出每一步最该敲的命令。',
            steps: [
              { goal: '第 1 步：还不知道瓶颈是 CPU、内存还是 IO，你先做什么？', hint: '别急着找函数，先给整个程序做一次体检。', choices: [
                { cmd: 'perf stat -d -- ./worker', correct: true, why: '✓ 对。先用计数模式拿到整体画像：IPC、缓存、分支、上下文切换。这一步决定后面所有方向。' },
                { cmd: 'perf record -F 999 -g -- ./worker', why: '还不知道是不是 CPU 问题就直接采样，容易把时间花在错误的方向上；而且 999Hz 对初次排查没必要。' },
                { cmd: 'gdb ./worker', why: '没有崩溃也没有断点目标，调试器帮不上「慢」这个问题。' }
              ] },
              { goal: '第 2 步：stat 显示 IPC 0.65、cache-misses 81%、context-switches 极低。下一步？', hint: '已经确认是 CPU + 缓存问题，该找具体位置了。', choices: [
                { cmd: 'perf record -F 99 -g -- ./worker', correct: true, why: '✓ 对。带调用栈采样，既能看到热函数，也能看到是谁把它调起来的。' },
                { cmd: 'strace -c ./worker', why: 'context-switches 很低且 sys 时间几乎为零，系统调用不是嫌疑对象。' },
                { cmd: 'valgrind --tool=cachegrind ./worker', why: 'Cachegrind 能做缓存模拟，但慢几十倍，属于「已经定位到函数之后」的精细手段，不该放在第二步。' }
              ] },
              { goal: '第 3 步：report 里 68% 落在 parse_record()，你想看这个函数里哪条指令最贵。', hint: 'report 的 TUI 里选中符号按 a，命令行里也有对应子命令。', choices: [
                { cmd: 'perf annotate -i perf.data -s parse_record', correct: true, why: '✓ 对。annotate 把样本映射回汇编指令/源码行，左侧百分比告诉你时间集中在哪几行。' },
                { cmd: 'perf script | head', why: 'perf script 输出的是原始样本事件流，信息量太大且没有聚合，不适合这个目的。' },
                { cmd: 'perf list', why: 'perf list 只是列出可用事件，跟已有数据的分析无关。' }
              ] },
              { goal: '第 4 步：发现热点是一次按列读取的大数组。你按分块重写后，怎么证明优化有效？', hint: '要同时有绝对耗时和相对热点的证据。', choices: [
                { cmd: 'mv perf.data perf.data.old && perf record -F 99 -g -- ./worker && perf diff perf.data.old perf.data', correct: true, why: '✓ 对。保留旧样本做对比，perf diff 直接显示各符号占比的变化；再配一次 perf stat --repeat 3 看绝对耗时就更完整了。' },
                { cmd: 'perf report', why: '只重看一次新报告，没有基线和定量对比，说服力不足。' },
                { cmd: 'time ./worker', why: 'time 能给出总耗时，是最低限度的验证，但说不清热点是否真的搬走了，也无法排除机器负载波动。' }
              ] }
            ],
            debrief: '把这四步背下来，就是一套可以搬到任何 C++ 项目上的流程：**stat 判断瓶颈类型 → record -g 定位位置 → annotate 看到指令 → diff 验证修复**。工具会换，这个顺序不会换。' }
        ]
      },

      /* ---------------------------------------------------------- 7 */
      {
        id: 'cmds', title: '命令速查', kicker: 'CHEATSHEET', minutes: 5,
        blocks: [
          { type: 'cmdtable', title: 'perf 常用命令（可直接点复制）', rows: [
            { cmd: 'perf stat ./app', desc: '默认事件整体计数', tip: '第一次接触任何程序都先跑它', tag: '计数' },
            { cmd: 'perf stat -d -- ./app', desc: '详细模式，附带常用硬件事件与派生指标', tip: '-d 可叠加到 -ddd，事件越来越多，开销也略增', tag: '计数' },
            { cmd: 'perf stat -e cycles,instructions,cache-misses -- ./app', desc: '只数指定的几个事件', tip: 'IPC = instructions / cycles；cache-misses 看后面的百分比', tag: '计数' },
            { cmd: 'perf stat --repeat 5 -- ./app', desc: '重复运行 5 次给均值与方差', tip: '性能对比必备，避免噪声', tag: '计数' },
            { cmd: 'perf stat -p <PID> sleep 10', desc: '对已在运行的进程计数 10 秒', tip: '线上排查不用重启进程', tag: '计数' },
            { cmd: 'perf stat -a sleep 10', desc: '整机范围计数', tip: '需要更高权限', tag: '计数' },
            { cmd: 'perf record -F 99 -g -- ./app', desc: '采样 + 调用栈，生成 perf.data', tip: '最核心的一条；99Hz 是常用起点', tag: '采样' },
            { cmd: 'perf record -g --call-graph dwarf,8192 -- ./app', desc: '用 DWARF 做栈回溯', tip: '二进制没保留帧指针时用它，代价是 perf.data 更大', tag: '采样' },
            { cmd: 'perf record -e cache-misses -c 10000 -- ./app', desc: '每 1 万次 cache miss 采一次样', tip: '-c 指定周期而不是频率，适合定位「哪里造成失效」', tag: '采样' },
            { cmd: 'perf report', desc: '打开 TUI 报告（按 a 进入 annotate，按 / 搜索）', tip: '--stdio 可输出到管道；--sort 改排序键', tag: '分析' },
            { cmd: 'perf report --children', desc: '把子函数样本累计到调用者', tip: '和默认视图对比着看，能区分「自己慢」还是「调了慢的下层」', tag: '分析' },
            { cmd: 'perf annotate -i perf.data -s <symbol>', desc: '汇编/源码级热点', tip: '需要 -g 才能显示源码行', tag: '分析' },
            { cmd: 'perf script', desc: '导出原始样本事件流', tip: '火焰图流水线的输入', tag: '分析' },
            { cmd: 'perf script | stackcollapse-perf.pl | flamegraph.pl > flame.svg', desc: '生成火焰图', tip: '来自 Brendan Gregg 的 FlameGraph 仓库', tag: '分析' },
            { cmd: 'perf diff perf.data.old perf.data', desc: '对比两次采样的热点变化', tip: '验证优化效果的量化证据', tag: '分析' },
            { cmd: 'perf top -F 99', desc: '实时系统级热点，类似 top', tip: '适合快速看整机在忙什么', tag: '实时' },
            { cmd: 'perf list', desc: '列出所有可用事件', tip: '找 tracepoint 用 perf list | grep', tag: '其他' },
            { cmd: 'perf trace ./app', desc: '类似 strace 的系统调用跟踪', tip: '怀疑 syscall 瓶颈时用它', tag: '其他' },
            { cmd: 'perf probe -x ./app \'func_name\'', desc: '动态插入探测点', tip: '不需要重新编译即可观测特定函数', tag: '其他' },
            { cmd: 'perf sched record / perf sched latency', desc: '调度延迟分析', tip: '线程多、抢锁、唤醒延迟场景', tag: '其他' },
            { cmd: 'perf c2c record / perf c2c report', desc: '伪共享（false sharing）与缓存行争用', tip: '多线程程序 IPC 低但单线程正常时考虑它', tag: '进阶' },
            { cmd: 'perf mem record / perf mem report', desc: '内存访问延迟归因', tip: '需要硬件支持（Intel PEBS / AMD IBS）', tag: '进阶' },
            { cmd: 'perf archive', desc: '打包符号与 build-id，供别的机器分析', tip: '线上采集、线下分析的常用组合', tag: '其他' },
            { cmd: 'perf buildid-cache', desc: '管理符号缓存', tip: '[unknown] 太多时排查它', tag: '其他' }
          ] }
        ]
      },

      /* ---------------------------------------------------------- 8 */
      {
        id: 'pitfalls', title: '常见坑', kicker: 'GOTCHAS', minutes: 5,
        blocks: [
          { type: 'pitfalls', title: '点开看解法', items: [
            { q: 'report 里全是 [unknown] 或一串 0x 地址', a: 'perf 拿到了地址但翻译不成符号。常见于：没加 -g、二进制被 strip、PIE + ASLR、JIT 代码、动态库没装 debuginfo。', fix: '重新用 -O2 -g 编译；确认 file ./app 里有 debug_info；必要时 perf buildid-cache 添加符号。' },
            { q: '明明有个函数很慢，report 里却找不到它', a: '被编译器内联了，样本算到了调用者头上；或者函数太短，一次都没被采到。', fix: '临时加 -fno-inline 或给函数标 [[gnu::noinline]] 做诊断；采样时让工作量足够大（循环放大 / 提高 -F）。注意：这只是诊断手段，最终仍要剖析真实构建。' },
            { q: '-g 采出来的调用栈只有一层，或者显示 [unknown] 帧', a: '-O2 下 rbp 被当作通用寄存器，帧指针回溯断了。', fix: '编译时加 -fno-omit-frame-pointer，或采集时改 --call-graph dwarf,8192（更慢、文件更大，但不依赖帧指针）。' },
            { q: 'cache-misses 显示 <not supported> 或 Permission denied', a: '虚拟机 / 云主机没透传 PMU，或 perf_event_paranoid 限制太严。', fix: '先 sudo sysctl -w kernel.perf_event_paranoid=1；仍不行就改用软件事件（task-clock / cpu-clock）配合 -e 采样，容器内加 --cap-add=PERFMON / SYS_ADMIN。' },
            { q: 'perf: not found 或者提示内核版本不匹配', a: 'perf 用户态工具与内核版本强绑定，容器里尤其常见：镜像里装的版本对应不上宿主机内核。', fix: '物理机装 linux-tools-$(uname -r)；容器里挂载宿主机的 perf 或换用匹配版本。' },
            { q: '程序只跑 0.01 秒，perf.data 里 0 个样本', a: '99Hz 意味着平均每 10ms 才采一次，程序早就结束了。', fix: '让被测工作量重复足够多次（包一层循环），或 perf stat --repeat 20 看统计值。不要用 -F 9999 硬扛，采样本身会严重干扰短程序。' },
            { q: '优化完好像变快了，但说不清是不是机器波动', a: '单次测量不可信：CPU 频率、缓存预热、后台负载都会影响。', fix: '固定 CPU 频率或至少同一台机器连续测；perf stat --repeat 5 看方差；perf diff 对比两次采样；A/B 交替跑而不是先跑 5 次 A 再跑 5 次 B。' },
            { q: '程序很慢，但 perf report 几乎没有样本', a: '程序大部分时间在等：磁盘 IO、网络、锁、sleep、条件变量。采样只记录在 CPU 上跑的指令。', fix: '看 task-clock 是否远小于 elapsed；改用 off-CPU 分析、perf sched、perf trace、strace -c 或 eBPF 工具。' },
            { q: '多线程程序里热点看起来很分散', a: '默认按进程聚合，不同线程做不同事时会互相稀释。', fix: 'perf report --sort comm,pid,tid,symbol 或加 --tid；也用 perf top -t <tid> 单看某个线程。' }
          ] },
          { type: 'prose', title: '一条底线',
            paras: ['**永远剖析你要发布的那个构建。** 用 -O0 或专门改过的「好分析」版本得出的热点排序，和线上真实二进制可能完全不同。正确做法是保持 -O2/-O3，只额外加 -g 与栈回溯参数，并把 debuginfo 分离保存。'] }
        ]
      },

      /* ---------------------------------------------------------- 9 */
      {
        id: 'quiz', title: '结业测验', kicker: 'CHECK YOURSELF', minutes: 6,
        blocks: [
          { type: 'quiz', id: 'perf-quiz', title: '8 道题，检验你是否真的建立了模型', questions: [
            { q: 'perf stat 和 perf record 最本质的区别是什么？', options: [
              'stat 更快，record 更准',
              'stat 精确计数事件总量，record 周期性采样并保留调用栈/指令地址',
              'stat 只能看用户态，record 能看内核态',
              'stat 需要 root，record 不需要'
            ], answer: 1, explain: 'stat 是 counting：跑完读一次计数器，得到总量。record 是 sampling：事件溢出时中断、抓快照，得到分布。前者回答「多少」，后者回答「在哪」。' },
            { q: 'perf stat 显示 IPC = 0.70、branch-misses 0.5%、cache-misses 78%，最合理的推断是？', options: [
              '分支预测写得太差，应该重写 if/else',
              'CPU 大量周期在等内存，先查访问局部性',
              '程序被频繁抢占，应该减少线程数',
              '编译器没开优化，重新用 -O3 编译就好'
            ], answer: 1, explain: '分支预测失败率很健康、上下文切换没有异常，唯一显著异常是缓存失效；IPC 低正是流水线等内存的表现。' },
            { q: '想让 perf report 显示 C++ 函数名和源码行，编译参数应该是？', options: [
              'g++ -O0 -pg -o app app.cpp',
              'g++ -O2 -s -o app app.cpp',
              'g++ -O2 -g -fno-omit-frame-pointer -o app app.cpp',
              'g++ -O2 -DNDEBUG -o app app.cpp'
            ], answer: 2, explain: '-O2 保持真实优化等级，-g 提供符号/行号，-fno-omit-frame-pointer 让调用栈可靠。-pg 是 gprof 的插桩，-s 是 strip 掉符号，都是反效果。' },
            { q: '为什么常用 -F 99 而不是 -F 100？', options: [
              '99 是内核允许的最大值',
              '避免与程序中 100Hz 的周期性任务锁步，减少系统性采样偏差',
              '100Hz 需要 root 权限',
              '奇数频率能让样本更均匀分布'
            ], answer: 1, explain: '采样如果和被测程序的周期行为同步，会系统性地只采到某一类状态。用 99（或 997）这类质数/非整频率可打散这种锁步。' },
            { q: 'perf report 里 71% 的 Overhead 指的是？', options: [
              '该函数占程序运行时间的精确 71%',
              '该函数消耗了 71% 的 CPU 周期（精确计数）',
              '落在该符号上的样本数占总样本数的 71%',
              '该函数被调用了总次数的 71%'
            ], answer: 2, explain: '采样是统计估计：百分比 = 该符号样本数 / 总样本数。样本越少波动越大，短函数可能完全不被采到。' },
            { q: '程序很慢，但 perf record 几乎采不到样本。最可能的原因？', options: [
              '采样频率设置得太低了',
              '程序大部分时间在等 IO / 锁 / sleep，属于 off-CPU 问题',
              '没有加 -g 编译',
              'perf.data 文件损坏了'
            ], answer: 1, explain: 'perf 只记录在 CPU 上执行的指令。对比 task-clock 与 elapsed：若前者远小于后者，就该转向 off-CPU 分析（perf sched / trace / strace / eBPF）。' },
            { q: '改完代码后，最有说服力的验证方式是？', options: [
              '再跑一次程序，感觉快了就行',
              'perf report 里看不到那个函数了',
              '保留旧 perf.data，用 perf diff 对比热点占比，并配合 perf stat --repeat 看耗时方差',
              '把 -O2 换成 -O3 再测一次'
            ], answer: 2, explain: '既要相对证据（perf diff 的占比变化），也要绝对证据（stat --repeat 的耗时与方差）。单次测量会被机器波动欺骗。' },
            { q: '在容器里跑 perf，下面哪个说法是对的？', options: [
              '只要宿主机装了 perf，容器里一定能用',
              '容器内的 perf 版本要和宿主机内核匹配，且通常需要额外 capability（PERFMON/SYS_ADMIN）',
              '容器里必须用 root 才能采样，没有别的办法',
              '容器不支持硬件事件，只能完全放弃 perf'
            ], answer: 1, explain: 'perf 通过 perf_event_open 访问宿主机内核的能力，版本需与宿主机内核匹配；容器默认能力集里没有 PERFMON，云主机 PMU 也可能未透传，此时可退回软件事件。' }
          ] }
        ]
      },

      /* --------------------------------------------------------- 10 */
      {
        id: 'finish', title: '带走这张卡', kicker: 'TAKEAWAY', minutes: 3,
        blocks: [
          { type: 'cards', title: '一页纸流程', items: [
            { icon: '1', title: '测整体', text: 'perf stat -d -- ./app → 看 IPC / cache-miss / ctx-switches，判定瓶颈类型。' },
            { icon: '2', title: '定位置', text: 'perf record -F 99 -g -- ./app → perf report；必要时 --children / annotate。' },
            { icon: '3', title: '看路径', text: '火焰图或 perf script，弄清是谁把热函数调用起来的。' },
            { icon: '4', title: '改 + 复测', text: '只改一处 → perf stat --repeat 5 与 perf diff 双重验证 → 再改下一处。' }
          ] },
          { type: 'compare', title: '什么时候不该用 perf（该换工具了）', head: ['症状', '更合适的工具'], rows: [
            ['堆内存泄漏 / 越界 / 未初始化值', 'Valgrind memcheck 或 ASan/LSan —— 见本课程第 02 课'],
            ['程序在等锁、等 IO、频繁睡眠', 'off-CPU 分析、perf sched、strace -c、eBPF'],
            ['多线程数据竞争', 'ThreadSanitizer、Helgrind、DRD'],
            ['需要精确到每一次函数调用的耗时', 'gprof / 手工插桩 /  tracing（采样不适合极短函数）'],
            ['缓存行为想做指令级模拟', 'Valgrind Cachegrind + KCachegrind']
          ] },
          { type: 'checklist', id: 'perf-check', title: '结业清单（勾选会保存进度）', items: [
            { text: '我能解释 counting 与 sampling 的区别', hint: '心智模型' },
            { text: '我在自己的机器上成功跑出过 perf stat 的数字', hint: '环境' },
            { text: '我知道 -O2 -g -fno-omit-frame-pointer 各自解决什么问题', hint: '编译' },
            { text: '我能从 IPC 与 cache-misses 推断瓶颈类型', hint: '读输出' },
            { text: '我能用 -g 采到调用栈并处理 [unknown]', hint: '分析' },
            { text: '我会用 perf diff / --repeat 验证一次优化', hint: '闭环' }
          ] }
        ]
      }
    ]
  };
  window.LAB_DATA.tools.push(COURSE);
})();
