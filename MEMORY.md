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
- 2026-11-03 新增 `canvas/api-profiles-patch.js`：在「API 来源设置」中隐藏原始云雾卡片并管理任意多个云雾/第三方 API 配置。每项包含名称、申请地址、API Key、Base URL，每卡保留「申请」并在右侧提供「启用/已启用」；`activeId` 保证同一时间只启用一个。第三方配置的 `modelCatalog` / `selectedModels` / `modelsFetchedAt` / `modelsError` / `modelsBaseUrl` 也存入 `localStorage["manshiguang:canvas-api-profiles"]`；填写或变更 Base URL / Key 后自动拉取，支持拉取全部、全选图片、清空和逐项勾选。启用项同步到 `canvas-api-settings` 与 `state.vendorConfigs.yunwu`，刷新后保持。
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
