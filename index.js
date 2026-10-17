// ======================== 依赖 ========================
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { chromium } = require('playwright');

// ======================== 工具 ========================
function stripBOM(s) {
  return s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s;
}

// ======================== 配置加载（全部兜底）========================
const DEFAULT_SELECTORS = { username: '#username', password: '#userTypePwd', submit: '#loginBtn' };
const DEFAULT_LOGGED_IN = ['text=退出', 'text=开始'];
const DEFAULT_EVENT_TYPES = ['beforeunload', 'unload', 'visibilitychange', 'pagehide'];
const DEFAULT_LEAVE_KEYWORDS = ['leave', 'unload', 'visibility', 'pagehide', 'beforeunload'];
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function keywordList(value, fallback) {
  if (!Array.isArray(value)) return fallback.slice();
  // 只保留非空字符串，避免数字或对象在 toLowerCase 时抛错
  return value.filter(item => typeof item === 'string' && item.length > 0);
}

function loadConfig() {
  const p = path.join(__dirname, 'config.json');
  if (!fs.existsSync(p)) throw new Error('缺少 config.json');
  const raw = JSON.parse(stripBOM(fs.readFileSync(p, 'utf8')));
  const leaveKeywords = keywordList(raw.leaveKeywords, DEFAULT_LEAVE_KEYWORDS);
  const hasInterceptKeywords = Object.prototype.hasOwnProperty.call(raw, 'interceptKeywords');

  return {
    targetUrl: process.env.SITE_URL  || raw.targetUrl || '',
    username:  process.env.SITE_USER || raw.username  || '',
    password:  process.env.SITE_PWD  || raw.password  || '',

    selectors: { ...DEFAULT_SELECTORS, ...(raw.selectors || {}) },
    loggedInSelectors: Array.isArray(raw.loggedInSelectors) ? raw.loggedInSelectors : DEFAULT_LOGGED_IN,

    keepOpen:            raw.keepOpen            !== false,
    autoHandleDialogs:   raw.autoHandleDialogs   !== false,
    autoRemoveModal:     raw.autoRemoveModal     !== false,
    autoClickFullscreen: raw.autoClickFullscreen === true,
    fullscreen:          raw.fullscreen          === true,
    hideInfobar:         raw.hideInfobar         !== false,

    clickTimeout: typeof raw.clickTimeout === 'number' ? raw.clickTimeout : 8000,

    interceptLeaveRequests: raw.interceptLeaveRequests !== false,
    leaveKeywords,
    interceptKeywords: hasInterceptKeywords ? keywordList(raw.interceptKeywords, []) : leaveKeywords.slice(),
    interceptKeywordsLegacy: !hasInterceptKeywords,
    incidentFnNames: Array.isArray(raw.incidentFnNames) ? raw.incidentFnNames.filter(Boolean) : [],

    incidentEventTypes: Array.isArray(raw.incidentEventTypes)
      ? raw.incidentEventTypes.filter(Boolean)
      : DEFAULT_EVENT_TYPES.slice(),

    incidentObjectMethods: Array.isArray(raw.incidentObjectMethods)
      ? raw.incidentObjectMethods.filter(x => x && x.owner && x.name)
      : [],

    userDataDir: path.resolve(__dirname, raw.userDataDir || './chrome-profile'),
  };
}

const CONFIG = loadConfig();

// ======================== 补丁生成 ========================
// 内部代码不使用模板字面量，避免与外层模板字符串的 ${} 冲突
function buildAntiPatch(cfg, generation) {
  return `
(function(){
  const generation = ${generation};
  if (generation < (window.__antiPatchGeneration__ || 0)) return;
  window.__antiPatchGeneration__ = generation;

  // ---- 0. 清理上一份补丁 ----
  const oldCleanup = window.__antiPatchCleanup__;
  window.__antiPatchCleanup__ = null;
  if (typeof oldCleanup === 'function') {
    try { oldCleanup(); console.log('[防yh] 已清理旧补丁'); } catch(_) {}
  }

  const cleanups = [];
  const W = window, D = document;

  // ---- 1. hidden / visibilityState 伪装 ----
  try {
    Object.defineProperty(D, 'hidden',          { get: function(){ return false; },     configurable: true });
    Object.defineProperty(D, 'visibilityState', { get: function(){ return 'visible'; }, configurable: true });
  } catch(_) {}

  // ---- 2. 事件拦截 ----
  const eventTypes = ${JSON.stringify(cfg.incidentEventTypes)};
  const kill = ['blur','focusout','pagehide','freeze','webkitvisibilitychange','msvisibilitychange'];

  // 2a. kill 事件高优先级 stop（对已注册的监听器兜底）
  // 只做 stopImmediatePropagation，不调用 preventDefault：
  //   - preventDefault 在 pagehide 上会破坏往返缓存（bfcache）
  //   - preventDefault 在 blur/focusout/freeze 上无意义
  const stopFn = function(e){ try { e.stopImmediatePropagation(); } catch(_) {} };
  [W, D].forEach(function(el){
    kill.forEach(function(ev){
      try {
        el.addEventListener(ev, stopFn, true);
        cleanups.push(function(){ try { el.removeEventListener(ev, stopFn, true); } catch(_) {} });
      } catch(_) {}
    });
  });

  // 2b. window.onxxx setter 拦截（覆盖 kill + eventTypes 并集）
  const allTypes = Array.from(new Set(kill.concat(eventTypes)));
  allTypes.forEach(function(type){
    try {
      const prop = 'on' + type;
      let origDesc;
      try { origDesc = Object.getOwnPropertyDescriptor(W, prop); } catch(_) {}
      let origVal;
      try { origVal = W[prop]; } catch(_) {}
      Object.defineProperty(W, prop, {
        configurable: true,
        get: function(){ return null; },
        set: function(){ try { console.log('已拦截 ' + prop + ' 赋值'); } catch(_) {} }
      });
      cleanups.push(function(){
        try {
          if (origDesc) Object.defineProperty(W, prop, origDesc);
          else Object.defineProperty(W, prop, { value: origVal, writable: true, configurable: true });
        } catch(_) {}
      });
    } catch(_) {}
  });

  // ---- 3. window 顶层函数替换（incidentFnNames）----
  const fnNames = ${JSON.stringify(cfg.incidentFnNames)};
  const fnNameSet = new Set(fnNames);
  const owned = new WeakSet();
  const originals = new WeakMap();
  const wrapFns = function(){
    fnNameSet.forEach(function(n){
      try {
        let f = W[n];
        if (owned.has(f)) {
          const saved = originals.get(f);
          if (!saved || saved.name === n) return;
          // 包装函数被挪到别的名字上时，先解回原函数，再为当前名字单独包一层
          f = saved.original;
        }
        if (typeof f === 'function' && !owned.has(f)) {
          const wrapper = function(){ try { console.log('已拦截函数:', n); } catch(_) {} };
          owned.add(wrapper);
          originals.set(wrapper, { name: n, original: f });
          W[n] = wrapper;
        }
      } catch(_) {}
    });
  };
  wrapFns();
  const wrapTimer = setInterval(wrapFns, 300);
  cleanups.push(function(){
    clearInterval(wrapTimer);
    fnNameSet.forEach(function(n){
      try {
        const saved = originals.get(W[n]);
        if (saved && saved.name === n) W[n] = saved.original;
      } catch(_) {}
    });
  });

  // ---- 4. addEventListener / removeEventListener 原型劫持 ----
  if (eventTypes.length) {
    try {
      const origAdd = EventTarget.prototype.addEventListener;
      const origRemove = EventTarget.prototype.removeEventListener;
      const wrapperMap = new WeakMap();

      const hookedAdd = function(type, fn, opts) {
        if (typeof fn === 'function' && eventTypes.indexOf(type) !== -1 && !fn.__kill__) {
          // ⚠️ wrapper 不能调用 preventDefault：
          //    beforeunload 上调用会弹出"确认离开"对话框，反而没拦到
          // ⚠️ wrapper 不能调用 stopImmediatePropagation：
          //    会影响其他合法的同类监听器（如自动保存）
          const wrapper = function(){
            try { console.log('已拦截事件回调:', type); } catch(_) {}
          };
          wrapper.__kill__ = true;
          wrapper.__orig__ = fn;
          wrapper.__type__ = type;

          let set = wrapperMap.get(fn);
          if (!set) { set = new Set(); wrapperMap.set(fn, set); }
          set.add(wrapper);

          return origAdd.call(this, type, wrapper, opts);
        }
        return origAdd.call(this, type, fn, opts);
      };

      const hookedRemove = function(type, fn, opts) {
        if (typeof fn === 'function') {
          const set = wrapperMap.get(fn);
          if (set) {
            for (const w of Array.from(set)) {
              if (w.__type__ === type) {
                try { origRemove.call(this, type, w, opts); } catch(_) {}
                set.delete(w);
              }
            }
          }
        }
        return origRemove.call(this, type, fn, opts);
      };

      try { hookedAdd.__hooked__ = true; } catch(_) {}
      try { hookedAdd.toString    = function(){ return 'function addEventListener() { [native code] }'; }; } catch(_) {}
      try { hookedRemove.toString = function(){ return 'function removeEventListener() { [native code] }'; }; } catch(_) {}

      EventTarget.prototype.addEventListener    = hookedAdd;
      EventTarget.prototype.removeEventListener = hookedRemove;
      cleanups.push(function(){
        try { EventTarget.prototype.addEventListener    = origAdd; } catch(_) {}
        try { EventTarget.prototype.removeEventListener = origRemove; } catch(_) {}
      });

      console.log('[防yh] 已劫持 addEventListener | 目标事件:', eventTypes.join(', '));
    } catch(_) {}
  }

  // ---- 5. 对象方法替换（incidentObjectMethods）----
  const objMethods = ${JSON.stringify(cfg.incidentObjectMethods)};
  objMethods.forEach(function(item){
    try {
      const owner = item.owner, name = item.name;
      const parts = String(owner).split('.').filter(Boolean);
      let target = W;
      const start = (parts[0] === 'window') ? 1 : 0;
      for (let i = start; i < parts.length; i++) {
        target = target && target[parts[i]];
        if (!target) return;
      }
      if (!target) return;
      const orig = target[name];
      if (typeof orig === 'function' && !orig.__kill__) {
        const wrapper = function(){ try { console.log('已拦截对象方法:', owner + '.' + name); } catch(_) {} };
        wrapper.__kill__ = true;
        target[name] = wrapper;
        cleanups.push(function(){
          try { if (target[name] === wrapper) target[name] = orig; } catch(_) {}
        });
      }
    } catch(_) {}
  });

  // ---- 6. 弹窗移除 ----
  if (${cfg.autoRemoveModal}) {
    try {
      // 用 textContent 而非 innerText：innerText 每次访问触发强制重排，DOM 大时严重卡顿
      const closeModal = function(){
        [].slice.call(D.querySelectorAll('div,section')).forEach(function(n){
          const t = (n.textContent || '');
          if ((t.indexOf('yh') !== -1 || t.indexOf('离开页面') !== -1 || t.indexOf('请勿切换') !== -1) && t.length < 300) {
            const box = n.closest('.modal,.el-dialog,.ant-modal,[class*="modal"],[class*="dialog"]') || n;
            if (box && box.parentNode) { box.parentNode.removeChild(box); console.log('已移除yh弹窗'); }
          }
        });
        D.querySelectorAll('[class*="mask"],[class*="overlay"]').forEach(function(m){ try { m.remove(); } catch(_) {} });
      };
      const observer = new MutationObserver(closeModal);
      observer.observe(D.documentElement, { childList: true, subtree: true });
      const modalTimer = setInterval(closeModal, 800);
      cleanups.push(function(){ try { observer.disconnect(); } catch(_) {} clearInterval(modalTimer); });
    } catch(_) {}
  }

  // ---- 7. webdriver 伪装 ----
  try { Object.defineProperty(navigator, 'webdriver', { get: function(){ return false; }, configurable: true }); } catch(_) {}

  // ---- 8. 注册清理函数 ----
  W.__antiPatchCleanup__ = function(){
    cleanups.forEach(function(fn){ try { fn(); } catch(_) {} });
    cleanups.length = 0;
    W.__antiPatchCleanup__ = null;
  };

  console.log('[防yh] 补丁已注入 | 函数:', fnNameSet.size,
    '| 事件类型:', eventTypes.length,
    '| 对象方法:', objMethods.length,
    '| 弹窗清理:', ${cfg.autoRemoveModal});
})();
`;
}

// ======================== 辅助函数 ========================
async function visible(locator) {
  try { await locator.waitFor({ state: 'visible', timeout: 1500 }); return true; } catch (_) { return false; }
}

async function isLoggedIn(page) {
  for (const sel of CONFIG.loggedInSelectors) {
    try { if (await page.locator(sel).first().isVisible({ timeout: 800 })) return true; } catch (_) {}
  }
  return false;
}

async function autoLogin(page) {
  if (!CONFIG.targetUrl) {
    console.log('⚠ targetUrl 为空，跳过自动导航，请手动访问');
    return;
  }
  await page.goto(CONFIG.targetUrl, { waitUntil: 'domcontentloaded' }).catch(e => {
    console.log('⚠ 打开页面失败:', e.message.split('\n')[0]);
  });
  try { await page.waitForLoadState('networkidle', { timeout: 6000 }); } catch (_) {}

  if (await isLoggedIn(page)) { console.log('✓ 已登录，跳过'); return; }
  if (!CONFIG.username || !CONFIG.password) {
    console.log('未配置账号密码（可用环境变量 SITE_USER / SITE_PWD），请手动登录');
    return;
  }
  for (const frame of page.frames()) {
    if (frame.isDetached()) continue;
    try {
      const u = frame.locator(CONFIG.selectors.username);
      const p = frame.locator(CONFIG.selectors.password);
      if (await visible(u) && await visible(p)) {
        await u.fill(CONFIG.username);
        await p.fill(CONFIG.password);
        await frame.locator(CONFIG.selectors.submit).click({ timeout: CONFIG.clickTimeout }).catch(() => {});
        console.log('✓ 按配置选择器登录');
        return;
      }
      const acc = frame.locator('input[type="text"], input[type="tel"], input[type="number"], input[placeholder*="手机"], input[placeholder*="账号"], input[placeholder*="用户名"]').first();
      const pwd = frame.locator('input[type="password"]').first();
      const btn = frame.locator('button:has-text("登录"), input[type="submit"], [class*="login"] button').first();
      if (await visible(acc) && await visible(pwd)) {
        await acc.fill(CONFIG.username);
        await pwd.fill(CONFIG.password);
        if (await visible(btn)) await btn.click({ timeout: CONFIG.clickTimeout }).catch(() => {});
        console.log('✓ 宽松匹配登录');
        return;
      }
    } catch (_) {}
  }
  console.log('✗ 未找到登录表单，请手动登录（输入 d 诊断）');
}

async function enableClickFullscreen(page) {
  try {
    await page.evaluate(() => {
      if (window.__clickFs__) return;
      window.__clickFs__ = true;
      document.addEventListener('click', () => {
        const el = document.documentElement;
        const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
        if (fn && !document.fullscreenElement) fn.call(el).catch(() => console.log('全屏被拒绝'));
      }, true);
    });
    console.log('✓ 已开启点击全屏');
  } catch (_) {}
}

async function pressF11(page) {
  try { await page.keyboard.press('F11'); console.log('✓ 已发送 F11'); } catch (_) {}
}

// ======================== 扫描（只展示，不写入）========================
async function scanLeaveFns(page) {
  const kws = CONFIG.leaveKeywords;
  if (!kws.length) { console.log('⚠ leaveKeywords 为空，无法扫描'); return; }
  if (page.isClosed()) { console.log('✗ 页面已关闭，无法扫描'); return; }

  const r = await page.evaluate((words) => {
    const lower = words.map(w => w.toLowerCase());
    const hits = [];
    const seenSafe = new WeakMap();
    const seenUnsafe = new WeakMap();
    const ident = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
    const maxDepth = 2;

    const SKIP = new Set([
      'window','self','top','parent','frames','globalThis',
      'document','location','history','navigator','screen',
      'localStorage','sessionStorage','indexedDB','crypto',
      'console','performance','caches','speechSynthesis',
    ]);

    function matchKeys(k) {
      const lk = k.toLowerCase();
      return lower.filter(w => lk.indexOf(w) !== -1);
    }

    function pathSafe(segments) {
      for (let i = 1; i < segments.length; i++) {
        if (!ident.test(segments[i])) return false;
      }
      return true;
    }

    function walk(obj, path, depth) {
      if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) return;
      // 按安全类别记录已走过的最大剩余深度。更深的路径不能挡住更浅的别名
      const safe = pathSafe(path);
      const seen = safe ? seenSafe : seenUnsafe;
      const remain = maxDepth - depth;
      let prev;
      try { prev = seen.get(obj); } catch (_) { prev = undefined; }
      if (prev !== undefined && prev >= remain) return;
      try { seen.set(obj, remain); } catch (_) {}
      let keys;
      try { keys = Object.getOwnPropertyNames(obj); } catch(_) { return; }
      for (const k of keys) {
        if (SKIP.has(k)) continue;
        if (k.charAt(0) === '_' && k.charAt(1) === '_') continue;
        if (k === 'constructor' || k === 'prototype') continue;
        let v;
        try { v = obj[k]; } catch(_) { continue; }
        const next = path.concat(k);
        const vt = typeof v;
        const matched = matchKeys(k);
        // 只收集 function 类型，避免 string/number 等噪音
        if (matched.length && vt === 'function') {
          hits.push({ segments: next, matched: matched });
        }
        if (depth < maxDepth && v && vt === 'object' && !Array.isArray(v)) {
          walk(v, next, depth + 1);
        }
      }
    }
    walk(window, ['window'], 0);
    return hits;
  }, kws);

  if (!r.length) {
    console.log('未发现 function 类型的匹配项（关键词可能太窄，或页面尚未加载完）');
    return;
  }

  const generic = new Set(['focus', 'blur', 'hidden', 'switch', 'exit']);
  const topFns = [];
  const objMethods = [];
  const weakHits = [];
  const unsupported = [];
  for (const hit of r) {
    const name = hit.segments[hit.segments.length - 1];
    const ownerParts = hit.segments.slice(1, -1);
    const shown = formatPath(hit.segments);
    const weak = hit.matched.every(word => generic.has(word));
    if (ownerParts.some(part => !IDENTIFIER.test(part))) {
      unsupported.push(shown);
      continue;
    }
    if (weak) {
      weakHits.push(shown);
      continue;
    }
    if (!ownerParts.length) topFns.push(name);
    else objMethods.push({ owner: ownerParts.join('.'), name });
  }

  console.log(`\n扫描结果 (${r.length} 个 function)。下面是可粘贴 JSON，把两个数组抄进 config.json 后按 r。`);
  console.log(JSON.stringify({ incidentFnNames: topFns, incidentObjectMethods: objMethods }, null, 2));
  if (weakHits.length) {
    console.log('\n以下只匹配了泛词 focus/blur/hidden/switch/exit，未放进 JSON：');
    weakHits.forEach(item => console.log('  - ' + item));
  }
  if (unsupported.length) {
    console.log('\n以下属性名不能按点路径访问，未放进 JSON：');
    unsupported.forEach(item => console.log('  - ' + item));
  }
  console.log('');
}

function formatPath(segments) {
  return segments.map((part, index) => {
    if (index === 0) return part;
    return IDENTIFIER.test(part) ? '.' + part : '[' + JSON.stringify(part) + ']';
  }).join('');
}

// ======================== 热更新 ========================
let patchGeneration = 0;
let patchScript = null;
let interceptRouted = false;
const INTERCEPT_PATTERN = '**/*';

function nextPatch(cfg) {
  patchGeneration += 1;
  return buildAntiPatch(cfg, patchGeneration);
}

async function installInitPatch(context, patch) {
  const nextScript = await context.addInitScript(patch);
  const prevScript = patchScript;
  patchScript = nextScript;
  if (!prevScript) return;
  try { await prevScript.dispose(); } catch (_) {}
}

function interceptActive(cfg) {
  return cfg.interceptLeaveRequests && cfg.interceptKeywords.length > 0;
}

function reportInterceptPolicy() {
  if (!CONFIG.interceptLeaveRequests) return;
  if (CONFIG.interceptKeywordsLegacy) {
    console.log('⚠ config.json 没有 interceptKeywords，请求拦截暂时沿用 leaveKeywords。请把 URL 关键词单独写到 interceptKeywords。');
  }
  if (!CONFIG.interceptKeywords.length) console.log('⚠ interceptKeywords 为空，未注册请求拦截');
}

function interceptRequest(route) {
  if (!interceptActive(CONFIG)) return route.continue();
  const req = route.request();
  const type = req.resourceType();
  if (type !== 'xhr' && type !== 'fetch') return route.continue();
  const url = req.url().toLowerCase();
  const hit = CONFIG.interceptKeywords.some(keyword => url.includes(keyword.toLowerCase()));
  if (!hit) return route.continue();
  console.log('拦截:', req.url().slice(0, 90));
  return route.abort('blockedbyclient');
}

async function syncInterceptRoute(context, cfg) {
  const shouldRoute = interceptActive(cfg);
  if (shouldRoute === interceptRouted) return;
  if (!shouldRoute) {
    try {
      await context.unroute(INTERCEPT_PATTERN, interceptRequest);
      interceptRouted = false;
    } catch (e) {
      try {
        await context.route(INTERCEPT_PATTERN, interceptRequest);
        interceptRouted = true;
      } catch (_) {
        interceptRouted = false;
      }
      throw e;
    }
    return;
  }
  try {
    await context.route(INTERCEPT_PATTERN, interceptRequest);
    interceptRouted = true;
  } catch (e) {
    try { await context.unroute(INTERCEPT_PATTERN, interceptRequest); } catch (_) {}
    interceptRouted = false;
    throw e;
  }
}

async function hotReload(context) {
  const nextConfig = loadConfig();
  // 路由先按下一份配置切换成功，再发布新补丁，避免失败时新一代补丁已经在页面上跑起来
  await syncInterceptRoute(context, nextConfig);
  Object.assign(CONFIG, nextConfig);
  reportInterceptPolicy();
  const patch = nextPatch(nextConfig);
  await installInitPatch(context, patch);

  let ok = 0;
  const failed = [];
  for (const p of context.pages()) {
    if (p.isClosed()) continue;
    try {
      await p.evaluate(patch);
      ok += 1;
    } catch (e) {
      failed.push(p.url() + ': ' + e.message);
    }
  }

  if (failed.length) {
    console.log('✗ 热更新未全部完成 | 已注入:', ok, '| 失败:', failed.length);
    failed.forEach(line => console.log('  - ' + line));
    return;
  }
  console.log('✓ 热更新完成 | 已注入:', ok,
    '| 函数:', CONFIG.incidentFnNames.length,
    '| 事件:', CONFIG.incidentEventTypes.length,
    '| 对象方法:', CONFIG.incidentObjectMethods.length);
}

async function diagnose(page) {
  if (page.isClosed()) { console.log('✗ 页面已关闭'); return; }
  const info = await page.evaluate(() => ({
    url: location.href,
    hidden: document.hidden,
    visibilityState: document.visibilityState,
    fullscreenEl: !!document.fullscreenElement,
    // 用 __hooked__ 标记检测（toString 已被伪装成 native，不能靠它判断）
    addEventListenerHooked: EventTarget.prototype.addEventListener.__hooked__ === true,
    inputs: [...document.querySelectorAll('input')].slice(0, 20).map(e => ({ id: e.id, name: e.name, type: e.type, placeholder: e.placeholder })),
    buttons: [...document.querySelectorAll('button,a,[role=button]')].slice(0, 30).map(e => ({ text: (e.innerText || '').trim(), id: e.id, className: String(e.className).slice(0, 60) })),
  }));
  console.log('诊断:', JSON.stringify(info, null, 2));
}

async function launchBrowser() {
  const args = CONFIG.fullscreen
    ? ['--start-fullscreen', '--disable-extensions']
    : ['--start-maximized', '--disable-extensions'];
  if (CONFIG.hideInfobar) args.push('--test-type');

  const opts = { headless: false, args, viewport: null, ignoreDefaultArgs: ['--enable-automation'] };
  const channels = [
    { name: 'Chrome', channel: 'chrome' },
    { name: 'Edge',   channel: 'msedge' },
    { name: 'Chromium', channel: null },
  ];
  for (const { name, channel } of channels) {
    try {
      const launchOpts = channel ? { ...opts, channel } : opts;
      console.log('实际启动参数:', launchOpts.args);
      const ctx = await chromium.launchPersistentContext(CONFIG.userDataDir, launchOpts);
      console.log('✓ 已启动', name);
      return ctx;
    } catch (e) {
      console.log('  ' + name + ' 未找到:', e.message.split('\n')[0]);
    }
  }
  throw new Error('未找到可用浏览器');
}

// ======================== 主流程 ========================
(async () => {
  let context, page;
  try {
    context = await launchBrowser();
    await installInitPatch(context, nextPatch(CONFIG));
    await syncInterceptRoute(context, CONFIG);
    reportInterceptPolicy();

    const pages = context.pages();
    page = pages.find(p => !p.isClosed()) || await context.newPage();

    // 用 WeakSet 保证每个页面只绑定一次监听器
    const boundPages = new WeakSet();
    let browserGone = false;
    // 浏览器窗口被关掉时，结束 node，快捷键进程会跟着退出
    const stopBecauseBrowserClosed = () => {
      if (browserGone) return;
      browserGone = true;
      process.exit(0);
    };
    context.on('close', stopBecauseBrowserClosed);
    const browser = context.browser();
    if (browser) browser.on('disconnected', stopBecauseBrowserClosed);

    const bindPage = (p) => {
      if (boundPages.has(p)) return;
      boundPages.add(p);

      if (CONFIG.autoHandleDialogs) {
        p.on('dialog', d => {
          console.log('弹窗:', d.message().slice(0, 80));
          // beforeunload 上 accept 才会离开页面；其余弹窗仍关闭
          const done = d.type() === 'beforeunload' ? d.accept() : d.dismiss();
          done.catch(() => {});
        });
      }
      p.on('console', m => {
        const t = m.text();
        if (t.includes('[防yh]') || t.includes('已拦截')) { console.log(t); return; }
        const safe = t.replace(/(token|password|pwd|authorization)\s*[:=]\s*\S+/gi, '$1=***');
        console.log('[页面] ' + safe);
      });
      p.on('close', () => {
        console.log('页面被关闭');
        const stillOpen = context.pages().some(item => !item.isClosed());
        if (stillOpen || browserGone) return;
        browserGone = true;
        // 只剩这个页面时，关掉浏览器进程再退出，避免窗口空转
        context.close().catch(() => {}).finally(() => process.exit(0));
      });
    };

    context.on('page', async p => {
      bindPage(p);
      await p.waitForLoadState('domcontentloaded').catch(() => {});
      if (CONFIG.autoClickFullscreen) await enableClickFullscreen(p);
      console.log('新页面:', p.url());
    });

    bindPage(page);

    await autoLogin(page);
    if (CONFIG.autoClickFullscreen) await enableClickFullscreen(page);

    console.log('指令：回车=状态 | s=扫描 | r=热更新 | f=F11 | d=诊断 | q=退出');

    if (CONFIG.keepOpen) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

      let intentionalQuit = false;
      rl.on('close', () => {
        if (intentionalQuit) return;
        console.log('\nstdin 已关闭，退出');
        process.exit(0);
      });

      const loop = () => rl.question('>>> ', async line => {
        const cmd = line.trim().toLowerCase();
        try {
          if (cmd === 'q') {
            intentionalQuit = true;
            await context.close().catch(() => {});
            rl.close();
            process.exit(0);
            return;
          }
          else if (cmd === 'd') await diagnose(page);
          else if (cmd === 's') await scanLeaveFns(page);
          else if (cmd === 'r') await hotReload(context);
          else if (cmd === 'f') await pressF11(page);
          else console.log('URL:', page.url(), '| hidden:', await page.evaluate(() => document.hidden).catch(() => '-'));
        } catch (e) { console.log('指令出错:', e.message); }
        loop();
      });
      loop();
    } else {
      await context.close();
    }
  } catch (err) {
    console.error('错误:', err.message);
    try { await context?.close(); } catch (_) {}
    process.exit(1);
  }
})();