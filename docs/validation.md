# DSH Bridge 验证记录与真机验收

## 验证范围

初始实现阶段验证 JavaScript Bundle、Android Prebuild、类型、lint、自动化测试与工作流定义。随后用户已授权安装 Android SDK、提交推送和发布；下方初始验证表为执行授权前的历史结果，SDK/native/远端状态在发布记录中单独更新。未把模拟 React/native mock 测试等同于真机执行。

环境：Windows，Node 22.23.3、Bun 1.4.2、React / React Test Renderer 19.2.3、Vitest 5.0.3、Expo SDK 57。验证命令使用临时 Node 22 LTS，本机默认 Node 25 不受 Vitest 5 支持。

## 本地验证结果（2026-10-03）

| 检查                 | 结果                                                                                                           |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| Frozen lockfile 安装 | 通过；依赖与 lockfile 无变化                                                                                   |
| Expo 原生兼容性      | `expo install --check` 通过，依赖均为 SDK 兼容版本                                                             |
| TypeScript           | 常规 `tsc --noEmit` 及排除忽略/生成类型文件的 clean-checkout 检查均通过                                        |
| ESLint               | 全工程 `--max-warnings 0` 通过，0 error / 0 warning                                                            |
| 完整测试             | 13 个文件、469 项；5 个独立完整进程连续全通过                                                                  |
| 随机测试             | seed `31003`，469/469 通过                                                                                     |
| 工作流定义           | actionlint 1.7.12 通过；Windows 本地未运行 shellcheck/pyflakes，也未运行 GitHub job                            |
| Android export       | 清除 Metro 缓存后通过，4094 modules、28 assets、Hermes bundle 7,279,300 bytes                                  |
| Android prebuild     | `--platform android --no-install` 通过；原生项目无依赖变更、无此前 system-ui 警告                              |
| 原生配置             | 包名 `com.dshtauri.dshbridge`、cleartext 开启、CAMERA/POST_NOTIFICATIONS 权限、无 RECORD_AUDIO；CNG 产物不入库 |
| APK / 真机 / 远端 CI | **未验证**；本机 Android SDK 路径不存在，本轮未下载 SDK                                                        |

Clean-checkout 检查暴露了仅靠被忽略的 Expo 生成类型声明才能识别 CSS 导入的问题；已将 Expo 与 Uniwind 类型入口一并放入项目源文件 [env.d.ts](../src/env.d.ts)，复验通过。

导出的 Android Hermes bundle SHA-256：

```text
24d7f1c99cd0e12ae009cf1e46b1d30b757a627a8e6b6134cd23ed05d0064281
```

该校验值属于本次本地 Bundle，不是 APK 校验值。

## 自动化范围

测试直接调用真实协议解析、扫描池、Store、持久化、运行控制、通知策略、通知 hook、生成的 WebView shim 及 React 渲染的路由/网页组件；只 mock 原生、网络、Expo 与视觉库边界。

| 范围                                                                                                                           | 关键覆盖                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [URL 协议](../src/utils/bridge-protocol.test.ts) / [候选发现](../src/utils/discovery.test.ts)                                  | HTTP/HTTPS、令牌清理、恶意 scheme、IPv4、端口、精确排除、当前 IP 规范化                                                                                  |
| [探测客户端](../src/services/bridge-client.test.ts)                                                                            | 真实身份协议、非 JSON/SPA 拒绝、超时、取消、最大并发、预算及资源清理                                                                                     |
| [连接 Store](../src/store/modules/connection/index.test.ts) / [持久化](../src/store/modules/connection/storage.test.ts)        | 成功后记录、20 条/5 条、重复历史选最新、guide、令牌隔离、单个 SecureStore 读取失败不抹掉其他历史、写入次序                                               |
| [运行控制](../src/store/modules/connection/runtime.test.ts)                                                                    | 历史优先、token-only、取消/IP/探测竞态、20 秒超期拒绝迟到结果、精确跳过断开地址、health 代际隔离                                                         |
| [通知策略](../src/utils/notification-policy.test.ts) / [原生 hook](../src/hooks/use-notifications.test.ts)                     | 权限单飞与失败重试、前台抑制、静音 channel、稳定 tag、250 ms 点击合并、冷/热响应、监听释放                                                               |
| [注入脚本](../src/utils/webview-bridge.test.ts)                                                                                | 实际生成脚本在 `node:vm` 执行；origin/nonce/source、幂等、DSH shell/login 指纹、错误文档、真实 session capability、15 秒 focus acknowledgment、取消/重试 |
| [根布局](../src/ui/routes/_layout.test.tsx) / [首页](../src/ui/routes/index.test.tsx) / [扫码](../src/ui/routes/scan.test.tsx) | 真实 React/Store；hydration、通知返回正确主机、关闭 modal、原生 Drawer props、WebView 实例保留、五条状态、相机权限与重复扫码                             |
| [WebView 组件](../src/ui/webview/bridge-webview.test.tsx)                                                                      | Android finish-before-error 不误记成功、可信 ready、20 秒加载界限、focus supersession/ACK、同文档重载可见性、登录跳转重试、外站导航、返回键与释放        |

路由测试位于生产路由目录外，避免 Expo Router 将测试文件打入应用。无快照、skip、only、盲等或 Jest API；假计时器和本地 native mocks 在每个文件清理。

### 本轮修复的关键回归

- 自身 IPv4 有前导零时，候选排除必须使用规范化 IP。
- 反序列化重复 origin 时保留最新 timestamp，新的 QR token 优先于旧存储 token。
- 20 秒全局扫描 deadline 后，即使 worker 延迟返回也不能再接管连接。
- 旧页面的 health 请求不能覆盖重连后相同 origin 的新状态。
- SecureStore 单条读取失败保留其余历史和可读令牌，不降级为明文。
- Android 原生 WebView 可能先 `onLoad` 再 `onError`；成功以同源、带 nonce 的真实 DSH 文档 ready 为准。
- 原生通知先写 `pendingFocus`，再触发 `focusGeneration` 订阅；相同 metadata 重试仍产生新 request，旧 acknowledgment 不清空新请求。
- WebView 重载重新同步可见性并取消旧 focus；新文档就绪后重新定位，失败提供可见手动提示。
- APK 同标签改签名模式重跑使用同名资产，且显式设置 prerelease true/false。

## 代表性变异验证

通过当前 Vitest 的 `startVitest` API 和 Vite `enforce: 'pre'` transform，仅在内存中修改真实生产模块，不改写磁盘上的生产代码或测试。变异前后完整 control 都为 **469/469 通过**；八个样本均被实际断言击杀，零幸存/无效样本。

| 变异决策                                        | 失败 / 该范围测试数 |
| ----------------------------------------------- | ------------------- |
| 删除 native 消息 nonce 校验                     | 3 / 108             |
| 删除 shim origin/source 限制                    | 7 / 108             |
| 保留状态检测调用但忽略前台抑制结果              | 2 / 24              |
| 删除扫描结果接管前的 expired guard              | 1 / 39              |
| 颠倒 pendingFocus 与 focusGeneration 的写入顺序 | 3 / 9               |
| native `onLoad` 未经 ready 证明就记为成功       | 2 / 20              |
| 删除同文档 reload 的 `onLoadStart` 重置         | 2 / 20              |
| 已存 token 优先于新 QR/显式 token               | 2 / 39              |

每个样本恰好一次目标 transform 命中与应用；测试集合与 control 对应范围一致。没有将语法、import、收集、未处理异常或 runner 失败计为击杀。45 个 source/test/config/manifest 文件的 SHA-256 快照在运行前后不变。该结果是代表性测试效力检查，不是全量 mutation coverage，更不是原生执行证明。

详细输出与可重跑脚本保留在本地被忽略的临时目录：[mutation-results.json](../.temp/mutation-results.json)、[mutation-check.mjs](../.temp/mutation-check.mjs)。原始临时证据不属于远端源码交付。

## 连接失败与扫码图标修复（2026-10-03，尚未发布）

用户反馈地址正确、浏览器可访问，但 APP 显示连接失败且抽屉仍显示可用。主机公开探测成功与 WebView 文档就绪是两条不同链路，不能根据绿点证明页面已经加载成功。以下为生产代码的确定性回归结果，尚不能确认用户设备具体触发了哪一条路径。

- 上游 Bridge 的正常密码登录 HTML 返回 HTTP 401；旧组件把该主文档状态码直接记为终止错误，并拒绝随后到达的可信 ready。先写失败再 ready，以及先 ready 再收到 401，两种顺序均已复现。现在 401 等待可信 DSH 登录/应用指纹，不直接判为成功；无指纹的 401 仍在 20 秒后失败。
- 注入较早时页面指纹或原生消息通道可能尚未出现；旧脚本遇到相同 nonce 直接返回，完成阶段再次注入也不重新检查。现在重复注入仅重试 readiness；成功后只发送一次，不重复安装通知构造器或监听。
- 初次成功后同源整页重载，Store 的初始 loading 已结束；旧 watchdog 因此没有再次启动。现在超时跟随每个文档的 readiness，重载的未验证 401 仍精确在 20 秒失败，已验证的登录页不会被迟到 timeout 覆盖。
- 首页和抽屉两个扫码入口均使用扫描框图标 `ScanLine`，不再使用二维码图案；真实路由渲染断言覆盖两个入口。

网络错误、其他主文档 HTTP 4xx/5xx 与 render process 终止仍为失败；generic HTML、外站/子框架、错误 nonce/source 不能获得就绪。未修改上游或安装本地 SDK。

| 检查                | 本轮结果                                                               |
| ------------------- | ---------------------------------------------------------------------- |
| TypeScript / ESLint | `tsc --noEmit` 与全工程 `--max-warnings 0` 均通过                      |
| 完整测试            | 13 个文件、481 项；5 个独立进程连续全通过                              |
| 随机测试            | seed `100404`，481/481 通过                                            |
| Expo 兼容           | `expo install --check` 通过                                            |
| Android export      | 清除缓存后通过，4094 modules、28 assets、Hermes bundle 7,279,563 bytes |
| Android prebuild    | `--platform android --no-install` 通过；依赖文件无变更                 |
| 新版 APK / 真机     | 未执行；已发布 `v0.1.0` APK 不包含本轮修复                             |

本轮本地 Hermes bundle SHA-256（不是 APK 校验值）：

```text
1b2f9148e3492d926bd3ccc670ef71e68e432d431fd566d621eb5cc0f71a10e5
```

### 本轮代表性变异验证

内存 transform 前后完整 control 均为 481/481 通过；8 个样本全部由实际断言击杀，0 幸存、0 无效样本。

| 变异决策                                    | 失败 / 该范围测试数 |
| ------------------------------------------- | ------------------- |
| 恢复把正常登录页 HTTP 401 直接记为失败      | 5 / 26              |
| watchdog 仅覆盖初次 loading，不覆盖文档重载 | 1 / 26              |
| 相同 nonce 再次注入不重试 readiness         | 3 / 139             |
| 每次注入重复发送 ready                      | 6 / 113             |
| 原生消息通道出现前消耗唯一 ready 机会       | 1 / 113             |
| 任意 complete HTML 都记为 ready             | 35 / 139            |
| 再次注入跳过 origin/top-frame 检查          | 4 / 113             |
| 两处扫码入口恢复为二维码图案                | 1 / 13              |

没有把语法、import、收集、未处理异常或 runner 失败算作击杀。44 个保护文件在运行前后的 SHA-256 不变；没有改写生产源码或测试。详细本地证据：[connection-mutation-results.json](../.temp/connection-mutation-results.json)、[connection-mutation-check.mjs](../.temp/connection-mutation-check.mjs)。这些临时文件不入库，结果不等于 Android 真机验证。

## v0.1.1 发布候选：UI、文档导航与声明打包（2026-10-03）

本节为最新候选结果；上方 469 / 481 项表保留各阶段历史，不代表最新测试数量。版本 `0.1.1`、Android versionCode `2`，用户已批准推送与 APK 发布；本地 SDK 仍未安装。

- 页面全宽作为原生 right/slide Drawer 的 `swipeEdgeWidth`，保留原生横向阈值和纵向失败规则；尺寸变化跟随 `useWindowDimensions`，不增加自定义手势层，抽屉开关仍不重挂 WebView。
- 首页最近连接与扫码按钮同为描边，自动扫描增加对比色雷达图标；当前/最近连接使用相同标题及列表项，无当前卡片、行内刷新或可用状态文字，状态仍有圆点与无障碍描述。最近标题右侧刷新复用真实 singleflight 探测，不重新连接网页。
- 从本地 DSH 内核提取原始鲸鱼、DeepSeek 与 Harness 的 SVG 路径，保持几何字符串不变，三行居中竖排；鲸鱼无白底，使用主题语义色反转，原 launcher PNG 不变。
- 复核新增三个先红后绿的真实 WebView / VM 回归：前一文档 19 秒时切到新文档，新文档仍获得完整 20 秒；新文档的可信 ready 可在旧截止后成功；Android `loading: false` 的 history/hash 回调不清除 one-shot 就绪、不取消待确认 focus。
- 原生 Expo 配置将 [第三方声明](../THIRD_PARTY_NOTICES.md) 全文嵌入 `extra.thirdPartyNotices`，复用唯一声明文件。真实 `getConfig` 回归与 Expo Constants 生成脚本均验证完整文本。Release 从实际 APK 的 `assets/app.config` 解压逐字核对，附带上传声明并纳入校验和。

| 检查                | 最新结果                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------ |
| 安装 / Expo 兼容    | frozen lockfile 安装与 `expo install --check` 通过，无依赖变更                             |
| TypeScript / ESLint | `tsc --noEmit`、全工程 `--max-warnings 0` 通过                                             |
| 完整测试            | 14 个文件、489 项；5 个独立完整进程连续通过                                                |
| 随机测试            | seed `100408`，489/489 通过                                                                |
| 代表性变异          | 15 个全部由断言击杀；前后 controls 均 489/489，0 幸存 / 0 无效；47 个保护文件 SHA-256 不变 |
| Android export      | 清缓存后通过，4094 modules、27 assets、Hermes 7,297,673 bytes                              |
| Android prebuild    | `--platform android --no-install` 通过；Android versionName `0.1.1`、versionCode `2`       |
| 工作流检查          | actionlint 1.7.12 通过（Windows 未运行 shellcheck/pyflakes）                               |
| 新 APK / 设备       | 等待远端真实 Release 与产物核验；设备验收未执行                                            |

最终本地 Hermes bundle（不是 APK）SHA-256：

```text
0c506a6d31a4bc08c7e4e1feba04b5c83519e798647aa4b24e0a1ef40351c5ce
```

### v0.1.1 代表性变异

| 恢复的错误决策                | 失败 / 该范围测试数 |
| ----------------------------- | ------------------- |
| HTTP 401 登录文档直接终止     | 5 / 29              |
| watchdog 仅覆盖最初连接       | 3 / 29              |
| 新文档继承旧截止时间          | 2 / 29              |
| history/hash 回调清除文档就绪 | 1 / 29              |
| 相同 nonce 不重试 readiness   | 3 / 142             |
| 重复 ready 握手               | 6 / 113             |
| transport 出现前消耗 ready    | 1 / 113             |
| 任意 HTML 视为 DSH            | 35 / 142            |
| 再次注入忽略 origin/top       | 4 / 113             |
| 扫码恢复二维码图案            | 2 / 17              |
| 抽屉仅右边缘可滑              | 1 / 17              |
| 最近连接按钮无描边            | 1 / 17              |
| 标题刷新为空操作              | 1 / 17              |
| 鲸鱼不随主题反色              | 1 / 17              |
| Harness 字形与底牌同色        | 1 / 17              |

每个变异一次命中，测试收集、import、未处理异常与 runner 失败均为零，不将这些误算为击杀。临时脚本与报告：[connection-mutation-check.mjs](../.temp/connection-mutation-check.mjs)、[v011-mutation-results.json](../.temp/v011-mutation-results.json)，不入库。原生 WebView 回调、全页手势与 SVG 真机视觉仍需下面的设备验收，自动化通过不替代这些结果。

## 真机验收清单（尚未执行）

### Android 与 LAN

- [ ] 在至少一台 Android 真机安装开发客户端/APK，验证冷启动、明暗主题、无白底鲸鱼 / DeepSeek / Harness 三行 SVG 裁切及反色、三点动画、系统 inset/返回键。
- [ ] 首次启动历史为空自动扫描；已保存可用主机优先连接；全部离线进入手动页；取消和重复扫描无迟到跳转。
- [ ] 验证不同 LAN IP、主机防火墙、访客网络隔离、Wi-Fi 切换、无 IPv4/VPN 及自定义端口 QR。
- [ ] 从页面中央、左侧与右侧向左滑均打开 right/slide 抽屉，网页不重载；纵向网页滚动与系统返回手势不冲突；最近连接按钮与网页按钮同样可打开；首次 guide 点按或打开抽屉后不再弹。
- [ ] 列表只显示五条，绿/红圆点与主机启停一致，TalkBack 可读出状态；标题刷新仅更新可用性，点击当前/最近项重连，断开后扫描且不会立即连回刚断开的 origin。

### 相机与 WebView

- [ ] 相机允许/拒绝/永久拒绝/从设置返回；后台不保持相机运行；单个 QR 连续识别只连接一次。
- [ ] 测试 Bridge token-only、token+password、password-only 登录，302 清理 auth 参数、cookie 重连、无效/过期 token、历史安全存储。
- [ ] Android 网络错误、主文档 HTTP 4xx/5xx、WebView render process 终止不污染成功历史，重连可恢复。
- [ ] 外部链接和 popup 只在外部浏览器打开；自定义 scheme/file 不进入受信 WebView。
- [ ] 网页有 history 时返回、抽屉打开时返回、扫码 modal 打开时返回与 Android 原生手势不冲突。

### 通知

- [ ] Android 13+ 首次权限弹窗、拒绝、系统设置撤销再授权；前台无系统重复通知。
- [ ] 普通/静音 channel、同 tag 更新、点击合并、短暂 inactive、通知抽屉 blur/focus 行为。
- [ ] 暖点击当前主机、扫码 modal 内点击、切换另一已知主机、冷启动等待 hydration、会话被折叠时官方 capability 仍能定位。
- [ ] 登录页到 workspace 的整页跳转与重载后 focus 重试；不可定位时显示手动选择提示。
- [ ] 区分已投递通知的冷点击与进程被杀后产生的新远程事件；后者没有 push/常驻服务保证。

### APK 与发布

- [x] 经批准推送后运行真实 Ubuntu CI/Release；确认 Gradle、原生模块与 SDK 版本实际编译成功。
- [x] 无 signing secrets 的开发签名路径：APK v2 签名验证、16 KB zipalign 检查、checksum、版本、包名、预发布标记与资产全部通过。
- [ ] 四个 signing secrets 的全有、部分配置，以及正式证书路径的真实运行验收。
- [ ] 真机检查 16 KB page size 兼容；`zipalign -P 16` 不是全部 ELF/runtime 兼容性的证明。
- [ ] 正式签名更新、开发签名切换卸载提醒、同标签重新上传的 notes/prerelease/资产一致性。
- [ ] iOS 发布 TODO；本轮无 iOS CI、ATS/local-network 权限或发行验收。

## 发布执行记录

2026-10-03 用户授权 SDK 安装、推送代码和发布 Android APK。目标仓库为私有 [`dsh-tauri/dsh-bridge-mobile`](https://github.com/dsh-tauri/dsh-bridge-mobile)，版本 `v0.1.0` / Android versionCode `1`；无正式签名 secrets，按约定使用开发签名并标为 prerelease。

- 发布前复验：typecheck、零警告 lint、随机 seed `100301` 的 469/469 测试通过。
- 首次提交 `644948e` 已推送到 `main`。[首次 Ubuntu CI](https://github.com/dsh-tauri/dsh-bridge-mobile/actions/runs/37062026233) 全部通过，包含安装、Expo 兼容、typecheck、lint、普通/随机测试、export 与 prebuild。
- 用户随后明确优先完成 Release APK，本地 SDK 留待发布后处理。本轮停止本地 SDK 安装与中转方案，未创建 SDK artifact；仅远端 Release job 安装必要工具。Android command-line tools 固定 `16.0` / `12266719`，与 JDK 17 配对。
- Release 工具链调整提交 `4917467` 已推送，标签 `v0.1.0` 指向该提交。[对应 CI](https://github.com/dsh-tauri/dsh-bridge-mobile/actions/runs/37063330514) 全部通过。
- [首次原生 APK Release](https://github.com/dsh-tauri/dsh-bridge-mobile/actions/runs/37063335612) 的 build 与 publish 全部成功；Gradle 输出 `BUILD SUCCESSFUL in 36m 45s`。版本校验、依赖安装、Expo 兼容、typecheck、lint、469 项随机测试、Android 工具安装、prebuild、原生编译、签名/对齐验证和 Release 上传均通过。
- [v0.1.0 Release](https://github.com/dsh-tauri/dsh-bridge-mobile/releases/tag/v0.1.0) 于 `2026-10-02T21:30:52Z` 发布（北京时间 2026-10-03 05:30:52），为非 draft 的开发签名 prerelease。仓库私有，下载需访问权限。
- [APK](https://github.com/dsh-tauri/dsh-bridge-mobile/releases/download/v0.1.0/dsh-bridge-v0.1.0-android.apk) 大小 `103110816` bytes；[SHA256SUMS.txt](https://github.com/dsh-tauri/dsh-bridge-mobile/releases/download/v0.1.0/SHA256SUMS.txt) 与实际下载 APK 的 SHA-256 均为 `b7300f89e6c05388409c136afdc0d27ebff4a3cb58ab9232c52540ab64360d9f`，也与 GitHub asset digest 一致。
- `apksigner verify --verbose` 通过，v2 scheme 为 true、signer 数为 1；`zipalign -c -P 16 4` 通过。APK metadata：包名 `com.dshtauri.dshbridge`、versionName `0.1.0`、versionCode `1`、minSdk `24`、target/compileSdk `36`、ABI `arm64-v8a` / `armeabi-v7a` / `x86_64`。
- 真机验收仍未执行；远端编译、签名/对齐验证与设备行为分开记录。

本地成果和规范见 [README](../README.md) 与 [开发规则](../AGENTS.md)。
