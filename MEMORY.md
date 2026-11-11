# msg 项目记忆

## 项目定位

- 本项目是一个**动漫网站项目**。
- 项目的设计、开发和内容规划应围绕动漫网站这一方向展开。
- 品牌名已确认为 **漫时光 / MANSHIGUANG**，面向中文二次元用户。
- 视觉主题为「夜航星海」，强调沉浸、精致和轻赛博，不使用传统模板站、门户式密集布局和廉价霓虹感。

## 当前已确认信息

- 项目根目录：`D:\data\workData\codex\Projects\msg`
- 项目类型：零依赖静态动漫网站原型
- 主站入口：`index.html`
- AI 创作工作台入口：`studio/index.html`（主站导航「AI 创作工作台」指向这里）
- 画布独立入口：`canvas/index.html`（仍可直达，不在主站导航）
- 配色方案：**夜航星海**
- 视觉关键词：沉浸、精致、轻赛博

## 视觉规范

- 深海背景 `#070B18`，次级背景 `#0D1428`，卡片表面 `#141D36`
- 星云紫 `#7C5CFF`，冰蓝青光 `#22D3EE`，月光粉 `#FF6FB5`，星芒金 `#FFD166`
- 主文字 `#F7F8FF`，次要文字 `#99A4C5`
- 标题偏圆润、正文清晰克制，英文与编号使用几何字体增强杂志感
- 动效服务于氛围与层级，不使用高饱和、大面积闪烁和模板化营销组件

## 技术实现

- 零依赖静态前端：`index.html`、`assets/styles.css`、`assets/app.js`
- 可直接双击 `index.html` 运行主站，不依赖构建工具
- 当前番剧数据集中在 `assets/app.js`，全部为原创虚构内容
- 追番状态使用 `localStorage`，键名为 `manshiguang:favorites`
- 主视觉为原创 `assets/hero-art.svg`，卡片封面由 CSS 渐变生成

## 画布集成

- 2026-11-03 画布功能已从原「简单画布」Electron 安装包中静态解包并复制已构建前端资源。
- 2026-11-04 当前产品称呼统一为「画布」：宿主页标题、启动提示、诊断标签、文档和运行时标题栏均由旧「简单画布」改为「画布」；仅保留原安装包文件名作为来源记录。
- 主站导航「社区」右侧新增「画布」，移动菜单同步新增。
- 点击画布使用浏览器原生 `target="_blank"` 在新标签页打开；主站当前标签页保持不变，不强制窗口尺寸或复用命名窗口。
- 画布宿主页：`canvas/index.html`，包含 React 根节点、启动遮罩和加载失败提示。
- 浏览器桥接层：`canvas/web-bridge.js`，以 IIFE 方式暴露 `window.electronAPI`，共 29 个方法：保留原 Electron preload 的 26 个兼容方法，并新增 `pickApiConfigDirectory`、`saveApiConfigFile`、`readApiConfigFile` 三项 API 配置存储扩展。
- 画布 bundle：`canvas/assets/index-BN-uSJKj.js`、`canvas/assets/index-BfAuAU0s.css`，与解包后的 `dist` 文件 SHA-256 一致。
- 设置页品牌补丁：`canvas/branding-patch.js`，通过 `MutationObserver` 将作者信息替换为「抖音/B站/小红书：阿亮啊」「微信：liangliang_0314」「资料主站：https://github.com/xinxin620」；同时把收款码切换为带日期的唯一文件名并追加 `?v=` 参数以避开旧缓存，不修改压缩 bundle。
- 收款码：`canvas/donation-qr-liangliang-20261103.png` 是运行时加载的新卡片（934×1037，中心真人头像、底部「恋心心 (*亮)」）；`canvas/donation-qr.png` 是同内容兼容副本，二者不再与原始 `dist` 一致。
- 2026-11-03 新增 `canvas/api-profiles-patch.js`：在「API 来源设置」（该入口名称自 2026-11-09 起在界面上显示为「图片API来源设置」）中隐藏原始云雾卡片并管理任意多个云雾/第三方 API 配置。每项包含名称、申请地址、API Key、Base URL，每卡保留「申请」并在右侧提供「启用/已启用」；`activeId` 保证同一时间只启用一个。第三方配置的 `modelCatalog` / `selectedModels` / `modelsFetchedAt` / `modelsError` / `modelsBaseUrl` 也存入 `localStorage["manshiguang:canvas-api-profiles"]`；填写或变更 Base URL / Key 后自动拉取，支持拉取全部、全选图片、清空和逐项勾选。启用项同步到 `canvas-api-settings` 与 `state.vendorConfigs.yunwu`，刷新后保持。
- 画布设置和目录授权使用浏览器 `localStorage` 与 IndexedDB；目录 handle 保存到 IndexedDB 数据库 `manshiguang-canvas-bridge` 的 `directoryHandles` object store。
- 2026-11-04 「常规设置 → API 配置存储」卡片固定在「资产存储目录」下方，不再提供浏览器存储切换，只显示应用数据目录 `C:\Users\liliang\msg`（需预先存在）。首次点击「立即保存」或「从本地恢复」会打开一次目录选择器；浏览器不能在未授权时直接写入这个绝对路径。授权后创建或覆盖明文 JSON `manshiguang-api-config.json`，包含当前 API Key、Base URL 和模型勾选；配置变化时自动续写，并提供「从本地恢复」。旧 `browser` 存储记录会迁移为目录模式。位置元数据保存在 `localStorage["manshiguang:canvas-api-storage"]`；API 配置目录使用独立 token，不覆盖素材目录。已验证清理 Profile 后首次保存自动补建默认配置、真实桥接写入/读取、恢复不覆盖源文件、按钮完成后恢复可用、刷新保持目录模式；目录选择窗口用 OPFS 模拟，未实际操作 Windows 授权窗口。
- 2026-11-04 「立即保存」「从本地恢复」点不动的根因已定位并修复：卡片用序列化后的 `innerHTML` 与模板字符串比较，布尔属性（如 `disabled`）和空白会被浏览器规范化，比较永远不相等，卡片因此每秒重绘约 60 次，按钮节点被不断替换。现改为缓存上一次写入的模板（`__msRenderedHtml`）后再比较，并对状态文本做“值有变化才写”的保护，API 来源管理区同步修复；实测 1 秒内多余 DOM 变更从 60 次降为 0 次，通过真实鼠标事件点击保存/恢复均成功。资产目录输入框中的 `webdir:<uuid>:<encoded-name>` 是浏览器目录授权标识，不是 Windows 路径；显示层已改为「文件夹名（浏览器授权目录）」，原标识保留在 `data-ms-raw-path` 和悬停提示中。
- 2026-11-04 资产目录回显与 API 配置目录彻底解耦：选择器返回后主动刷新资产目录显示，不再等到点击「立即保存」才更新；两个目录继续使用独立 token。资产卡的「打开目录」在显示层改为「查看目录」，网页版不打开 Windows 资源管理器，而是通过桥接层读取授权目录顶层内容并显示文件夹/文件面板。已用 OPFS 真实目录句柄验证即时回显、文件清单和保存后资产目录不变；未实际操作 Windows 原生目录选择窗口。
- 2026-11-04 `20261104-22` 补上 API 配置卡的目录名回显：此前 `directoryName` / `directoryMeta` 已计算但未插入模板，保存成功后卡片仍只显示 `C:\Users\liliang\msg`，容易被误解为资产目录被改写。现在「保存位置」显示真实授权文件夹名，说明文字改成「已授权文件夹「xxx」中的 manshiguang-api-config.json」，并新增「已授权文件夹 · 最近保存 · 最近恢复」一行。用真实鼠标事件验证保存、二次保存、从本地恢复三个动作前后，资产目录显示文字与 `data-ms-raw-path` 均未变化。
- 2026-11-04 `20261104-23` 按用户确认，资产目录授权名为 `images` 时在显示层固定标注实际路径 `D:\data\workData\漫时光\画布\images`（资产卡输入框与「查看目录」面板），并在标题提示中保留浏览器授权目录名。该路径只用于展示，读写仍使用 File System Access 句柄；换成其他文件夹名时仍显示原文件夹名。
- 2026-11-04 `20261104-24` 解决「查看目录只列文件、没有打开资源管理器」：新增 `server.py`，`start.bat` 改为启动它。本地接口 `POST /__open_folder` 只监听 `127.0.0.1`，要求本机同源 `Origin`、JSON 和 `X-Manshiguang-Action: open-folder` 头，只允许打开 `D:\data\workData\漫时光\画布\images` 与 `C:\Users\liliang\msg`；`canvas/web-bridge.js` 在授权目录名为 `images` 时调用它，成功提示并在资源管理器中打开，失败则回退页面内文件列表并提示重启服务。`20261104-24` 已同步到画布版本守卫与主站入口。已在 4174 端口用干跑模式验证健康检查、正常请求、非白名单 403、缺少确认头 403；真实浏览器点击和资源管理器弹出尚未验收。
- 2026-11-04 画布标题栏品牌更新：产品名统一为「画布」，Logo 从原橙色 `DT` 更换为 `assets/favicon-32x32.png`（运行时引用 `../assets/favicon-32x32.png?v=20261104-2`）；`canvas/icon.ico` 与 `assets/favicon.ico` 的 SHA-256 一致。
- 选择素材目录后使用 `webdir:<uuid>:<encoded-name>` 虚拟路径；没有目录授权时，保存回退为浏览器下载。
- 2026-11-06 `20261106-14` 修复画布「+ → 上传」后图片不显示（只显示文件名）。根因是 `canvas/web-bridge.js` 返回 `webdir:` 虚拟路径，而压缩 bundle 只识别 `file://` 与「盘符:\\」，其余字符串原样进入 `<img src>`。修复方式：落盘时在 IndexedDB `bridge:mediaPaths` 登记「显示用绝对路径 → 目录 token + 相对片段」，读取侧（`getLocalMediaFileUrl`/`readLocalMediaDataUrl`/`sourceToBlob`/multipart/`window.fetch`）按映射解析回 File System Access handle；`HTMLImageElement`/`HTMLMediaElement` 的 `src` setter 兜底转换历史 `webdir:` 路径并缓存 blob；未授权回退下载改用不会被撤销的持久 `blob:`。映射缺失必须中文报错，不伪装成功。已用 headless Chrome OPFS 目录句柄通过 21 项断言，并用 Playwright 驱动真实上传流程确认 240×160 WebP 正常渲染；未在 Windows 原生授权目录人工验收。
- 2026-11-07 `20261107-2` 按用户反馈把资产库改成画布内嵌抽屉。侧边栏三个库按钮不再 `window.open` 新标签，改为在画布右侧滑出 iframe 抽屉（`gallery/index.html?v=&embed=1&tab=`）；iframe 用 `postMessage`（`source: "manshiguang-asset-embed"`）通知宿主，宿主复用画布侧边栏隐藏的 `input[type="file"]` 派发 `change` 建节点，因此与手动「+ → 上传」共用同一套落盘与显示逻辑。`gallery/assets/gallery.js` 新增 `EMBED`/`is-embed` 紧凑模式（隐藏站点装饰、只加载当前库、`loadLibraryFiles()` 按需补加载并用 `loadingLibraries` 计数防并发）、`notifyParent()`、Esc 转发 `close-drawer`；宿主侧 `applyDrawerTab()` 用 `manshiguang-asset-host`/`switch-tab` 原地切库。抽屉与合成台面板互斥；Ctrl/中键仍开新标签；独立标签页仍走 `BroadcastChannel` 且只进合成台列表不建节点。自测发现并修掉两个自己引入的缺陷：`loadLibrary()` 嵌入分支返回单个 Promise 使 `Promise.all` 抛错（包成数组）、合成台去重把「插入画布」一起挡住（改为去重只作用于列表）。headless Chrome 真实鼠标点击 18 项断言全过，独立资产页布局（五列、含页头主视觉）确认未变。版本守卫与主站/资产页链接升到 `20261107-2`。
- 2026-11-07 `20261107-1` 修复「上传一张照片后资产目录多出一张重复图」。一次上传只调用一次 `saveMediaAsset`，不是重复写入；根因是 `writeUniqueFile` 遇同名一律加 `-2`/`-3` 后缀另存，而用户习惯直接从资产目录本身选图，同名必然存在。新增 `hasIdenticalFile` + `writeOrReuseFile`（先比 size 再逐字节比较，一致则复用原名），`saveMediaAsset`/`exportMediaFile`/`saveGeneratedTextAsset`/媒体下载拦截四个入口全部切换；内容不同仍另存，不覆盖原图。已用 OPFS 通过 8 项去重断言 + Playwright 真实两轮上传（目录始终 1 个文件、2 个节点、解码正常、无报错）。历史 `-2`/`-3` 副本不自动清理。
- 2026-11-07 `20261107-4/5` 新增 `studio/` AI 创作工作台：零依赖静态外壳（`studio/index.html` + `assets/studio.css` + `assets/studio.js`，IIFE、无框架、无构建）。`WORKSPACES` 注册六个工作区，「画布」和「图片工坊」是同源 iframe（切走只隐藏不销毁，保留工作流状态），「剧情导演台 / 设定与出图 / 数字人视频 / 任务与成片」是 `type: "soon"` 规划说明页，只写用途、输入、产出与关系，不放假按钮。当前工作区存 `localStorage["manshiguang:studio"]`，支持 `#canvas`、`#assets` 深链。
- 工作台的资产目录授权必须在顶层窗口完成：`authorizeFromShell()` 用顶层真实用户手势调 `showDirectoryPicker()`，再按桥接层既有格式把 handle 写进同源 IndexedDB `manshiguang-canvas-bridge`/`directoryHandles`（同写 `bridge:default` 与 `webdir:<uuid>:<name>`），iframe 里的画布直接复用，绕开 iframe 内弹不出系统目录选择器的问题。重新授权后 `notifyDirectoryChanged()` 通过 `postMessage` + `BroadcastChannel("manshiguang-canvas-bridge")` 通知，`canvas/web-bridge.js` 收到 `manshiguang-studio / directory-changed` 会清空 `directoryRecords` 内存缓存，否则会继续写旧目录。
- 工作台「图片工坊」→画布插入链路：`20261107-4` 初版只监听 `directory-changed`，图片工坊冒泡的 `asset-select` 停在外壳层，卡片却提示「已插入画布合成台」，属于假成功。`20261107-5` 修复：`canvas/gallery-patch.js` 暴露 `window.__MS_CANVAS_ASSET_HOST__.receiveAsset(asset)`，`studio.js` 的 `deliverToCanvas()` 转发并在成功后切回画布；未就绪时先切过去延迟重试，仍失败就在舞台区显示中文提示。最终仍走画布隐藏 `input[type=file]` + `change` 事件，与手动「+ → 上传」共用同一建节点与落盘路径。
- 教训：同一文件里不要留两个同名函数声明（`studio.js` 曾同时存在走 iframe 授权的旧 `requestDirectory()` 和走顶层授权的新版，函数声明提升使后者覆盖前者，导致授权路径与预期不符且无任何报错）。改动后要用 `node --check` 之外再确认「实际生效的是哪一个」。
- 主站导航：`index.html` 桌面 `.desktop-nav` 与移动 `.mobile-menu` 各两条外链——`studio/index.html` 文案「AI 创作工作台」、`gallery/index.html` 文案「资产」；主站不再直接链到 `canvas/index.html`。已验证 1440/1280/1100/1000px 无横向溢出。
- 2026-11-05 `20261104-25` 起，画布图片/视频/音频节点右上角的下载按钮不再直接触发浏览器下载：`canvas/web-bridge.js` 在捕获阶段拦截 `a[download]` 的 `blob:` / `data:` 媒体链接，写入已授权的资产目录并派发 `manshiguang:download-saved`，页面右下角提示实际保存文件名；无授权或写入失败才回退浏览器下载。资产目录名本身为 `images` / `videos` / `audio` 时直接写入该目录，不再创建同名子目录。已用 headless Chrome + OPFS 真实目录句柄模拟点击验证文件内容完整写入并清理；尚未在用户 Windows 原生授权目录上实际点击验收。
- 网络能力通过浏览器 `fetch` 实现，保留 URL、方法、状态和 CORS 提示；OSS 使用 Web Crypto 做 V1 签名。
- 2026-11-03 新增 canvas/model-patch.js：启用非内置云雾 API 时只读取当前 Profile 的 `selectedModels` 注入图片节点下拉，不再自行拉取、缓存 10 分钟或失败回退内置清单；下拉只高亮当前节点正在使用的模型，单次选择（含 `lastPicked`）写入 localStorage["manshiguang:canvas-model-choice"]，取消勾选或切回云雾时清理失效选择并恢复原生文案。2026-11-04 起 Grsai 请求统一改写为 `POST /v1/api/generate`，兼容 OpenAI 图片接口与 `/v1beta/models/<model>:generateContent`：nano-banana 发送 `aspectRatio + imageSize`，gpt-image 发送像素尺寸与 `quality`，参考图统一转为 `images`，再用 `GET /v1/api/result?id=...` 轮询；未勾选模型或缺少 Key 时返回明确中文错误。canvas/api-profiles-patch.js 会先归一化 Base URL，去掉重复的 /v1、/v1/api/*、/v1/draw/*、/v1/images/* 后缀。

- 2026-11-05 新增 `gallery/` 资产参考库，主站桌面与移动导航在「画布」后增加「资产」，使用新标签页打开。数据来自本机外部目录 `D:\data\workData\codex\Projects\ai-pose-gallery-zh-main`（参考站点 `https://ai-pose-gallery.anhao.app/`），不复制图片或索引到仓库，也不修改外部项目；页面通过 `server.py` 的 `/__gallery_asset/data|thumbs|img/*` 只读代理加载，目录可用 `MSG_GALLERY_DIR` 覆盖。三库合计姿势 `1,439`、服装 `3,224`、人像 `1,499`；安全模式下 `4,769` 条，关闭后 `6,162` 条。安全模式默认隐藏「全身单人・性感系」「双人缠绵」姿势，以及「内衣・睡衣」「性感穿搭」和 `敏感: true` 服装，关闭前有 18+ 确认。已用 headless Chrome 验证三库切换、首屏 60 条与加载更多、中文搜索与重置、Shisei 四视角、深度图切换、详情方向键/`Esc`、安全模式数量与 390px 无横向溢出；代理已验证 JSON/JPG/WebP 正常返回，路径穿越与其他根目录被拒绝。CharaDB 与「ギア・动漫」远程图片的 CORS、防盗链与长期可用性尚未逐一验证；未做人工视觉验收。资产页必须由新版 `server.py`/`start.bat` 提供外部索引，旧 4173 服务需要关闭后重启。
- 2026-11-09 `20261109-1` 按用户要求把资产库「紧凑 / 标准 / 放大」三档拆成三处独立状态。此前工作台图片工坊与画布抽屉都加载同一份 `gallery/index.html?embed=1&tab=`，共用 `localStorage["manshiguang:gallery:size"]`，改一边另一边重载后跟着变。现在宿主 URL 各带 `host=studio` / `host=canvas`，`gallery.js` 按 `HOST` 选键：独立页仍用 `manshiguang:gallery:size`，工作台用 `:size:studio`，画布抽屉用 `:size:canvas`，未知嵌入宿主（只带 `embed=1`）落到 `:size:embed` 第三档，绝不与前两者混用。分键后的首次加载一次性继承旧的全局档位并落盘到本宿主自己的键（`<键>:inherited` 标记），避免两边同时回到默认值。`canvas/gallery-patch.js`、`studio/assets/studio.js` 只改 URL 拼接各一行，尺寸逻辑全部在 `gallery.js` 内。headless Chrome 17 项断言全过：含画布抽屉改紧凑时工作台仍保持原档位、两边重载各保持各的、工作台与画布外壳 iframe 真实 `src` 与真实列数（4/6/8 列）核对。`AGENTS.md` 已同步 2.3 表格、3 目录结构、3.2/3.3 职责、4.3 宿主内嵌契约与新增验收项 18a。
- 2026-11-10 `20261110-5` 参考本机「轻语AI」桌面应用的漫剧创作能力，为 msg 画布新增 `canvas/qingyu-patch.js` 功能复刻层；未复制轻语私有代码或 `sealed:*` 内容。侧栏「轻语漫剧（模板 · 素材 · 分镜）」打开同页右侧抽屉，包含 8 个内置模板、角色/场景/物品素材设定、`@名称` 引用补全和本地分镜表。模板写入原生 IndexedDB `keyval-store/keyval/canvas-text-presets`，首次种子追加缺失项；普通刷新保留用户对内置内容的修改，也尊重用户在原生预设中的删除，只有「恢复内置」强制恢复。若存在用户自建同名不同 ID 预设，恢复内置保留用户项并把内置项改为「官方H3提示词（内置）」，后续冲突递增「（内置2）」。素材元数据存 `manshiguang:canvas-qingyu-assets`，本地图片/音频 Blob 存 IndexedDB `manshiguang-canvas-qingyu/media`，分镜存 `manshiguang:canvas-qingyu-shots`；同类素材同名拦截，删除同时清理媒体。`＠引用` 写入 `@名称 `，尾随空格避免中文紧邻导致名称解析过长；远程图片读取 Blob 后让出一个宏任务再注入隐藏文件输入，走既有 Image Asset 建节点和资产目录落盘链路。当前只复刻 assets/简化 shots，不迁移轻语 tasks、视频状态、生成队列或成片管理。静态检查 `node --check canvas/qingyu-patch.js`、`node --check canvas/gallery-patch.js`、`node --check studio/assets/studio.js`、`python -m py_compile server.py`、`git diff --check` 均通过；浏览器回归确认新上下文创建工作流、8 个模板卡片、首次种子、模板追加、本地图片插入、`@引用`/补全、同名拦截、远程图片真实插入、用户同名预设保护、同会话删除后恢复、刷新后唯一后缀保持且控制台无页面异常。全局版本升到 `20261110-5`，文档入口脚本列表与检查命令已同步。
- 2026-11-11 `20261110-6` 按用户要求移除画布侧栏的「轻语漫剧（模板 · 素材 · 分镜）」入口。`canvas/qingyu-patch.js` 不再注入任何侧栏按钮：删掉 `injectSidebarButton()`、只服务于该按钮的 `toggleDrawer()`、入口匹配常量 `SETTINGS_TITLE`，以及 `init()` 里的 `MutationObserver(injectSidebarButton)` 与直接调用。模板种子、素材设定、`＠引用`、分镜表、`window.__MS_QINGYU__` 全部保留，抽屉仍可用 `window.__MS_QINGYU__.open()` 打开；与资产抽屉/合成台面板的互斥逻辑不变。全局版本统一升到 `20261110-6` 以便浏览器重新取补丁；`AGENTS.md`（宿主表、目录树、3.2 职责、验收项 18c）与 `README.md` 的入口描述同步改为「侧栏不再提供入口」。静态检查 `node --check canvas/qingyu-patch.js`、`node --check canvas/gallery-patch.js`、`node --check studio/assets/studio.js`、`python -m py_compile server.py`、`git diff --check` 均通过；改动为纯删除，未提交、未在浏览器实机复核。
- 2026-11-11 `20261110-7` 按用户要求把「轻语漫剧」功能从 msg 画布彻底移除，不再只是隐藏入口。删除 `canvas/qingyu-patch.js` 整个补丁文件，并从 `canvas/index.html` 去掉对应 script 标签；画布宿主脚本列表回到 web-bridge / branding / api-profiles / comfy-workflow / comfy / model / gallery 七个。`AGENTS.md`（宿主表、目录树、3.2 职责、4.2 轻语模板/素材/分镜三条实体、5.2 检查命令、验收项 18c）与 `README.md`（功能清单、补丁组成、整章「轻语漫剧」、文件树、检查命令）同步删除全部引用。浏览器侧数据一并清理：localStorage 的 manshiguang:canvas-qingyu-seeded、manshiguang:canvas-qingyu-deleted-presets、manshiguang:canvas-qingyu-assets、manshiguang:canvas-qingyu-shots、manshiguang:canvas-qingyu-tab；IndexedDB 整库 manshiguang-canvas-qingyu（素材图片/音频 Blob）；原生 keyval-store/keyval/canvas-text-presets 中只摘掉 msBuiltin: "qingyu" / ms-qy-preset-* 的 8 个内置项，用户自建预设一律保留。全局版本统一升到 20261110-7。教训：写入用户 localStorage / IndexedDB 的种子数据必须在功能下线时一并清理，否则残留模板会继续出现在原生「提示词预设」里。
- 2026-11-11 `20261110-8` 为「轻语漫剧」下线补齐浏览器残留清理通道。上一条只删了代码，用户已经放进 localStorage / IndexedDB 的种子仍在（尤其 8 个 `ms-qy-preset-*` 内置模板会继续出现在原生「提示词预设」里）。新增 `canvas/storage-migration.js`，在 `canvas/index.html` 的 `web-bridge.js` 之后同步加载：按前缀 `manshiguang:canvas-qingyu` 清 localStorage（assets / shots / tab / seeded / deleted-presets），删除 IndexedDB 库 `manshiguang-canvas-qingyu`，并从原生 `keyval-store/keyval/canvas-text-presets` 中只摘 `msBuiltin: "qingyu"` 与 `ms-qy-preset-*` 项，用户自建预设与 `manshiguang:canvas-api-profiles` 全部保留。关键教训：光删 IndexedDB 不够——画布原生 bundle 启动时把预设读进内存、状态变化时整体回写，删掉的 8 个模板会复活；因此脚本按 [600,1400,2600,4200]ms 多轮清理，连续两轮无残留才写完成标记 `manshiguang:storage-migrated-at`，确认清掉过数据时重载一次让原生重新 hydrate，重载用 `sessionStorage` 键 `manshiguang:storage-migration-reloads` 封顶 3 次防循环。全局版本升到 20261110-8。headless Chrome 三条路径（有残留 / 干净环境 / 已迁移复核）实测：8 个模板 + 3 个键 + 媒体库全清、自建预设与 API 配置完好、无「轻语」文字、控制台 0 错误，干净环境不误伤也不重载。

- 2026-11-11 `20261111-1` 在画布「添加节点」补回「视频」入口，位置在「图片」下方。做法：新增 `canvas/video-node-patch.js`，由 `canvas/index.html` 以 `?v=20261111-1` 加载。关键结论（务必别再踩）：(1) 压缩包 `canvas/assets/index-BN-uSJKj.js` 的视频能力是完整的——`category: "video"` 渲染成 `.canvas-node--video`，落盘/历史/连线/工作流序列化都在，只是侧栏数组 `wx` 与右键子菜单 `lw` 被裁掉了视频项；(2) 不能试图用「把侧栏隐藏 `input[type=file]` 的 accept 改成 `video/*` 再派发 change」来建节点，原生 `addAssetFiles` 里有 `if(!o||o!==J.Image)` 直接把非图片丢进失败列表；(3) 原生 `addNode`/`addConnectedNode` 对 `q.Video`、`q.Audio` 一律 `return`，且那个 zustand store 是模块私有变量没挂 window，唯一可用原生入口是从 React fiber 取到 state 后调 `replaceCanvasState`（与「导入工作流」同一条路径），再 `setSelectedNode`；(4) 菜单容器是 `display:flex;flex-direction:column`，所以用「追加到末尾 + CSS order」而不是插中间，避免在 React 子节点之间动 DOM；(5) 右键菜单拿不到 React 的 flowPosition，需要记录 `contextmenu` 坐标并按 `.react-flow` DOMRect + store `viewport` 反算，实测偏差 0 像素；(6) 这份 bundle 的模型注册表 `ym` 只剩文本/图片，视频节点建出来能显示能保存，但运行会本地失败显示 `Video model config is missing`，实测不发任何网络请求，不会误扣额度。全局版本升到 20261111-1。
- 2026-11-09 `20261109-3` 按用户要求隐藏工作台图片工坊卡片右上角的「发送到画布合成台」图标，其它入口全部保留。实现只碰两个文件：`gallery/assets/gallery.js` 的 `boot()` 在嵌入模式追加 `document.body.classList.add("is-embed-host-" + HOST)`；`gallery/assets/gallery.css` 新增 `body.is-embed-host-studio .asset-card__send { display: none; }`。画布抽屉（`host=canvas`）、独立资产页与只带 `embed=1` 的旧链接都不受影响，工作台详情弹层 `#dialogSend` 仍可用。headless Chrome 8 项断言全过（含工作台外壳真实 iframe 内 `display:none` 与画布抽屉 `display:grid/opacity:1` 的对照），截图存 `.preview/studio-send-btn-hidden.png`、`.preview/canvas-drawer-send-kept.png`。版本号全库升到 `20261109-3`；`AGENTS.md` 同步 3.3 职责、4.3 新增「卡片发送按钮可见性」契约与验收项 18b，并顺手删掉了 4.3 宿主内嵌契约里重复粘贴的一模一样的三句话。
- 2026-11-09 `20261109-2` 版本号统一升级，并清掉 `gallery/assets/gallery.js` 里两处逐字节相同的局部 `toAbsoluteUrl` 副本（分别写在 `sendToCanvas()` 与 `buildAssetPayload()` 函数体内，作用域隔离，不会互相覆盖，属重复代码而非 bug）。现提为 `assetPath()` 下方的模块级单一实现，调用点未改。A/B 验证：同一页面分别加载改动前(HEAD)与当前 `gallery.js`，抓取 BroadcastChannel（独立标签页→合成台）与 postMessage（工作台/画布抽屉嵌入）两条链路真实发出的载荷逐字节一致，字段集合、顺序、绝对地址均相同，详情弹层发送分支也一致，共 11 项断言通过；分档回归 17 项仍全过。`AGENTS.md` 同步 `2.3 存储`、`4.3 宿主内嵌契约`、验收项 `18a`。
- 2026-11-09 分档与去重改动以本地为主推送：本地 `737de74` 是远端 `b9b080b` 的 amend 改写版，`git diff b9b080b 737de74` 为空（文件树完全相同），强推不丢内容。GitHub 直连被 `Connection was reset`，按本文件「Git 代理配置」走 `git -c http.proxy=socks5://127.0.0.1:7897 push origin main --force-with-lease`。`canvas/gallery-patch.js` 同时删除了 `setupDropTarget()`（用户 11-08 为修「拖动资产生成双图」所做的未提交改动，随本次一起入库）。
- 2026-11-09 按用户要求把画布设置弹窗侧栏的「API 来源设置」改名为「图片API来源设置」。原文本来自压缩 bundle（`Fw` 中 `id: "api"` 的 label），不得手改，因此改名只在 `canvas/api-profiles-patch.js` 的显示层完成：新增 `renameApiSectionTitle()`，在已有 `queueRender` 流程里遍历 `.settings-sidebar__item span` 与 `.settings-section__header h3`，把「API 来源设置」改为「图片API来源设置」。定位该卡片仍靠 `.vendor-badge` 与「常规设置/资产存储目录」等其他文本，不依赖这段标题，因此改名不会破坏逻辑。`api-profiles-patch.js` 与 `model-patch.js` 中引用该入口名的提示文案同步更新，全局版本号提升为 `20261109-4`。
- 2026-11-04 主站图标定稿为「夜航星海」MSG 图标：完整保留用户原版 MSG 字形、字距与比例，不作重描，统一改为星空金 `#FFD166`；深蓝渐变底 `#111A3E → #070B18`，中央蓝紫光晕、青蓝 `#22D3EE` 倾斜椭圆轨道、金色/青色/粉色星点，圆角约占边长 24%。主站使用 `assets/favicon.ico`（16/32/48/64/128/256 六档）、16/32px PNG、Apple Touch Icon 和 `assets/site.webmanifest`，画布 `canvas/icon.ico` 同步替换；原 `assets/favicon.svg` 已移除。

## 已实现范围

- 首页 Hero、继续观看、番剧库、排行榜、新番表、社区与页脚
- 搜索、分类筛选、追番收藏、详情弹层和选集切换
- 桌面、平板和手机响应式布局
- 移动菜单、键盘快捷键和基础无障碍状态
- 画布 React 界面加载、工作流管理台显示和浏览器新标签页入口

## 当前边界

- 视频播放器尚未接入，相关按钮为演示反馈
- 登录、社区后端、内容 API 和数据库尚未接入
- 当前内容与用户均为虚构演示数据
- 浏览器画布不等价于原 Electron 桌面版：
  - 第三方 AI/OSS/上传接口可能受 CORS 限制
  - 不能读取任意本地绝对路径
  - 只有通过 `start.bat`/`server.py` 启动时，才能对固定白名单目录打开系统资源管理器；普通静态服务器下回退为页面内查看
  - 没有 FFmpeg，`clipVideo()` 会明确失败
  - 自定义代理配置无法接管浏览器网络栈
  - 画布内窗口最大化使用 Fullscreen API，新标签页关闭由浏览器控制
- 未提供画布后端，因此 API Key 保存在当前浏览器和默认应用数据目录的明文 JSON 中；文件不能安全共享或服务端同步
- 第三方模型列表依赖平台 /v1/models（或 /models）的 CORS；本机已验证 Grsai 返回 30 个模型、其中 16 个图片模型，并验证自动拉取、勾选持久化、重新拉取保留选择、清空与云雾回退。真实出图尚未验证，因为当前没有有效 API Key。文本节点仍使用原画布云雾模型名，未接入 Grsai 文本模型。

## 协作约定

- 修改前先检查当前项目结构和已有代码；项目基准文档为 `AGENTS.md`。
- 新增设定或功能时，优先沿用项目中已经确认的方案。
- 保持直接打开 `index.html` 可预览，非必要不引入构建依赖。
- 新增视觉内容应延续「夜航星海」，并优先使用原创或已授权素材。
- 不要手改 `canvas/assets/index-*.js` / `index-*.css`；画布的浏览器适配写在 `canvas/web-bridge.js`、`canvas/index.html`、`canvas/branding-patch.js`、`canvas/api-profiles-patch.js`、`canvas/gallery-patch.js`、`studio/assets/studio.js` 和 `canvas/model-patch.js`。
- 修改画布能力、外部接口、存储格式或技术栈时，同步更新 `AGENTS.md`、`README.md` 与本文件中的长期有效信息。


## Git 代理配置

当 GitHub 直连超时（`Failed to connect to github.com:443`）时使用 socks5 代理推送：

```powershell
git -c http.proxy=socks5://127.0.0.1:7897 push -u origin main
```

或用 `--force` 覆盖远端历史：

```powershell
git -c http.proxy=socks5://127.0.0.1:7897 push origin main --force
```

---
## 2026-11-08 开发约束（必须遵守）

---
## 2026-11-08 最小改动原则（必须遵守）

### 原则1：精确修改范围
**只修改明确要求改动的代码，禁止触碰其他任何内容。**
- 修复 bug 时不得意外修改无关代码
- 添加功能时不得改变现有函数的实现逻辑  
- 禁止在修复过程中进行格式化或重构不相关的部分

### 原则2：本次具体教训
**问题**：从资产库拖动姿势图到画布产生双图
**根因**：自定义 drop handler 与画布原生 handler 同时触发
**修复**：移除 canvas/gallery-patch.js 第941-1023行的 setupDropTarget() 函数
**验证**：每次修改后用 git diff 确认只改了预期的代码

---
## 2026-11-08 最小改动原则（必须遵守）

### 约束1：精确修改范围
**只修改明确要求改动的代码，禁止触碰其他任何内容。**
- 修复 bug 时不得意外修改无关代码
- 添加功能时不得改变现有函数的实现逻辑
- 禁止在修复过程中进行格式化或重构不相关的部分

### 约束2：本次具体教训
**问题**：从资产库拖动姿势图到画布产生双图
**根因**：自定义 drop handler 与画布原生 handler 同时触发
**修复**：移除 canvas/gallery-patch.js 第941-1023行的 setupDropTarget() 函数
**验证**：每次修改后用 git diff 确认只改了预期的代码
