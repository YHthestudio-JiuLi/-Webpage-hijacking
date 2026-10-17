---

## 环境要求

- Node.js ≥ 20
- Chrome / Edge 已安装，或运行 `npx playwright install chromium`
- Playwright：`npm i playwright`

---

## 快速开始

```bash
# 1. 安装依赖
npm i playwright

# 2. （可选）安装 Chromium 内核
npx playwright install chromium

# 3. 配置凭据（推荐环境变量，不落盘）
# Windows PowerShell:
$env:SITE_URL="https://xxx"; $env:SITE_USER="u"; $env:SITE_PWD="p"; node index.js
# Linux/macOS:
SITE_URL="https://xxx" SITE_USER="u" SITE_PWD="p" node index.js

# 4. 或直接运行（凭据写在 config.json）
node index.js

config.json 字段说明
所有字段均可省略，脚本会兜底默认值。

凭据
字段	默认	说明
targetUrl	""	目标网站地址。为空则跳过自动导航，手动访问
username	""	登录账号。建议用环境变量 SITE_USER 覆盖
password	""	登录密码。建议用环境变量 SITE_PWD 覆盖
环境变量优先级：SITE_URL / SITE_USER / SITE_PWD > config.json。

登录
字段	默认	说明
selectors.username	#username	账号输入框选择器
selectors.password	#userTypePwd	密码输入框选择器
selectors.submit	#loginBtn	登录按钮选择器
loggedInSelectors	["text=退出", "text=开始"]	判断「已登录」的标志，命中任一即跳过登录
clickTimeout	8000	点击超时（毫秒）
选择器不匹配时会尝试宽松匹配（input[type=password]、button:has-text("登录") 等）。

浏览器
字段	默认	说明
userDataDir	./chrome-profile	持久化目录，保存登录态。相对路径基于脚本目录解析
fullscreen	false	启动即全屏（--start-fullscreen）
hideInfobar	true	隐藏「受自动化控制」提示条（--test-type，会忽略证书错误）
autoClickFullscreen	false	点击页面时尝试进入全屏
补丁开关
字段	默认	说明
autoRemoveModal	true	自动移除「离开页面 / 请勿切换」弹窗和遮罩
autoHandleDialogs	true	关闭 alert/confirm。beforeunload 改为确认离开。只在页面第一次绑定时读取，按 r 不能中途打开
keepOpen	true	保持浏览器开启并进入交互模式；false 则登录后立即关闭
拦截配置
字段	默认	说明
interceptLeaveRequests	true	省略时为 true。为 true 且 interceptKeywords 非空才拦截 xhr/fetch
leaveKeywords	["leave","unload","visibility","pagehide","beforeunload"]	只给 s 扫描函数名。省略时用这组词；写成 [] 表示不扫描
interceptKeywords	沿用 leaveKeywords	只用于 URL 拦截。旧配置没有该字段时沿用 leaveKeywords；拦截开启时，每次启动和每次按 r 都会提示，直到补上该字段。显式写 [] 则不注册路由
incidentFnNames	[]	要替换的 window 顶层函数名。s 打印可粘贴 JSON，需手填，不要带 window. 前缀
incidentEventTypes	["beforeunload","unload","visibilitychange","pagehide"]	要拦截的 addEventListener 事件类型
incidentObjectMethods	[]	要替换的对象方法，格式 { "owner": "myApp", "name": "checkLeave" }
三类拦截机制
补丁从三个层面拦截防切屏，覆盖绝大多数场景。

1. window 顶层函数替换（incidentFnNames）
原理：window[n] = wrapper 直接替换函数引用。

适用：

js
function checkLeave() {}              // ✅ 拦得到
window.onbeforeunload = checkLeave;   // ✅ 拦得到（走 setter）
var checkLeave = function(){}         // ✅ 拦得到
拦不到：

js
(function(){ function checkLeave(){} })();     // ❌ 闭包内部，window 上没有
myApp.checkLeave = function(){};               // ❌ 在别的对象上（用 incidentObjectMethods）
el.addEventListener('beforeunload', fn);       // ❌ 走事件系统（用 incidentEventTypes）
验证：浏览器控制台 typeof window.名字，返回 "function" 才能拦。

2. addEventListener 劫持（incidentEventTypes）
原理：劫持 EventTarget.prototype.addEventListener，把注册的回调包一层空函数。

适用：

js
window.addEventListener('beforeunload', someFn);      // ✅ 拦得到
document.addEventListener('visibilitychange', fn);    // ✅ 拦得到
element.addEventListener('blur', fn);                 // ✅ 拦得到
这是现代前端（Vue/React）防切屏最常用的方式，最值得开。

副作用：页面自身的 beforeunload（如自动保存）也会被拦。如影响业务，把对应事件从 incidentEventTypes 移除。

3. 对象方法替换（incidentObjectMethods）
原理：按路径找到对象，替换其方法。

适用：

js
const myApp = { checkLeave: function(){} };
myApp.checkLeave();   // ✅ 拦得到（配置 { "owner": "myApp", "name": "checkLeave" }）
注意：路径必须真实存在，且对象重新赋值后需要重新热更新。owner 的每一段都必须是合法标识符。属性名里有点号或空格时，不能写成点路径，扫描也不会把它放进 JSON。

扫描
输入 s 按 leaveKeywords 扫描 window 顶层和最多两层子对象上的 function，打印一段可直接解析的 JSON，不写入 config.json。当前默认扫描词是 leave、unload、visibility、pagehide、beforeunload。

window 顶层 function → incidentFnNames（只含函数名）

子对象 function → incidentObjectMethods（owner 已去掉 window. 前缀，且每一段都是合法标识符）

只匹配 focus/blur/hidden/switch/exit 的泛词，以及属性名不能按点路径访问的项，会列在 JSON 外面，不会混进 JSON。

热更新流程
text
>>> s
{
  "incidentFnNames": ["checkLeave"],
  "incidentObjectMethods": [
    { "owner": "myApp", "name": "checkLeave" }
  ]
}
把这两个数组抄进 config.json 并保存，然后按 r。

>>> r                          # 热更新
[防yh] 已清理旧补丁
[防yh] 补丁已注入 | 函数: 2 | 事件类型: 4 | 对象方法: 0 | 弹窗清理: true
✓ 热更新完成 | 已注入: 1 | 函数: 2 | 事件: 4 | 对象方法: 0
顶层函数在 window 上已经存在，或补丁还在时才出现，都会被替换；从配置删掉并按 r 后会恢复原函数。对象方法只在注入时对象和方法都已经存在才替换。请求拦截立即按新配置生效。改了 incidentEventTypes 之后，页面上已经注册的监听不会被拆掉，需要再刷新页面才会按新的事件类型重建。之后新开的页面使用最新补丁。无需重启脚本，无需重开浏览器。

如何判断是否真的拦截成功
方式 1：看日志

触发页面防切屏逻辑（切窗口、点关闭、刷新等），终端应出现：

text
[页面] 已拦截函数: checkLeave
[页面] 已拦截事件回调: visibilitychange
[页面] 已拦截对象方法: myApp.checkLeave
[页面] 已移除yh弹窗
没出现 = 没拦到，按下方排查。

方式 2：输入 d 诊断

text
{
  "addEventListenerHooked": true,    // true = addEventListener 劫持生效
  "hidden": false,
  "visibilityState": "visible"
}
方式 3：浏览器控制台手动验证

js
typeof window.checkLeave                           // "function" → 可拦
String(EventTarget.prototype.addEventListener)     // 含 "[native code]" = 未劫持
排查：改完配置拦不到
现象	排查方向
按 r 后无 已拦截函数 日志	名字不在 window 上 / 不是函数 / 拼写错误。控制台 typeof window.名字 确认
切窗有反应但无拦截日志	走的是 addEventListener。确认事件类型在 incidentEventTypes 里，且 r 后看到 已劫持 addEventListener
关闭页仍有二次确认	是原生 beforeunload。incidentEventTypes 要含 beforeunload。改这个事件列表后，已经注册的监听要刷新页面才会重建。autoHandleDialogs 为 true 时，beforeunload 弹窗会确认离开；这个开关在页面第一次绑定时读取，按 r 不能中途打开，要重启脚本
弹窗一闪而过但仍有遮罩	autoRemoveModal 是否为 true
全部日志都没有	config.json 是否保存成功？r 后是否看到「补丁已注入」
页面功能异常	interceptLeaveRequests 误伤正常接口，临时设为 false 或缩小 interceptKeywords
⚠️ 重要注意事项
1. 扫描词和拦截词是分开的
leaveKeywords 只用于 s 扫描函数名。省略时默认是 leave、unload、visibility、pagehide、beforeunload；写成 [] 则不扫描。

interceptKeywords 只用于拦截 xhr/fetch 的 URL。显式写成 [] 时不注册路由，即使 interceptLeaveRequests 为 true。

旧配置里没有 interceptKeywords 时，会暂时用 leaveKeywords 做 URL 拦截，避免升级后拦截被静默关掉。interceptLeaveRequests 为 true 时，每次启动和每次按 r 都会在终端提示，直到把 URL 关键词写进 interceptKeywords。开关为 false 时不提示。

填 "leave" 进 interceptKeywords 会误伤 /api/leave/list 这类正常接口。业务 URL 含关键词时，把 interceptLeaveRequests 设为 false。

2. --test-type 会忽略证书错误
hideInfobar: true 时添加 --test-type，某些版本会忽略证书错误。生产环境建议设 false。

3. 持久化 profile 含登录态
chrome-profile/ 保存 cookie、token、历史。分发前必须清理：

bash
node clean-profile.js --dry    # 先看会删什么
node clean-profile.js --all    # 确认后真删
4. 明文凭据
不要把真实账号密码写进 config.json 提交 git。用环境变量覆盖：

bash
export SITE_USER=xxx SITE_PWD=xxx
.gitignore 已包含 chrome-profile/、.env、*.log。

5. 补丁可能被页面检测
Object.defineProperty(document, 'hidden') 和 addEventListener 劫持可被对抗性站点检测。已对 addEventListener.toString 做 native 伪装，但高级检测仍可能识别。不建议用于强对抗场景（如在线考试、监控系统）。

安全性说明
设计	作用
环境变量优先于 config.json	凭据不落盘
扫描只打印，不写回 config.json	热更新只读文件，不会把环境变量写回磁盘
日志脱敏 token/password/pwd/authorization	页面 console 转发时过滤敏感信息
clean-profile.js 危险路径校验	防止误删根目录
route 只拦 xhr/fetch	不误杀主文档/脚本/图片
补丁 cleanup 幂等	热更新不残留监听器/定时器
分发前 Checklist
bash
# 1. 清理 profile 和日志
node clean-profile.js --dry
node clean-profile.js --all

# 2. 确认 config.json 无真实凭据
cat config.json

# 3. 打包排除敏感目录
zip -r release.zip . -x "chrome-profile/*" ".env" "*.log"
常见问题
Q: 改了 config.json 为什么没生效？
A: config.json 是启动时读一次，运行中改文件不会自动重读。输入 r 热更新（会重读文件 + 重新注入补丁）。

Q: 热更新后浏览器会刷新吗？
A: 不会自动刷新。顶层函数在 window 上已经存在，或补丁还在时才出现，都会被替换；从配置删掉并按 r 后会恢复原函数。对象方法只在注入时对象和方法都已经存在才替换。请求拦截立即按新配置生效。改 incidentEventTypes 时，已经注册的 addEventListener 不会被拆掉，需要再刷新一次页面。autoHandleDialogs 只在页面第一次绑定时读取，改这个开关要重启脚本。

Q: 重启脚本后 chrome-profile 里的登录态还在吗？
A: 在。持久化 profile 就是为了复用登录态。想清空就用 clean-profile.js。

Q: 为什么扫描出来的很多函数我都不认识？
A: 扫描遍历 window 属性，会包含第三方库挂的全局函数。s 只打印 JSON，不写入配置。泛词和不能按点路径访问的项会列在 JSON 外面。只把需要的数组抄进 incidentFnNames 或 incidentObjectMethods，然后按 r。

Q: 拦截了 beforeunload 后页面自动保存失效了？
A: 从 incidentEventTypes 移除 beforeunload，或设 incidentEventTypes: [] 关闭事件劫持，只保留函数替换和弹窗移除。

Q: 纯闭包内部调用的函数能拦吗？
A: 不能。JS 层面无法拦截未暴露到可控对象上的引用。但闭包函数 99% 会通过 addEventListener 或 window.onxxx 注册，拦这些出口即可切断链路。

许可
仅供学习与个人自动化使用。请遵守目标网站的服务条款，勿用于违反规定的场景。
