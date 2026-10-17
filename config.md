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
  "autoHandleDialogs": true,        // 自动关闭 alert/confirm
  "autoRemoveModal": true,          // 自动移除「离开页面」弹窗和遮罩
  "autoClickFullscreen": false,     // 点击时尝试全屏
  "fullscreen": false,              // 启动即全屏
  "hideInfobar": true,              // 隐藏「受自动化控制」提示条（会忽略证书错误）

  // ==================== 请求拦截 ====================
  "interceptLeaveRequests": true,   // 是否拦截含关键词的 xhr/fetch
  // 双用途：①扫描 window 属性名 ②拦截 URL
  // ⚠️ 填 "leave" 会误伤 /api/leave/xxx 这类正常接口，业务 URL 含关键词时请设 interceptLeaveRequests=false
  "leaveKeywords": ["leave", "unload", "visibility", "blur", "focus", "hidden", "switch", "exit"],

  // ==================== 拦截：window 顶层函数 ====================
  // 填「函数名」字符串，补丁执行 window[名字] = 空函数
  // 适用：function foo(){} / window.foo = fn / window.onbeforeunload = fn
  // 验证：控制台 typeof window.名字 返回 "function" 才能拦
  // 示例："incidentFnNames": ["checkLeave", "onbeforeunload", "handleLeave"]
  "incidentFnNames": [],

  // ==================== 拦截：addEventListener 事件 ====================
  // 补丁劫持 EventTarget.prototype.addEventListener，把这些事件的回调包成空函数
  // 现代前端（Vue/React）防切屏最常用这种方式，最值得开
  // 副作用：页面自身的 beforeunload（如自动保存）也会被拦，影响业务就移除对应事件
  "incidentEventTypes": ["beforeunload", "unload", "visibilitychange", "pagehide"],

  // ==================== 拦截：对象方法 ====================
  // 每个元素 { owner, name }：owner=对象路径（点分隔，window 可省略），name=方法名
  // 适用：myApp.checkLeave() / window.myPlugin.onLeave()
  // 示例：
  //   "incidentObjectMethods": [
  //     { "owner": "myApp",    "name": "checkLeave" },
  //     { "owner": "myPlugin", "name": "onLeave" }
  //   ]
  "incidentObjectMethods": []
}