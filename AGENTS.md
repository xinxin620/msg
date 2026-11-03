# Repository Guidelines

## 项目基准 / Project Baseline

> 本文件是 `msg` 仓库的项目级基准上下文，首次按当前工作副本核对于 2026-11-04。后续任务应优先阅读本文件，再检查实际代码；若本文件与源码、页面行为或外部工具事实冲突，以当前代码和实际验证为准，并在同一变更中同步修复本文件。
>
> 每次变更架构、依赖、入口、存储格式、画布桥接能力、外部服务边界或关键约束时，都必须同步更新本文件。

### 1. 项目名称、业务定位与用途

- **项目名称**：漫时光 / MANSHIGUANG。
- **业务定位**：面向中文二次元用户的沉浸式动漫网站原型，视觉主题为「夜航星海」。
- **主要用途**：
  - 展示原创虚构番剧、排行榜、新番表、社区内容和追番状态。
  - 提供搜索、分类筛选、详情弹层、选集和本地收藏等纯前端交互。
  - 在主导航「社区」右侧提供独立「画布」入口，在浏览器新标签页打开「简单画布」AI 工作流管理界面。
  - 画布支持工作流编排、AI 服务商配置、素材上传、文本/媒体保存和部分网络请求，但仍是浏览器版，不等价于原 Electron 桌面版。
- **当前阶段**：零依赖静态前端原型。没有账号系统、真实番剧 API、视频播放器、社区后端、服务端数据库或生产部署配置。

### 2. 技术栈、运行时与依赖

#### 2.1 主站

| 类别 | 当前实现 |
| --- | --- |
| 页面 | 原生 HTML5，中文语义化结构 |
| 样式 | 原生 CSS，CSS 变量、Grid/Flex、媒体查询、动画 |
| 脚本 | 原生 JavaScript，IIFE/普通脚本，无 ESM、无框架、无打包 |
| 构建 | 无构建步骤、无 `package.json`、无 npm 依赖 |
| 预览 | 可直接打开 `index.html`；推荐通过本地静态服务器访问 |
| 存储 | `localStorage`，追番键名 `manshiguang:favorites` |
| 浏览器 | 现代 Chrome、Edge、Firefox、Safari 的较新版本；画布高级本地能力优先 Chromium |
| 字体 | Google Fonts；离线时回退到系统中文字体 |

#### 2.2 画布

`canvas/` 是从用户提供的「简单画布」Electron 安装包中提取的已打包前端，不是本仓库重新构建的源码。

| 类别 | 当前实现 |
| --- | --- |
| 前端 | 预构建 React 19.2.4 单页应用，嵌入在 `canvas/assets/index-*.js` |
| 工作流画布 | `@xyflow/react`（原包声明 `^12.10.2`） |
| 状态 | Zustand（原包声明 `^5.0.12`） |
| 本地数据 | Dexie / idb-keyval；浏览器桥接另用 IndexedDB |
| 图形与编辑 | PixiJS、react-image-crop、lucide-react |
| 桌面原实现 | Electron preload + IPC + Node.js 文件系统、FFmpeg、undici |
| 当前宿主 | `canvas/index.html` + `canvas/web-bridge.js` + `canvas/branding-patch.js` + `canvas/api-profiles-patch.js` + `canvas/model-patch.js`，在普通浏览器中提供兼容层、品牌替换、API 来源多配置管理和第三方模型列表/协议适配 |
| 构建 | 本仓库不构建画布 bundle；不要手改压缩后的 `index-*.js` / `index-*.css` |

#### 2.3 Java、Spring 与中间件结论

- **Java 版本：不适用。** 本项目没有 Java 源码、JVM 构建或 Java 运行时要求。
- **Spring Boot / Spring Cloud / Spring MVC：不适用。**
- **Redis、RabbitMQ、MySQL：不适用。** 没有消息队列、缓存服务或关系数据库。
- **数据库表：无。** 主站收藏使用 `localStorage`；画布偏好/workflow 由打包应用保存在浏览器存储；API 多配置使用 `localStorage["manshiguang:canvas-api-profiles"]`，当前启用项再同步到原有 `canvas-api-settings`；目录授权使用 IndexedDB 数据库 `manshiguang-canvas-bridge` 的 `directoryHandles` object store。API 配置默认保留在浏览器；若在「常规设置 → API 配置存储」中选择本地目录，则另写一份明文 JSON 副本，位置元数据使用 `localStorage["manshiguang:canvas-api-storage"]`，目录 handle 使用独立 token 保存，不复用或覆盖素材目录。
- 后续若引入后端，应先明确 API、鉴权、数据模型和部署边界，再修改本文件；不要把模板中的 Java/Spring/MySQL 假设套到当前项目上。

### 3. 目录结构与职责

```text
msg/
├─ index.html                 主站页面结构、图标、导航、弹层与页脚
├─ assets/
│  ├─ styles.css              夜航星海视觉系统、布局、动效与响应式
│  ├─ app.js                  番剧数据、渲染、收藏、搜索、弹层和画布新标签页入口
│  ├─ hero-art.svg            首页原创主视觉
│  └─ favicon.svg             主站图标
├─ canvas/
│  ├─ index.html              画布宿主页、启动遮罩和错误提示
│  ├─ web-bridge.js           浏览器兼容桥接层，向画布暴露 window.electronAPI
│  ├─ branding-patch.js       设置页作者信息品牌替换补丁，不修改压缩 bundle
│  ├─ api-profiles-patch.js   云雾/第三方 API 多配置管理与唯一启用补丁
│  ├─ model-patch.js          已选模型下拉注入与第三方请求协议适配
│  ├─ assets/
│  │  ├─ index-BN-uSJKj.js    已打包 React 画布应用
│  │  └─ index-BfAuAU0s.css   已打包画布样式
│  ├─ dt-canvas-logo.png      画布品牌资源
│  ├─ donation-qr.png         阿亮啊支付宝收款码兼容副本
│  ├─ donation-qr-liangliang-20261103.png
│  │                          运行时加载的阿亮啊支付宝收款码卡片
│  └─ icon.ico                画布图标
├─ .preview/                  桌面、移动端、搜索和详情验收截图
├─ AGENTS.md                  项目基准与协作约束
├─ README.md                  面向使用者的项目说明
└─ MEMORY.md                  项目长期记忆与已确认决策
```

#### 3.1 主站职责

- `index.html`：只保留静态结构和无障碍语义；动态番剧卡片、排行榜、新番表和搜索结果由 `assets/app.js` 渲染。
- `assets/app.js`：
  - `animeLibrary`：12 部原创虚构番剧的唯一数据源。
  - `state`：当前筛选、搜索、移动菜单、详情和收藏 UI 状态。
  - `renderAnimeGrid()`、`renderRanking()`、`renderSchedule()`、`renderSearch()`：数据驱动的渲染入口。
  - `setupEvents()`：统一交互事件入口；画布入口使用原生 `target="_blank"` 链接在新标签页打开，不做 popup 窗口拦截。
  - `init()`：页面初始化顺序的单一入口。
- `assets/styles.css`：所有主站视觉与响应式规则；新增主站组件优先沿用已有 CSS 变量和类命名。

#### 3.2 画布职责

- `canvas/index.html`：加载桥接脚本、品牌/API 补丁、画布 bundle、React 根节点和启动遮罩；遮罩只在 React 根节点产生内容后消失，12 秒未加载时显示诊断提示。
- `canvas/web-bridge.js`：浏览器兼容层，负责网络、文件、目录、API 配置 JSON 读写、窗口、诊断和 OSS 请求；不得把桌面 Node/Electron 能力伪装成成功。
- `canvas/branding-patch.js`：通过 `MutationObserver` 替换设置侧栏的作者信息文本（`大桶子ai` → `阿亮啊`、`wmxwz1` → `liangliang_0314`、`hub.datong-ai.cn` → `https://github.com/xinxin620`），并把收款码切换到带日期的唯一文件名并追加版本参数，以避免旧 URL 缓存；补丁必须独立于原始 bundle，更新二维码或升级画布后同步提升脚本/图片版本并重新核对选择器。
- `canvas/api-profiles-patch.js`：隐藏原始云雾 vendor 卡片，在原位置插入多配置管理区；支持内置云雾与任意多个第三方 API，每项包含名称、申请地址、API Key、Base URL，每张卡保留「申请」并在右侧提供「启用/已启用」。状态使用 `localStorage["manshiguang:canvas-api-profiles"]`，`activeId` 保证同一时间只有一个启用；切换时同步到画布原有 `canvas-api-settings`、`state.vendorConfigs.yunwu` 和云雾输入框。第三方 Profile 还保存 `modelCatalog`、`selectedModels`、`modelsFetchedAt`、`modelsError`、`modelsBaseUrl`：填写或变更 Base URL / API Key 后自动尝试 `${base}/v1/models` 和 `${base}/models`，也提供「拉取全部模型」「全选图片」「清空」。首次或接口地址变化时默认勾选全部图片模型；同源刷新保留仍存在的既有勾选，不无故覆盖用户选择。Base URL 会归一化掉 `/v1/api/*`、`/v1/draw/*`、`/v1/images/*`、`/v1/models`、`/v1` 等路径。补丁只挂在页面 DOM 上，不修改压缩 bundle。「常规设置 → API 配置存储」卡片紧跟「资产存储目录」：默认使用浏览器存储；切换本地目录后，可通过真实目录选择器保存 `manshiguang-api-config.json`，并在 API Key、Base URL 或模型勾选变化后自动续写。本地文件是明文 JSON，包含 API 密钥；「从本地恢复」读取该文件后只更新浏览器状态，不立即回写源文件。
- `canvas/model-patch.js`：当启用的 API 不是内置云雾时，只读取当前 Profile 的 `selectedModels` 注入图片节点模型下拉；没有勾选时显示明确空状态，不回退到内置清单。用户选择写入 `localStorage["manshiguang:canvas-model-choice"]`（按 `banana` / `gpt` 两个族保存），选中后通过点击原生下拉项让 React 更新节点状态；取消勾选或切回云雾时清理失效选择并恢复原生按钮文案。请求侧劫持 `window.fetch`：命中 `/v1/images/generations`（文生图）或 `/v1/images/edits`（带参考图）且当前平台为 Grsai 时，强制从当前 Profile 的 `selectedModels` 选择模型，未勾选则返回明确中文错误；随后改写为 `${base}/v1/draw/nano-banana`（nano-banana 族）或 `${base}/v1/draw/completions`（gpt-image 族），并在需要时轮询 `${base}/v1/draw/result`，最后回填成 OpenAI 风格的 `{ data: [{ url }] }`。
- `canvas/assets/index-*.js` 与 `index-*.css`：外部已打包产物，默认视为只读。若需升级画布，整体替换 bundle 并重新核对桥接 API，不要局部修改压缩代码。

### 4. 核心模块、实体与接口

#### 4.1 主站核心实体

- **番剧对象**：`id`、`title`、`en`、`kanji`、`theme`、`genres`、`year`、`score`、`episodes`、`status`、`badge`、`studio`、`synopsis`、`day`、`time`、`trend`、`rank`。
- **收藏集合**：追番 ID 的 `Set`，持久化到 `localStorage["manshiguang:favorites"]`。
- **搜索/筛选状态**：当前关键词、分类、移动菜单、详情和目标番剧均由后端无依赖的本地状态驱动。
- **画布入口**：`canvas/index.html`；主站链接使用 `target="_blank"` 与 `rel="noopener"` 在浏览器新标签页打开，不替换主站页面。

#### 4.2 画布核心实体与接口

- **Workflow**：节点、边、分组、工作流名称和参数；可导入/导出 `.json` / `.dtworkflow`。
- **Node**：图片、视频、音频、文本、AI 生成节点等；节点结果保留文件名、媒体 URL、本地路径和生成参数。
- **Provider / API 配置**：云端文本/图片服务商、API Key、Base URL、模型映射；默认保存在当前浏览器，也可额外写入用户选择的本地明文 JSON，不存在服务端同步或共享。画布设置页可维护任意多个 API Profile，但 `activeId` 只能指向一个配置。
- **API Profile**：`id`、`name`、`apiKey`、`baseUrl`、`applyUrl`、`builtin`，以及第三方专用的 `modelCatalog`、`selectedModels`、`modelsFetchedAt`、`modelsError`、`modelsBaseUrl`；内置云雾 ID 固定为 `yunwu`，第三方 ID 在新增时生成。默认云雾仍使用画布原生模型和展示，不参与第三方模型勾选。
- **API 配置存储设置**：`version`、`mode`（`browser` / `directory`）、`directoryToken`、`directoryName`，保存在 `localStorage["manshiguang:canvas-api-storage"]`。未设置时按 `browser` 处理。
- **本地 API 配置文件**：固定名 `manshiguang-api-config.json`；外层为 `version`、`kind: "manshiguang-api-config"`、`savedAt`、`state`，`state` 即 `manshiguang:canvas-api-profiles` 的完整结构。文件明文包含 API Key。
- **目录授权记录**：IndexedDB 中的 File System Access directory handle；虚拟目录 token 形如 `webdir:<uuid>:<encoded-name>`。素材目录与 API 配置存储目录使用各自的 token，API 配置目录不会成为素材默认目录。
- **兼容 API**：`window.electronAPI` 共 29 项：26 项与原 Electron preload 对齐，另有 3 项本项目 API 配置存储扩展：
  - 窗口：`windowControl`、`getWindowState`、`onWindowStateChanged`、`openExternalUrl`
  - 诊断/路径：`getUserDataPath`、`appendDiagnosticLog`、`getDiagnosticLogPath`、`getDefaultAssetsPath`
  - 文件/目录：`pickDirectory`、`pickApiConfigDirectory`、`openFolder`、`saveTextFile`、`saveApiConfigFile`、`readApiConfigFile`、`openTextFile`、`saveGeneratedTextAsset`、`saveMediaAsset`、`exportMediaFile`、`readLocalMediaDataUrl`、`getLocalMediaFileUrl`
  - 网络/上传：`httpRequest`、`fetchRemoteImageDataUrl`、`yunwuImageEditRequest`、`uploadImageRequest`、`multipartRequest`、`writeTempUploadFile`、`uploadSignedUrl`、`uploadOssObject`
  - 原桌面媒体能力：`clipVideo`
- **存储与接口边界**：没有应用级数据库表；浏览器存储不是服务端数据源。对外能力由页面 DOM 交互和 `window.electronAPI` 兼容层组成。

### 5. 构建、启动与测试

#### 5.1 构建

本项目无需安装和构建：

```powershell
# 主站与画布均没有 build 命令
```

推荐本地静态服务器：

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

然后访问：

- `http://127.0.0.1:4173/`：漫时光主站
- `http://127.0.0.1:4173/canvas/index.html`：简单画布

直接双击 `index.html` 可预览主站基础界面；但 File System Access、Web Crypto、IndexedDB 持久化和跨标签页行为在 `file://` 下可能受限，涉及画布保存/网络功能时应使用本地 HTTP 地址。

#### 5.2 静态检查

```powershell
node --check assets/app.js
node --check canvas/web-bridge.js
node --check canvas/branding-patch.js
node --check canvas/api-profiles-patch.js
node --check canvas/model-patch.js
```

还可检查页面资源是否可访问：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/canvas/index.html
```

#### 5.3 浏览器验收

至少检查：

1. 主站导航「社区」右侧出现「画布」。
2. 点击「画布」在浏览器新标签页打开画布，而不是替换主站页面。
3. 画布 React 根节点完成渲染，`#canvasBoot` 消失。
4. 浏览器控制台没有未处理异常。
5. `window.electronAPI` 的对象存在且方法数量与桥接层一致。
6. 移动菜单也能打开画布。
7. 进入任一工作流并打开「模型与接口设置」，确认作者信息为「抖音/B站/小红书：阿亮啊」「微信：liangliang_0314」「资料主站：https://github.com/xinxin620」，且收款码实际加载 `canvas/donation-qr-liangliang-20261103.png`，中心为真人头像、底部为「恋心心 (*亮)」。
8. 在「API 来源设置」添加 3 个第三方配置后，4 张卡片全部显示；每张保留「申请」并有「启用/已启用」，任意时刻仅一个启用；切换后刷新页面仍保持，且原云雾输入框与 `canvas-api-settings` 同步为当前配置。
9. 启用 Grsai（Base URL 可填 `https://grsai.dakka.com.cn`、带 `/v1/draw/completions` 或 `/v1/api/generate` 的完整地址）后，确认自动拉取 30 个模型并默认勾选 16 个图片模型；打开图片节点模型下拉，只应显示当前 `selectedModels`。取消若干勾选并刷新后选择仍保留；再次点击「拉取全部模型」不得无故覆盖既有勾选；「清空」后下拉应显示空提示而不是回退原生模型。
10. 进入「常规设置」，确认「API 配置存储」紧跟「资产存储目录」且默认选中「浏览器存储」；切换「本地目录」后选择目录，应生成 `manshiguang-api-config.json`。修改 API Key 或模型勾选应自动续写；「从本地恢复」应更新配置且不立刻覆盖源文件；切回浏览器存储后不应继续写本地文件；刷新后模式和目录名称应保持。

只报告实际完成的检查。AI 服务商、OSS、CORS、上传和 FFmpeg 若没有真实环境和凭证，不得标记为已验证。

### 6. 编码规范、命名与异常处理

- **语言**：面向用户的文案、提示、文档默认使用简体中文；代码标识符使用英文。
- **零依赖原则**：主站保持纯静态 HTML/CSS/JS。除非明确需要复杂构建，否则不要为主站引入 React、Vite、Node 后端或包管理器。
- **脚本风格**：主站和桥接层都是传统浏览器脚本；新增代码沿用 IIFE、`const`/`let`、显式命名函数和 `data-*` 事件钩子。不要无故把主站改为 ESM。
- **DOM 约定**：查询集中在 `$` / `$$` 辅助函数；事件绑定集中在 `setupEvents()`；动态列表通过渲染函数生成，不在多处复制数据。
- **命名**：主站 CSS 倾向 kebab-case/组件语义类；JS 使用 camelCase；持久化键名沿用现有 `manshiguang:*` 前缀；画布 bundle 内的类名不可改。
- **无障碍**：保留 `aria-*`、键盘焦点、`Escape` 关闭、`skip-link` 和可见焦点；新增按钮必须使用正确元素或明确 `type`。
- **异常处理**：兼容桥接的普通拒绝使用 `throw new Error(中文说明)`，不得静默成功；网络错误要保留 URL、方法、状态和 CORS 提示。画布宿主页在根节点未渲染时显示可诊断的启动失败信息。
- **文件/资源所有权**：浏览器无法访问的绝对路径、系统文件管理器、FFmpeg 和原生窗口能力必须明确报错或降级说明，不能用假数据掩盖。
- **安全**：API Key 默认保存在浏览器本地；用户显式选择本地目录时会写入明文 JSON 副本，只能放在本人可控的私有目录。不要把密钥、上传凭证、用户选择的绝对路径或生成的配置文件写入仓库、日志或提交。`openExternalUrl` 只允许 `http/https`。
- **生成文件**：`canvas/assets/index-*.js`、`index-*.css` 是外部构建产物，不手改；需要升级时整体替换并复测桥接契约。

### 7. 已知约束、历史备注与注意事项

#### 7.1 浏览器能力边界

- **CORS**：AI 服务商、上传服务和部分 OSS 端点可能拒绝浏览器跨域请求。`httpRequest` 会保留目标 URL、方法、状态和 CORS 提示，但不能绕过服务端 CORS。
- **自定义代理**：原 Electron 桌面版可通过 Node/undici 使用网络代理；普通浏览器桥接层不能接管系统代理。设置页的代理配置不会改变浏览器网络栈。
- **本地绝对路径**：浏览器不能读取任意 Windows 路径。必须通过画布文件上传，或在 Chromium 中选择素材目录后使用 `webdir:` 虚拟路径。
- **系统文件管理器**：`openFolder()` 在网页版明确失败，不能打开资源管理器。
- **FFmpeg 视频剪辑**：`clipVideo()` 在网页版明确失败；没有原桌面版的 FFmpeg 二进制执行能力。
- **窗口最大化**：浏览器兼容实现使用 Fullscreen API，不等价于 Electron 原生无边框窗口；`window.close()` 也可能受浏览器窗口策略限制。
- **文件保存**：优先使用 File System Access API；不支持时回退浏览器下载。未授权素材目录时，生成媒体不会落到原桌面默认目录。
- **新标签页**：画布使用原生 `target="_blank"` 链接在浏览器新标签页打开；浏览器或扩展可能拦截，主站不强制窗口尺寸，也不复用命名窗口。

#### 7.2 项目历史与维护

- 画布资源从「简单画布 Setup 0.0.1.exe」解包，原应用包名为 `canvas-app`，原包版本为 `0.0.5`。
- 当前 `canvas/assets`、品牌图和图标与解包后的 `dist` 文件逐文件 SHA-256 一致；`canvas/donation-qr.png` 与 `canvas/donation-qr-liangliang-20261103.png` 内容相同，均为用户提供的收款码卡片，不再与原始 `dist` 一致。带日期文件名是运行时首选路径，稳定文件名保留为原始 bundle 的兼容回退。
- `canvas/branding-patch.js` 在浏览器运行时替换设置侧栏作者信息，原始压缩 bundle 内仍保留旧文本；这是有意的只读边界，不要为了替换品牌而修改 bundle。
- `canvas/api-profiles-patch.js` 在浏览器运行时管理多套 API 配置，压缩 bundle 内仍只有原始云雾 vendor 卡片。已验证：添加第三方配置并填写 Base URL 后自动拉取、30 个模型与 16 个图片模型默认勾选、手动勾选/取消、刷新保持、重新拉取保留选择、清空、唯一启用和云雾回退。API 配置存储的另一条独立验收链已通过：默认浏览器模式、OPFS 模拟目录选择后真实桥接写入/读取 JSON、Key 变更自动续写、从本地恢复不覆盖源文件、刷新保持目录模式、切回浏览器后停止本地写入。未实际操作 Windows 系统目录选择授权窗口。真实第三方出图仍未验证，因为当前没有有效 Key。
- `canvas/model-patch.js` 依赖 bundle 内部只有 `yunwu` 一个 vendor 的事实，因此无法直接把 `grsai` 变成 vendor；它改为「Base URL 指向第三方 + 拦截请求改协议」的运行时方案。模型目录与勾选归 API Profile 管理，`model-patch.js` 只展示 `selectedModels`，不再单独拉取、缓存 10 分钟或失败回退内置清单。已验证模型下拉只显示勾选模型、空勾选提示、选择持久化与未勾选时的明确请求错误；真实出图尚未验证。文本节点仍沿用原云雾模型名，未做 Grsai 文本模型适配。
- 原 Electron preload 暴露 26 个 IPC 方法；当前 `canvas/web-bridge.js` 在保留这 26 个兼容方法之外，新增 `pickApiConfigDirectory`、`saveApiConfigFile`、`readApiConfigFile` 三项 API 配置存储扩展，共 29 项。扩展不代表所有网络和原生能力已可用。
- 本次集成未运行原始安装器或 `SimpleCanvas.exe`，只使用静态解包资源。
- 主站仍是演示原型：番剧、用户、社区内容均为原创虚构数据；没有视频播放器、登录、服务端收藏或真实社区接口。
- 若后续恢复/升级画布 bundle，必须重新核对：资源路径、React 根节点、`window.electronAPI` 方法、IndexedDB 记录格式、保存/下载路径和启动遮罩行为。
- 若引入后端或真实第三方接口，必须在本文件第 2、4、5、7 节同步更新技术栈、接口、数据表和验证方式。
