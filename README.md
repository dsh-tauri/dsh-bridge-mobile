# DSH Bridge

React Native 局域网发现与 WebView 连接管理器，使用 Expo Router、HeroUI Native 和原生手势右抽屉。应用名称 **DSH Bridge**，Android 包名 `com.dshtauri.dshbridge`。

仓库归属：[`dsh-tauri/dsh-bridge-mobile`](https://github.com/dsh-tauri/dsh-bridge-mobile)（私有）。[Android APK 发布入口](https://github.com/dsh-tauri/dsh-bridge-mobile/releases)；访问源码与 APK 需要该私有仓库的权限。

## 功能

- 启动先恢复历史连接及安全令牌，优先检测历史；无可用历史时并发发现当前 IPv4 `/24` 网段中的 DSH 服务。
- 扫描页：黑色鲸鱼、三点脉冲动画、扫描文案及取消按钮。取消后显示底部自动扫描、扫码连接与最近连接入口。
- `react-native-drawer-layout` 原生手势抽屉：右侧、`slide` 模式，右边缘向左滑打开；当前连接、重新连接、最近五条及可用状态、红色断开按钮。
- QR 相机识别 HTTP/HTTPS 地址，包括上游 `?auth=…` / `?token=…` 连接链接；重复扫码锁定、权限拒绝和设置入口。
- 全屏 `react-native-webview`，抽屉开关不会重新挂载网页；首次连接滑动引导、Android 返回键、加载失败与重连。
- 上游网页 `Notification` / `dsh://native-notification` 适配原生通知；同 tag 更新、权限单飞、静音通道与冷/热点击恢复连接及会话。
- HeroUI Native 直接使用，不引入公司包装包、shadcn 或基准项目补丁；主题映射 Desktop 的中性反色主按钮与明暗色板。

## 开发

建议 **Node 22 LTS**（至少 22.13）与 **Bun 1.4.2**。系统 Node 25 不在测试工具的支持范围内。

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint --max-warnings 0
bun run test
bun run test:shuffle
bun run build
bun run prebuild:android
```

`build` 只导出 Android JavaScript/Hermes bundle；`prebuild:android` 只生成原生项目，不编译 APK。工程采用 Expo CNG，生成的 `android/`、`ios/` 不入库。

已安装 Android SDK、JDK 17 后，可构建开发客户端并在模拟器或真机启动：

```sh
bun run android
bun run dev
```

扫码、WebView、原生通知及手势验收请使用开发客户端或 APK，不以网页预览替代。SDK、Gradle、CI 与发布结果分别记录在 [验证记录](docs/validation.md)，不将 bundle/prebuild 成功等同于 APK 或真机验收。

### 依赖基准

版本依据最新版 HeroUI Native 的 peer 条件及对应 Expo SDK 的原生兼容表，不继承 lexim 基准仓库的旧版本。锁定版本见 [package.json](package.json) 与 [bun.lock](bun.lock)。

| 组件                        | 锁定基准                          |
| --------------------------- | --------------------------------- |
| HeroUI Native               | 1.0.10                            |
| Expo / React Native / React | SDK 57 / 0.86.3 / 19.2.3          |
| 原生 Drawer                 | react-native-drawer-layout 4.2.11 |
| Reanimated / Worklets       | 4.5.1 / 0.10.1                    |
| Gesture Handler / WebView   | 2.32.x / 13.16.1                  |

HeroUI 的实际开发栈与 Expo 57 原生版本一致；不是将所有独立 npm 包无条件升级到 latest。`react-if-lite`（React `^18`）和 `valtio-define`（React `^19.2.4`）的声明会对 Expo 固定的 React 19.2.3 产生 peer 警告；保留 Expo 官方配对，已验证真实 React 渲染及 bundle，不添加隐藏 override 或公司补丁。原生执行仍须 CI/真机验证。

参考：[HeroUI Native Quick Start](https://heroui.com/en/docs/native/getting-started/quick-start)、[React Navigation Drawer Layout](https://reactnavigation.org/docs/drawer-layout)。

## 发现与连接约束

参数集中在 [constants.ts](src/config/constants.ts)：默认端口 `3082`（Bridge）、`3080`（DSH），并加入历史端口及 `EXTRA_SCAN_PORTS`；并发 40、请求超时 600 ms、历史探测 3 s、整个自动发现预算 20 s。前台每 15 s 检测当前连接与最近五条。

服务识别使用上游公开 `/__dsh_bridge__/auth-status` JSON。旧响应缺少身份字段时再校验 `/manifest.webmanifest` 的 DSH 标识；不会把任意 HTTP 200 HTML 当作 DSH 服务。没有 mDNS 广播或未知服务的通用端口枚举。

- 自动发现以当前 IPv4 推导 `/24`，不保证跨网段、VPN、访客 Wi-Fi 隔离或非默认端口发现。此时使用桌面/Bridge 生成的 QR，或在配置中追加端口。
- 桌面与手机需能互访，主机服务必须监听 LAN 接口，防火墙需允许对应端口。
- 断开清空当前连接并回到扫描页，保留历史；紧接着的那轮扫描跳过刚断开的精确 origin，避免马上连回同一地址。
- 最多保存 20 条成功连接，抽屉显示最近五条。成功由可信 DSH 文档就绪消息确认，不依赖 Android 会在网络错误前触发的原生 `onLoad`。
- AsyncStorage 只存无令牌的连接元数据；令牌单独存 SecureStore。密码登录保留在 WebView 内，由其 cookie jar 管理，不通过 RN fetch 登录。
- LAN HTTP 通过 Android cleartext 配置支持；HTTP 不提供传输保密性，请仅用于可信局域网。公网连接优先 HTTPS，避免将带令牌的 QR 分享给他人。

## 通知与安全边界

通知实现见 [use-notifications.ts](src/hooks/use-notifications.ts)、[webview-bridge.ts](src/utils/webview-bridge.ts)。

- 消息入口校验类型白名单、精确 scheme/host/port origin、原生事件 URL 和每个 WebView 的随机 nonce；页面转发还检查同源且 `event.source === window`。外站顶层链接在外部浏览器打开。
- APP 活跃前台不重复投递系统通知；进入可信页面后请求权限。拒绝不投递，后续重新检查系统授权；静音通知使用独立 Android channel。
- 通知点击仅回到当前或已有历史 origin，不自动信任任意通知 metadata 地址。冷启动等待 hydration，必要时关闭扫码 modal 并重新连接保存的主机。
- 会话定位使用上游 `__dshClientCtx` 的 `uiWorkspace.openSession`，兼容旧 `sessions.open` 及真实 `data-row-key` 会话行。等待页面就绪与前台状态，200 ms 重试、15 s 上限，匹配请求 acknowledgment 后才清空待处理点击；失败显示手动选择提示。
- 上游没有独立远程通知推送端点。网页事件只在 WebView/应用仍有执行机会时可转发；**不保证系统挂起、进程被杀或关闭 APP 后继续收到新任务通知**。已存在的系统通知点击可恢复连接。
- 通知 action 按钮与输入动作尚为 TODO；当前只处理通知本体点击。iOS 发布、后台远程 push/常驻服务不在本次实现范围。

## 项目结构

- [根布局](src/app/_layout.tsx)：原生 Provider、hydration、持久化、发现与通知响应生命周期。
- [首页](src/app/index.tsx) / [扫码页](src/app/scan.tsx)：扫描状态、原生抽屉、相机 modal。路由测试放在 [UI 测试目录](src/ui/routes/)，不污染 Expo Router 的生产路由。
- [连接 Store](src/store/modules/connection/index.ts) / [运行控制](src/store/modules/connection/runtime.ts) / [持久化](src/store/modules/connection/storage.ts)：连接与代际状态的唯一权威。
- [探测客户端](src/services/bridge-client.ts)、[URL 协议](src/utils/bridge-protocol.ts)、[候选生成](src/utils/discovery.ts)：身份校验、取消与有界并发。
- [WebView](src/ui/webview/bridge-webview.tsx)：原生导航边界、可信就绪、通知点击 acknowledgment。
- [主题变量](src/styles/variables.css)、[文案](src/config/copy.ts)、[开发规则](AGENTS.md)。

## Android APK CI 与发布

[CI](.github/workflows/ci.yml) 执行 frozen install、Expo 兼容检查、typecheck、零警告 lint、普通/随机测试、Android export 与 prebuild。[Release workflow](.github/workflows/release.yml) 只构建 APK，iOS TODO；由 `v*` 标签或手动选择**已有版本标签**触发。

发布前需同步版本和 Android `versionCode`，并经批准提交、推送代码与标签。工作流校验标签指向当前 commit，且 tag、[package.json](package.json)、[app.json](app.json) 版本一致。

正式签名需同时配置四个 GitHub Actions secrets：

| Secret                      | 内容               |
| --------------------------- | ------------------ |
| `ANDROID_KEYSTORE_BASE64`   | keystore 的 Base64 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码      |
| `ANDROID_KEY_ALIAS`         | 签名 key alias     |
| `ANDROID_KEY_PASSWORD`      | 签名 key 密码      |

四项全有时对 release APK 使用正式 key 重新签名；全无时使用开发证书，并在日志、release notes 中明确警告且强制标为 prerelease；部分配置直接失败。开发证书不能视作安全的生产签名；切换正式签名通常不能覆盖安装已有开发签名 APK，需先卸载。

远端构建环境：JDK 17、Android command-line tools 16.0、API 36 / build-tools 36.0.0、NDK 27.1.12297006、CMake 3.22.1。无需先安装本地 SDK 即可由 Release CI 构建 APK。产物为 `dsh-bridge-v<版本>-android.apk` 与 `SHA256SUMS.txt`。上传前执行 zipalign 16 KB 对齐检查、签名验证及 APK metadata 检查；build 与 publish 分离，发布同标签重跑使用稳定资产名与显式 prerelease 状态。

首次 `v0.1.0` 发布已获授权；本轮优先完成远端 APK，本地 SDK 留待后续。没有配置正式签名 secrets 时，发布明确标注开发签名的预发布 APK。[CI 执行记录](https://github.com/dsh-tauri/dsh-bridge-mobile/actions) 和 [Release](https://github.com/dsh-tauri/dsh-bridge-mobile/releases) 是远端结果入口。APK 安装、签名升级、16 KB 真机和手势/相机/通知行为尚待设备验收，完整状态见 [验证记录](docs/validation.md)。
