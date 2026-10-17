{
  // ==================== 目标站点与凭据 ====================
  // 建议用环境变量 SITE_URL / SITE_USER / SITE_PWD 覆盖，避免明文落盘
  "targetUrl": "",
  "username": "",
  "password": "",

  // ==================== 登录选择器 ====================
  "selectors": {
    "username": "#username",
    "password": "#userTypePwd",
    "submit": "#loginBtn"
  },
  // 命中任一即视为已登录，跳过自动登录
  "loggedInSelectors": ["text=退出", "text=开始"],

  // ==================== 浏览器行为 ====================
  "keepOpen": true,                 // true=进入交互模式；false=登录后立即关闭
  "userDataDir": "./chrome-profile",// 持久化目录，保存登录态
  "clickTimeout": 8000,             // 点击超时（毫秒）
  "autoHandleDialogs": true,        // alert/confirm 关闭；beforeunload 确认离开。启动时绑定，按 r 不能中途打开
  "autoRemoveModal": true,          // 自动移除「离开页面」弹窗和遮罩
  "autoClickFullscreen": false,     // 点击时尝试全屏
  "fullscreen": false,              // 启动即全屏
  "hideInfobar": true,              // 隐藏「受自动化控制」提示条（会忽略证书错误）

  // ==================== 请求拦截 ====================
  // 只拦 URL，与 leaveKeywords 无关
  // 没有本字段的旧配置会暂时沿用 leaveKeywords。拦截开启时，每次启动和每次按 r 都会提示迁移
  // 显式写成 [] 则不注册路由，即使 interceptLeaveRequests 为 true
  // ⚠️ 填 "leave" 会误伤 /api/leave/xxx 这类正常接口
  "interceptLeaveRequests": false,
  "interceptKeywords": [],

  // ==================== 扫描关键词 ====================
  // 只给 s 扫描用，不参与 URL 拦截。省略时使用这组词；写成 [] 表示不扫描
  // s 只打印可粘贴 JSON，不写回本文件。泛词和不安全路径会另外列出
  "leaveKeywords": ["leave", "unload", "visibility", "pagehide", "beforeunload"],

  // ==================== 拦截：window 顶层函数 ====================
  // 手填函数名。补丁执行 window[名字] = 空函数，不要带 window. 前缀
  // 适用：function foo(){} / window.foo = fn / window.onbeforeunload = fn
  // 验证：控制台 typeof window.名字 返回 "function" 才能拦
  // s 会打印一段可粘贴 JSON。泛词、以及属性名含点号或空格的路径不会放进 JSON
  "incidentFnNames": ["VisibilityStateEntry", "blurCount"],

  // ==================== 拦截：addEventListener 事件 ====================
  // 补丁劫持 EventTarget.prototype.addEventListener，把这些事件的回调包成空函数
  // 现代前端（Vue/React）防切屏最常用这种方式，最值得开
  // 副作用：页面自身的 beforeunload（如自动保存）也会被拦，影响业务就移除对应事件
  "incidentEventTypes": ["beforeunload", "unload", "visibilitychange", "pagehide"],

  // ==================== 拦截：对象方法 ====================
  // 每个元素 { owner, name }：owner=对象路径（点分隔，window 可省略），name=方法名
  // 适用：myApp.checkLeave() / window.myPlugin.onLeave()
  // owner 的每一段都必须是合法标识符，不要带 window. 前缀
  // 示例：{ "owner": "myApp", "name": "checkLeave" }
  "incidentObjectMethods": [
    { "owner": "screenfull", "name": "exit" }
  ]
}