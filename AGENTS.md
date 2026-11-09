# Repository Guidelines

## 项目基准 / Project Baseline

> 本文件是 `msg` 仓库的项目级基准上下文，首次按当前工作副本核对于 2026-11-04，2026-11-05 增补资产参考库。后续任务应优先阅读本文件，再检查实际代码；若本文件与源码、页面行为或外部工具事实冲突，以当前代码和实际验证为准，并在同一变更中同步修复本文件。
>
> 每次变更架构、依赖、入口、存储格式、画布桥接能力、外部服务边界或关键约束时，都必须同步更新本文件。

### 1. 项目名称、业务定位与用途

- **项目名称**：漫时光 / MANSHIGUANG。
- **业务定位**：面向中文二次元用户的沉浸式动漫网站原型，视觉主题为「夜航星海」。
- **主要用途**：
  - 展示原创虚构番剧、排行榜、新番表、社区内容和追番状态。
  - 提供搜索、分类筛选、详情弹层、选集和本地收藏等纯前端交互。
  - 在主导航「社区」右侧提供「AI 创作工作台」入口，在浏览器新标签页打开 `studio/index.html`。工作台自带左侧工作区栏，把画布、图片工坊（资产库）等能力集成在同一页面内切换，无需跳来跳去；剧情导演台、设定与出图、数字人视频、任务与成片为已规划的占位工作区。
  - 主导航仍保留独立「资产」入口，直接打开完整版 `gallery/index.html`；画布内部也保留同页资产抽屉。
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

`canvas/` 是画布前端，来自用户提供的原「简单画布」Electron 安装包中提取的已打包资源，不是本仓库重新构建的源码。

| 类别 | 当前实现 |
| --- | --- |
| 前端 | 预构建 React 19.2.4 单页应用，嵌入在 `canvas/assets/index-*.js` |
| 工作流画布 | `@xyflow/react`（原包声明 `^12.10.2`） |
| 状态 | Zustand（原包声明 `^5.0.12`） |
| 本地数据 | Dexie / idb-keyval；浏览器桥接另用 IndexedDB |
| 图形与编辑 | PixiJS、react-image-crop、lucide-react |
| 桌面原实现 | Electron preload + IPC + Node.js 文件系统、FFmpeg、undici |
| 当前宿主 | `canvas/index.html` + `canvas/web-bridge.js` + `canvas/branding-patch.js` + `canvas/api-profiles-patch.js` + `canvas/comfy-patch.js` + `canvas/model-patch.js`，在普通浏览器中提供兼容层、品牌替换、API 来源多配置管理、ComfyUI 连接设置和第三方模型列表/协议适配 |
| 构建 | 本仓库不构建画布 bundle；不要手改压缩后的 `index-*.js` / `index-*.css` |

#### 2.3 资产参考库

`gallery/` 是新增的零依赖静态参考库页面，视觉延续主站「夜航星海」。它不打包、不引入框架，也不复制外部图片或索引到本仓库。

| 类别 | 当前实现 |
| --- | --- |
| 页面 | `gallery/index.html`，原生 HTML5 与语义化结构 |
| 样式 | `gallery/assets/gallery.css`，CSS 变量、Grid/Flex、响应式与星场动效 |
| 脚本 | `gallery/assets/gallery.js`，传统 IIFE，无 ESM、无框架、无构建 |
| 数据 | 外部只读目录 `D:\data\workData\codex\Projects\ai-pose-gallery-zh-main`，可用 `MSG_GALLERY_DIR` 覆盖 |
| 数据入口 | 资产图与索引已复制到 `gallery/local-assets/`（约 1.1GB，由 `.gitignore` 排除，不进版本库），由静态服务器直接提供；`server.py` 的 `/__gallery_asset/` 外部只读代理仍保留可用 |
| 嵌入模式 | `gallery/index.html?embed=1&host=<studio\|canvas>&tab=poses\|costumes\|portraits`，供工作台图片工坊与画布右侧抽屉以 iframe 使用：隐藏站点装饰、按需只加载当前库 |
| 数据规模 | 安全模式 `4,769` 条；关闭安全模式 `6,162` 条。姿势 `1,439`、服装 `3,224`、人像 `1,499` |
| 图片来源 | 部分本地 WebP、部分外部站点 URL；远程站点可用性与跨域未做长期承诺 |
| 存储 | 只有「紧凑 / 标准 / 放大」尺寸档位持久化，且按宿主场景分键：`manshiguang:gallery:size`（独立资产页）、`manshiguang:gallery:size:studio`（工作台图片工坊）、`manshiguang:gallery:size:canvas`（画布抽屉），三处互不影响；其余筛选、搜索与安全模式只在当前页面会话中保存 |

#### 2.4 AI 创作工作台

`studio/` 是画布与资产库的统一外壳，零依赖静态页面，不引入框架、不打包。

| 类别 | 当前实现 |
| --- | --- |
| 页面 | `studio/index.html`，原生 HTML5 + 左侧工作区栏 + 顶部工具条 |
| 样式 | `studio/assets/studio.css`，沿用主站「夜航星海」色板变量 |
| 脚本 | `studio/assets/studio.js`，传统 IIFE，无 ESM、无框架、无构建 |
| 工作区 | `画布`、`图片工坊` 为 iframe 实时页面；`剧情导演台`、`设定与出图`、`数字人视频`、`任务与成片` 为规划中的占位说明页 |
| 集成方式 | iframe + 同源 `postMessage` / `BroadcastChannel`；不改动画布压缩 bundle |
| 目录授权 | 授权在工作台顶层窗口完成，结果写进与画布桥接层同库同键的 IndexedDB，iframe 内的画布直接复用 |
| 入口 | 主站导航「AI 创作工作台」；`canvas/index.html` 与 `gallery/index.html` 仍可独立打开 |

#### 2.5 Java、Spring 与中间件结论

- **Java 版本：不适用。** 本项目没有 Java 源码、JVM 构建或 Java 运行时要求。
- **Spring Boot / Spring Cloud / Spring MVC：不适用。**
- **Redis、RabbitMQ、MySQL：不适用。** 没有消息队列、缓存服务或关系数据库。
- **数据库表：无。** 主站收藏使用 `localStorage`；画布偏好/workflow 由打包应用保存在浏览器存储；API 多配置使用 `localStorage["manshiguang:canvas-api-profiles"]`，当前启用项再同步到原有 `canvas-api-settings`；ComfyUI 本地/云端连接配置使用 `localStorage["manshiguang:canvas-comfyui"]`；目录授权使用 IndexedDB 数据库 `manshiguang-canvas-bridge` 的 `directoryHandles` object store；资产落盘后的「显示用绝对路径 → 目录 token + 相对片段」映射记录在同库 `bridge:mediaPaths`。API 配置以浏览器 `localStorage` 维护运行状态，并默认写入应用数据目录 `C:\Users\liliang\msg\manshiguang-api-config.json`；位置元数据使用 `localStorage["manshiguang:canvas-api-storage"]`。目录 handle 使用独立 token 保存，不复用或覆盖素材目录；首次使用需要由用户在浏览器目录选择器中授权一次。
- 后续若引入后端，应先明确 API、鉴权、数据模型和部署边界，再修改本文件；不要把模板中的 Java/Spring/MySQL 假设套到当前项目上。

### 3. 目录结构与职责

```text
msg/
├─ index.html                 主站页面结构、图标、导航、弹层与页脚
├─ start.bat                  Windows 快速启动：本地服务器并打开主站
├─ stop.bat                   Windows 快速停止：结束 4173 端口进程
├─ server.py                  本地静态服务器、固定目录打开接口与资产只读代理
├─ assets/
│  ├─ styles.css              夜航星海视觉系统、布局、动效与响应式
│  ├─ app.js                  番剧数据、渲染、收藏、搜索、弹层和画布新标签页入口
│  ├─ hero-art.svg            首页原创主视觉
│  ├─ favicon.ico             主站多尺寸图标
│  ├─ favicon-16x16.png       浏览器 16px 图标
│  ├─ favicon-32x32.png       浏览器 32px 图标
│  ├─ apple-touch-icon.png    Apple 主屏幕图标
│  ├─ android-chrome-*.png    Android / PWA 图标
│  └─ site.webmanifest        Web App 图标清单
├─ canvas/
│  ├─ index.html              画布宿主页、启动遮罩和错误提示
│  ├─ web-bridge.js           浏览器兼容桥接层，向画布暴露 window.electronAPI
│  ├─ branding-patch.js       标题栏产品名/Logo、设置页作者信息与收款码补丁，不修改压缩 bundle
│  ├─ api-profiles-patch.js   云雾/第三方 API 多配置管理与唯一启用补丁
│  ├─ comfy-patch.js          「ComfyUI设置」侧栏 tab、本地/云端连接配置、测试与工作流选择补丁
│  ├─ model-patch.js          已选模型下拉注入与第三方请求协议适配
│  ├─ gallery-patch.js        画布内资产抽屉、合成台面板与资产插入节点补丁
│  ├─ assets/
│  │  ├─ index-BN-uSJKj.js    已打包 React 画布应用
│  │  └─ index-BfAuAU0s.css   已打包画布样式
│  ├─ dt-canvas-logo.png      画布品牌资源
│  ├─ donation-qr.png         阿亮啊支付宝收款码兼容副本
│  ├─ donation-qr-liangliang-20261103.png
│  │                          运行时加载的阿亮啊支付宝收款码卡片
│  └─ icon.ico                画布图标
├─ gallery/
│  ├─ index.html              资产参考库宿主页，支持 ?embed=1&host=&tab= 嵌入模式
│  ├─ assets/
│  │  ├─ gallery.css          资产页视觉、断点与嵌入模式紧凑样式
│  │  └─ gallery.js           三库索引读取、筛选、详情与安全模式逻辑
│  └─ local-assets/           本地化的索引与图片（约 1.1GB，由 .gitignore 排除，不提交）
├─ studio/
│  ├─ index.html              AI 创作工作台外壳、工作区栏与版本守卫
│  └─ assets/
│     ├─ studio.css           工作台布局与夜航星海配色
│     └─ studio.js            工作区注册、iframe 复用、目录授权与共享桥接
├─ .preview/                  桌面、移动端、搜索、详情、资产库与工作台验收截图
├─ .gitignore                 排除 local-assets、临时脚本与本地日志
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
  - `setupEvents()`：统一交互事件入口；画布与资产入口都使用原生 `target="_blank"` 链接在新标签页打开，不做 popup 窗口拦截。
  - `init()`：页面初始化顺序的单一入口。
- `assets/styles.css`：所有主站视觉与响应式规则；新增主站组件优先沿用已有 CSS 变量和类命名。

#### 3.2 画布职责

- `canvas/index.html`：加载桥接脚本、品牌/API 补丁、画布 bundle、React 根节点和启动遮罩；遮罩只在 React 根节点产生内容后消失，12 秒未加载时显示诊断提示。页面在启动脚本前校验地址中的 `v` 参数，缺少或过期时自动重定向到当前版本，避免已打开的旧标签页继续运行缓存中的旧补丁。
- `canvas/web-bridge.js`：浏览器兼容层，负责网络、文件、目录、API 配置 JSON 读写、窗口、诊断和 OSS 请求；不得把桌面 Node/Electron 能力伪装成成功。素材落盘后返回的是「显示用绝对路径」（如 `D:\data\workData\漫时光\画布\images\SPR-0010.webp`），而不是 `webdir:` 虚拟标识：压缩 bundle 只识别 `file://` 与「盘符:\\」两种本地路径，其余字符串会被原样写进 `<img src>`，导致上传后只剩文件名。桥接层用 `bridge:mediaPaths` 记录把该路径映射回目录 handle，并在 `getLocalMediaFileUrl`、`readLocalMediaDataUrl`、`sourceToBlob`、multipart 与 `window.fetch` 上按映射解析；同时对历史遗留的 `webdir:` 路径包装 `HTMLImageElement`/`HTMLMediaElement` 的 `src` setter 做兜底转换（带 blob 缓存）。真实读写仍以 File System Access handle 为准，路径文本只是键。落盘统一走 `writeOrReuseFile`：同名且字节一致时复用原文件，避免从资产目录自身重复上传时不断产生 `-2` / `-3` 副本。
- `canvas/branding-patch.js`：通过 `MutationObserver` 将标题栏产品名和 Logo 替代文本统一为「画布」，把标题栏 Logo 图片切换为 `../assets/favicon-32x32.png?v=20261104-2`，并替换设置侧栏的作者信息文本（`大桶子ai` → `阿亮啊`、`wmxwz1` → `liangliang_0314`、`hub.datong-ai.cn` → `https://github.com/xinxin620`），并把收款码切换到带日期的唯一文件名并追加版本参数，以避免旧 URL 缓存；补丁必须独立于原始 bundle，更新二维码或升级画布后同步提升脚本/图片版本并重新核对选择器。
- `canvas/api-profiles-patch.js`：隐藏原始云雾 vendor 卡片，在原位置插入多配置管理区；同时把设置弹窗侧栏项与分区标题的原文本「API 来源设置」在显示层统一改为「图片API来源设置」：原文本保留为常量 `NATIVE_API_SECTION_TITLE`，由 `queueRender` 中的 `renameApiSectionTitle()` 遍历 `.settings-sidebar__item span` 与 `.settings-section__header h3` 完成，不手改压缩 bundle；支持内置云雾与任意多个第三方 API，每项包含名称、申请地址、API Key、Base URL，每张卡保留「申请」并在右侧提供「启用/已启用」。状态使用 `localStorage["manshiguang:canvas-api-profiles"]`，`activeId` 保证同一时间只有一个启用；切换时同步到画布原有 `canvas-api-settings`、`state.vendorConfigs.yunwu` 和云雾输入框。第三方 Profile 还保存 `modelCatalog`、`selectedModels`、`modelsFetchedAt`、`modelsError`、`modelsBaseUrl`：填写或变更 Base URL / API Key 后自动尝试 `${base}/v1/models` 和 `${base}/models`，也提供「拉取全部模型」「全选图片」「清空」。首次或接口地址变化时默认勾选全部图片模型；同源刷新保留仍存在的既有勾选，不无故覆盖用户选择。Base URL 会归一化掉 `/v1/api/*`、`/v1/draw/*`、`/v1/images/*`、`/v1/models`、`/v1` 等路径。补丁只挂在页面 DOM 上，不修改压缩 bundle。「常规设置 → API 配置存储」卡片紧跟「资产存储目录」：不再提供浏览器存储切换，固定显示应用数据目录 `C:\Users\liliang\msg`。旧存储状态会自动迁移为目录模式；目录需预先存在，首次点击「立即保存」或「从本地恢复」会打开一次浏览器目录选择器并授权该目录。首次保存时若还没有 API Profile，会从画布原生输入框补建默认云雾配置，避免出现“点了没反应”。授权后写入或读取明文 JSON `manshiguang-api-config.json`，API Key、Base URL 或模型勾选变化时自动续写；读取只更新浏览器状态，不立即回写源文件。保存/恢复必须显示操作中、持久成功或失败状态和最近时间，完成或失败后按钮必须恢复可用；错误提示要自动滚动到可见位置。浏览器只会返回文件夹名，不能伪造 Windows 绝对路径；显示层在授权目录名为 `images` 时按用户确认固定标注 `D:\data\workData\漫时光\画布\images`，该文本不参与读写，真实读写仍使用 File System Access handle。资产目录与 API 配置目录使用各自独立的 token；补丁会在选择器返回后主动刷新资产目录的友好回显，避免点「立即保存」时看起来像资产目录被改写。资产卡的原生「打开目录」在显示层改为「查看目录」，由桥接层读取并展示目录内容，不伪装为已打开 Windows 资源管理器。
- `canvas/comfy-patch.js`：在设置弹窗侧栏「图片API来源设置」之后追加独立「ComfyUI设置」tab。React 每次切换 tab 都会重建 `.settings-modal__body`，因此补丁用 `MutationObserver` 等待设置弹窗出现并持续校正挂载，不假设弹窗在页面加载时已存在。点击该 tab 后先给 body 加 `ms-comfy-view`，用 CSS 隐藏原生分区并注入 `#ms-comfy-section`；切回任一原生 tab 时移除分区、恢复原生 footer 文案。分区内含「本地 ComfyUI」与「云端 ComfyUI」两张卡，同一时间只启用一个，配置写入 `localStorage["manshiguang:canvas-comfyui"]`，并把当前启用项发布到 `window.__MS_COMFY__` 与 `manshiguang:comfy-changed` 事件。测试连接请求统一走 `${PROXY_PREFIX}system_stats?base=<地址>`，由 `server.py` 的 `/__comfy/` 转发；云端卡填写的访问密钥通过 `X-MS-Comfy-Key` 请求头传给本地服务，再由服务转成 `Authorization: Bearer`，密钥不写进 URL。启用卡还会自动读取 `${PROXY_PREFIX}userdata?dir=workflows&recurse=true&split=false&full_info=true` 列出 ComfyUI 已保存的工作流，支持本地搜索、手动刷新和点击选择；单项读取使用 `${PROXY_PREFIX}api/userdata/<encodeURIComponent("workflows/"+path)>`，必须校验 JSON 含 `nodes` 数组后才写入 `selectedWorkflow`。当前只完成工作流选择与持久化，不提交生成任务、不轮询进度、不回填结果。补丁不修改压缩 bundle。
- `canvas/model-patch.js`：当启用的 API 不是内置云雾时，只读取当前 Profile 的 `selectedModels` 注入图片节点模型下拉；没有勾选时显示明确空状态，不回退到内置清单。用户选择写入 `localStorage["manshiguang:canvas-model-choice"]`（按 `banana` / `gpt` 两个族保存），选中后通过点击原生下拉项让 React 更新节点状态；取消勾选或切回云雾时清理失效选择并恢复原生按钮文案。请求侧劫持 `window.fetch`：命中 `/v1/images/generations`、`/v1/images/edits` 或 `/v1beta/models/<model>:generateContent` 且当前平台为 Grsai 时，强制从当前 Profile 的 `selectedModels` 选择模型，未勾选或缺少 API Key 则返回明确中文错误；解析 OpenAI JSON/FormData 与 Gemini parts，把提示词、参考图、比例和清晰度统一改写为 `${base}/v1/api/generate`。nano-banana 系列发送 `aspectRatio + imageSize`，gpt-image 系列发送像素尺寸与 `quality`，参考图统一放进 `images`；异步任务随后用 `GET ${base}/v1/api/result?id=<taskId>` 轮询，最后回填成 OpenAI 风格的 `{ data: [{ url }] }`。
- `canvas/gallery-patch.js`：画布内的资产库集成层。负责三件事：一是把侧边栏「姿势库/服装库/人像库」三个按钮改为在画布右侧滑出 iframe 抽屉（`embed=1&host=canvas&tab=`），而不是跳新标签页，Ctrl/中键点击仍开新标签；二是接收抽屉或独立标签页发来的选中资产（`window.message` 校验同源 + `BroadcastChannel` 两路），写入合成台列表；三是维护合成台面板与角标。只有抽屉（嵌入）路径会自动新建 Image Asset 节点——它复用画布侧边栏隐藏的 `input[type="file"]` 并派发 `change` 事件，走与手动「+ → 上传」完全相同的建节点与落盘流程；独立标签页的 `BroadcastChannel` 路径仍只加入合成台列表，不自动建节点。抽屉与合成台面板同在右侧，打开一个会收起另一个，`Esc` 关闭抽屉。去重只作用于合成台列表，重复点同一资产仍会插入新节点。
- `canvas/assets/index-*.js` 与 `index-*.css`：外部已打包产物，默认视为只读。若需升级画布，整体替换 bundle 并重新核对桥接 API，不要局部修改压缩代码。

#### 3.3 资产参考库职责

- `gallery/index.html`：资产页语义结构、三库 tab、筛选区、结果网格、详情弹层、来源说明和安全模式确认入口；页面不依赖构建产物。
- `gallery/assets/gallery.js`：
  - `DATA_FILES`：列出声势、服装与人像索引文件；服装合并 `costume-zh`、`costume-shisei-zh`、`costume-gia-anime-zh`、`costume-anime-zh`。
  - `state`：当前库、搜索词、筛选、安全模式、首屏分页、姿势显示模式和详情状态。
  - `loadLibrary()` / `loadLibraryFiles()`：读取 `local-assets/data/*.json`，单文件失败时保留其余可用库并显示错误提示；嵌入模式只加载当前 tab 对应的索引，切库时按需补加载，用 `loadingLibraries` 计数防止并发重复请求。
  - `HOST` / `SIZE_STORAGE_KEY`：按 URL `host` 参数（`studio` / `canvas`）或独立资产页选出各自的尺寸档位存储键，三处互不影响；首次分键时一次性继承旧的全局档位并落盘到本宿主键。嵌入模式下 `boot()` 还会把 `is-embed-host-<HOST>` 追加到 `body`，供宿主差异化样式使用（目前用于在工作台隐藏卡片发送按钮，见 4.3）。`EMBED` / `notifyParent()`：嵌入模式下 `sendToCanvas()` 走 `postMessage`（`source: "manshiguang-asset-embed"`）通知宿主画布，不再依赖 `BroadcastChannel`；未加载的库在 tab 上显示「…」而不是 0。
  - `renderFilters()`、`renderGrid()`、`updateDialog()`：筛选、卡片和详情渲染入口。
  - `setupEvents()`：搜索、重置、加载更多、安全模式、详情导航、键盘快捷键和图片失败态。
  - `assetPath()` / `poseDepthPath()`：将相对资源映射到只读代理；本地绝对路径不应写进页面代码。
- `gallery/assets/gallery.css`：资产页全部视觉与断点规则；新增样式沿用现有 CSS 变量和 `asset-*` 命名，不复制主站整页样式。
- 外部数据目录：用户本地下载的 `ai-pose-gallery-zh-main` 仍是原始来源，默认只读，不得在 `msg` 内修改。为绕开跨域与大 JSON 读取限制，资产已复制到 `gallery/local-assets/` 供本地直读；该目录必须保持在 `.gitignore` 中，不得提交进版本库。

#### 3.4 AI 创作工作台职责

- `studio/index.html`：只有静态骨架（工作区栏 `#railList`、舞台 `#stageFrame`、顶部工具条、资产目录状态条 `#assetDirChip`、占位模板 `#soonTemplate`）与版本守卫脚本；地址缺少或过期 `v` 参数时自动重定向到当前版本，避免旧标签页继续运行缓存里的旧脚本。
- `studio/assets/studio.js`：
  - `WORKSPACES`：工作区唯一注册表。`type: "frame"` 的 `url` 指向真实页面（画布、嵌入模式资产库，可带 `tabs` 顶部分段控制器）；`type: "soon"` 只提供 `purpose`/`inputs`/`outputs`/`relation`，由 `#soonTemplate` 渲染成规划说明，不做假功能。新增工作区只改这张表。
  - `ensureFrame()` / `activate()`：每个 frame 工作区只创建一次 iframe，切走时隐藏而不销毁，切回时保留工作流状态与已加载索引；只有「重载」按钮强制重新载入。当前工作区写入 `localStorage["manshiguang:studio"]`，并用 hash（`#canvas`、`#assets`）支持深链。
  - `authorizeFromShell()`：目录授权必须在顶层窗口完成。顶层点击一定是真实用户手势，选择结果按桥接层既有格式写进同源 IndexedDB `manshiguang-canvas-bridge` 的 `directoryHandles`（同时写 `bridge:default` 与 `webdir:<uuid>:<name>` 两条记录），因此 iframe 里的画布不必自己弹选择器，绕开了 iframe 用户激活不稳定导致「点了没反应」的问题。
  - `notifyDirectoryChanged()`：重新授权后向所有已加载 iframe `postMessage`，并通过 `BroadcastChannel("manshiguang-canvas-bridge")` 通知以独立标签页打开的画布，让桥接层丢弃内存里的旧目录 handle 缓存。
  - `refreshDirChip()`：工作台只做「是否已授权 + 目录名」的只读回显，从不覆盖已有授权；用户在画布设置里改目录后，回到工作台重新聚焦即会刷新。
- **图片工坊 → 画布插入链路**：`gallery/assets/gallery.js` 在嵌入模式下一律先 `postMessage` 给宿主；宿主是工作台时，`studio.js` 把 `asset-select` 转交画布 iframe 的 `window.__MS_CANVAS_ASSET_HOST__.receiveAsset()`，最终仍走 `canvas/gallery-patch.js` 既有的隐藏 `input[type="file"]` + `change` 事件流程，与画布内资产抽屉、手动「+ → 上传」共用同一条建节点与落盘路径。
- 工作台不做的事：不代理画布的 API 配置存储、不复制资产索引、不重新实现节点工作流，它只是外壳与路由；所有实际能力仍来自 `canvas/`、`gallery/` 与 `server.py`。

### 4. 核心模块、实体与接口

#### 4.1 主站核心实体

- **番剧对象**：`id`、`title`、`en`、`kanji`、`theme`、`genres`、`year`、`score`、`episodes`、`status`、`badge`、`studio`、`synopsis`、`day`、`time`、`trend`、`rank`。
- **收藏集合**：追番 ID 的 `Set`，持久化到 `localStorage["manshiguang:favorites"]`。
- **搜索/筛选状态**：当前关键词、分类、移动菜单、详情和目标番剧均由后端无依赖的本地状态驱动。
- **AI 创作工作台入口**：`studio/index.html`；主站链接使用 `target="_blank"` 与 `rel="noopener"` 在浏览器新标签页打开，不替换主站页面。工作台左侧栏集成画布、图片工坊与四个规划中工作区。
- **资产入口**：`gallery/index.html`；位于「AI 创作工作台」之后，同样使用新标签页打开完整资产页。`canvas/index.html` 与不带 `embed` 参数的 `gallery/index.html` 仍是合法独立入口，只是不再出现在主站导航中；画布内三个资产库按钮默认走同页 iframe 抽屉，仅 Ctrl/中键点击才开新标签。

#### 4.2 画布核心实体与接口

- **Workflow**：节点、边、分组、工作流名称和参数；可导入/导出 `.json` / `.dtworkflow`。
- **Node**：图片、视频、音频、文本、AI 生成节点等；节点结果保留文件名、媒体 URL、本地路径和生成参数。
- **Provider / API 配置**：云端文本/图片服务商、API Key、Base URL、模型映射；浏览器 `localStorage` 维护运行状态，并同步写入应用数据目录中的明文 JSON，不存在服务端同步或共享。画布设置页可维护任意多个 API Profile，但 `activeId` 只能指向一个配置。
- **API Profile**：`id`、`name`、`apiKey`、`baseUrl`、`applyUrl`、`builtin`，以及第三方专用的 `modelCatalog`、`selectedModels`、`modelsFetchedAt`、`modelsError`、`modelsBaseUrl`；内置云雾 ID 固定为 `yunwu`，第三方 ID 在新增时生成。默认云雾仍使用画布原生模型和展示，不参与第三方模型勾选。
- **API 配置存储设置**：`version`、`mode`、`directoryToken`、`directoryName`、`lastSavedAt`、`lastRestoredAt`，保存在 `localStorage["manshiguang:canvas-api-storage"]`。当前网页版固定按 `directory` 处理，旧 `browser` 记录也会迁移为 `directory`；时间字段使用 ISO 8601，界面按本地时区展示。
- **ComfyUI 连接配置**：`version`、`activeId`、`profiles`；`profiles` 固定为 `local`（本地 ComfyUI）与 `cloud`（云端 ComfyUI）两项，每项含 `name`、`baseUrl`、`apiKey`，以及可选的 `selectedWorkflow`（`path`、`name`、`size`、`modified`、`nodeCount`、`fetchedAt`、`baseUrl`）。`activeId` 同时只能指向一个配置，保存于 `localStorage["manshiguang:canvas-comfyui"]`；启用项与其工作流选择发布到 `window.__MS_COMFY__`。地址变化时该配置的工作流选择立即失效。
- **ComfyUI 只读代理**：`GET /__comfy/<path>?base=<encoded-url>` 与 `POST /__comfy/<path>?base=<encoded-url>`，默认转发到 `base` 后拼接 `<path>`；只允许本机 http 或任意 https，拒绝远程 http 与越界路径，仅接受本机客户端；可选 `X-MS-Comfy-Key` 请求头会转换为上游 `Authorization: Bearer <key>`。转发时保留路径中的原始百分号编码，只对解码副本做越界、反斜杠、控制字符检查，确保 ComfyUI 的 `userdata/workflows%2F<file>` 单文件路由可用。
- **本地 API 配置文件**：固定名 `manshiguang-api-config.json`；外层为 `version`、`kind: "manshiguang-api-config"`、`savedAt`、`state`，`state` 即 `manshiguang:canvas-api-profiles` 的完整结构。文件明文包含 API Key。
- **目录授权记录**：IndexedDB 中的 File System Access directory handle；虚拟目录 token 形如 `webdir:<uuid>:<encoded-name>`。素材目录与 API 配置存储目录使用各自的 token，API 配置目录不会成为素材默认目录。
- **素材路径映射**：`bridge:mediaPaths`（IndexedDB）保存 `{ path, token, segments, savedAt }` 列表，`path` 为显示用 Windows 绝对路径，最多保留 1200 条。`saveMediaAsset`、`exportMediaFile`、`saveGeneratedTextAsset` 与媒体下载拦截统一返回该 `path`，原 `webdir:` 标识保留在附加字段 `virtualPath` 中。映射缺失时必须抛出中文错误并提示重新选择目录/重新上传，不得静默回退。
- **兼容 API**：`window.electronAPI` 共 29 项：26 项与原 Electron preload 对齐，另有 3 项本项目 API 配置存储扩展：
  - 窗口：`windowControl`、`getWindowState`、`onWindowStateChanged`、`openExternalUrl`
  - 诊断/路径：`getUserDataPath`、`appendDiagnosticLog`、`getDiagnosticLogPath`、`getDefaultAssetsPath`
  - 文件/目录：`pickDirectory`、`pickApiConfigDirectory`、`openFolder`、`saveTextFile`、`saveApiConfigFile`、`readApiConfigFile`、`openTextFile`、`saveGeneratedTextAsset`、`saveMediaAsset`、`exportMediaFile`、`readLocalMediaDataUrl`、`getLocalMediaFileUrl`
  - 网络/上传：`httpRequest`、`fetchRemoteImageDataUrl`、`yunwuImageEditRequest`、`uploadImageRequest`、`multipartRequest`、`writeTempUploadFile`、`uploadSignedUrl`、`uploadOssObject`
  - 原桌面媒体能力：`clipVideo`
- **存储与接口边界**：没有应用级数据库表；浏览器存储不是服务端数据源。对外能力由页面 DOM 交互和 `window.electronAPI` 兼容层组成。

#### 4.3 资产参考库实体与接口

- **姿势条目**：`id`、`体系`、`姿势编号`、`分类`、`姿势名称`、`角度`、`缩略图`、`原图`、`检索`。默认安全模式隐藏体系 `全身单人・性感系` 与 `双人缠绵`。
- **服装条目**：`id`、`source`、`一级分类`、`分类`、`服装名称`、`标签`、`关键词`、`缩略图`、`预览图`、`原图`、`检索`，部分条目含 `views`、`selectedView`、`来源`、`来源地址`、`敏感`。默认隐藏分类 `内衣・睡衣`、`性感穿搭` 与 `敏感: true` 条目。
- **人像条目**：`id`、`分区`、`发长`、`发型名称`、`标题`、`宽`、`高`、`精选`、`热门`、`缩略图`、`原图`、`检索`。
- **搜索与筛选状态**：当前库、关键词、主要分类、次级分类、标签、视角、发长、热门/精选与首屏数量，全部为页面内状态。
- **安全模式**：默认 `true`，关闭前必须显示 18+ 确认；安全模式切换会重置筛选与分页。
- **详情预览**：上一张/下一张、`←` / `→`、`Esc`；姿势支持白模/深度图切换，服装支持多视角切换。
- **宿主内嵌契约**：画布抽屉与工作台图片工坊都通过 `gallery/index.html?v=<版本>&embed=1&host=<canvas|studio>&tab=<库>` 加载。`host` 决定尺寸档位使用哪个 localStorage 键：`studio`、`canvas` 与独立资产页（无 `host` 且无 `embed`）各自独立，改一边不影响另一边；缺少 `host` 但带 `embed=1` 的旧链接回退到 `embed` 独立档位，绝不与 `studio`/`canvas` 混用。分键后的首次加载会继承旧的全局档位并写入本宿主自己的键，之后完全脱钩。iframe 内向宿主发送 `{ source: "manshiguang-asset-embed", type: "asset-select", asset }` 与 `{ ..., type: "close-drawer" }`，宿主向 iframe 发送 `{ source: "manshiguang-asset-host", type: "switch-tab", tab }`。所有消息都校验 `event.origin === window.location.origin`。独立标签页仍沿用 `BroadcastChannel("manshiguang:asset-transfer")`。
- **卡片发送按钮可见性**：卡片右上角的 `.asset-card__send`（「发送到画布合成台」）按宿主区分——`body.is-embed-host-studio`（工作台图片工坊）下 `display: none`；画布抽屉（`host=canvas`）、独立资产页与只带 `embed=1` 的旧链接一律保留可见。工作台内仍可点开卡片用详情弹层的 `#dialogSend` 把资产送进画布，该入口不受影响。规则只写在 `gallery/assets/gallery.css`，靠 `gallery.js` 追加的宿主类名生效，不得改动画布压缩 bundle。
- **只读资产接口**：
  - `GET /__gallery_asset/data/*.json`
  - `GET /__gallery_asset/thumbs/*`
  - `GET /__gallery_asset/img/*`
  - 根目录白名单为 `data`、`thumbs`、`img`；扩展名白名单为 JSON/JPG/JPEG/PNG/WebP/GIF/AVIF；拒绝绝对路径、反斜杠、NUL、`.`/`..`、越界路径与其他根目录。
  - 外部数据目录默认 `D:\data\workData\codex\Projects\ai-pose-gallery-zh-main`，可通过环境变量 `MSG_GALLERY_DIR` 覆盖。
- **远程图片**：CharaDB 和「ギア・动漫」索引中的部分图片使用远程站点 URL，页面不代理、不缓存这些跨域资源；其可用性取决于来源站点和当前网络。
#### 4.4 AI 创作工作台实体与接口

- **Workspace**：`id`、`label`、`tagline`、`kicker`、`icon`、`type`、`state`；`frame` 类型另有 `url` 与 `tabs`，`soon` 类型另有 `purpose`、`inputs`、`outputs`、`relation`。当前固定六项：`canvas`（在线）、`assets`（在线，界面名「图片工坊」）、`story`（剧情导演台）、`imagelab`（设定与出图）、`human`（数字人视频）、`tasks`（任务与成片），后三项为规划中。
- **工作台状态**：`localStorage["manshiguang:studio"]`，字段 `workspace`（上次激活的工作区 id）与 `assetTab`（`poses`/`costumes`/`portraits`）。
- **共享目录授权**：工作台与画布桥接层共用 IndexedDB `manshiguang-canvas-bridge` / object store `directoryHandles`，默认目录键固定 `bridge:default`，token 形如 `webdir:<uuid>:<encoded-name>`。同源 iframe 与顶层窗口共享同一份记录，因此在工作台授权一次，画布 iframe 立即可用。
- **工作台 → 画布消息**：`{ source: "manshiguang-studio", type: "directory-changed" }`，同时通过 `postMessage`（同源 iframe）与 `BroadcastChannel("manshiguang-canvas-bridge")`（独立标签页）发送；桥接层收到后清空目录 handle 内存缓存，下一次读写重新从 IndexedDB 取值。
- **工作台 ↔ 资产 iframe 消息**：沿用 4.3 的 `manshiguang-asset-host` / `manshiguang-asset-embed` 契约；工作台作为宿主时只发 `switch-tab`。图片工坊 iframe 冒泡上来的 `asset-select` 由工作台 `deliverToCanvas()` 转交给画布工作区暴露的 `window.__MS_CANVAS_ASSET_HOST__.receiveAsset(asset)`（由 `canvas/gallery-patch.js` 提供），成功接收后自动切回画布；画布补丁未就绪时先切过去并延迟重试一次，仍失败就在舞台区显示中文提示，绝不静默成功。
- 所有跨 frame 消息都必须校验 `event.origin === window.location.origin`；非同源宿主只能退回整页重新赋值 `src`。

### 5. 构建、启动与测试

#### 5.1 构建

本项目无需安装和构建：

```powershell
# 主站与画布均没有 build 命令
```

推荐使用项目自带的本地服务器：

```powershell
python server.py 4173
```

`start.bat` 已切换到 `server.py`。服务只监听 `127.0.0.1`，除静态文件外提供 `GET /__health`、`POST /__open_folder` 与资产只读代理 `/__gallery_asset/`；`/__open_folder` 只接受本机同源请求、JSON 和 `X-Manshiguang-Action: open-folder` 请求头，并且只允许打开 `D:\data\workData\漫时光\画布\images` 与 `C:\Users\liliang\msg` 两个固定目录。测试时可用环境变量 `MSG_OPEN_FOLDER_DRY_RUN=1` 验证接口而不真正弹出资源管理器。资产目录可用 `MSG_GALLERY_DIR` 覆盖，但只允许代理其 `data`、`thumbs`、`img` 子目录。若改用 `python -m http.server`，画布仍可运行，但「打开目录」会回退为页面内查看文件列表，资产页也无法读取外部索引与图片。

然后访问：

- `http://127.0.0.1:4173/`：漫时光主站
- `http://127.0.0.1:4173/canvas/index.html`：画布
- `http://127.0.0.1:4173/studio/index.html`：AI 创作工作台（主站导航入口指向这里）
- `http://127.0.0.1:4173/gallery/index.html`：资产参考库

直接双击 `index.html` 可预览主站基础界面；但 File System Access、Web Crypto、IndexedDB 持久化和跨标签页行为在 `file://` 下可能受限，涉及画布保存/网络功能时应使用本地 HTTP 地址。

#### 5.2 静态检查

```powershell
node --check assets/app.js
node --check canvas/web-bridge.js
node --check canvas/branding-patch.js
node --check canvas/api-profiles-patch.js
node --check canvas/comfy-patch.js
node --check canvas/model-patch.js
node --check canvas/gallery-patch.js
node --check studio/assets/studio.js
node --check gallery/assets/gallery.js
python -m py_compile server.py
```

还可检查页面资源是否可访问：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/studio/index.html
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/gallery/index.html
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/canvas/index.html
```

#### 5.3 浏览器验收

至少检查：

1. 主站导航「社区」右侧出现「AI 创作工作台」和「资产」；桌面导航与移动菜单文案、链接一致，均指向 `studio/index.html` 与 `gallery/index.html`，主站不再直接链到 `canvas/index.html`。导航在 1440/1280/1100/1000px 下都不得出现横向滚动。
2. 点击「AI 创作工作台」在浏览器新标签页打开工作台，而不是替换主站页面；工作台默认落在上次使用的或 hash 指定的工作区。
3. 画布 React 根节点完成渲染，`#canvasBoot` 消失。
4. 浏览器控制台没有未处理异常。
5. `window.electronAPI` 的对象存在且方法数量与桥接层一致。
6. 移动菜单也能打开 AI 创作工作台。
7. 进入任一工作流并打开「模型与接口设置」，确认作者信息为「抖音/B站/小红书：阿亮啊」「微信：liangliang_0314」「资料主站：https://github.com/xinxin620」，且收款码实际加载 `canvas/donation-qr-liangliang-20261103.png`，中心为真人头像、底部为「恋心心 (*亮)」。

7a. 设置侧栏必须依次为「常规设置 / 快捷键设置 / 图片API来源设置 / ComfyUI设置」，ComfyUI 项位于图片 API 项正下方。点击后只显示 ComfyUI 分区，含本地与云端两张卡；切回「图片API来源设置」时 ComfyUI 分区必须移除、footer 恢复「保存配置」；再次切回仍能显示两张卡。关闭设置重新打开后 tab 仍在，但默认回到「常规设置」。填本机地址并点「测试连接」应经 `server.py` 返回 ComfyUI 版本，填 `http://` 远程地址应给出中文错误；启用后刷新仍保持，`window.__MS_COMFY__` 与 `localStorage["manshiguang:canvas-comfyui"]` 同步。启用卡应自动列出真实 ComfyUI `workflows` 目录中的工作流；搜索能过滤名称与路径，刷新能重新读取。点击一项后应读取单文件并校验 `nodes` 数组，显示节点数量、文件大小与更新时间，并把 `selectedWorkflow` 写进 localStorage 与 `window.__MS_COMFY__`；非法 JSON 必须报中文错误且不覆盖原选择。
8. 在「图片API来源设置」添加 3 个第三方配置后，4 张卡片全部显示；每张保留「申请」并有「启用/已启用」，任意时刻仅一个启用；切换后刷新页面仍保持，且原云雾输入框与 `canvas-api-settings` 同步为当前配置。
9. 启用 Grsai（Base URL 可填 `https://grsai.dakka.com.cn` 或 `https://grsai.dakka.com.cn/v1/api/generate` 的完整地址）后，确认自动拉取 30 个模型并默认勾选 16 个图片模型；打开图片节点模型下拉，只应显示当前 `selectedModels`，且只有当前节点正在使用的模型显示黑色选中态，切换后高亮、按钮文案和 `lastPicked` 同步更新。取消若干勾选并刷新后选择仍保留；再次点击「拉取全部模型」不得无故覆盖既有勾选；「清空」后下拉应显示空提示而不是回退原生模型。生成请求必须命中 `POST /v1/api/generate`，结果查询必须命中 `GET /v1/api/result?id=...`。
10. 进入「常规设置」，确认「API 配置存储」紧跟「资产存储目录」，只显示应用数据目录 `C:\Users\liliang\msg`，不再出现「浏览器存储」。清除 API Profile 后首次点击「立即保存」应立即显示“正在打开目录选择窗口”，随后弹出系统目录选择窗口；首次点击「从本地恢复」也应具备同样行为。选定目录后应补建默认云雾配置并显示已授权说明，保存时生成或覆盖 `manshiguang-api-config.json`，文件内容包含当前 API Key、Base URL 和模型勾选。修改配置应自动续写；两个按钮在保存或读取期间显示操作中状态，完成后显示持久成功提示和最近保存/恢复时间，并恢复可用；「从本地恢复」不立刻覆盖源文件。刷新后目录模式、目录名称和授权 handle 应保持，旧 `browser` 存储状态应自动迁移为目录模式。
11. 选择一个素材目录并确认授权后，点击图片节点的下载按钮：文件应写入该目录，页面右下角提示保存文件名，浏览器下载栏不应新增同名文件；若授权目录名恰好是 `images`，文件应直接位于该目录而不出现 `images\images`。撤销目录授权或让写入失败时，应显示失败提示并回退浏览器下载。工作流 `.json` / `.dtworkflow` 和文本下载不应被媒体拦截逻辑改写。`20261104-25` 已用 OPFS 模拟目录验证媒体下载落盘与内容一致，未在 Windows 原生授权目录实测。

11a. 左侧「+」→「上传」选择本地图片后，Image Asset 节点必须直接显示图片内容，而不是只显示文件名；节点 `results[].localPath` 应为 `D:\data\workData\漫时光\画布\images\<文件名>` 这类绝对路径，`<img>` 实际 `src` 由桥接层解析为 `blob:`。同一素材反复渲染不应重复生成 Blob；未选择资产目录时回退浏览器下载并使用 `blob:` 显示。`20261106-14` 已用 headless Chrome 驱动真实「+ → 上传 → 选文件」流程验证 240×160 WebP 正常解码，并验证旧 `webdir:` 节点路径的兜底转换；未在 Windows 原生授权目录人工点击验收。

11b. 从资产目录自身选择一张已存在的图片并连续上传两次：目录里必须仍然只有 1 个文件，不得出现 `<原名>-2.<ext>` 之类副本，同时画布应新增 2 个节点且都能正常显示；上传一张同名但内容不同的图片时，必须保留原文件并另存新名。`20261107-1` 已用 OPFS 目录句柄验证 8 项去重断言与真实「+ → 上传」两轮流程；未在 Windows 原生授权目录人工验收。
12. 为「资产存储目录」选择名为 `images` 的目录后，输入框应立即显示 `D:\data\workData\漫时光\画布\images（授权目录：images）`，不得等到点击「立即保存」才更新；选择其他目录名时仍显示「文件夹名（浏览器授权目录）」。通过 `start.bat` 启动时，资产卡按钮应显示「打开目录」，点击后由本机 `server.py` 在 Windows 资源管理器中打开该固定路径，并显示页面状态提示；`/__health` 不可用或 `server.py` 未启动时，按钮回退为「查看目录」，点击后显示顶层文件/目录列表及重启服务提示，不能静默失败。随后为「API 配置存储」选择另一个目录并点击「立即保存」，资产目录的显示文本和 `data-ms-raw-path` 必须保持不变。

13. 打开 `gallery/index.html`：页面完成加载，控制台无未处理异常；三库 tab 可切换，首屏各显示 60 条并可「加载更多」。
14. 安全模式默认开启，顶部与结果区显示 `SFW 安全模式`；关闭前出现 18+ 确认，取消不改变状态。安全模式总量应为 `4,769`，关闭后总量 `6,162`；姿势分别为 `765` / `1,439`，服装 `2,505` / `3,224`，人像均为 `1,499`。
15. 搜索、分类/来源/标签/发长筛选与「重置筛选」可用；姿势切换「素体白模/深度图」后卡片、详情徽标、详情按钮文案和图片 URL 同步变化。
16. 服装库选择 Shisei 条目，详情应出现正面、斜侧、侧面、背面多视角按钮，切换后主图与「查看原图」目标同步；`←` / `→` 切换条目，`Esc` 关闭。
17. 以 390px 宽度打开资产页，确认 `document.documentElement.scrollWidth <= window.innerWidth`，不得出现横向滚动；`server.py` 的代理接口应拒绝路径穿越与其他根目录。
18. 在画布工作流页点击侧边栏「姿势库/服装库/人像库」：必须在画布同页右侧滑出 iframe 抽屉而不是开新标签；抽屉内为嵌入紧凑布局（默认「标准」档 6 列，可用「紧凑 / 标准 / 放大」切到 8 / 6 / 4 列，档位与工作台图片工坊互相独立），看不到站点页头、主视觉与来源说明；点卡片上的发送按钮后画布新增 Image Asset 节点、右下角提示「已插入…到画布」、合成台列表与角标同步；重复点同一张资产应再新增一个节点（合成台列表不重复计数）。Ctrl/中键点击库按钮仍开新标签页；`Esc` 或再次点同一按钮关闭抽屉；抽屉与合成台面板互斥显示；切到未加载过的库时原地补加载并显示该库条目。独立打开的 `gallery/index.html` 布局必须保持原样（五列、显示页头与主视觉）。`20261107-2` 已用 headless Chrome 真实鼠标点击跑通 18 项断言；未在 Windows 原生授权目录人工验收。

18a. 「紧凑 / 标准 / 放大」三档在工作台图片工坊、画布抽屉与独立资产页三处必须各自独立：在画布抽屉切到紧凑后，工作台图片工坊与独立资产页的档位和列数都不得改变，反向同理；三处各自重载后仍保持自己的档位。`20261109-2` 已用 headless Chrome 复跑 17 项断言全过（含 iframe 真实列数、localStorage 键值，以及两条发送链路载荷与重构前逐字节一致的 A/B 对比）。

18b. 卡片右上角「发送到画布合成台」图标只在工作台图片工坊隐藏：`gallery/index.html?embed=1&host=studio` 下 `.asset-card__send` 必须 `display: none`，而 `host=canvas`（画布抽屉）、独立 `gallery/index.html` 与只带 `embed=1` 的旧链接都必须仍然可见可点；工作台详情弹层的发送按钮必须保留可用。`20261109-3` 已用 headless Chrome（含工作台外壳真实 iframe）跑通 8 项断言并截图核对。
19. 打开 AI 创作工作台：左侧栏为「画布 / 图片工坊 / 剧情导演台 / 设定与出图 / 数字人视频 / 任务与成片」六项，前两项标为在线、后四项标为规划中并给出用途、输入、产出和与现有能力的关系，不提供假按钮。
20. 在工作台点「画布」：iframe 内画布应用完成渲染，切到「图片工坊」再切回「画布」时工作流与滚动状态仍在（iframe 只隐藏不销毁），只有「重载」会重新载入。
21. 在工作台左下角点「授权资产目录」并选择 `D:\data\workData\漫时光\画布\images`：状态条变为已授权并显示目录名；随后在画布 iframe 内「+ → 上传」选本地图片，节点必须直接显示图片内容，文件落在该目录且不产生 `-2` 副本。这一步验证的是「顶层授权 + iframe 复用」链路，画布内部不需要再弹一次目录选择器。
22. 已加载画布后在工作台重新授权另一个目录：桥接层收到 `manshiguang-studio / directory-changed` 后必须丢弃旧的内存 handle，下一次读写使用新目录；未收到通知的独立画布标签页也要通过 `BroadcastChannel` 同步失效。取消系统目录选择窗口不得改动原授权。
23. 工作台「图片工坊」顶部「姿势/服装/人像」分段控制器切换资产库不重新加载页面；画布内资产抽屉、合成台角标和 `Esc` 关闭行为与工作台并存且互不影响。独立打开 `canvas/index.html` 与 `gallery/index.html` 时功能不变。`20261107-4` 已用 headless Chrome 跑通 24 项导航/联动断言与 9 项工作台内画布/抽屉断言（含真实建工作流、插入资产、授权失效重建）；未在 Windows 原生授权目录人工点击验收。

只报告实际完成的检查。AI 服务商、OSS、CORS、上传和 FFmpeg 若没有真实环境和凭证，不得标记为已验证。

### 6. 编码规范、命名与异常处理

- **语言**：面向用户的文案、提示、文档默认使用简体中文；代码标识符使用英文。
- **零依赖原则**：主站保持纯静态 HTML/CSS/JS。除非明确需要复杂构建，否则不要为主站引入 React、Vite、Node 后端或包管理器。
- **工作台约定**：`studio/assets/studio.js` 只是外壳与路由，新能力一律落在 `canvas/`、`gallery/` 自己的补丁里，不在工作台重复实现；新增工作区只改 `WORKSPACES` 注册表，未实现的工作区必须用 `type: "soon"` 写清用途、输入、产出和关系，禁止放假按钮或占位即成功的交互。
- **脚本风格**：主站和桥接层都是传统浏览器脚本；新增代码沿用 IIFE、`const`/`let`、显式命名函数和 `data-*` 事件钩子。不要无故把主站改为 ESM。
- **DOM 约定**：查询集中在 `$` / `$$` 辅助函数；事件绑定集中在 `setupEvents()`；动态列表通过渲染函数生成，不在多处复制数据。
- **命名**：主站 CSS 倾向 kebab-case/组件语义类；JS 使用 camelCase；持久化键名沿用现有 `manshiguang:*` 前缀；画布 bundle 内的类名不可改。
- **无障碍**：保留 `aria-*`、键盘焦点、`Escape` 关闭、`skip-link` 和可见焦点；新增按钮必须使用正确元素或明确 `type`。
- **异常处理**：兼容桥接的普通拒绝使用 `throw new Error(中文说明)`，不得静默成功；网络错误要保留 URL、方法、状态和 CORS 提示。画布宿主页在根节点未渲染时显示可诊断的启动失败信息。
- **文件/资源所有权**：浏览器无法访问的绝对路径、系统文件管理器、FFmpeg 和原生窗口能力必须明确报错或降级说明，不能用假数据掩盖。
- **安全**：API Key 会同时保存在当前浏览器和默认应用数据目录的明文 JSON 中，只能放在本人可控的私有目录。不要把密钥、上传凭证、用户选择的绝对路径或生成的配置文件写入仓库、日志或提交。`openExternalUrl` 只允许 `http/https`。
- **生成文件**：`canvas/assets/index-*.js`、`index-*.css` 是外部构建产物，不手改；需要升级时整体替换并复测桥接契约。
- **资产页**：继续使用原生 HTML/CSS/JS 和 IIFE；页面资源统一走 `local-assets/` 相对路径，外部目录绝对路径不得硬编码为可直接访问的静态路径；`gallery/local-assets/` 必须保持在 `.gitignore` 中，不要提交进版本库。
- **临时脚本**：会话中的一次性补丁写入器、headless 自测与截图脚本统一放在仓库根目录 `_scratch/`，该目录必须保持在 `.gitignore` 中，不提交进版本库，也不得被 `canvas/`、`gallery/`、`studio/`、`server.py` 等正式代码引用。正式自测若需要长期保留，改写为文档记录的命令并放到对应说明里。

### 7. 已知约束、历史备注与注意事项

#### 7.1 浏览器能力边界

- **CORS**：AI 服务商、上传服务和部分 OSS 端点可能拒绝浏览器跨域请求。`httpRequest` 会保留目标 URL、方法、状态和 CORS 提示，但不能绕过服务端 CORS。
- **自定义代理**：原 Electron 桌面版可通过 Node/undici 使用网络代理；普通浏览器桥接层不能接管系统代理。设置页的代理配置不会改变浏览器网络栈。
- **本地绝对路径**：浏览器不能读取任意 Windows 路径。必须通过画布文件上传，或在 Chromium 中选择素材目录。为了让压缩 bundle 正确显示素材，桥接层把已授权目录的落盘结果表示为显示用绝对路径，并在 IndexedDB `bridge:mediaPaths` 中登记到目录 handle 的映射；读取时按映射回到 File System Access。映射不存在（换浏览器、清理站点数据或路径伪造）时必须明确报错，绝不把该路径交给浏览器原生 `file://` 读取。
- **系统文件管理器**：浏览器本身不能直接打开 Windows 资源管理器。`start.bat` 启动的 `server.py` 提供受本机同源保护、仅限固定目录白名单的 `/__open_folder` 接口；`openFolder()` 在目录名为 `images` 时调用该接口，成功后派发 `manshiguang:directory-opened` 并提示实际路径。服务不可用、目录不在白名单或权限失效时，继续读取已授权目录的顶层内容并派发 `manshiguang:directory-inspected`，由补丁显示「查看目录」面板和重试说明。固定显示路径只用于打开与展示，文件数据读写仍必须通过 File System Access handle。
- **FFmpeg 视频剪辑**：`clipVideo()` 在网页版明确失败；没有原桌面版的 FFmpeg 二进制执行能力。
- **窗口最大化**：浏览器兼容实现使用 Fullscreen API，不等价于 Electron 原生无边框窗口；`window.close()` 也可能受浏览器窗口策略限制。
- **文件保存**：生成媒体、节点导出和图片/视频/音频下载都优先使用 File System Access API 写入已授权素材目录；浏览器不支持或目录未授权、权限失效时才回退浏览器下载。压缩 bundle 的下载按钮只创建 `blob:` 临时链接并立即撤销，桥接层必须在捕获阶段拦截 `a[download]`，缓存 `URL.createObjectURL` 生成的 Blob，再用 `writeOrReuseFile` 落盘。资产目录本身名为 `images` / `videos` / `audio` 时直接写入该目录，避免出现同名嵌套。
- **同名素材去重**：`writeOrReuseFile` 先按字节比较目标同名文件，内容完全一致时直接复用原文件并返回原名，只有内容确实不同才退回 `writeUniqueFile` 追加 `-2` / `-3` 后缀。用户经常直接从资产目录本身选图上传，若一律加后缀就会出现「传一张照片多出两张一样的图」。所有落盘入口（`saveMediaAsset`、`exportMediaFile`、`saveGeneratedTextAsset`、媒体下载拦截）必须走 `writeOrReuseFile`，不要直接调用 `writeUniqueFile`。
- **目录选择器**：`showDirectoryPicker()` 必须在点击处理函数的首个 `await` 之前调用；不要先查询 IndexedDB 再弹窗，否则浏览器会丢失用户激活，Windows 目录选择窗口可能完全不出现。
- **目录回显**：授权成功后桥接返回 `webdir:<uuid>:<encoded-name>`，这是 IndexedDB 中目录 handle 的键，不是 Windows 路径（节点内的素材路径则来自 `bridge:mediaPaths` 映射，见「本地绝对路径」条目）；资产存储目录输入框在显示层对 `images` 显示固定实际路径，对其他目录名显示「文件夹名（浏览器授权目录）」，真实标识保留在 `data-ms-raw-path` 与 `title` 中，不要把它当成可用的绝对路径。补丁会包装 `pickDirectory()`，在目录选择器返回后主动轮询并刷新显示，因为 React 更新受控输入框的 `value` 不会触发 `MutationObserver`。
- **新标签页**：AI 创作工作台与资产页使用原生 `target="_blank"` 链接在浏览器新标签页打开；浏览器或扩展可能拦截，主站不强制窗口尺寸，也不复用命名窗口。画布仍可独立打开，用于需要完整窗口尺寸的场景，工作台右上角也提供「新标签页」按钮。
- **资产参考库**：必须通过 `start.bat` / `server.py` 访问项目外索引；普通静态服务器无法读取外部目录。远程图片不经过本地代理，跨域、来源站点下线或防盗链都可能导致单张图失败，页面显示失败占位但不应阻断其他条目。图片与原始数据不适用本仓库 MIT 许可证，版权归各来源作者，禁止打包倒卖或侵权使用。
- **工作台 iframe**：画布与资产库都跑在 `iframe` 里，受同源限制。目录授权必须在顶层窗口做（iframe 内的用户激活不稳定），再把 handle 写进共享 IndexedDB；handle 不可结构化克隆到别的源，也不能序列化保存，因此换浏览器或清站点数据后需要重新授权。工作台切换工作区不会销毁 iframe，内存态（未保存的节点、生成中任务）会保留，但「重载」和刷新工作台页面都会重置画布内未落盘的状态。

#### 7.2 项目历史与维护

- 画布资源从「简单画布 Setup 0.0.1.exe」解包，原应用包名为 `canvas-app`，原包版本为 `0.0.5`。
- 当前 `canvas/assets`、品牌图和图标与解包后的 `dist` 文件逐文件 SHA-256 一致；`canvas/donation-qr.png` 与 `canvas/donation-qr-liangliang-20261103.png` 内容相同，均为用户提供的收款码卡片，不再与原始 `dist` 一致。带日期文件名是运行时首选路径，稳定文件名保留为原始 bundle 的兼容回退。
- `canvas/branding-patch.js` 在浏览器运行时替换设置侧栏作者信息，原始压缩 bundle 内仍保留旧文本；这是有意的只读边界，不要为了替换品牌而修改 bundle。
- `canvas/api-profiles-patch.js` 在浏览器运行时管理多套 API 配置，压缩 bundle 内仍只有原始云雾 vendor 卡片。已验证：添加第三方配置并填写 Base URL 后自动拉取、30 个模型与 16 个图片模型默认勾选、手动勾选/取消、刷新保持、重新拉取保留选择、清空、唯一启用和云雾回退。API 配置存储的独立验收链已通过：固定目录模式、清理 Profile 后首次点击「立即保存」自动补建默认配置、OPFS 模拟目录选择后真实桥接写入/读取 JSON、保存/读取按钮即时进入操作中状态、持久成功提示、最近保存/恢复时间更新、两个按钮完成后恢复可用、Key 变更自动续写、从本地恢复不覆盖源文件、刷新保持目录模式。未实际操作 Windows 系统目录选择授权窗口。真实第三方出图仍未验证，因为当前没有有效 Key。
- 2026-11-04 排查“浏览器存储 / 本地目录切换无反应”时确认：切换逻辑本身可用，实际问题来自仍在运行 `api-profiles-patch.js?v=20261104-3` 的旧标签页。`canvas/index.html` 已加入 `20261104-9` 版本守卫，主站画布链接同步升级到该版本。另修正渲染监听范围：设置弹窗通过 portal 挂在 `#root` 外，原监听只观察 `#root`，页面加载后再打开设置时可能不插入存储卡片；现改为观察 `document.body`。旧页面需强制刷新或重新从主站打开一次。
- 2026-11-04 `20261104-19` 版本修复：首次点击「立即保存」或「从本地恢复」时，若浏览器中还没有 API Profile，会先自动补建默认云雾配置；未授权目录时先显示“正在打开目录选择窗口”，保存/读取完成后按钮恢复可用，错误提示自动滚动可见。旧「浏览器存储」状态强制迁移为目录模式。标题栏 Logo 同时替换为 `assets/favicon-32x32.png`。保存/恢复验收使用 OPFS 模拟目录选择，未实际操作 Windows 原生选目录窗口。
- 2026-11-04 `20261104-20` 版本修复：API 配置卡此前用 `card.innerHTML !== nextHtml` 判断是否需要重绘，但浏览器会把 `disabled` 等布尔属性与空白规范化后再序列化，比较永远不相等，导致卡片每秒约 60 次无限重绘，按钮节点被反复替换，「立即保存」「从本地恢复」点击无效且鼠标一直显示忙碌光标。现改为记录上一次写入的模板字符串（`__msRenderedHtml`）后再比较，并在 `MutationObserver` 回调里跳过状态文本未变化的写入；API 来源管理区同步采用相同写法。另：资产存储目录输入框中的 `webdir:<uuid>:<encoded-name>` 只是在浏览器安全限制下的目录授权标识（`%E7%94%BB%E5%B8%83` 解码为「画布」），页面拿不到 Windows 绝对路径，因此运行时会把它显示为「画布（浏览器授权目录）」，原标识保留在 `data-ms-raw-path` 与 `title` 中。
- 2026-11-04 `20261104-21` 版本修复：资产目录选择完成后不再等待其他渲染事件，选择器一返回就刷新为「文件夹名（浏览器授权目录）」，因此点击「立即保存」时不会再出现资产目录“跟着变”的错觉；资产目录与 API 配置目录仍使用独立 token。原生「打开目录」按钮在显示层改为「查看目录」，点击后由 `openFolder()` 读取已授权目录的顶层文件夹和文件，并通过 `manshiguang:directory-inspected` 事件显示内容面板；网页仍不打开 Windows 资源管理器。已用 OPFS 真实目录句柄验证即时回显、文件清单与两个目录互不影响；未实际操作 Windows 原生目录选择窗口。
- 2026-11-04 `20261104-22` 版本修复：API 配置卡此前已算出 `directoryName` / `directoryMeta`，却从未写进渲染模板，因此用户选定目录并保存后仍只看到 `C:\Users\liliang\msg`，容易误以为上方资产目录被连带修改。现在「保存位置」右侧直接显示已授权文件夹名，说明文字改为「已授权文件夹「xxx」中的 manshiguang-api-config.json」，并新增一行「已授权文件夹 / 最近保存 / 最近恢复」。已用真实鼠标事件验证：保存、二次保存、从本地恢复三个动作前后，资产目录输入框的显示文字与 `data-ms-raw-path` 均保持不变；两个目录的 token 各自独立，`pickApiConfigDirectory()` 始终以 `makeDefault: false` 写库，不会覆盖资产目录的 `bridge:default` 记录。
- 2026-11-04 `20261104-23` 版本按用户要求，在授权目录名为 `images` 时把用户确认的实际路径 `D:\data\workData\漫时光\画布\images` 固定显示在资产目录输入框和「查看目录」面板中。该路径只是显示层标注，不参与读写；选择其他文件夹时仍回退为文件夹名。已确认该目录存在且包含截图中显示的两张 PNG。
- 2026-11-04 `20261104-24` 版本新增 `server.py`，让 `start.bat` 启动的本地服务代理「打开目录」操作，解决旧版本只能列出目录内容、无法唤起 Windows 资源管理器的问题。接口只监听回环地址，校验同源 `Origin`、JSON 内容和 `X-Manshiguang-Action` 请求头，只允许 `D:\data\workData\漫时光\画布\images` 与 `C:\Users\liliang\msg` 两个固定目录。已在 4174 端口使用 `MSG_OPEN_FOLDER_DRY_RUN=1` 验证：健康检查成功、指定目录返回成功、`C:\Windows` 返回 403、缺少确认头返回 403；未在真实浏览器中点击并观察资源管理器弹出。
- 2026-11-05 `20261104-25` 版本修复节点下载跳过资产目录的问题。压缩画布的 `Kg` 下载函数只调用 `<a download>` 指向 `blob:`，不调用 `saveMediaAsset`；现在 `canvas/web-bridge.js` 在 `document` 捕获阶段识别媒体扩展名的下载链接，优先从 `URL.createObjectURL` 缓存或即时读取 Blob，写入已授权目录并派发 `manshiguang:download-saved`，页面右下角显示保存结果；未授权或失败才重新触发浏览器下载。`saveMediaAsset` 同步复用目录判定，避免 `images\images`。已在 headless Chrome 中用 OPFS 目录句柄模拟点击，验证文件写入、内容字节一致和事件详情；尚未在用户的 Windows 原生授权目录上实际点击下载验收。
- 2026-11-07 `20261107-5` 补上工作台「插入画布」断链：初版工作台只监听 `directory-changed`，图片工坊 iframe 发出的 `asset-select` 停在外壳层，卡片却提示「已插入画布合成台」，属于假成功。现在 `canvas/gallery-patch.js` 暴露 `window.__MS_CANVAS_ASSET_HOST__.receiveAsset()`，`studio.js` 负责转发并在接收后切回画布，已验证新增节点与图片解码显示。
- 2026-11-07 `20261107-4` 新增 `studio/` AI 创作工作台：主站导航「画布」改为「AI 创作工作台」并指向 `studio/index.html`，工作台用左侧栏把画布与图片工坊（嵌入模式资产库）集成在同一页面切换，另设剧情导演台、设定与出图、数字人视频、任务与成片四个规划中工作区。目录授权改到顶层窗口完成后写入共享 IndexedDB，画布 iframe 直接复用，解决 iframe 内弹不出系统目录选择器的问题。同时修掉两处会静默失效的缺陷：`studio.js` 里残留的旧 `requestDirectory()` 定义覆盖了新版顶层授权（函数声明提升导致后定义者生效，实际仍走 iframe 授权路径），以及桥接层缓存旧目录 handle 使重新授权后仍写向原目录——现在收到 `directory-changed` 会清空 `directoryRecords`。独立入口 `canvas/index.html`、`gallery/index.html` 全部保留。
- 2026-11-07 `20261107-2` 按用户反馈把资产库改为画布内嵌抽屉。此前侧边栏三个库按钮 `window.open` 跳新标签，用户要在新标签挑图、点发送、再切回画布看结果，且面板关掉后只能靠角标重新打开（角标在列表为空时还会隐藏）。现在：`canvas/gallery-patch.js` 注入右侧 iframe 抽屉，`gallery/index.html?embed=1&tab=` 走新增的 `is-embed` 紧凑样式并只加载当前库索引；iframe 用 `postMessage` 通知宿主，宿主复用画布侧边栏隐藏的 `input[type="file"]` 派发 `change` 事件建节点，因此与手动「+ → 上传」共用同一套落盘与显示逻辑；独立标签页仍走 `BroadcastChannel` 且只进合成台列表，不自动建节点。过程中修掉两个自测暴露的问题：`loadLibrary()` 嵌入分支返回单个 Promise 导致 `Promise.all` 报错（包成数组），以及合成台去重把「插入画布」一起挡住（改为去重只作用于列表）。已用 headless Chrome 真实鼠标点击跑通 18 项断言并确认独立资产页布局未受影响。版本守卫与主站/资产页链接升到 `20261107-2`。
- 2026-11-07 `20261107-1` 修复「上传一张照片后资产目录里多出一张重复图」。排查确认一次上传只调用一次 `saveMediaAsset`，不是重复写入；真正原因是 `writeUniqueFile` 遇到同名文件一律追加 `-2` / `-3` 后缀另存，而用户习惯直接从资产目录 `D:\data\workData\漫时光\画布\images` 选图，同名文件必然存在，于是每次上传都多出一份内容完全相同的副本。新增 `hasIdenticalFile` + `writeOrReuseFile`：先比文件大小再逐字节比较，一致则复用原文件并返回原名，不一致才退回唯一命名，四个落盘入口全部切换。已在 headless Chrome 验证「新文件」「同名同内容重复上传不产生副本且路径不变」「同名不同内容仍另存」共 8 项断言，并用 Playwright 跑通真实上传两轮：目录始终 1 个文件、画布 2 个节点、图片正常解码、无页面报错。版本守卫升到 `20261107-1`，主站与资产页入口链接同步。历史遗留的 `-2` / `-3` 重复文件不会自动清理，需要用户手动删除。
- 2026-11-06 `20261106-14` 修复「左侧 + → 上传 → 选本地图片后图片不显示，只显示文件名」。根因：`canvas/web-bridge.js` 的 `saveMediaAsset` 返回 `webdir:<uuid>:<name>/images/<file>`，而压缩 bundle 的本地路径判定只认 `file://` 与「盘符:\\」，其余字符串原样进入 `<img src>`，浏览器无法解析。现在落盘统一登记 `bridge:mediaPaths` 并返回显示用绝对路径，读取侧（`getLocalMediaFileUrl`、`readLocalMediaDataUrl`、`sourceToBlob`、multipart、`window.fetch`）按映射解析回目录 handle；`HTMLImageElement`/`HTMLMediaElement` 的 `src` setter 兜底转换历史 `webdir:` 路径并缓存 blob；无目录授权的回退下载不再返回 60 秒后被撤销的临时 URL。已在 headless Chrome 用 OPFS 目录句柄跑通 21 项断言（含 240×160 WebP 真实解码、旧路径兜底、映射缺失中文报错），并用 Playwright 驱动真实「+ → 上传 → 选文件」流程确认节点渲染出图片；`v=20261106-14` 已同步到画布版本守卫与主站入口。尚未在用户 Windows 原生授权目录人工点击验收。
- 2026-11-05 新增 `gallery/` 资产参考库与 `/__gallery_asset/` 只读代理，主站桌面和移动导航在「画布」后增加「资产」。数据来自用户本地 `ai-pose-gallery-zh-main`，不复制图片与索引；默认安全模式隐藏 `全身单人・性感系`、`双人缠绵`、`内衣・睡衣`、`性感穿搭` 及 `敏感: true` 服装。已用 headless Chrome 验证三库数量、分页、搜索、Shisei 四视角、深度图切换、详情键盘导航与 390px 无横向溢出；代理已验证 JSON/JPG/WebP 返回 200，路径穿越与其他根目录返回 403。尚未逐一验证 CharaDB、ギア・动漫远程图片的长期可用性，也未在 Windows 原生目录下做人工视觉验收。
- canvas/model-patch.js 依赖 bundle 内部只有 yunwu 一个 vendor 的事实，因此无法直接把 `grsai` 变成 vendor；它改为「Base URL 指向第三方 + 拦截请求改协议」的运行时方案。模型目录与勾选归 API Profile 管理，`model-patch.js` 只展示 `selectedModels`，不再单独拉取、缓存 10 分钟或失败回退内置清单。已验证模型下拉只显示勾选模型、空勾选提示、选择持久化与未勾选时的明确请求错误；真实出图尚未验证。文本节点仍沿用原云雾模型名，未做 Grsai 文本模型适配。
- 原 Electron preload 暴露 26 个 IPC 方法；当前 `canvas/web-bridge.js` 在保留这 26 个兼容方法之外，新增 `pickApiConfigDirectory`、`saveApiConfigFile`、`readApiConfigFile` 三项 API 配置存储扩展，共 29 项。扩展不代表所有网络和原生能力已可用。
- 本次集成未运行原始安装器或 `SimpleCanvas.exe`，只使用静态解包资源。
- 主站仍是演示原型：番剧、用户、社区内容均为原创虚构数据；没有视频播放器、登录、服务端收藏或真实社区接口。
- 若后续恢复/升级画布 bundle，必须重新核对：资源路径、React 根节点、`window.electronAPI` 方法、IndexedDB 记录格式、保存/下载路径和启动遮罩行为。
- 若引入后端或真实第三方接口，必须在本文件第 2、4、5、7 节同步更新技术栈、接口、数据表和验证方式。
