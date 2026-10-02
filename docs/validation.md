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

## 真机验收清单（尚未执行）

### Android 与 LAN

- [ ] 在至少一台 Android 真机安装开发客户端/APK，验证冷启动、明暗主题、鲸鱼与三点动画、系统 inset/返回键。
- [ ] 首次启动历史为空自动扫描；已保存可用主机优先连接；全部离线进入手动页；取消和重复扫描无迟到跳转。
- [ ] 验证不同 LAN IP、主机防火墙、访客网络隔离、Wi-Fi 切换、无 IPv4/VPN 及自定义端口 QR。
- [ ] 右边缘向左滑打开右侧 slide 抽屉，网页不重载；最近连接按钮与网页按钮同样可打开；首次 guide 点按或打开抽屉后不再弹。
- [ ] 列表只显示五条，绿/红状态与主机启停一致；点击重连、当前重启、断开后扫描且不会立即连回刚断开的 origin。

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

- [ ] 经批准推送后运行真实 Ubuntu CI/Release；确认 Gradle、原生模块与 SDK 版本实际编译成功。
- [ ] 四个 signing secrets 的全有、全无、部分配置；校验证书、zipalign、checksum、版本、APK 包名与资产。
- [ ] 真机检查 16 KB page size 兼容；`zipalign -P 16` 不是全部 ELF/runtime 兼容性的证明。
- [ ] 正式签名更新、开发签名切换卸载提醒、同标签重新上传的 notes/prerelease/资产一致性。
- [ ] iOS 发布 TODO；本轮无 iOS CI、ATS/local-network 权限或发行验收。

## 发布执行记录

2026-10-03 用户授权 SDK 安装、推送代码和发布 Android APK。目标仓库为私有 [`dsh-tauri/dsh-bridge-mobile`](https://github.com/dsh-tauri/dsh-bridge-mobile)，版本 `v0.1.0` / Android versionCode `1`；无正式签名 secrets，按约定使用开发签名并标为 prerelease。

- 发布前复验：typecheck、零警告 lint、随机 seed `100301` 的 469/469 测试通过。
- 本地 SDK：安装执行中；官方 Google 下载当前存在 TLS 握手失败，尚未证明安装成功。
- 远端验证与发布：[Actions](https://github.com/dsh-tauri/dsh-bridge-mobile/actions)、[Releases](https://github.com/dsh-tauri/dsh-bridge-mobile/releases)；提交后跟进实际结果，不提前宣称 APK 成功。
- 真机验收仍未执行；远端编译、签名/对齐验证与设备行为分开记录。

本地成果和规范见 [README](../README.md) 与 [开发规则](../AGENTS.md)。
