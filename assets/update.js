/* =====================================================================
 *  自动检查更新（纯静态、无后端、不上传任何数据）
 *
 *  原理：页面定期读取同目录下的 version.json（带 cache-bust），
 *  把其中的内容指纹 revision 与浏览器本地记录的已见版本比较。
 *  指纹一致 = 已最新；不一致 = 弹出非阻塞提示条，由用户决定是否刷新。
 *  学习进度另存于 localStorage 的 lab-training-state-v1，刷新不会丢失。
 *
 *  version.json 由 scripts/bump-version.js / GitHub Actions 自动维护，
 *  课程数据一变，指纹就会变，用户端无需任何配置即可收到提示。
 * ===================================================================== */
(function () {
  'use strict';

  const KEY = 'lab-update-state-v1';
  const INTERVAL = 30 * 60 * 1000;      // 每 30 分钟自动检查
  const VISIBLE_GAP = 5 * 60 * 1000;    // 标签页重新可见时的最小检查间隔
  const SNOOZE = 6 * 60 * 60 * 1000;    // 「稍后提醒」静默 6 小时
  const GRACE = 45 * 1000;              // 新构建宽限期，等 Pages 部署完成

  let timer = null, graceTimer = null, remote = null, sessionDismissed = false;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function defaults() {
    return { seenRevision: null, dismissedAt: 0, lastCheck: 0, lastOk: null,
      reason: '', version: null, revision: null };
  }
  function load() {
    try { return Object.assign(defaults(), JSON.parse(localStorage.getItem(KEY) || '{}')); }
    catch (e) { return defaults(); }
  }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* noop */ } }
  function toast(msg) {
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => { t.hidden = true; }, 2100);
  }
  function setDot(on) {
    const d = document.querySelector('#btnCheckUpdate .update-dot');
    if (d) d.hidden = !on;
  }
  function hideBanner() { const b = $('updateBanner'); if (b) b.hidden = true; }
  function showBanner(v) {
    const b = $('updateBanner'); if (!b) return;
    $('ubVersion').textContent = v.version ? '· v' + v.version : '';
    const hist = (v.history || []).slice(0, 2).map(h => '· ' + h.note).join('　');
    $('ubNote').textContent = (v.note || '课程内容已更新') + (hist ? '　｜　最近更新：' + hist : '');
    b.hidden = false;
  }
  function renderStatus() {
    const el = $('verLine'); if (!el) return;
    const s = load();
    const ver = s.version ? 'v' + esc(s.version) : '版本未知';
    const rev = (s.revision || '—').slice(0, 8);
    const time = s.lastCheck
      ? new Date(s.lastCheck).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : '尚未检查';
    let status = '待检查';
    if (s.lastOk === true) {
      status = (s.seenRevision && s.revision && s.seenRevision !== s.revision) ? '发现新版本' : '已是最新';
    } else if (s.lastOk === false) status = location.protocol === 'file:' ? '本地预览' : '离线';
    el.innerHTML = ver + ' · <code>' + esc(rev) + '</code><br>最后检查 ' + esc(time) + ' · ' + status;
  }

  async function check(manual) {
    const s = load();
    s.lastCheck = Date.now();

    // 双击本地文件打开时，fetch 会被 file:// 的跨域策略拦住，直接降级
    if (location.protocol === 'file:') {
      s.lastOk = false; s.reason = 'local'; save(s); renderStatus();
      if (manual) toast('本地预览模式：发布到网页后才会自动检查更新');
      return;
    }

    try {
      const res = await fetch('version.json?_=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const v = await res.json();
      if (!v || !v.revision) throw new Error('version.json 格式不对');
      remote = v;
      s.lastOk = true; s.reason = ''; s.version = v.version || ''; s.revision = v.revision;
      save(s); renderStatus();

      // 第一次访问：只记录基线，不打扰
      if (!s.seenRevision) {
        s.seenRevision = v.revision; save(s); hideBanner(); setDot(false);
        if (manual) toast('已是最新版本 ' + (v.version || ''));
        return;
      }
      if (v.revision === s.seenRevision) {
        hideBanner(); setDot(false);
        if (manual) toast('已是最新版本 ' + (v.version || ''));
        return;
      }

      setDot(true);
      if (sessionDismissed && !manual) return;
      if (!manual && Date.now() - s.dismissedAt < SNOOZE) return;

      // 刚提交的版本，Pages 可能还没构建完，等一会儿再提示，避免刷新拿到旧资源
      const age = Date.now() - Date.parse(v.build || 0);
      if (!manual && Number.isFinite(age) && age >= 0 && age < GRACE) {
        if (!graceTimer) {
          graceTimer = setTimeout(() => { graceTimer = null; check(false); }, GRACE - age + 3000);
        }
        return;
      }
      showBanner(v);
      if (manual) toast('发现新版本，请查看页面顶部提示');
    } catch (e) {
      s.lastOk = false; s.reason = e.message || 'offline'; save(s); renderStatus();
      if (manual) toast('暂时无法检查更新（离线或本地预览）');
    }
  }

  function init() {
    const checkBtn = $('btnCheckUpdate');
    if (checkBtn) checkBtn.addEventListener('click', () => { sessionDismissed = false; check(true); });

    const refresh = $('ubRefresh');
    if (refresh) refresh.addEventListener('click', () => {
      const s = load();
      if (remote) { s.seenRevision = remote.revision; s.dismissedAt = 0; save(s); }
      // 换一个 URL 参数绕过 HTML 缓存；静态资源若仍是旧的，浏览器 10 分钟后自然过期
      const url = new URL(location.href);
      url.searchParams.set('_v', ((remote && remote.revision) || String(Date.now())).slice(0, 12));
      location.replace(url.toString());
    });
    const later = $('ubLater');
    if (later) later.addEventListener('click', () => {
      const s = load(); s.dismissedAt = Date.now(); save(s);
      sessionDismissed = true; hideBanner(); toast('已静默 6 小时，期间可点右上角手动检查');
    });
    const close = $('ubClose');
    if (close) close.addEventListener('click', () => { sessionDismissed = true; hideBanner(); });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - load().lastCheck > VISIBLE_GAP) check(false);
    });
    window.addEventListener('online', () => check(false));

    renderStatus();
    setTimeout(() => check(false), 2500);
    timer = setInterval(() => check(false), INTERVAL);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
