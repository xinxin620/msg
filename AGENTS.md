# Repository Guidelines

## 项目基准 / Project Baseline

> 本文件是 `msg` 仓库的项目级基准上下文，首次核对于 2026-11-04，最新按工作副本复核对齐于 2026-11-11。后续任务先读本文件再读代码；若本文件与源码、页面行为或外部工具事实冲突，一律以当前代码和实测结果为准，并在同一变更中修正本文件。
>
> **必须同步更新本文件的情形**：架构、依赖、入口、存储格式、画布桥接能力、外部服务边界或关键约束发生变化。
>
> **防膨胀约定（写本文件前先读这条）**：本文件只保留「仍然有效的结论」，不记录实现过程与修复流水。
> - 带具体版本号的历史条目、逐版修复记录 → 追加到 `docs/history.md`，不要回写本节。
> - 针对某个具体行为的回归验收项 → 追加到 `docs/acceptance.md`；本文件 5.3 只保留每次改动都要跑的通用项。
> - 补丁的内部机制（选择器、fiber 取法、坐标换算、接口路径细节）以该补丁文件头部的中文注释与实际代码为准；本文件只留「职责 + 关键坑 + 跨文件契约 + 边界」，单个文件条目尽量控制在 4 行以内。新写补丁时把机制写进头部注释。
> - 功能下线：把长期结论留在 3.2/7.2 各一行，细节归档进 `docs/history.md`。

### 1. 项目名称、业务定位与用途

- **项目名称**：漫时光 / MANSHIGUANG。
- **业务定位**：面向中文二次元用户的沉浸式动漫网站原型，视觉主题「夜航星海」。
- **主要用途**：
  - 展示原创虚构番剧、排行榜、新番表、社区内容和追番状态，提供搜索、筛选、详情弹层、选集与本地收藏等纯前端交互。
  - 主导航「社区」右侧提供「AI 创作工作台」入口，新标签页打开 `studio/index.html`；工作台用左侧工作区栏把画布、图片工坊（资产库）集成在同一页面切换。剧情导演台、设定与出图、数字人视频、任务与成片为已规划的占位工作区。
  - 主导航另保留独立「资产」入口，直接打开完整版 `gallery/index.html`；画布内部也有同页资产抽屉。
  - 画布支持工作流编排、AI 服务商配置、ComfyUI 生成、素材上传、文本/媒体保存和部分网络请求，但仍是浏览器版，不等价于原 Electron 桌面版。
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
| 浏览器 | 现代 Chrome、Edge、Firefox、Safari 较新版本；画布高级本地能力优先 Chromium |
| 字体 | Google Fonts；离线时回退系统中文字体 |

#### 2.2 画布

`canvas/` 来自用户提供的原「简单画布」Electron 安装包中提取的已打包资源，不是本仓库重新构建的源码。

| 类别 | 当前实现 |
| --- | --- |
| 前端 | 预构建 React 19.2.4 单页应用，在 `canvas/assets/index-*.js` |
| 工作流画布 | `@xyflow/react`（原包声明 `^12.10.2`） |
| 状态 | Zustand（原包声明 `^5.0.12`） |
| 本地数据 | Dexie / idb-keyval；浏览器桥接另用 IndexedDB |
| 图形与编辑 | PixiJS、react-image-crop、lucide-react |
| 桌面原实现 | Electron preload + IPC + Node.js 文件系统、FFmpeg、undici |
| 当前宿主 | `canvas/index.html` + `web-bridge.js` + `storage-migration.js` + `branding-patch.js` + `api-profiles-patch.js` + `comfy-workflow.js` + `comfy-patch.js` + `model-patch.js` + `gallery-patch.js` + `video-node-patch.js`：在普通浏览器里提供兼容层、残留数据迁移、品牌替换、API 多配置、ComfyUI 连接与生成、第三方模型适配、资产抽屉与「添加节点」视频入口 |
| 构建 | 本仓库不构建画布 bundle；不要手改压缩后的 `index-*.js` / `index-*.css` |

#### 2.3 资产参考库

`gallery/` 是零依赖静态参考库页面，视觉延续主站；不打包、不引入框架。

| 类别 | 当前实现 |
| --- | --- |
| 页面 / 样式 / 脚本 | `gallery/index.html`；`assets/gallery.css`（CSS 变量、Grid、响应式、星场动效、嵌入紧凑样式）；`assets/gallery.js`（传统 IIFE，无构建） |
| 数据来源 | 外部只读目录 `D:\data\workData\codex\Projects\ai-pose-gallery-zh-main`，可用 `MSG_GALLERY_DIR` 覆盖；原始参考站点 `https://ai-pose-gallery.anhao.app/` |
| 数据入口 | 资产图与索引已复制到 `gallery/local-assets/`（约 1.1GB，`.gitignore` 排除，不进版本库）由静态服务器直读；`server.py` 的 `/__gallery_asset/` 外部只读代理仍保留可用 |
| 嵌入模式 | `gallery/index.html?embed=1&host=<studio\|canvas>&tab=poses\|costumes\|portraits`，隐藏站点装饰、只加载当前库 |
| 数据规模 | 安全模式 `4,769` 条，关闭后 `6,162` 条；姿势 `1,439`、服装 `3,224`、人像 `1,499` |
| 图片来源 | 部分本地 WebP、部分外部站点 URL；远程站点可用性与跨域未做长期承诺 |
| 存储 | 只有「紧凑 / 标准 / 放大」尺寸档位持久化，且按宿主分键（见 4.2）；其余筛选、搜索与安全模式只在当前页面会话中保存 |

#### 2.4 AI 创作工作台

`studio/` 是画布与资产库的统一外壳，零依赖静态页面。

| 类别 | 当前实现 |
| --- | --- |
| 页面 / 样式 / 脚本 | `studio/index.html`（工作区栏 + 顶部工具条）；`assets/studio.css`（沿用主站色板）；`assets/studio.js`（IIFE，无构建） |
| 工作区 | `画布`、`图片工坊` 为 iframe 实时页面；`剧情导演台`、`设定与出图`、`数字人视频`、`任务与成片` 为规划中的占位说明页 |
| 集成方式 | iframe + 同源 `postMessage` / `BroadcastChannel`；不改动画布压缩 bundle |
| 目录授权 | 授权在工作台顶层窗口完成，结果写进与画布桥接层同库同键的 IndexedDB，iframe 内的画布直接复用 |
| 入口 | 主站导航「AI 创作工作台」；`canvas/index.html` 与 `gallery/index.html` 仍可独立打开 |

#### 2.5 Java、Spring 与中间件结论

- **Java / Spring / Redis / RabbitMQ / MySQL：全部不适用。** 没有 Java 源码、JVM 构建、消息队列、缓存服务或关系数据库。
- **数据库表：无。** 所有运行状态都在浏览器存储与本地文件里，键位与目录契约统一列在 4.2「存储与键位总表」，不在别处重复展开。
- 后续若引入后端，先明确 API、鉴权、数据模型与部署边界，再改本文件；不要把模板里的 Java/Spring/MySQL 假设套到当前项目上。
### 3. 目录结构与职责

```text
msg/
├─ index.html                 主站页面结构、图标、导航、弹层与页脚
├─ start.bat                  Windows 快速启动：本地服务器并打开主站
├─ stop.bat                   Windows 快速停止：结束 4173 端口进程
├─ server.py                  本地静态服务器、固定目录打开接口、资产与 ComfyUI 只读/转发代理
├─ assets/
│  ├─ styles.css              夜航星海视觉系统、布局、动效与响应式
│  ├─ app.js                  番剧数据、渲染、收藏、搜索、弹层和新标签页入口
│  ├─ hero-art.svg            首页原创主视觉
│  ├─ favicon.* / apple-touch-icon.png / android-chrome-*.png
│  │                          主站多尺寸图标
│  └─ site.webmanifest        Web App 图标清单
├─ canvas/
│  ├─ index.html              画布宿主页、启动遮罩、版本守卫
│  ├─ web-bridge.js           浏览器兼容桥接层，向画布暴露 window.electronAPI
│  ├─ storage-migration.js    一次性迁移：清除已下线功能（当前「轻语漫剧」）的本地残留
│  ├─ branding-patch.js       标题栏产品名/Logo、设置页作者信息与收款码补丁
│  ├─ api-profiles-patch.js   云雾/第三方 API 多配置管理、API 配置存储与「图片API来源设置」改名
│  ├─ comfy-patch.js          「ComfyUI设置」侧栏 tab、连接配置、工作流选择与生成执行
│  ├─ comfy-workflow.js       工作流「编辑格式 → API 格式」转换器（无 DOM，可被 Node require 回归）
│  ├─ model-patch.js          已选模型下拉注入与第三方请求协议适配
│  ├─ gallery-patch.js        画布内资产抽屉、合成台面板与资产插入节点
│  ├─ video-node-patch.js     把被裁掉的「视频」入口补回侧栏「+」与右键「添加节点」
│  ├─ assets/index-*.js|.css  已打包 React 画布应用与样式（只读）
│  ├─ dt-canvas-logo.png / icon.ico
│  │                          画布品牌资源与图标
│  └─ donation-qr*.png        阿亮啊支付宝收款码（带日期件为运行时首选，无日期件为兼容回退）
├─ gallery/
│  ├─ index.html              资产参考库宿主页，支持 ?embed=1&host=&tab= 嵌入模式
│  ├─ assets/gallery.css|.js  资产页样式与三库读取、筛选、详情、安全模式逻辑
│  └─ local-assets/           本地化索引与图片（约 1.1GB，.gitignore 排除，不提交）
├─ studio/
│  ├─ index.html              AI 创作工作台外壳、工作区栏与版本守卫
│  └─ assets/studio.css|.js   工作台布局；工作区注册、iframe 复用、目录授权与共享桥接
├─ docs/
│  ├─ acceptance.md           完整浏览器回归验收清单（自 5.3 移出，逐字保留）
│  └─ history.md              项目历史与逐版本流水账（自 7.2 移出，逐字保留）
├─ .preview/                  桌面、移动端、搜索、详情、资产库与工作台验收截图
├─ .gitignore                 排除 local-assets、临时脚本与本地日志
├─ AGENTS.md                  项目基准与协作约束（结论层）
├─ README.md                  面向使用者的项目说明
└─ MEMORY.md                  项目长期记忆与已确认决策（约定与踩坑层）
```

三个文档分工：`AGENTS.md` 讲架构与契约，`MEMORY.md` 讲长期约定与踩过的坑，`README.md` 讲给用户看的功能用法。同一条信息只在最合适的一份里展开，其余用一节编号引用，不复制正文。

#### 3.1 主站职责

- `index.html`：只保留静态结构与无障碍语义；卡片、排行榜、新番表、搜索结果由 `assets/app.js` 渲染。桌面导航 `.desktop-nav` 与移动菜单 `.mobile-menu` 各含两条外链，见 4.1。
- `assets/app.js`：`animeLibrary` 是 12 部原创虚构番剧的唯一数据源；`state` 保存筛选、搜索、移动菜单、详情与收藏状态；`renderAnimeGrid()` / `renderRanking()` / `renderSchedule()` / `renderSearch()` 是数据驱动的渲染入口；`setupEvents()` 统一绑定交互，画布与资产入口都用原生 `target="_blank"` 新标签页打开，不做 popup 拦截；`init()` 是初始化顺序的单一入口。
- `assets/styles.css`：主站全部视觉与响应式规则；新增组件优先沿用已有 CSS 变量与类命名。

#### 3.2 画布职责

各补丁的内部实现机制写在自己文件头部注释里，本节只留职责、必须知道的坑与边界。

- `canvas/index.html`：加载桥接脚本、各组补丁、画布 bundle、React 根节点与启动遮罩；遮罩只在根节点产生内容后消失，12 秒未加载显示诊断提示。启动脚本前校验地址 `v` 参数，缺少或过期时自动重定向到当前版本，避免旧标签页继续跑缓存里的旧补丁。
- `canvas/web-bridge.js`：浏览器兼容层，覆盖网络、文件、目录、API 配置 JSON 读写、窗口、诊断与 OSS 请求；**不得把桌面 Node/Electron 能力伪装成成功**。
  - 关键坑：素材落盘后必须返回「显示用绝对路径」（如 `D:\data\workData\漫时光\画布\images\SPR-0010.webp`），不能用 `webdir:` 虚拟标识——压缩 bundle 只识别 `file://` 与「盘符:\」两种本地路径，其余字符串被原样写进 `<img src>`，表现为上传后只剩文件名。桥接层用 `bridge:mediaPaths` 把该路径映射回目录 handle，并在 `getLocalMediaFileUrl`、`readLocalMediaDataUrl`、`sourceToBlob`、multipart 与 `window.fetch` 上按映射解析，对历史 `webdir:` 路径另有 `src` setter 兜底转换（带 blob 缓存）。真实读写仍以 File System Access handle 为准，路径文本只是键。
  - 落盘统一走 `writeOrReuseFile`：同名且字节一致直接复用原文件，避免从资产目录自身重复上传时不断产生 `-2` / `-3` 副本。
- `canvas/storage-migration.js`：无依赖的一次性迁移脚本，在桥接层之后同步执行，清除已下线功能留在浏览器里的种子与元数据。当前负责「轻语漫剧」（键前缀 `manshiguang:canvas-qingyu`、IndexedDB `manshiguang-canvas-qingyu`、8 个 `ms-qy-preset-*` 内置文本预设），用户自建预设与 API Profile 一律保留。
  - 关键坑：原生 bundle 会把预设读进内存并在状态变化时整体回写，只删 IndexedDB 会让残留复活，因此脚本按 `[600, 1400, 2600, 4200]` 毫秒多轮清理，连续两轮确认无残留才写完成标记，确认清掉过数据才重载一次画布（`sessionStorage` 计数封顶 3 次防循环）。过程写入 `window.__MS_STORAGE_MIGRATION__` 便于自测。未来再下线功能，把键名/库名追加进本文件常量列表，细节记 `docs/history.md`。
- `canvas/branding-patch.js`：用 `MutationObserver` 把标题栏产品名与 Logo 替代文本统一为「画布」，Logo 图切到 `../assets/favicon-32x32.png` 并带版本参数；替换设置侧栏作者信息（`大桶子ai` → `阿亮啊`、`wmxwz1` → `liangliang_0314`、`hub.datong-ai.cn` → `https://github.com/xinxin620`）；收款码切到带日期的唯一文件名并追加版本参数以避开旧 URL 缓存。补丁必须独立于 bundle；更新二维码或升级画布后同步提升脚本/图片版本并重核选择器。
- `canvas/api-profiles-patch.js`：管理内置云雾 + 任意多个第三方 API 配置，同一时间只有一个启用。
  - 设置弹窗侧栏项与分区标题在显示层把「API 来源设置」改为「图片API来源设置」，原文本保留为常量 `NATIVE_API_SECTION_TITLE`，由 `queueRender` 里的 `renameApiSectionTitle()` 完成，不手改 bundle。
  - 每张卡保留「申请」，右侧「启用/已启用」；切换时同步到画布原有 `canvas-api-settings`、`state.vendorConfigs.yunwu` 与云雾输入框。第三方 Profile 会自动拉模型并支持勾选（首次或接口地址变化默认勾全部图片模型，同源刷新保留既有勾选）；用户随便粘贴的完整接口地址会统一归一化到根地址。
  - 「常规设置 → API 配置存储」固定为应用数据目录 `C:\Users\liliang\msg`，不再提供浏览器存储切换，旧状态自动迁移；首次保存/恢复会打开一次目录选择器，之后读写明文 JSON `manshiguang-api-config.json`（Key/Base URL/勾选变化自动续写；读取只更新浏览器状态，不回写源文件）。保存/恢复必须显示操作中、成功或失败与最近时间，完成后按钮恢复可用，错误提示自动滚动到可见位置。
  - 坑：浏览器只返回文件夹名，不能伪造 Windows 绝对路径；授权目录名为 `images` 时按用户确认固定标注真实路径，该文本不参与读写。资产目录与 API 配置目录用各自独立 token；原生「打开目录」在显示层叫「查看目录」，由桥接层列出内容，不伪装成已打开资源管理器。
- `canvas/comfy-patch.js`：在设置侧栏「图片API来源设置」之后追加独立「ComfyUI设置」tab，含「本地 ComfyUI」与「云端 ComfyUI」两张卡，同一时间只启用一个。
  - React 每次切 tab 都重建弹窗 body，补丁用 `MutationObserver` 持续校正挂载；进入本 tab 才泥入自己的分区并隐藏原生分区，切回原生 tab 必须完全恢复。
  - 所有请求走 `server.py` 的 `/__comfy/` 转发，云端访问密钥用 `X-MS-Comfy-Key` 请求头传给本地服务再转成 `Authorization: Bearer`，**密钥不写进 URL**。启用卡自动列出 ComfyUI 已保存工作流（搜索/刷新/点击选择），单项读取必须校验 JSON 含 `nodes` 数组才写入 `selectedWorkflow`。
  - 生成执行：选中工作流后先 `analyze()`，通过才 `convert()` 并列出可编辑标量参数（默认只展示常用项）；点「开始生成」提交 `prompt`，随后轮询 `history/<promptId>` 与 `queue`（1.5 秒间隔，最长 30 分钟，「取消等待」只停轮询不中断 ComfyUI）；完成后取 `outputs[*].images`，经 `view` 拉图，复用 `window.__MS_CANVAS_ASSET_HOST__.receiveAsset()` 走与资产插入同一条建节点与落盘路径。
  - 安全边界：本机 ComfyUI 0.43 没有 `validate_only`，`/prompt` 一提交即真实执行，**只有用户显式点「开始生成」才发任务**；`analyze()` 判定含子图、前端虚拟节点或旧版未命名 widget 的工作流不可安全转换，显示中文原因并禁用提交，绝不假装成功。
- `canvas/comfy-workflow.js`：无 DOM 依赖的工作流「编辑格式 → API 格式」转换器，同时挂 `window.__MS_COMFY_WORKFLOW__` 并可被 Node 直接 `require` 做回归测试；`analyze()` 返回 `{ok, blockers}`；提供 `convert()` / `editableFields()` / `applyEdits()` / `collectOutputs()`。
  - 踩过的方向性坑：连线穿透时 Reroute 要往**上游**追，旁路节点要按**与被请求槽位相同的连线类型**匹配，方向错了整条连线会丢。
  - 回归基准：已用本机 ComfyUI 官方前端 `graphToPrompt` 导出的 23 份标准答案逐字段对账（12 份完全一致、10 份正确判为不可转换、1 份差异源于实例缺自定义节点）；对账脚本在 `_scratch/`，不属仓库内容。
- `canvas/model-patch.js`：启用非内置云雾时，只把当前 Profile 的 `selectedModels` 注入图片节点模型下拉；无勾选显示明确空状态，不回退内置清单。取消勾选或切回云雾时清理失效选择并恢复原生文案。请求侧劫持 `window.fetch`，把 OpenAI/Gemini 风格的图片请求统一改写成第三方的 `${base}/v1/api/generate`（nano-banana 发 `aspectRatio + imageSize`，gpt-image 发像素尺寸与 `quality`，参考图统一进 `images`），异步任务用 `v1/api/result?id=` 轮询后回填成 OpenAI 风格 `{ data: [{ url }] }`；未勾选或缺 Key 直接返回中文错误。
- `canvas/gallery-patch.js`：画布内资产集成层，也是**所有来源插入图片节点的唯一入口**。三件事：把侧栏「姿势库/服装库/人像库」改为画布右侧滑出 iframe 抽屉（Ctrl/中键仍开新标签）；接收抽屉或独立标签页发来的选中资产写入合成台；维护合成台面板与角标。
  - 只有抽屉（嵌入）路径会自动新建 Image Asset 节点——复用侧栏隐藏 `input[type="file"]` 并派发 `change`，与手动「+ → 上传」同一条建节点与落盘流程；独立标签页的 `BroadcastChannel` 路径只进合成台列表。抽屉与合成台面板同侧互斥，`Esc` 关抽屉。去重只作用于合成台列表。
  - 历史教训：不要在这里再写自定义 drop handler，与画布原生 handler 同时触发会「拖一次出两张图」。
- `canvas/video-node-patch.js`：把被裁掉的「视频」入口补回侧栏「+」与右键「添加节点」两处菜单。bundle 内部视频能力是完整的（`category: "video"` 会渲染成 `.canvas-node--video`，落盘、历史、序列化都在），只是原生 `addNode` / `addConnectedNode` 对 `video`/`audio` 直接 `return`，菜单数组里也没有它。
  - 关键坑：菜单容器是竖向 flex，只能追加到末尾再用 CSS `order` 排序，不可在 React 自己维护的子节点之间插 DOM；插入位置按文本定位而不硬编码索引，并用 `data-ms-video-item` 防重复注入。
  - 建节点不能走原生 `addNode`，也不能改隐藏 file input 的 `accept`（原生 `addAssetFiles` 只收图片）：走的是从 React fiber 取出私有 zustand store、再用「导入工作流」同款 `replaceCanvasState` 追加节点。取不到 store 只报中文提示，绝不假装成功。取 store 与默认字段的具体写法见该文件头部注释。
  - 边界：当前这份 bundle 的视频模型注册表为空，视频节点能建、能显示、能连线、能随工作流保存，但点运行会本地失败提示 `Video model config is missing`，实测零网络请求、不误扣额度；后续整体替换为含视频模型的 bundle 后本补丁无需改动。
- `canvas/assets/index-*.js` 与 `index-*.css`：外部已打包产物，默认只读。升级画布时整体替换 bundle 并重核桥接契约，不要局部改压缩代码。

#### 3.3 资产参考库职责

- `gallery/index.html` 与 `gallery/assets/gallery.css`：三库 tab、筛选区、结果网格、详情弹层、来源说明与安全模式确认入口及其全部视觉与断点规则；不依赖构建产物，新增样式沿用现有 CSS 变量与 `asset-*` 命名，不复制主站整页样式。
- `gallery/assets/gallery.js`：`DATA_FILES` 列出三库索引（服装合并 `costume-zh`、`costume-shisei-zh`、`costume-gia-anime-zh`、`costume-anime-zh`）；`state` 保存当前库、搜索、筛选、安全模式、分页、姿势显示模式与详情状态；`loadLibrary()` / `loadLibraryFiles()` 读 `local-assets/data/*.json`，单文件失败保留其余库并报错，嵌入模式只加载当前 tab 索引、`loadingLibraries` 计数防并发重复请求；`HOST` / `SIZE_STORAGE_KEY` 按宿主选尺寸档位键（见 4.2）；`renderFilters()` / `renderGrid()` / `updateDialog()` 是渲染入口；`setupEvents()` 统一绑定；`assetPath()` / `poseDepthPath()` 把相对资源映射到只读代理，页面代码里不写本地绝对路径。
- 宿主相关的显隐规则只写在 `gallery/assets/gallery.css`，靠 `gallery.js` 追加的宿主类名生效，不改动画布 bundle。
- 外部数据目录 `ai-pose-gallery-zh-main` 是原始来源，默认只读，不得在 `msg` 内修改；为绕开跨域与大 JSON 读取限制，资产已复制到 `gallery/local-assets/` 供本地直读，该目录必须保持在 `.gitignore` 中。

#### 3.4 AI 创作工作台职责

- `studio/index.html`：只有静态骨架（`#railList`、`#stageFrame`、顶部工具条、`#assetDirChip`、`#soonTemplate`）与版本守卫；缺 `v` 或过期时自动重定向，避免旧标签页跑旧脚本。
- `studio/assets/studio.js`：
  - `WORKSPACES` 是工作区唯一注册表，新增工作区只改这张表：`type: "frame"` 指向真实页面（可带 `tabs` 顶部分段控制器），`type: "soon"` 只给 `purpose`/`inputs`/`outputs`/`relation` 渲染成规划说明，不做假功能。
  - `ensureFrame()` / `activate()`：每个 frame 工作区只创建一次 iframe，切走隐藏不销毁，切回保留工作流状态与已加载索引，只有「重载」强制重新载入；当前工作区写 `localStorage["manshiguang:studio"]`，并用 hash（`#canvas`、`#assets`）支持深链。
  - `authorizeFromShell()`：**目录授权必须在顶层窗口完成**——顶层点击一定是真实用户手势，结果按桥接层既有格式写进同源 IndexedDB 的 `directoryHandles`，iframe 里的画布直接复用，绕开 iframe 用户激活不稳定导致「点了没反应」。
  - `notifyDirectoryChanged()`：重新授权后向所有已加载 iframe `postMessage` 并用 `BroadcastChannel` 通知独立标签页的画布，让桥接层丢弃内存里的旧 handle 缓存。
  - `refreshDirChip()`：只做「是否已授权 + 目录名」的只读回显，从不覆盖已有授权。
- 工作台不做的事：不代理画布的 API 配置存储、不复制资产索引、不重新实现节点工作流；它只是外壳与路由，实际能力全在 `canvas/`、`gallery/` 与 `server.py`。
### 4. 核心模块、实体与接口

#### 4.1 主站核心实体

- **番剧对象**：`id`、`title`、`en`、`kanji`、`theme`、`genres`、`year`、`score`、`episodes`、`status`、`badge`、`studio`、`synopsis`、`day`、`time`、`trend`、`rank`。
- **收藏集合**：追番 ID 的 `Set`，持久化到 `localStorage["manshiguang:favorites"]`。
- **搜索/筛选状态**：关键词、分类、移动菜单、详情与目标番剧全部是页面内本地状态，无后端。
- **主站导航外链**：桌面 `.desktop-nav` 与移动 `.mobile-menu` 各两条，文案与链接一致——「AI 创作工作台」→ `studio/index.html`、「资产」→ `gallery/index.html`，均 `target="_blank"` + `rel="noopener"`；主站不再直链 `canvas/index.html`。

#### 4.2 画布核心实体、接口与存储键位

- **Workflow**：节点、边、分组、名称与参数；可导入/导出 `.json` / `.dtworkflow`。
- **Node**：图片、视频、音频、文本、AI 生成等；结果保留文件名、媒体 URL、本地路径与生成参数。视频节点见 3.2 `video-node-patch.js`。
- **API Profile**：`id`、`name`、`apiKey`、`baseUrl`、`applyUrl`、`builtin`，第三方另有 `modelCatalog`、`selectedModels`、`modelsFetchedAt`、`modelsError`、`modelsBaseUrl`；内置云雾 ID 固定 `yunwu`，第三方 ID 新增时生成。云雾用画布原生模型，不参与第三方勾选。
- **ComfyUI 连接配置**：`version`、`activeId`、`profiles`（固定 `local` 与 `cloud` 两项，各含 `name`、`baseUrl`、`apiKey` 与可选 `selectedWorkflow`：`path`/`name`/`size`/`modified`/`nodeCount`/`fetchedAt`/`baseUrl`）。`activeId` 同时只能指向一个；地址变化时该配置的工作流选择立即失效。
- **ComfyUI 提交契约**：提交体 `{ prompt: {"<节点id>": {class_type, inputs}} }`，节点 id 用编辑格式的原始数字 id 字符串；连线值是 `[上游节点id, 输出槽]` 二元组。完成判定：`history/<promptId>` 命中即结束（`status_str === "error"` 为失败，错误文本取 `messages` 里的 `exception_message`），否则看是否出现在 `queue_running` / `queue_pending`。结果图在 `outputs[*].images[]`，用 `view?filename&type&subfolder` 取回。
- **ComfyUI 代理接口**：`GET` / `POST /__comfy/<path>?base=<encoded-url>`，默认转发到 `base` 后拼接 `<path>`；只允许本机 http 或任意 https，拒绝远程 http 与越界路径，仅接受本机客户端；可选 `X-MS-Comfy-Key` 转成上游 `Authorization: Bearer`。转发时保留路径原始百分号编码，只对解码副本做越界/反斜杠/控制字符检查，以保证 `userdata/workflows%2F<file>` 单文件路由可用。
- **本地 API 配置文件**：固定名 `manshiguang-api-config.json`；外层 `version`、`kind: "manshiguang-api-config"`、`savedAt`、`state`，`state` 即 `manshiguang:canvas-api-profiles` 的完整结构。**文件明文含 API Key。**
- **素材路径映射**：`bridge:mediaPaths` 保存 `{ path, token, segments, savedAt }` 列表，`path` 为显示用 Windows 绝对路径，最多 1200 条。`saveMediaAsset`、`exportMediaFile`、`saveGeneratedTextAsset` 与媒体下载拦截统一返回该 `path`，原 `webdir:` 标识留在附加字段 `virtualPath`。映射缺失必须抛中文错误并提示重新选择目录/重新上传，不得静默回退。
- **兼容 API**：`window.electronAPI` 共 29 项 = 与原 Electron preload 对齐的 26 项 + 本项目 3 项 API 配置存储扩展。
  - 窗口：`windowControl`、`getWindowState`、`onWindowStateChanged`、`openExternalUrl`
  - 诊断/路径：`getUserDataPath`、`appendDiagnosticLog`、`getDiagnosticLogPath`、`getDefaultAssetsPath`
  - 文件/目录：`pickDirectory`、`pickApiConfigDirectory`、`openFolder`、`saveTextFile`、`saveApiConfigFile`、`readApiConfigFile`、`openTextFile`、`saveGeneratedTextAsset`、`saveMediaAsset`、`exportMediaFile`、`readLocalMediaDataUrl`、`getLocalMediaFileUrl`
  - 网络/上传：`httpRequest`、`fetchRemoteImageDataUrl`、`yunwuImageEditRequest`、`uploadImageRequest`、`multipartRequest`、`writeTempUploadFile`、`uploadSignedUrl`、`uploadOssObject`
  - 原桌面媒体能力：`clipVideo`
- **存储与键位总表**（唯一权威列表，其他地方只引用不复制）：

| 键 / 库 | 位置 | 用途 |
| --- | --- | --- |
| `manshiguang:favorites` | localStorage | 主站追番收藏 |
| `manshiguang:canvas-api-profiles` | localStorage | 全部 API Profile 与 `activeId`；启用项再同步到原有 `canvas-api-settings` |
| `manshiguang:canvas-api-storage` | localStorage | API 配置存储的位置元数据（`version`/`mode`/`directoryToken`/`directoryName`/`lastSavedAt`/`lastRestoredAt`，时间 ISO 8601） |
| `manshiguang:canvas-comfyui` | localStorage | ComfyUI 本地/云端配置与 `activeId`；启用项发布到 `window.__MS_COMFY__`，变更时派发 `manshiguang:comfy-changed` |
| `manshiguang:canvas-model-choice` | localStorage | 用户为 `banana` / `gpt` 两族选定的模型 |
| `manshiguang:gallery:size`（`:studio` / `:canvas` / `:embed`） | localStorage | 资产尺寸档位，按宿主分键互不影响；分键后首次加载各继承一次旧全局档位（`<键>:inherited` 标记） |
| `manshiguang:studio` | localStorage | 工作台当前工作区（`workspace`）与资产库页签（`assetTab`） |
| `manshiguang:storage-migrated-at` | localStorage | 残留迁移完成标记 |
| `manshiguang-canvas-bridge` / `directoryHandles` | IndexedDB | 目录 handle；默认键 `bridge:default`，token 形如 `webdir:<uuid>:<encoded-name>` |
| 同库 `bridge:mediaPaths` | IndexedDB | 显示用绝对路径 → token + 相对片段 映射 |
| `C:\Users\liliang\msg\manshiguang-api-config.json` | 本地文件 | API 配置明文备份 |

  素材目录与 API 配置目录使用各自独立 token，API 配置目录不会成为素材默认目录；目录 handle 首次使用需用户在浏览器目录选择器里授权一次。
- **存储与接口边界**：没有应用级数据库表；浏览器存储不是服务端数据源。对外能力由页面 DOM 交互与 `window.electronAPI` 兼容层组成。

#### 4.3 资产参考库实体与接口

- **姿势条目**：`id`、`体系`、`姿势编号`、`分类`、`姿势名称`、`角度`、`缩略图`、`原图`、`检索`；安全模式默认隐藏体系 `全身单人・性感系` 与 `双人缠绵`。
- **服装条目**：`id`、`source`、`一级分类`、`分类`、`服装名称`、`标签`、`关键词`、`缩略图`、`预览图`、`原图`、`检索`，部分含 `views`、`selectedView`、`来源`、`来源地址`、`敏感`；默认隐藏分类 `内衣・睡衣`、`性感穿搭` 与 `敏感: true`。
- **人像条目**：`id`、`分区`、`发长`、`发型名称`、`标题`、`宽`、`高`、`精选`、`热门`、`缩略图`、`原图`、`检索`。
- **搜索与筛选状态**：当前库、关键词、主/次分类、标签、视角、发长、热门/精选与首屏数量，全为页面内状态。安全模式默认 `true`，关闭前必须 18+ 确认，切换会重置筛选与分页。详情支持上一张/下一张、`←` / `→`、`Esc`；姿势可切白模/深度图，服装可切多视角。
- **宿主内嵌契约**：抽屉与图片工坊都通过 `gallery/index.html?v=<版本>&embed=1&host=<canvas|studio>&tab=<库>` 加载。`host` 决定尺寸档位用哪个键（见 4.2 表）；缺 `host` 但带 `embed=1` 的旧链接回退 `:size:embed` 独立档位，绝不与 `studio`/`canvas` 混用。
  - iframe → 宿主：`{ source: "manshiguang-asset-embed", type: "asset-select", asset }`、`{ ..., type: "close-drawer" }`；宿主 → iframe：`{ source: "manshiguang-asset-host", type: "switch-tab", tab }`。所有消息都校验 `event.origin === window.location.origin`。独立标签页仍用 `BroadcastChannel("manshiguang:asset-transfer")`。
  - 嵌入模式下 `boot()` 把 `is-embed-host-<HOST>` 追加到 `body`，供宿主差异化样式；卡片右上角 `.asset-card__send`（「发送到画布合成台」）只在 `body.is-embed-host-studio` 下 `display: none`，画布抽屉、独立资产页与只带 `embed=1` 的旧链接一律保留。工作台内仍可用详情弹层的 `#dialogSend` 送进画布，该入口不受影响。规则只写在 `gallery/assets/gallery.css`，不改动画布 bundle。
- **只读资产接口**：`GET /__gallery_asset/data/*.json`、`/thumbs/*`、`/img/*`；根目录白名单 `data`、`thumbs`、`img`，扩展名白名单 JSON/JPG/JPEG/PNG/WebP/GIF/AVIF；拒绝绝对路径、反斜杠、NUL、`.`/`..`、越界路径与其他根目录。外部数据目录默认 `D:\data\workData\codex\Projects\ai-pose-gallery-zh-main`，可用 `MSG_GALLERY_DIR` 覆盖。
- **远程图片**：CharaDB 与「ギア・动漫」索引部分图片是远程站点 URL，页面不代理不缓存，可用性取决于来源站点与当前网络。

#### 4.4 AI 创作工作台实体与接口

- **Workspace**：`id`、`label`、`tagline`、`kicker`、`icon`、`type`、`state`；`frame` 另有 `url`/`tabs`，`soon` 另有 `purpose`/`inputs`/`outputs`/`relation`。当前固定六项：`canvas`（在线）、`assets`（在线，界面名「图片工坊」）、`story`、`imagelab`、`human`、`tasks`（后四项规划中）。
- **共享目录授权**：工作台与画布桥接层共用 4.2 表里的 IndexedDB 库与 object store，同源 iframe 与顶层窗口共享同一份记录，因此工作台授权一次画布 iframe 立即可用。
- **工作台 → 画布消息**：`{ source: "manshiguang-studio", type: "directory-changed" }`，同时走 `postMessage`（同源 iframe）与 `BroadcastChannel("manshiguang-canvas-bridge")`（独立标签页）；桥接层收到后清空目录 handle 内存缓存，下次读写重新从 IndexedDB 取值。
- **图片工坊 → 画布插入链路**：`asset-select` 由工作台 `deliverToCanvas()` 转交画布 iframe 的 `window.__MS_CANVAS_ASSET_HOST__.receiveAsset(asset)`（由 `canvas/gallery-patch.js` 提供），成功接收后自动切回画布；画布补丁未就绪时先切过去并延迟重试一次，仍失败就在舞台区显示中文提示，绝不静默成功。最终走 3.2 描述的同一条隐藏 `input[type="file"]` + `change` 流程。
- 所有跨 frame 消息都必须校验 `event.origin === window.location.origin`；非同源宿主只能退回整页重新赋值 `src`。

### 5. 构建、启动与测试

#### 5.1 构建与启动

本项目无需安装和构建，主站与画布都没有 build 命令。推荐用项目自带的本地服务器：

```powershell
python server.py 4173
```

`start.bat` 已切换到 `server.py`。服务只监听 `127.0.0.1`，除静态文件外提供 `GET /__health`、`POST /__open_folder`、资产只读代理 `/__gallery_asset/` 与 ComfyUI 转发代理 `/__comfy/`（契约见 4.2）。`/__open_folder` 只接受本机同源请求、JSON 与 `X-Manshiguang-Action: open-folder` 请求头，且只允许打开 `D:\data\workData\漫时光\画布\images` 与 `C:\Users\liliang\msg` 两个固定目录；测试可用 `MSG_OPEN_FOLDER_DRY_RUN=1` 验证接口而不真弹资源管理器。若改用 `python -m http.server`，画布仍可运行，但「打开目录」退化为页面内文件列表，资产页也无法读取外部索引与图片。

访问入口：

- `http://127.0.0.1:4173/`：漫时光主站
- `http://127.0.0.1:4173/studio/index.html`：AI 创作工作台（主站导航入口指向这里）
- `http://127.0.0.1:4173/canvas/index.html`：画布
- `http://127.0.0.1:4173/gallery/index.html`：资产参考库

直接双击 `index.html` 可预览主站基础界面，但 File System Access、Web Crypto、IndexedDB 持久化与跨标签页行为在 `file://` 下可能受限，涉及画布保存/网络功能必须用本地 HTTP 地址。

#### 5.2 静态检查

```powershell
node --check assets/app.js
node --check canvas/web-bridge.js
node --check canvas/branding-patch.js
node --check canvas/api-profiles-patch.js
node --check canvas/comfy-patch.js
node --check canvas/comfy-workflow.js
node --check canvas/model-patch.js
node --check canvas/gallery-patch.js
node --check canvas/video-node-patch.js
node --check canvas/storage-migration.js
node --check studio/assets/studio.js
node --check gallery/assets/gallery.js
python -m py_compile server.py
git diff --check
```

还可检查页面资源是否可访问：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/studio/index.html
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/gallery/index.html
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4173/canvas/index.html
```

`node --check` 只保证语法，不保证同名函数没被覆盖（见 `MEMORY.md`），改完仍要确认「实际生效的是哪一个」。

#### 5.3 浏览器验收（通用项）

每次改动画布/资产/工作台都要跑的最小集：

1. 主站导航「社区」右侧出现「AI 创作工作台」和「资产」，桌面与移动菜单文案、链接一致，均指向 `studio/index.html` 与 `gallery/index.html`，主站不直链 `canvas/index.html`；导航在 1440/1280/1100/1000px 下都无横向滚动。
2. 工作台在新标签页打开而不是替换主站；默认落在上次使用或 hash 指定的工作区；左侧栏六项中前两项在线、后四项为规划说明，不提供假按钮。
3. 画布 React 根节点完成渲染、`#canvasBoot` 消失；浏览器控制台无未处理异常；`window.electronAPI` 存在且方法数量与桥接层一致。
4. 设置弹窗四个侧栏项依次为「常规设置 / 快捷键设置 / 图片API来源设置 / ComfyUI设置」，各 tab 来回切换后原生分区与注入分区都能正确恢复，不残留对方的控件与 footer 文案。
5. 涉及目录授权/上传/下载的操作，必须实测「节点直接显示媒体内容」而不是只显示文件名，且资产目录里不产生 `-2` / `-3` 副本。
6. 同一条能力在工作台 iframe、画布独立标签页、独立资产页三种宿主下分别验证，档位/抽屉/角标互不影响。
7. 改过前端就确认版本号守卫已生效：旧标签页会被重定向，`?v=` 与各文件实际引用一致。

**逐条历史验收项全量清单见 `docs/acceptance.md`**，新增针对具体行为的回归项写在那里，不要回写本节。

只报告实际完成的检查。AI 服务商、OSS、CORS、上传和 FFmpeg 若没有真实环境和凭证，不得标记为已验证。

### 6. 编码规范、命名与异常处理

- **语言**：面向用户的文案、提示、文档默认简体中文；代码标识符用英文。
- **零依赖原则**：主站保持纯静态 HTML/CSS/JS，不引入 React、Vite、Node 后端或包管理器。
- **分层约定**：`studio/assets/studio.js` 只是外壳与路由，新能力一律落在 `canvas/`、`gallery/` 自己的补丁里，不在工作台重复实现。
- **脚本风格**：沿用 IIFE、`const`/`let`、显式命名函数与 `data-*` 事件钩子，不要无故把主站改成 ESM。
- **DOM 约定**：查询集中在 `$` / `$$`；事件绑定集中在 `setupEvents()`；动态列表由渲染函数生成，不在多处复制数据。给 React 维护的容器加 DOM 时，只追加再用 CSS `order` 排序，且必须可重入（属性标记防重复注入）。
- **命名**：主站 CSS 倾向 kebab-case/组件语义类；JS 用 camelCase；持久化键名沿用 `manshiguang:*` 前缀；画布 bundle 内的类名不可改。
- **无障碍**：保留 `aria-*`、键盘焦点、`Escape` 关闭、`skip-link` 与可见焦点；新增按钮使用正确元素或明确 `type`。
- **异常处理**：兼容桥接的普通拒绝使用 `throw new Error(中文说明)`，不得静默成功；网络错误保留 URL、方法、状态与 CORS 提示；宿主页在根节点未渲染时显示可诊断的启动失败信息。
- **能力边界**：浏览器无法访问的绝对路径、系统文件管理器、FFmpeg、原生窗口必须明确报错或写明降级，不能用假数据掩盖。
- **安全**：API Key 同时保存在当前浏览器与应用数据目录的明文 JSON 中，只能放在本人可控的私有目录；不要把密钥、上传凭证、用户选择的绝对路径或生成的配置文件写进仓库、日志或提交。
- **生成文件**：`canvas/assets/index-*.js`、`index-*.css` 是外部产物，不手改；需要升级时整体替换并复测桥接契约。
- **资产页**：继续用原生 HTML/CSS/JS 与 IIFE；页面资源统一走 `local-assets/` 相对路径，外部目录绝对路径不得硬编码为可直接访问的静态路径；`gallery/local-assets/` 必须保持在 `.gitignore` 中。
- **临时脚本**：会话中的一次性补丁写入器、headless 自测与截图脚本统一放仓库根目录 `_scratch/`，该目录必须保持在 `.gitignore` 中，不得被 `canvas/`、`gallery/`、`studio/` 的正式代码引用。
- **文档写法**：改代码时同步更新文档，但按开头的「防膨胀约定」落位——结论进本文件，流水账进 `docs/history.md`，回归项进 `docs/acceptance.md`。

### 7. 已知约束与注意事项

#### 7.1 浏览器能力边界

- **CORS**：AI 服务商、上传服务和部分 OSS 端点可能拒绝浏览器跨域请求。`httpRequest` 会保留目标 URL、方法、状态与 CORS 提示，但不能绕过服务端 CORS。
- **自定义代理**：原桌面版可用 Node/undici 走代理；普通浏览器桥接层不能接管系统代理，设置页的代理配置不会改变浏览器网络栈。
- **本地绝对路径**：浏览器不能读任意 Windows 路径，必须通过画布文件上传或在 Chromium 中选择素材目录；显示用路径与映射机制见 3.2。
- **系统文件管理器**：浏览器本身打不开 Windows 资源管理器。「查看目录」由 `server.py` 提供受本机同源保护、仅限固定目录白名单的接口实现，结果用 `manshiguang:directory-opened` 自定义事件回传给补丁，不伪装成已打开资源管理器。
- **FFmpeg 视频剪辑**：`clipVideo()` 在网页版明确失败，没有原桌面版的 FFmpeg 执行能力。
- **窗口控制**：最大化用 Fullscreen API 兼容实现，不等价于 Electron 原生无边框窗口；`window.close()` 也可能受浏览器窗口策略限制。
- **文件保存**：生成媒体、节点导出与媒体下载优先用 File System Access API 写入已授权素材目录；不支持、未授权或权限失效时才回退浏览器下载。
- **同名素材去重**：`writeOrReuseFile` 先按字节比较目标同名文件，完全一致才复用原名，内容确实不同才追加 `-2` / `-3`。
- **目录选择器时机**：`showDirectoryPicker()` 必须在点击处理函数的首个 `await` 之前调用，否则丢失用户激活、Windows 窗口可能不出现；iframe 内授权不可靠，必须在顶层窗口做（见 3.4）。
- **目录回显**：授权成功返回的 `webdir:<uuid>:<encoded-name>` 是 IndexedDB 中目录 handle 的键，不是 Windows 路径。
- **新标签页**：工作台与资产页用原生 `target="_blank"` 打开；浏览器或扩展可能拦截，主站不强制窗口尺寸也不复用命名窗口。画布仍可独立打开，用于需要完整窗口尺寸的场景。
- **资产参考库**：必须通过 `start.bat` / `server.py` 访问项目外索引，普通静态服务器无法读取外部目录；远程图片不经本地代理（见 4.3）。
- **工作台 iframe**：画布与资产库都跑在 iframe 里，受同源限制；handle 不可序列化跨窗口传递，只能靠共享 IndexedDB + 变更通知。

#### 7.2 长期维护事实

- 画布资源从「简单画布 Setup 0.0.1.exe」解包（原包名 `canvas-app`，原包版本 `0.0.5`）；`canvas/assets`、品牌图和图标与解包后的 `dist` 逐文件 SHA-256 一致，收款码两个文件是有意替换的例外。本次集成未运行原始安装器或 `SimpleCanvas.exe`，只使用静态解包资源。
- 品牌与多配置都在浏览器运行时替换，原始压缩 bundle 内仍保留旧文本与原始 vendor 卡片——这是有意的只读边界，不要为了替换而改 bundle。
- `canvas/model-patch.js` 依赖「bundle 内部只有 yunwu 一个 vendor」这一事实，所以第三方不是新增 vendor，而是「Base URL 指向第三方 + 拦截改写请求」。整体替换 bundle 后必须重新核对该前提。
- 若后续恢复/升级画布 bundle，必须重新核对：资源路径、React 根节点、`window.electronAPI` 方法、IndexedDB 记录格式、保存/下载路径、启动遮罩行为，以及各补丁依赖的 DOM 类名与内部数组。
- 主站仍是演示原型：番剧、用户、社区内容均为原创虚构数据；没有视频播放器、登录、服务端收藏或真实社区接口。
- 「轻语漫剧」已彻底下线，残留数据由 `canvas/storage-migration.js` 自动清理，清理细节与相关版本记录在 `docs/history.md`；未来再下线功能照这条约定办。
- **逐版本修复记录与历史流水账见 `docs/history.md`，不要写回本节。**
- 若引入后端或真实第三方接口，必须同步更新本文件第 2、4、5、7 节的技术栈、接口、数据表和验证方式。