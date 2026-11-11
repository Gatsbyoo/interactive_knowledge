/* =====================================================================
 *  课程 02：Valgrind —— 把「内存好像漏了」变成一份带行号的判决书
 * ===================================================================== */
(function () {
  const COURSE = {
    id: 'valgrind',
    name: 'valgrind',
    tagline: '越界、释放后使用、未初始化值、泄漏：一次全看见',
    color: '#0f766e',
    icon: 'V',
    level: '入门 → 能独立排查 C++ 内存错误并把检查接进 CI',
    minutes: 50,
    summary: 'Valgrind 是一套动态二进制插桩框架，Memcheck 是它最常用的工具。它把你的程序放到一个「虚拟 CPU」上执行，因此能逐字节跟踪内存是否合法、值是否初始化。这一课从这套机制讲起，用一个同时包含 4 类错误的 C++ 程序，练到能独立读懂整份报告。',
    goals: [
      '理解 Valgrind 为什么不需要重新编译，以及为此付出的代价',
      '能区分 Invalid read/write、uninitialised value、mismatched free、泄漏四类报告',
      '能解释 definitely / indirectly / possibly lost / still reachable 四种泄漏分类',
      '知道怎么用 RAII 减少问题、怎么用抑制文件和 --error-exitcode 接进 CI'
    ],
    prereq: [
      'Linux 环境（Valgrind 主要支持 Linux；macOS 支持有限，Windows 用 WSL2）',
      'g++ 与基础 shell 操作',
      '一个能跑几秒到几十秒的最小复现用例（Valgrind 很慢，别拿全量压测喂它）'
    ],

    sections: [
      /* ---------------------------------------------------------- 0 */
      {
        id: 'start', title: '开始之前', kicker: 'ORIENTATION', minutes: 3,
        blocks: [
          { type: 'prose', title: '它解决的是另一类「没有报错」的问题',
            lead: '程序不崩溃、日志干净，但内存一路涨；或者偶尔在某台机器上崩，复现不了。这类问题 perf 帮不上忙。',
            paras: [
              'C++ 里最折磨人的错误，往往**不会立刻崩溃**：写越界覆盖了别人的对象、用了已经释放的内存、读了一个没初始化的变量、new 完忘了 delete。它们可能几小时后才以完全无关的方式爆出来。',
              'Valgrind 的 Memcheck 会把这些「未定义行为」变成**带文件名和行号的即时报告**。它不需要你改代码、不需要重新编译成特殊版本（但建议带 -g），代价是程序会慢 10~50 倍。',
              '另外要建立一个重要认知：Valgrind 是**一个框架**，Memcheck 只是其中一个工具。同一个框架下还有 Cachegrind（缓存模拟）、Callgrind（调用图）、Massif（堆内存随时间变化）、Helgrind / DRD（数据竞争）。学完 Memcheck，其他的只是换个 `--tool`。'
            ],
            note: { kind: 'info', title: '和上一课的关系', text: 'perf 回答「哪里慢」，Valgrind 回答「哪里错」。两者互不替代，但共用同一套排查思路：先建立心智模型 → 最小复现 → 读懂输出 → 修复 → 复测。这个网页里两课的章节结构完全一样，就是为了方便你横向对照。' } },
          { type: 'roadmap', title: '这一课的路线', items: [
            { title: '建立心智模型', text: '虚拟 CPU、影子内存、definedness 与 addressability', mins: 7 },
            { title: '环境自检', text: '安装、编译参数、第一条 valgrind 命令', mins: 5 },
            { title: '5 分钟最小闭环', text: '用拼装器搭命令，跑一遍看报告长什么样', mins: 7 },
            { title: 'C++ 实验程序', text: '一个程序里藏 4 类错误 + 4 种泄漏状态', mins: 7 },
            { title: '读懂输出', text: '逐行点开错误报告与 LEAK SUMMARY', mins: 13 },
            { title: '实战任务', text: '自己决定下一步该加哪个参数', mins: 5 },
            { title: '速查 / 避坑 / 测验', text: '工具家族、抑制文件、CI 集成', mins: 10 }
          ] },
          { type: 'cards', title: '先记住这三个词', items: [
            { icon: '01', title: 'Addressability 可寻址性', text: '这一字节现在允不允许被读/写：有没有被分配、是不是越界、是不是已经 free。Memcheck 用一张影子位图（shadow memory）给每个字节做标记。' },
            { icon: '02', title: 'Definedness 定义性', text: '这一字节里的值有没有被初始化。Memcheck 用 V bits 跟着每一位的「是否已定义」一起传播，所以能发现「用一个未初始化的 int 去做判断」。' },
            { icon: '03', title: 'Loss record 泄漏记录', text: '程序退出时还活着的堆块，按「还能不能找到指向它的指针」分成 definitely / indirectly / possibly lost 和 still reachable。' }
          ] }
        ]
      },

      /* ---------------------------------------------------------- 1 */
      {
        id: 'model', title: '心智模型', kicker: 'MENTAL MODEL', minutes: 7,
        blocks: [
          { type: 'prose', title: '它不是调试器，是一个「虚拟 CPU」',
            paras: [
              '普通程序：机器码直接跑在真 CPU 上。Valgrind 程序：Valgrind 先把你的机器码一小块一小块地**反汇编并翻译成中间表示（VEX IR）**，在插桩代码里加上「检查这块内存合法吗」「这个值初始化过吗」，再把 IR 翻译回机器码执行。你的程序始终跑在一个被 Valgrind 模拟的 CPU 上。',
              '这解释了三件事：**① 不用重新编译**（它读的是最终的二进制）；**② 会很慢**（每条指令周围都多了检查，通常 10~50 倍）；**③ 连没有源码的第三方库也能查**（只是报告里没有行号）。',
              '它同时维护两张影子表：一张记录每字节「可寻址性」，一张记录每位的「定义性」（V bits）。算术指令会传播 V bits，所以当未初始化的值参与 `+`/`-`/比较时，结果也会被标记为未定义——但 Memcheck **不会立刻报错**，只有当未定义的值影响程序行为（条件跳转、系统调用参数、地址计算）时才报。' ],
            note: { kind: 'warn', title: '由此产生一个经典困惑', text: '「Conditional jump or move depends on uninitialised value(s)」报的位置，往往不是变量声明的地方，而是它第一次被拿去做判断/IO 的地方。要找源头，必须开 --track-origins=yes。' } },
          { type: 'compare', title: 'Memcheck 能查什么、不能查什么', head: ['', '能查', '查不到 / 要换工具'], rows: [
            ['越界', '堆块越界读写（包括 off-by-one）', '栈上数组越界、全局数组越界（Memcheck 能力有限，用 ASan）'],
            ['生命周期', 'use-after-free、double free、new[]/delete 不匹配', '数据竞争（用 Helgrind / DRD / TSan）'],
            ['初始化', '未初始化值影响分支、系统调用、指针', '静态存储区、某些编译器优化后消失的变量'],
            ['泄漏', '程序退出时所有未释放堆块及分类', '运行期持续增长但不退出（用 Massif 看趋势）'],
            ['其他', '非法系统调用参数、重叠 memcpy', '逻辑错误、算法错误、性能问题']
          ] },
          { type: 'cards', title: '四种泄漏状态（面试常问）', items: [
            { icon: 'D', title: 'definitely lost 确定丢失', text: '找不到任何指向这块内存的指针了。真 bug，必须修。', tone: 'err' },
            { icon: 'I', title: 'indirectly lost 间接丢失', text: '块本身有指针，但指向它的父块已经 definitely lost（典型：链表头丢了，后面的节点全是间接丢失）。修好父块通常一起消失。' },
            { icon: 'P', title: 'possibly lost 可能丢失', text: '只找到指向块「内部某处」的指针（可能是故意的指针运算，也可能是悬野指针）。要人工判断。' },
            { icon: 'S', title: 'still reachable 仍可达', text: '程序退出时还有指针指着它：全局缓存、单例、静态容器。通常不算泄漏，但值得确认是不是忘了清理。默认报告不显示，需 --show-leak-kinds=all。', tone: 'ok' }
          ] },
          { type: 'prose', title: '一句忠告',
            paras: ['**最好的 Valgrind 报告是一份干净的报告，而不是一份你能看懂的报告。** 现代 C++ 里 90% 的这类问题可以被 `std::vector`、`std::string`、`std::unique_ptr`、值语义和 RAII 在编译期就消灭。Valgrind 真正的战场是：遗留代码、C API 边界、第三方库、手写内存池，以及「我以为这里没问题」的验证环节。'] }
        ]
      },

      /* ---------------------------------------------------------- 2 */
      {
        id: 'setup', title: '环境自检', kicker: 'SETUP', minutes: 5,
        blocks: [
          { type: 'steps', title: '三步就绪', items: [
            { title: '安装', text: '大多数发行版仓库里都有。macOS 支持有限（新系统常装不上），Windows 请走 WSL2。', cmd: 'sudo apt install valgrind          # Debian/Ubuntu\nsudo dnf install valgrind          # Fedora/RHEL' },
            { title: '用「适合被检查」的方式编译', text: '-g 给行号；-O0（或 -O1）让行号与源码一一对应；-fno-inline 保留函数边界。-O2 也能跑，但优化会内联、消除变量，报告可能变得难读。', cmd: 'g++ -g -O0 -fno-inline -o leaky leaky.cpp' },
            { title: '跑第一条命令', text: '--leak-check=full 打开详细泄漏检查；--track-origins=yes 给未初始化值溯源。', cmd: 'valgrind --leak-check=full --show-leak-kinds=all --track-origins=yes ./leaky' }
          ] },
          { type: 'terminal', id: 'vg-setup', title: '自己敲一遍（模拟终端）', prompt: 'dev@lab:~/vg$',
            intro: '输入 help 看可用命令。注意 Valgrind 报告里每行的 ==20847== 是进程 PID，不是错误编号。',
            suggestions: ['valgrind --version', 'g++ -g -O0 -fno-inline -o leaky leaky.cpp', 'valgrind ./leaky', 'valgrind --leak-check=full ./leaky', 'ls'],
            commands: [
              { cmd: 'valgrind --version', out: [{ t: 'valgrind-3.22.0', c: 'ok' }] },
              { cmd: 'uname -m', out: ['x86_64', { t: '→ Valgrind 支持 x86 / amd64 / arm64 / ppc 等常见架构', c: 'dim' }] },
              { cmd: 'g++ -g -O0 -fno-inline -o leaky leaky.cpp', out: [{ t: '✓ 编译完成，没有警告。-g 会在可执行文件里写入行号表', c: 'ok' }, { t: '→ 真实项目里可以对已经 -O2 编译的产物直接跑 valgrind，只是报告可读性差一些', c: 'dim' }] },
              { cmd: 'valgrind ./leaky', out: [
                { t: '==20847== Memcheck, a memory error detector', c: 'head' },
                { t: '==20847== Copyright (C) 2002-2022, and GNU GPL\'d, by Julian Seward et al.', c: 'dim' },
                { t: '==20847== Using Valgrind-3.22.0 and LibVEX; rerun with -h for copyright info', c: 'dim' },
                { t: '==20847== Command: ./leaky', c: '' },
                { t: '==20847==', c: '' },
                { t: '==20847== Invalid write of size 4', c: 'err' },
                { t: '==20847==    at 0x1091C6: make_buffer() (leaky.cpp:10)', c: '' },
                { t: '==20847==    by 0x109234: main (leaky.cpp:21)', c: '' },
                { t: '==20847== HEAP SUMMARY:', c: 'head' },
                { t: '==20847==     in use at exit: 88 bytes in 4 blocks', c: 'warn' },
                { t: '==20847==   total heap usage: 5 allocs, 1 frees, 96 bytes allocated', c: '' },
                { t: '==20847== ERROR SUMMARY: 4 errors from 4 contexts (suppressed: 0 from 0)', c: 'err' },
                { t: '→ 不加 --leak-check=full 时，只看到「有内存没释放」，看不到是谁分配的', c: 'accent' }
              ] },
              { cmd: 'valgrind --leak-check=full ./leaky', out: [
                { t: '==20847== 40 bytes in 1 blocks are definitely lost in loss record 2 of 4', c: 'err' },
                { t: '==20847==    at 0x4849013: operator new[](unsigned long) (vg_replace_malloc.c:640)', c: '' },
                { t: '==20847==    by 0x1091B7: make_buffer() (leaky.cpp:9)', c: '' },
                { t: '==20847==    by 0x109234: main (leaky.cpp:21)', c: '' },
                { t: '==20847==', c: '' },
                { t: '==20847== LEAK SUMMARY:', c: 'head' },
                { t: '==20847==    definitely lost: 48 bytes in 2 blocks', c: 'err' },
                { t: '==20847==    indirectly lost: 8 bytes in 1 blocks', c: 'warn' },
                { t: '==20847==      possibly lost: 0 bytes in 0 blocks', c: '' },
                { t: '==20847==    still reachable: 32 bytes in 1 blocks', c: 'ok' },
                { t: '→ 有了分配调用栈，就能直接定位到 leaky.cpp:9', c: 'accent' }
              ] },
              { cmd: 'valgrind --tool=memcheck --leak-check=full --show-leak-kinds=all --track-origins=yes ./leaky', out: [
                { t: '==20847== Memcheck, a memory error detector', c: 'head' },
                { t: '==20847== Command: ./leaky', c: '' },
                { t: '==20847==', c: '' },
                { t: '==20847== Conditional jump or move depends on uninitialised value(s)', c: 'err' },
                { t: '==20847==    at 0x10925A: main (leaky.cpp:24)', c: '' },
                { t: '==20847==  Uninitialised value was created by a stack allocation', c: 'ok' },
                { t: '==20847==    at 0x109220: main (leaky.cpp:23)', c: '' },
                { t: '==20847== ... (完整报告见下一章「读懂输出」)', c: 'dim' },
                { t: '==20847== ERROR SUMMARY: 4 errors from 4 contexts (suppressed: 0 from 0)', c: 'err' }
              ] },
              { cmd: 'ls', out: ['leaky.cpp   fixed.cpp   leaky', { t: '→ 实验代码已就绪', c: 'dim' }] },
              { cmd: 'cat leaky.cpp', out: [{ t: '（源码较长，请看下一章的代码标签页）', c: 'dim' }] }
            ] },
          { type: 'prose', title: '报告头部的三行别跳过',
            paras: [
              '`Memcheck, a memory error detector` 告诉你当前用的是哪个工具；`Command: ./leaky` 记录被检查的命令行（CI 日志里很有用）；`==20847==` 前缀是 **PID**，多进程程序里靠它区分是哪个进程报的（配 `--trace-children=yes`）。',
              '错误数量看最后一行 `ERROR SUMMARY`。注意它统计的是**错误种类/上下文数**，不是「发生了多少次」——同一行代码在一个循环里错一万次，通常也只算 1 个 context。'
            ] }
        ]
      },

      /* ---------------------------------------------------------- 3 */
      {
        id: 'first', title: '5 分钟最小闭环', kicker: 'QUICK WIN', minutes: 7,
        blocks: [
          { type: 'prose', title: '一条命令，四个开关',
            lead: 'Memcheck 的默认行为比较保守。日常排查建议固定用下面这组参数，形成肌肉记忆。',
            paras: [
              '`--leak-check=full`：给出每块泄漏内存的完整分配调用栈。',
              '`--show-leak-kinds=all`：把 still reachable / possibly lost 也列出来，避免漏掉线索。',
              '`--track-origins=yes`：未初始化值溯源（明显更慢，但对疑难问题价值极高）。',
              '`--num-callers=30`：调用栈默认只显示 12 层，深层模板代码经常被截断。'
            ] },
          { type: 'builder', title: '命令拼装器：搭一条自己的 valgrind', base: 'valgrind',
            groups: [
              { label: '① 选工具（不选就是 Memcheck）', opts: [
                { flag: '--tool=memcheck', label: 'memcheck', desc: '内存错误 + 泄漏（默认）', on: true, effect: '检查非法读写、未初始化值、释放/分配不匹配和内存泄漏。' },
                { flag: '--tool=massif', label: 'massif', desc: '堆内存随时间变化', on: false, effect: '按时间采样堆占用，用 ms_print 看「内存是在哪段代码涨上去的」，适合查缓存无限增长。' },
                { flag: '--tool=cachegrind', label: 'cachegrind', desc: '缓存命中模拟', on: false, effect: '模拟 L1/L2/LLC，输出每个函数/源码行的失效次数，配合 cg_annotate 或 KCachegrind。' },
                { flag: '--tool=helgrind', label: 'helgrind', desc: '线程错误', on: false, effect: '检测数据竞争、锁顺序问题、POSIX pthreads 误用（Memcheck 不查这些）。' }
              ] },
              { label: '② 检查力度', opts: [
                { flag: '--leak-check=full', label: '--leak-check=full', desc: '每块泄漏都给调用栈', on: true, effect: '从「有 N 字节没释放」升级为「这 N 字节是在 leaky.cpp 第 9 行分配的」。' },
                { flag: '--show-leak-kinds=all', label: '--show-leak-kinds=all', desc: '显示 still reachable 等全部类别', on: true, effect: '把 still reachable、possibly lost 一起列出来，便于判断是全局缓存还是真泄漏。' },
                { flag: '--track-origins=yes', label: '--track-origins=yes', desc: '未初始化值溯源', on: false, effect: '额外报告未初始化值是「在哪里被创建」的。代价：更慢、内存开销更大，只在需要时开。' },
                { flag: '--num-callers=30', label: '--num-callers=30', desc: '调用栈显示 30 层', on: false, effect: '模板/回调很深的 C++ 代码里，默认 12 层经常被截断，看不到自己的调用点。' }
              ] },
              { label: '③ 输出与 CI', opts: [
                { flag: '--error-exitcode=42', label: '--error-exitcode=42', desc: '有错误就返回非零退出码', on: false, effect: '让 CI 在有内存错误时失败。默认 Valgrind 即使报错也返回被测程序的退出码。' },
                { flag: '--log-file=vg.log', label: '--log-file=vg.log', desc: '报告写文件', on: false, effect: '把报告落到文件，便于归档为 CI artifact；支持 %p 占位符带 PID。' },
                { flag: '--suppressions=3rd.supp', label: '--suppressions', desc: '屏蔽第三方库误报', on: false, effect: '先用 --gen-suppressions=all 生成模板，再把第三方库的已知噪声过滤掉。' },
                { flag: '-q', label: '-q 安静模式', desc: '只输出错误', on: false, effect: '去掉版本信息和统计横幅，日志更干净。' }
              ] },
              { label: '④ 目标程序（-- 后是它自己的参数）', opts: [
                { flag: './leaky', label: './leaky', desc: '被测程序', on: true, effect: 'Valgrind 会把后面所有参数原样传给被测程序。' },
                { flag: '--trace-children=yes', label: '跟踪子进程', desc: '程序会 fork/exec 时', on: false, effect: '连子进程一起检查，日志里用不同 PID 区分。' }
              ] }
            ] },
          { type: 'terminal', id: 'vg-first', title: '看看同一程序，不同参数给出的信息量差别', prompt: 'dev@lab:~/vg$',
            intro: '依次试：裸跑 → 加 leak-check → 加 track-origins → 接 CI。',
            suggestions: ['valgrind ./leaky', 'valgrind --leak-check=full ./leaky', 'valgrind --leak-check=full --track-origins=yes ./leaky', 'valgrind --error-exitcode=42 ./leaky; echo $?'],
            commands: [
              { cmd: 'valgrind ./leaky', out: [
                { t: '==20847== HEAP SUMMARY:', c: 'head' },
                { t: '==20847==     in use at exit: 88 bytes in 4 blocks', c: 'warn' },
                { t: '==20847==   total heap usage: 5 allocs, 1 frees, 96 bytes allocated', c: '' },
                { t: '==20847== ERROR SUMMARY: 4 errors from 4 contexts', c: 'err' },
                { t: '→ 只知道「有 88 字节没还」，不知道是谁借的', c: 'accent' }
              ] },
              { cmd: 'valgrind --leak-check=full ./leaky', out: [
                { t: '==20847== 40 bytes in 1 blocks are definitely lost in loss record 2 of 4', c: 'err' },
                { t: '==20847==    at 0x4849013: operator new[](unsigned long)', c: '' },
                { t: '==20847==    by 0x1091B7: make_buffer() (leaky.cpp:9)', c: '' },
                { t: '==20847==    by 0x109234: main (leaky.cpp:21)', c: '' },
                { t: '→ 分配点精确到文件和行号，可以直接去改代码了', c: 'ok' }
              ] },
              { cmd: 'valgrind --leak-check=full --track-origins=yes ./leaky', out: [
                { t: '==20847== Conditional jump or move depends on uninitialised value(s)', c: 'err' },
                { t: '==20847==    at 0x10925A: main (leaky.cpp:24)', c: '' },
                { t: '==20847==  Uninitialised value was created by a stack allocation', c: 'ok' },
                { t: '==20847==    at 0x109220: main (leaky.cpp:23)', c: '' },
                { t: '→ 报错在 24 行，源头在 23 行。不开 --track-origins 就只有前半段', c: 'accent' }
              ] },
              { cmd: 'valgrind --error-exitcode=42 ./leaky; echo $?', out: [
                { t: '==20847== ERROR SUMMARY: 4 errors from 4 contexts', c: 'err' },
                { t: '42', c: 'ok' },
                { t: '→ CI 里只要检查退出码就能拦住回归，不用人肉读日志', c: 'accent' }
              ] },
              { cmd: 'valgrind --tool=massif ./leaky', out: [
                { t: '==20851== Massif, a heap profiler', c: 'head' },
                { t: '==20851== Command: ./leaky', c: '' },
                { t: '→ 生成 massif.out.20851，用 ms_print massif.out.20851 看堆增长曲线', c: 'dim' }
              ] },
              { cmd: 'ms_print massif.out.20851 | head -25', out: [
                { t: '    KB', c: 'head' },
                { t: ' 0.096^                                    #', c: '' },
                { t: '      |                              ::::::#::::::', c: '' },
                { t: '    0 +------------------------------------------------------->ki', c: '' },
                { t: '→ 纵轴是堆占用，底下附每一段的分配调用栈，适合查「内存慢慢涨」', c: 'accent' }
              ] },
              { cmd: 'clear', out: [] }
            ] },
          { type: 'prose', title: '关于速度',
            paras: ['Valgrind 会把程序拖慢 10~50 倍，`--track-origins=yes` 更慢。所以正确用法是：**构造一个几秒内能跑完、但能复现问题的最小用例**（一个单测、一个 replay 文件、一次请求），而不是把整个服务压测流量喂给它。这也是为什么它适合进 CI 跑单测，不适合放线上。'] }
        ]
      },

      /* ---------------------------------------------------------- 4 */
      {
        id: 'code', title: 'C++ 实验程序', kicker: 'THE SUBJECT', minutes: 7,
        blocks: [
          { type: 'prose', title: '一个文件，藏了 4 类错误 + 4 类泄漏状态',
            lead: '下面这段程序短到能一眼看完，但 Valgrind 会给出一份完整的教科书式报告。',
            paras: [
              '注意最后两行 `buf = nullptr; head = nullptr;`：这不是多此一举，而是**故意丢掉最后一根指针**，让 definitely lost / indirectly lost 的分类稳定出现。如果局部变量还指着那块内存，Memcheck 退出时扫描栈仍可能把它判成 still reachable 或 possibly lost——这是真实排查里很常见的现象。',
              '`static int* g_cache = new int[8]` 是全局缓存：退出时指针还在，所以是 still reachable，通常不算 bug。'
            ] },
          { type: 'code', title: 'leaky.cpp · 待检查程序', tabs: [
            { name: 'leaky.cpp', lang: 'cpp', code: `#include <cstdio>
#include <cstring>

struct Node { int value; Node* next; };

static int* g_cache = new int[8];        // 全局缓存：退出时仍可达

[[gnu::noinline]] int* make_buffer() {
    int* p = new int[10];                // 40 B
    p[10] = 42;                          // ← 越界写（off-by-one）
    return p;
}

[[gnu::noinline]] Node* build_list() {
    Node* head = new Node{1, nullptr};   // 8 B
    head->next = new Node{2, nullptr};   // 8 B
    return head;                          // 从不释放
}

int main() {
    int* buf = make_buffer();

    int threshold;                        // ← 未初始化
    if (threshold > 0)                   // ← 依赖未初始化值的条件跳转
        std::printf("positive\\n");

    char* s = new char[8];
    std::strcpy(s, "hi");
    delete s;                            // ← 应该是 delete[]（不匹配）
    std::printf("%c\\n", s[0]);           // ← use-after-free

    Node* head = build_list();
    std::printf("%d %d\\n", buf[0], head->value);
    buf = nullptr; head = nullptr;       // 丢掉最后一根指针
    return 0;
}` },
            { name: 'fixed.cpp', lang: 'cpp', code: `// 修复后的版本：同一份逻辑，用 RAII 与值语义重写。
#include <cstdio>
#include <vector>
#include <string>

struct Node { int value; };             // 不再有裸指针链表

static std::vector<int> g_cache(8);     // 局部/静态对象自己会析构

std::vector<int> make_buffer() {
    std::vector<int> v(10);
    v.at(9) = 42;                       // at() 越界会抛异常，而不是静默破坏内存
    return v;                           // 返回时自动管理，无需 delete
}

int main() {
    auto buf = make_buffer();
    int threshold = 0;                  // 明确初始化
    if (threshold > 0) std::printf("positive\\n");

    std::string s = "hi";               // 没有 new / delete
    std::printf("%c\\n", s[0]);

    std::vector<Node> nodes{{1}, {2}};
    std::printf("%d %d\\n", buf[9], nodes[0].value);
    return 0;                           // 全部自动释放
}
// 再跑一次 valgrind：ERROR SUMMARY: 0 errors from 0 contexts` },
            { name: 'build.sh', lang: 'bash', code: `# 编译：-g 给行号，-O0 保持行号对应，-fno-inline 保留函数边界
g++ -g -O0 -fno-inline -o leaky leaky.cpp

# 日常排查（推荐固定这一组）
valgrind --leak-check=full --show-leak-kinds=all \\
         --track-origins=yes --num-callers=30 ./leaky

# 把检查接进 CI：错误时返回 42，报告存档
valgrind --leak-check=full --error-exitcode=42 \\
         --log-file=vg_%p.log ./leaky || exit 1

# 生成第三方库的抑制模板
valgrind --gen-suppressions=all --leak-check=full ./leaky 2> raw.log
# 把 { ... } 段落存成 3rd.supp，之后用 --suppressions=3rd.supp

# 工具家族：换 --tool 就够了
valgrind --tool=massif ./app && ms_print massif.out.*
valgrind --tool=cachegrind ./app && cg_annotate cachegrind.out.*
valgrind --tool=callgrind ./app && kcachegrind callgrind.out.*
valgrind --tool=helgrind ./app        # 多线程数据竞争` }
          ], note: '行号与下一章报告里的 leaky.cpp:N 是对应的。把代码存下来真跑一遍，再对照网页里的逐行解读，效果最好。' },
          { type: 'cards', title: '编译参数为什么这样选', items: [
            { icon: '-g', title: '行号是刚需', text: '没有调试信息，报告里只有 0x1091C6 这样的地址。可以用 addr2line 事后翻译，但远不如直接带 -g 省事。' },
            { icon: '-O0', title: '让源码与二进制对齐', text: '-O2 会内联、消除变量、重排指令，导致「未初始化值」的报告位置飘到奇怪的地方。注意：这不代表不能查生产二进制，只是更难读。' },
            { icon: '≠', title: '不要 -static 全静态', text: '全静态链接会让 Valgrind 的 malloc 替换失效，报告里全是 libc 内部地址。动态链接是默认且推荐的方式。' },
            { icon: 'RAII', title: '先改代码，再跑工具', text: 'std::vector / unique_ptr 能从源头消灭大部分错误。工具是用来兜底和验证的，不是用来替代设计。' }
          ] }
        ]
      },

      /* ---------------------------------------------------------- 5 */
      {
        id: 'reading', title: '读懂输出', kicker: 'READ THE EVIDENCE', minutes: 13,
        blocks: [
          { type: 'prose', title: '第一份：错误报告（4 个错误上下文）',
            lead: '**点任何一行**查看解释。重点体会「报错位置」和「根因位置」的区别。',
            paras: ['读错误块的固定套路：① 第一行看错误类型 → ② `at/by` 栈看发生在哪 → ③ `Address ... is ...` 那几行看这块内存的历史（在哪分配、在哪释放）→ ④ 对照源码找根因。'] },
          { type: 'output', title: 'Memcheck 错误报告', subtitle: '命令：valgrind --leak-check=full --show-leak-kinds=all --track-origins=yes ./leaky', lines: [
            { t: '==20847== Memcheck, a memory error detector', c: 'head', note: '工具名。==20847== 是 PID 前缀，多进程时用来区分是哪个进程报的错。' },
            { t: '==20847== Command: ./leaky', c: '', note: '记录完整的命令行，CI 日志里靠它确认检查的到底是哪次构建。' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== Invalid write of size 4', c: 'err', note: '★ 错误类型 + 访问宽度。size 4 说明写了一个 4 字节的 int。「Invalid」指这块地址当前不可写，不是「值写错了」。' },
            { t: '==20847==    at 0x1091C6: make_buffer() (leaky.cpp:10)', c: '', note: '栈顶：错误实际发生的指令位置。leaky.cpp:10 就是 p[10] = 42。' },
            { t: '==20847==    by 0x109234: main (leaky.cpp:21)', c: '', note: '调用者。C++ 模板代码里栈可能很深，必要时加 --num-callers=30。' },
            { t: '==20847==  Address 0x4e350c8 is 0 bytes after a block of size 40 alloc\'d', c: 'warn', note: '★★ 最有价值的一行：这个地址正好在「一块 40 字节内存」之后 0 字节处。40 = 10 个 int，0 bytes after = 经典的 off-by-one 越界写。Memcheck 会记住每块内存的边界，所以能精确告诉你越了多少。' },
            { t: '==20847==    at 0x4849013: operator new[](unsigned long) (vg_replace_malloc.c:640)', c: '', note: 'vg_replace_malloc.c 是 Valgrind 自己替换掉的分配器实现，不是你的代码——看到它说明「这块内存在这里被分配」。' },
            { t: '==20847==    by 0x1091B7: make_buffer() (leaky.cpp:9)', c: 'ok', note: '★ 分配点：new int[10] 在 leaky.cpp:9。结合上一行，结论是「第 9 行分配了 10 个 int，第 10 行写了第 11 个」。' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== Conditional jump or move depends on uninitialised value(s)', c: 'err', note: '★ 第二类错误：条件跳转依赖了未定义的值。注意它没说「某个变量没初始化」，而是说「这个判断的结果不可信」——这正是 V bits 传播机制的表现。' },
            { t: '==20847==    at 0x10925A: main (leaky.cpp:24)', c: '', note: '报错点是 if (threshold > 0)，leaky.cpp:24。但根因不在这行。' },
            { t: '==20847==  Uninitialised value was created by a stack allocation', c: 'ok', note: '★ 只有开了 --track-origins=yes 才会有这段。它告诉你是「栈上分配的局部变量」带来的未定义值，而不是堆内存或系统调用。' },
            { t: '==20847==    at 0x109220: main (leaky.cpp:23)', c: 'ok', note: '★★ 真正的根因：int threshold; 在 leaky.cpp:23 没有初始化。记住这个模式：报错位置 ≠ 根因位置。' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== Mismatched free() / delete / delete []', c: 'err', note: '★ 第三类错误：分配和释放方式不配对。new[] 必须配 delete[]，malloc 必须配 free，new 必须配 delete。混用在很多实现上「看起来能跑」，但是未定义行为，可能破坏堆元数据。' },
            { t: '==20847==    at 0x484A2CF: operator delete(void*) (vg_replace_malloc.c:1088)', c: '', note: '这里调用的是 operator delete（单数），而分配用的是 operator new[]。' },
            { t: '==20847==    by 0x1092A4: main (leaky.cpp:29)', c: '', note: 'leaky.cpp:29 的 delete s; 应该改成 delete[] s;。' },
            { t: '==20847==  Address 0x4e35120 is 0 bytes inside a block of size 8 alloc\'d', c: '', note: '被释放的块是 8 字节（new char[8]）。' },
            { t: '==20847==    at 0x4849013: operator new[](unsigned long) (vg_replace_malloc.c:640)', c: '', note: '确认分配方是 new[]，与释放方 delete 不匹配。' },
            { t: '==20847==    by 0x109291: main (leaky.cpp:27)', c: '', note: '分配点 leaky.cpp:27。' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== Invalid read of size 1', c: 'err', note: '★ 第四类错误：读了一块已经不可读的内存。size 1 对应 char。' },
            { t: '==20847==    at 0x1092B1: main (leaky.cpp:30)', c: '', note: 'leaky.cpp:30 的 s[0]，发生在 delete 之后 → use-after-free。' },
            { t: '==20847==  Address 0x4e35120 is 0 bytes inside a block of size 8 free\'d', c: 'warn', note: '★★ 注意这个措辞：不是「越界」，而是「在一块已释放的 8 字节内存里」。Memcheck 不会立刻把释放的内存还给系统，所以能准确识别 UAF。' },
            { t: '==20847==    at 0x484A2CF: operator delete(void*) (vg_replace_malloc.c:1088)', c: '', note: '释放发生在哪里。' },
            { t: '==20847==    by 0x1092A4: main (leaky.cpp:29)', c: 'ok', note: '★ leaky.cpp:29 释放，leaky.cpp:30 使用。释放点与使用点相邻，是最典型的 UAF 模式；真实项目里两者常隔着几层回调。' },
            { t: '==20847==  Block was alloc\'d at', c: '', note: 'Memcheck 还会补上这块内存的出生地，方便你串起完整生命周期。' },
            { t: '==20847==    at 0x4849013: operator new[](unsigned long) (vg_replace_malloc.c:640)', c: 'dim' },
            { t: '==20847==    by 0x109291: main (leaky.cpp:27)', c: 'dim' }
          ] },
          { type: 'prose', title: '一个错误块 = 一份证据链',
            paras: ['把四类错误放一起看，你会发现 Memcheck 的报告结构高度一致：**错误类型 → 发生位置 → 这块内存的来历（分配 / 释放）**。练到能自动按这个顺序扫，看到陌生错误也不会慌。'],
            note: { kind: 'ok', title: '报错数量怎么看', text: 'ERROR SUMMARY 里的数字是「错误上下文数」。同一行错一万次通常只算 1 个 context；修一个根因，往往一串报错同时消失。所以永远从第一个错误开始修，而不是从数量最多的那个。' } },
          { type: 'output', title: 'HEAP SUMMARY 与 LEAK SUMMARY', subtitle: '程序退出时，Memcheck 做一次可达性分析', lines: [
            { t: '==20847== HEAP SUMMARY:', c: 'head', note: '从这里开始是退出时的堆快照。' },
            { t: '==20847==     in use at exit: 88 bytes in 4 blocks', c: 'warn', note: '退出时还有 4 块共 88 字节没释放。注意：不等于「泄漏了 88 字节」——里面可能包含 still reachable。' },
            { t: '==20847==   total heap usage: 5 allocs, 1 frees, 96 bytes allocated', c: '', note: '整个生命周期分配 5 次共 96 字节，只释放了 1 次。allocs 与 frees 严重不平衡，提示检查分配路径。' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== 40 bytes in 1 blocks are definitely lost in loss record 2 of 4', c: 'err', note: '★★ 确定丢失：new int[10] 的 40 字节，指针已被置空，再也找不回来。这是必须修的真泄漏。「loss record 2 of 4」只是记录编号。' },
            { t: '==20847==    at 0x4849013: operator new[](unsigned long) (vg_replace_malloc.c:640)', c: '' },
            { t: '==20847==    by 0x1091B7: make_buffer() (leaky.cpp:9)', c: 'ok', note: '★ 分配调用栈直达 leaky.cpp:9。修复方式：让 make_buffer 返回 std::vector<int>，或由调用方 delete[]。' },
            { t: '==20847==    by 0x109234: main (leaky.cpp:21)', c: '' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== 8 bytes in 1 blocks are indirectly lost in loss record 1 of 4', c: 'warn', note: '★ 间接丢失：链表第二个节点。它自己被 head->next 指着，但因为 head 那块内存已经 definitely lost，指针本身也找不到了。修好父块，这一项通常自动消失。' },
            { t: '==20847==    by 0x1091F0: build_list() (leaky.cpp:16)', c: '' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== 32 bytes in 1 blocks are still reachable in loss record 4 of 4', c: 'ok', note: '★ 仍可达：全局 g_cache = new int[8]。程序退出时全局指针还在，Memcheck 认为「够得着」。这类通常是故意的全局缓存/单例，不算泄漏；但如果本该清理，也要检查。默认不显示，靠 --show-leak-kinds=all 打开。' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== LEAK SUMMARY:', c: 'head', note: '四类汇总。排查优先级：definitely → indirectly → possibly → still reachable。' },
            { t: '==20847==    definitely lost: 48 bytes in 2 blocks', c: 'err', note: '48 = 40（int[10]）+ 8（链表头）。两个真泄漏。' },
            { t: '==20847==    indirectly lost: 8 bytes in 1 blocks', c: 'warn', note: '链表第二个节点，随父块一起修。' },
            { t: '==20847==      possibly lost: 0 bytes in 0 blocks', c: '', note: '可能丢失：只找到指向块内部某处的指针。常见于手写内存池或指针运算，需要人工判断。' },
            { t: '==20847==    still reachable: 32 bytes in 1 blocks', c: '', note: '全局缓存，通常可接受。' },
            { t: '==20847==         suppressed: 0 bytes in 0 blocks', c: 'dim', note: '被抑制规则过滤掉的记录。接了第三方库后这个数字会变大，记得定期复查抑制文件是否还有效。' },
            { t: '==20847==', c: 'dim' },
            { t: '==20847== ERROR SUMMARY: 4 errors from 4 contexts (suppressed: 0 from 0)', c: 'err', note: '★ 最终目标：0 errors from 0 contexts。把这个字符串写进 CI 的判定条件，配合 --error-exitcode 使用最稳。' }
          ] },
          { type: 'cards', title: '读报告的三条经验', items: [
            { icon: '①', title: '从第一个错误开始修', text: '后面的错误常常是第一个错误破坏内存后的连锁反应。修完重跑，可能一次消失七八个。' },
            { icon: '②', title: '看分配栈，不看报错栈', text: '报错位置只说「在哪触发」，分配/释放调用栈才告诉你「这块内存的生命周期该怎么设计」。' },
            { icon: '③', title: '区分「泄漏」和「没释放」', text: 'still reachable 有指针、程序退出后 OS 也会回收；definitely lost 才是运行中持续丢内存的真问题。' }
          ] }
        ]
      },

      /* ---------------------------------------------------------- 6 */
      {
        id: 'mission', title: '实战任务', kicker: 'MISSION', minutes: 5,
        blocks: [
          { type: 'mission', title: '任务：一个「跑得越久内存越大」的 C++ 服务',
            scenario: '单测全过，服务跑几小时后 RSS 从 200MB 涨到 2GB。你有一个能在 3 秒内复现的最小用例 ./repro（启动 → 处理 1000 条请求 → 退出）。选择每一步最合适的动作。',
            steps: [
              { goal: '第 1 步：第一次上手，先跑什么？', hint: '要看到每块未释放内存的分配位置。', choices: [
                { cmd: 'valgrind --leak-check=full --show-leak-kinds=all ./repro', correct: true, why: '✓ 对。full 给出分配调用栈，show-leak-kinds=all 避免漏掉 still reachable 的线索。最小用例几秒就跑完，正好适合 Valgrind。' },
                { cmd: 'valgrind --tool=helgrind ./repro', why: 'Helgrind 查的是数据竞争和锁误用，跟内存增长不是一类问题。' },
                { cmd: 'top -p $(pidof repro)', why: '只能确认「确实在涨」，拿不到任何定位信息，而且我们已经有最小复现了。' }
              ] },
              { goal: '第 2 步：报告里有一堆 Conditional jump depends on uninitialised value，但只给了报错行，没给源头。', hint: '有一个开关专门负责溯源。', choices: [
                { cmd: 'valgrind --leak-check=full --track-origins=yes ./repro', correct: true, why: '✓ 对。--track-origins=yes 会追加「Uninitialised value was created by ...」段落，指出值在哪创建。它会让 Valgrind 更慢，因此只在需要时开。' },
                { cmd: 'valgrind --num-callers=50 ./repro', why: '增加调用栈深度解决的是「栈被截断」，不是「未初始化值从哪里来」。' },
                { cmd: 'g++ -O3 -o repro repro.cpp', why: '更高优化等级会让变量被优化掉、行号错位，反而更难查。' }
              ] },
              { goal: '第 3 步：错误里 90% 来自某个闭源第三方库，你只关心自己代码的报错。', hint: '先让 Valgrind 生成规则，再复用规则。', choices: [
                { cmd: 'valgrind --gen-suppressions=all ./repro 2> raw.log  # 摘出 { ... } 段落存为 3rd.supp，再用 --suppressions=3rd.supp', correct: true, why: '✓ 对。--gen-suppressions=all 为每条错误打印可复用的抑制规则；筛出第三方库的部分存成 .supp，之后 --suppressions=3rd.supp 过滤噪声。注意定期复查，别把真 bug 一起压掉。' },
                { cmd: 'valgrind -q ./repro', why: '-q 只是静默掉版本横幅，错误一条都不会少。' },
                { cmd: 'grep -v 3rdparty < valgrind.log', why: '按文本过滤会破坏错误块的调用栈结构，还可能误删自己的错误；用官方抑制机制才可靠。' }
              ] },
              { goal: '第 4 步：修干净了，怎么防止以后又被人写回来？', hint: '让回归在流水线里自动失败。', choices: [
                { cmd: 'valgrind --leak-check=full --error-exitcode=42 --log-file=vg_%p.log ./repro', correct: true, why: '✓ 对。--error-exitcode 让有错误时返回非零，CI 直接失败；--log-file 把完整报告存成 artifact 供排查。建议在 CI 里只跑小而快的核心单测集。' },
                { cmd: '把 valgrind 装到线上容器里，每小时跑一次', why: '10~50 倍 slowdown 会直接影响线上服务；这是离线检查工具，应该进 CI / 测试环境。' },
                { cmd: '在代码里加 assert(内存没泄漏)', why: '没有这种断言能覆盖堆的整体状态；而且 Valgrind 的价值正是不需要改被测代码。' }
              ] }
            ],
            debrief: '这套顺序可以直接搬进团队规范：**最小复现 + --leak-check=full → --track-origins 溯源 → 抑制第三方噪声 → --error-exitcode 接 CI**。工具参数会忘，但「先定位、再清噪、最后固化」的思路不会。' }
        ]
      },

      /* ---------------------------------------------------------- 7 */
      {
        id: 'cmds', title: '命令速查', kicker: 'CHEATSHEET', minutes: 5,
        blocks: [
          { type: 'cmdtable', title: 'Memcheck 参数与其他工具（可点复制）', rows: [
            { cmd: 'valgrind ./app', desc: '默认用 Memcheck 跑一次', tip: '最快看一眼有没有错误，但泄漏信息很粗略', tag: 'Memcheck' },
            { cmd: 'valgrind --leak-check=full --show-leak-kinds=all ./app', desc: '完整泄漏报告，含分配栈与全部类别', tip: '日常排查的固定起手式', tag: 'Memcheck' },
            { cmd: 'valgrind --track-origins=yes ./app', desc: '未初始化值溯源', tip: '慢很多，定位疑难「野值」时再开', tag: 'Memcheck' },
            { cmd: 'valgrind --num-callers=30 ./app', desc: '调用栈显示 30 层', tip: 'C++ 模板/回调栈很深时用', tag: 'Memcheck' },
            { cmd: 'valgrind --error-exitcode=42 ./app', desc: '发现错误时返回 42', tip: 'CI 判定就靠它；默认返回被测程序退出码', tag: 'CI' },
            { cmd: 'valgrind --log-file=vg_%p.log ./app', desc: '报告写入文件（%p = PID）', tip: '多进程 / CI artifact 场景', tag: 'CI' },
            { cmd: 'valgrind --gen-suppressions=all ./app', desc: '为每条错误打印抑制规则', tip: '把 { ... } 段落存成 .supp 供复用', tag: 'CI' },
            { cmd: 'valgrind --suppressions=3rd.supp ./app', desc: '按规则屏蔽已知噪声', tip: '不要滥用，定期复查规则', tag: 'CI' },
            { cmd: 'valgrind --trace-children=yes ./app', desc: '连 fork/exec 的子进程一起查', tip: '日志里用 PID 前缀区分进程', tag: 'CI' },
            { cmd: 'valgrind --vgdb=yes --vgdb-error=0 ./app', desc: '出错时挂上 gdb 现场调试', tip: '想在错误发生的那一刻看变量时用', tag: '进阶' },
            { cmd: 'valgrind --error-limit=no ./app', desc: '不限制错误输出条数', tip: '默认超过一定数量会停止报告', tag: '进阶' },
            { cmd: 'valgrind --tool=massif ./app', desc: '堆内存随时间剖析', tip: '产物用 ms_print massif.out.<pid> 看曲线', tag: '工具家族' },
            { cmd: 'valgrind --tool=cachegrind ./app', desc: '缓存模拟（L1/LLC 失效）', tip: '配合 cg_annotate 或 KCachegrind 看源码行', tag: '工具家族' },
            { cmd: 'valgrind --tool=callgrind ./app', desc: '调用图 + 指令计数', tip: 'KCachegrind 可视化；比 perf 慢但不需要 PMU', tag: '工具家族' },
            { cmd: 'valgrind --tool=helgrind ./app', desc: '数据竞争 / 锁顺序问题', tip: 'pthreads 程序；Memcheck 不查线程错误', tag: '工具家族' },
            { cmd: 'valgrind --tool=drd ./app', desc: '另一种线程错误检测', tip: '和 Helgrind 覆盖略有差异，可交叉验证', tag: '工具家族' },
            { cmd: 'valgrind --tool=dhat ./app', desc: '分配效率分析（短命分配、浪费）', tip: '查「分配次数过多」而非泄漏', tag: '工具家族' },
            { cmd: 'ms_print massif.out.<pid>', desc: '把 Massif 输出画成 ASCII 曲线', tip: '关注陡升段下面的分配栈', tag: '工具家族' },
            { cmd: 'cg_annotate cachegrind.out.<pid>', desc: '把 Cachegrind 结果按函数/行展开', tip: '加 --auto=yes 自动带上源码', tag: '工具家族' },
            { cmd: 'valgrind --leak-check=full --error-exitcode=42 -q ./run_unit_tests', desc: 'CI 里检查单测集', tip: '只跑小而快的用例，避免流水线被拖慢几十倍', tag: 'CI' }
          ] },
          { type: 'compare', title: 'Valgrind vs. Sanitizers（C++ 工程师必知）', head: ['', 'Valgrind Memcheck', 'ASan / LSan / MSan (编译器插桩)'], rows: [
            ['要不要重编译', '不需要，直接跑现有二进制', '需要加 -fsanitize=... 重新编译'],
            ['运行开销', '10~50 倍，内存开销也大', '约 2~3 倍，可以跑得更久'],
            ['越界 / UAF', '堆块越界、UAF 很好', '更强：还能查栈越界、全局越界、容器溢出'],
            ['未初始化值', '✅ Memcheck 直接支持', '只有 MSan 支持，且要求所有依赖库也用 MSan 编译'],
            ['泄漏分类', '四类细分，信息最全', 'LSan 主要给 definitely lost 一类'],
            ['典型用法', '离线排查、最小复现、CI 单测、无源码二进制', '日常开发构建、压测、线上灰度（低开销）'],
            ['结论', '两者互补：开发期常开 ASan，交付前 / 疑难问题用 Valgrind 复核', '']
          ] }
        ]
      },

      /* ---------------------------------------------------------- 8 */
      {
        id: 'pitfalls', title: '常见坑', kicker: 'GOTCHAS', minutes: 5,
        blocks: [
          { type: 'pitfalls', title: '点开看解法', items: [
            { q: '报告里全是 0x 地址，没有文件名和行号', a: '二进制没有调试信息，或者被 strip 了；也可能是第三方库本来就没带 debuginfo。', fix: '用 -g 重新编译自己的代码；系统库装对应的 -dbg / debuginfo 包；实在不行用 addr2line -e ./app 0x1091C6 事后翻译。' },
            { q: '为什么「未初始化值」报在 if 那一行，而不是变量声明那一行', a: 'Memcheck 用 V bits 跟踪定义性，只在未定义值真正影响程序行为（条件跳转、系统调用参数、地址计算）时才报错。', fix: '开 --track-origins=yes，看「Uninitialised value was created by ...」段落定位源头。' },
            { q: 'still reachable 一大堆，是不是内存泄漏', a: '不一定。它表示退出时还有指针可达，常见于全局缓存、单例、静态容器、iostream 内部缓冲。', fix: '确认是否是设计使然；若确实要清零，改成函数内局部静态对象或显式 shutdown()。判断是否真泄漏要看 definitely lost。' },
            { q: '报告被第三方库 / STL 的错误刷屏', a: '这些库可能用了 Valgrind 不理解的自定义内存池，或者本身有已知问题。', fix: '用 --gen-suppressions=all 生成规则，筛出第三方部分存为 .supp，再 --suppressions=xxx.supp。抑制规则要写清调用栈，别用通配把自家错误也遮掉。' },
            { q: 'Valgrind 跑到一半慢得让人想放弃', a: '10~50 倍 slowdown 是机制决定的；--track-origins=yes、Massif、Callgrind 还会更慢。', fix: '构造最小复现（一个单测、一条请求、一个小输入文件）；别拿全量压测喂它；CI 里只跑核心单测集并设超时。' },
            { q: '用 -O2 编译后报告行号对不上、变量「消失」了', a: '编译器内联、消除变量、重排指令，导致栈与源码不再一一对应。', fix: '排查期用 -g -O0 -fno-inline；发布二进制也能查，但要有「报告可读性下降」的预期。不要因为 -O2 报得少就认为代码没问题。' },
            { q: '程序用了 fork/exec，子进程好像没被检查', a: '默认只跟踪主进程。', fix: '加 --trace-children=yes，日志里用 ==PID== 区分各进程；配 --log-file=vg_%p.log 分别存档。' },
            { q: '多线程程序偶发崩溃，Memcheck 却什么都没报', a: 'Memcheck 主要查内存正确性，不做 happens-before 分析，数据竞争它基本看不见。', fix: '改用 --tool=helgrind 或 --tool=drd，或用 -fsanitize=thread 重编译。' },
            { q: '加了 -static 之后报告全是 libc 内部地址', a: '全静态链接会让 Valgrind 无法替换 malloc/new，失去对堆块的追踪能力。', fix: '改回动态链接（默认）；只在确实需要时才静态链接，同时接受报告质量下降。' },
            { q: 'macOS / Windows 上装不上或跑不起来', a: 'Valgrind 主要面向 Linux；新版 macOS 支持有限，Windows 原生不支持。', fix: 'Windows 用 WSL2；macOS 优先用 ASan/LSan 与 Instruments；也可以用 Linux 虚拟机或容器跑 Valgrind。' },
            { q: 'ERROR SUMMARY 说 1 error，但日志里刷了几百行', a: '统计的是「错误上下文数」，同一处错误重复一万次通常仍算 1 个 context。', fix: '别被行数吓到，从第一个错误块修起；修完重跑常常连锁消失一片。' }
          ] },
          { type: 'prose', title: '一条底线',
            paras: ['**不要把「Valgrind 跑过没报错」当成内存安全的证明。** 它看不见栈/全局越界、数据竞争、逻辑错误，也看不见你没触发到的那条分支。它是很强的兜底，但真正的第一道防线是 RAII、值语义、代码评审，以及开发期常开的 Sanitizer。'] }
        ]
      },

      /* ---------------------------------------------------------- 9 */
      {
        id: 'quiz', title: '结业测验', kicker: 'CHECK YOURSELF', minutes: 6,
        blocks: [
          { type: 'quiz', id: 'vg-quiz', title: '8 道题，检验你是否真的会读报告', questions: [
            { q: 'definitely lost 和 still reachable 最关键的区别是？', options: [
              '前者字节数更大',
              '前者退出时已找不到任何指针，后者仍有指针可达',
              '前者发生在堆上，后者发生在栈上',
              '前者一定会导致崩溃，后者完全无害'
            ], answer: 1, explain: 'Memcheck 在退出时做可达性分析：找不到指针 = definitely lost（真泄漏）；还能从全局/静态指针走到 = still reachable（通常是故意的缓存或单例）。' },
            { q: '--track-origins=yes 的作用与代价是？', options: [
              '增加调用栈深度；几乎没有代价',
              '追踪未初始化值在哪里被创建；会明显变慢、内存开销更大',
              '追踪泄漏内存的分配位置；需要 root',
              '开启子进程跟踪；只在多进程程序有效'
            ], answer: 1, explain: '它给 V bits 增加来源追踪，报告里会多出「Uninitialised value was created by ...」。代价是显著变慢，所以按需开启。' },
            { q: 'Valgrind 为什么不需要重新编译程序？', options: [
              '因为它读取内核的 /proc 信息',
              '因为它只是包了一层 strace',
              '因为它在运行时把机器码翻译成 VEX IR 并插桩，在虚拟 CPU 上执行',
              '因为编译器默认就带上了检查代码'
            ], answer: 2, explain: '动态二进制插桩（DBI）：运行时反汇编 → 翻译成 IR → 插入检查 → 再翻译回机器码。代价是 10~50 倍 slowdown。' },
            { q: '报告显示 Conditional jump depends on uninitialised value(s)，最合理的理解是？', options: [
              '这个 if 语句写错了',
              '某个值从创建起就没初始化，直到这里第一次影响程序行为才被报告',
              'CPU 分支预测失败',
              '内存被释放后又被读取'
            ], answer: 1, explain: 'V bits 会随算术传播，Memcheck 只在未定义值影响条件跳转/系统调用/地址时才报。因此报错位置常常不是根因位置，需要 --track-origins=yes。' },
            { q: '为了让报告最易读，排查期推荐的编译参数是？', options: [
              'g++ -O3 -s -static',
              'g++ -g -O0 -fno-inline',
              'g++ -pg -O2',
              'g++ -DNDEBUG -flto'
            ], answer: 1, explain: '-g 提供行号，-O0 保持源码与指令对应，-fno-inline 保留函数边界。-static 会破坏 Valgrind 的 malloc 替换，-s 会 strip 掉符号。' },
            { q: '用 new[] 分配、却用 delete（不带 []）释放，Memcheck 会报什么？', options: [
              'Invalid write of size 8',
              'Mismatched free() / delete / delete []',
              'definitely lost',
              'Conditional jump or move depends on uninitialised value(s)'
            ], answer: 1, explain: '分配与释放方式必须配对：new ↔ delete、new[] ↔ delete[]、malloc ↔ free。混用是未定义行为，可能破坏堆元数据。' },
            { q: '要把 Valgrind 接进 CI，最关键的参数组合是？', options: [
              '--tool=cachegrind --vgdb=yes',
              '--error-exitcode=42 --log-file=vg_%p.log（配合小而快的用例）',
              '-q --num-callers=50',
              '--trace-children=yes --show-leak-kinds=all'
            ], answer: 1, explain: '默认即使报错也返回被测程序的退出码，CI 会误判通过。--error-exitcode 让错误变成失败，--log-file 保存报告；同时要用最小用例控制耗时。' },
            { q: '关于 Valgrind 与 AddressSanitizer，哪个说法是对的？', options: [
              'ASan 不需要重新编译，Valgrind 需要',
              '两者开销差不多',
              'Valgrind 能查未初始化值且无需重编译；ASan 更快、还能查栈/全局越界',
              'Valgrind 能查数据竞争，ASan 不能'
            ], answer: 2, explain: 'ASan 是编译期插桩（需重编译，约 2~3 倍开销），覆盖栈/全局越界更强；Valgrind 免重编译、支持未初始化值（MSan 才对应，且要求全量重编），但不查数据竞争（那是 Helgrind/TSan 的活）。' }
          ] }
        ]
      },

      /* --------------------------------------------------------- 10 */
      {
        id: 'finish', title: '带走这张卡', kicker: 'TAKEAWAY', minutes: 3,
        blocks: [
          { type: 'cards', title: '一页纸流程', items: [
            { icon: '1', title: '最小复现', text: '一个几秒能跑完、能稳定触发问题的用例；-g -O0 -fno-inline 编译。' },
            { icon: '2', title: '完整报告', text: '--leak-check=full --show-leak-kinds=all --track-origins=yes --num-callers=30。' },
            { icon: '3', title: '按证据链修', text: '错误类型 → 发生栈 → 分配/释放栈；从第一个错误修起，修完立刻重跑。' },
            { icon: '4', title: '固化', text: '抑制第三方噪声 → --error-exitcode 接 CI → 目标是 ERROR SUMMARY: 0 errors。' }
          ] },
          { type: 'compare', title: '两个工具，怎么选', head: ['你的问题', '去哪一门课'], rows: [
            ['程序慢、CPU 高、IPC 低、缓存失效高', 'perf —— perf stat 判类型 → perf record -g 找位置 → perf diff 验证'],
            ['内存涨、越界、UAF、未初始化值', 'Valgrind Memcheck / ASan'],
            ['内存随时间增长但退出时不算泄漏', 'Valgrind Massif + ms_print'],
            ['缓存行为想做指令级模拟（没有 PMU）', 'Valgrind Cachegrind + KCachegrind'],
            ['多线程数据竞争', 'Helgrind / DRD / ThreadSanitizer'],
            ['又慢又可能有内存错误', '先用 perf 分开「慢」和「错」，再分别验证；不要混在一次实验里下结论']
          ] },
          { type: 'checklist', id: 'vg-check', title: '结业清单（勾选会保存进度）', items: [
            { text: '我能解释 Valgrind 为什么不用重编译、为什么慢', hint: '心智模型' },
            { text: '我在自己的机器上跑出过一份带行号的泄漏报告', hint: '环境' },
            { text: '我能区分 4 种错误类型和 4 种泄漏分类', hint: '读输出' },
            { text: '我知道 --track-origins=yes 什么时候该开', hint: '参数' },
            { text: '我会用抑制文件处理第三方库噪声', hint: '工程化' },
            { text: '我知道怎么把检查接进 CI 而不拖垮流水线', hint: '闭环' }
          ] }
        ]
      }
    ]
  };
  window.LAB_DATA.tools.push(COURSE);
})();
