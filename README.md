---

## 环境要求

- Node.js ≥ 16
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
autoHandleDialogs	true	自动关闭 alert/confirm 原生弹窗
keepOpen	true	保持浏览器开启并进入交互模式；false 则登录后立即关闭
拦截配置
字段	默认	说明
interceptLeaveRequests	true	是否拦截含关键词的 xhr/fetch 请求
leaveKeywords	[]	扫描 + 请求拦截的关键词（两处共用，见下方注意事项）
incidentFnNames	[]	要替换的 window 顶层函数名
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
注意：路径必须真实存在，且对象重新赋值后需要重新热更新。

扫描 + 自动写入
输入 s 会扫描 window 顶层 + 一层子对象，把匹配 leaveKeywords 的属性按类型分类写入 config.json：

window 顶层的 function → incidentFnNames

子对象的 function → incidentObjectMethods

扫描结果会打印到终端，可先人工核对再热更新

输入 a = 扫描 + 写入 + 热更新，一步到位。

注意：扫描时如果 config.json 正在编辑器打开且未保存，脚本写回后你的编辑器再保存会覆盖。建议扫描前先关闭/保存编辑器。

热更新流程
text
>>> s                          # 扫描，自动写入 config.json
[扫描结果...]
✓ 本次新增: checkLeave, onbeforeunload
✓ incidentFnNames: [checkLeave, onbeforeunload]
输入 r 热更新生效

>>> r                          # 热更新
[防yh] 已清理旧补丁
[防yh] 补丁已注入 | 函数: 2 | 事件类型: 4 | 对象方法: 0 | 弹窗清理: true
✓ 热更新完成 | 已刷新: 1 | 函数: 2 | 事件: 4 | 对象方法: 0
热更新对所有已打开页面立即生效，且对之后新开的页面也生效。无需重启脚本，无需重开浏览器。

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
关闭页仍有二次确认	是原生 beforeunload，确认 interceptLeaveRequests: true 且 leaveKeywords 含 unload
弹窗一闪而过但仍有遮罩	autoRemoveModal 是否为 true
全部日志都没有	config.json 是否保存成功？r 后是否看到「补丁已注入」
页面功能异常	interceptLeaveRequests 误伤正常接口，临时设为 false 或缩小 leaveKeywords
⚠️ 重要注意事项
1. leaveKeywords 是双用途的
它同时用于：

扫描 window 属性名（模糊匹配）

拦截 含该词的 URL（xhr/fetch）

填 "leave" 会导致 /api/leave/list 这类正常接口也被拦。如果业务接口 URL 含关键词，建议：

设 interceptLeaveRequests: false，只用扫描功能

或另建 interceptKeywords 字段单独管理请求拦截关键词（需自行改代码）

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
saveIncidentFnsAndMethods 读原始 raw	不把环境变量写进文件
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
A: 不会刷新页面。补丁通过 page.evaluate 注入到当前页面，旧补丁会自动清理。

Q: 重启脚本后 chrome-profile 里的登录态还在吗？
A: 在。持久化 profile 就是为了复用登录态。想清空就用 clean-profile.js。

Q: 为什么扫描出来的很多函数我都不认识？
A: 扫描遍历 window 属性，会包含第三方库挂的全局函数。只把与「离开/切屏」相关的填进配置即可，不相关的可以删掉。

Q: 拦截了 beforeunload 后页面自动保存失效了？
A: 从 incidentEventTypes 移除 beforeunload，或设 incidentEventTypes: [] 关闭事件劫持，只保留函数替换和弹窗移除。

Q: 纯闭包内部调用的函数能拦吗？
A: 不能。JS 层面无法拦截未暴露到可控对象上的引用。但闭包函数 99% 会通过 addEventListener 或 window.onxxx 注册，拦这些出口即可切断链路。

许可
仅供学习与个人自动化使用。请遵守目标网站的服务条款，勿用于违反规定的场景。

text

---
