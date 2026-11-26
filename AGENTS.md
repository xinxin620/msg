# Repository Guidelines（路由索引）

> `msg` 仓库给 AI 的入口。**本文件只做路由 + 硬边界**：你提到某功能域（画布/图片工坊/工作台/主站）时，按下面索引读对应 `docs/<域>.md`（域记忆：机制/坑/契约），再往下才进具体源文件头注释与代码。冲突以当前代码与实测为准，并在同一变更修正本文件与对应 docs。

## 路由表（你提到什么 → 读什么）
| 你提到 | 先读 | 再进 |
| --- | --- | --- |
| 画布 / 工作流 / ComfyUI / 图片·文本 API 配置 / 设置整页（API设置分区） / 素材上传 / 视频节点 | `docs/画布.md` | `canvas/*.js`（各补丁头注释）、`canvas/settings.html`+`settings-page-patch.js`、`web-bridge.js` |
| 图片工坊 / 资产库 / 姿势·服装·人像 / 嵌入 | `docs/gallery.md` | `gallery/assets/gallery.js`、`gallery.css` |
| 工作台 / studio / 目录授权 / 工作区 | `docs/studio.md` | `studio/assets/studio.js` |
| 剧情导演台 / 项目管理 / 制作流水线（导入小说·小说转剧本·资产提取·剧本转分镜）/ 剧集树 / 剧本查看渲染 | `docs/story.md` | `story/assets/story*.js`、`story/index.html` |
| 看背影识人 / 小游戏 / 背影素材 / 战绩榜 | `docs/game.md` | `game/assets/game.js`、`game/data/roster.json` |
| 主站 / 首页 / 番剧 / 收藏 / 导航 / 素材管理（画布生成物页内 tab） | （无 docs，直接） | `index.html` + `assets/app.js` + `assets/styles.css`、枚举端点 `server.py` `__media_index` |
| 回归验收项 | `docs/acceptance.md` | — |
| 版本历史/流水账 | `docs/history.md` | — |

主站一行：纯静态 IIFE，`animeLibrary` 是 12 部番剧唯一数据源；`renderAnimeGrid()`/`renderRanking()`/`renderSchedule()`/`renderSearch()`/`renderWebsites()`+`renderWebsitesFilter()` 渲染；`setupEvents()` 统一绑定，画布/资产入口 `target="_blank"`；`init()` 初始化唯一入口。导航是 SPA：`main > .page[data-page]` 容器（`index.html`）+ `styles.css` 尾部 `main > .page{display:none}`，`showPage(page)` 切 `.is-visible`，hash 路由（`#top/#library/#ranking/#schedule/#community/#websites`，`pageFromHash`+`hashchange` 刷新恢复）；锚点点击统一委托（桌面/移动菜单/页脚共用 `a[href^="#"]`，页面外 id 走 `scrollIntoView`）。新增 tab 要同时改 index.html 两处导航+`.page` 容器、`PAGES` 集合与数据源。观看进度 `manshiguang:progress`（animeId->已看集数数组，继续观看区与选集/立即观看联动）；排播唯一数据源是 `scheduleMap`，`broadcastSlot(id)` 反查周几/时间，animeLibrary 不再存 day/time；hero 由 `renderHero()` 从 starlight 派生，勿再写死。网站大全数据源 `websiteDirectory`（按行业大类分组，每组 sites[] 含 name/url/desc），`state.websiteFilter` 控分类筛选。

## 省 token 写代码模式（用户已启用，默认遵守）
1. 无开场白、无多余说明，优先直接贴代码。
2. 注释极简，只保留必要注释，不写冗余讲解。
3. 问题明确时只返回可运行代码；需改动就只贴变更片段（diff 优先）。
4. 报错排查：精简定位，只给关键排查点 + 修复代码。
5. 未指定版本/环境时，沿用之前环境栈。
6. 不用「下面是代码」这类前缀。

## 硬边界（必须记住，不展开）
- `canvas/assets/index-*.js|.css` **只读禁改**，升级整体替换 + 重核桥接契约。
- 浏览器读不了任意 Windows 绝对路径；`webdir:<uuid>` 是 handle 键非路径；`showDirectoryPicker()` 须在点击处理首个 `await` 前调用；目录授权必须顶层窗口。
- 无 Java/Spring/MySQL/消息队列，无数据库表；状态全在浏览器存储 + `C:\Users\liliang\msg`（明文 API 配置文件只放本人可控目录）。
- 本地起停：`start.bat`/`stop.bat` → `python server.py 4173`（`/__health`、`/__open_folder`、`/__gallery_asset/`、`/__media/`、`/__media_index/`、`/__data/`、`/__comfy/`、`/__textapi/`）。
- 站点数据在 `data/{anime,schedule,websites,community}.json`（app.js 启动 fetch，改 server.py 须重启、改 data/*.json 刷新即生效）；主站「数据管理」tab 在线编辑/上传，POST `/__data/<file>` 写回（白名单四文件、JSON 校验、临时文件原子替换、仅本机）。首页推荐 = `featured:true` 的番（回退第一部），别再写死 id。素材管理页（主站 `#media` tab）走 `__media_index`：GET 枚举 `ALLOWED_FOLDERS` 根目录（画布 images + msg + **uploads**）返回相对路径清单与 `roots`（前端不再写死路径，root 下标由响应给出），预览走 `/__media/<rel>?root=N`，删除=POST move 进根目录 `.trash`（不真删，restore 平铺回根目录）；仅本机、限深 6/上限 4000、跳 `.trash` 等目录。手动上传走 `POST /__media_upload/?name=<文件>[&dir=posters]`：原始字节流式写 `uploads/`（第 3 根、.gitignore 不入库；`dir` 只认 `UPLOAD_SUBDIRS` 白名单=番剧海报），扩展名限 `MEDIA_INDEX_KINDS`、文件名取 basename 防穿越、重名加序号、`.part` 原子改名、2GB 上限、仅本机；前端 XHR 上传带进度、完成自动重扫。番剧真实海报：数据管理页「番剧封面海报」面板按部上传，落 `uploads/posters/cover-<id>.<ext>`，写 `anime.image`+`imageRoot`（成对，移除同清），`coverMarkup` 有图渲染 `.cover-photo` 照片封面、无图保持汉字渐变默认，hero 海报同步。
- 存储键位总表与实体字段：见各 `docs/<域>.md`；改动前 `git log` 核对版本号事实。
- 编码：用户文案/文档默认简体中文，标识符英文；IIFE/`const`/命名函数/`data-*`；React 容器加 DOM 只追加+CSS `order` 排序且可重入；桥接拒绝 `throw new Error(中文)` 不静默成功；一次性脚本放 `_scratch/`。

## 文档分工
`AGENTS.md`=本路由（给 AI）；`docs/<域>.md`=各功能域记忆；`README.md`=用法（给用户）；`MEMORY.md`=跨会话长期约定与踩坑；`docs/acceptance.md`=回归清单；`docs/history.md`=版本流水账。同一信息只在一处展开，别处引用。

## 何时建/拆功能域 docs（路由维护规则）
建一份 `docs/<域>.md` 当且仅当：① 该域 ≥3 个源文件协同；② 累积 ≥5 条踩坑/契约/边界；③ 你经常单独点名提问。反过来：单文件简单域（如主站）不建，留在路由表一行；纯流水账进 `history.md` 不进域文件。新增域文件后，把本路由表加一行。