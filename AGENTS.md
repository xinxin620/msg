# Repository Guidelines（路由索引）

> `msg` 仓库给 AI 的入口。**本文件只做路由 + 硬边界**：你提到某功能域（画布/图片工坊/工作台/主站）时，按下面索引读对应 `docs/<域>.md`（域记忆：机制/坑/契约），再往下才进具体源文件头注释与代码。冲突以当前代码与实测为准，并在同一变更修正本文件与对应 docs。

## 路由表（你提到什么 → 读什么）
| 你提到 | 先读 | 再进 |
| --- | --- | --- |
| 画布 / 工作流 / ComfyUI / 图片·文本 API 配置 / API设置整页 / 素材上传 / 视频节点 | `docs/画布.md` | `canvas/*.js`（各补丁头注释）、`canvas/settings.html`+`settings-page-patch.js`、`web-bridge.js` |
| 图片工坊 / 资产库 / 姿势·服装·人像 / 嵌入 | `docs/gallery.md` | `gallery/assets/gallery.js`、`gallery.css` |
| 工作台 / studio / 目录授权 / 工作区 | `docs/studio.md` | `studio/assets/studio.js` |
| 看背影识人 / 小游戏 / 背影素材 / 战绩榜 | `docs/game.md` | `game/assets/game.js`、`game/data/roster.json` |
| 主站 / 首页 / 番剧 / 收藏 / 导航 | （无 docs，直接） | `index.html` + `assets/app.js` + `assets/styles.css` |
| 回归验收项 | `docs/acceptance.md` | — |
| 版本历史/流水账 | `docs/history.md` | — |

主站一行：纯静态 IIFE，`animeLibrary` 是 12 部番剧唯一数据源；`renderAnimeGrid()`/`renderRanking()`/`renderSchedule()`/`renderSearch()`/`renderWebsites()`+`renderWebsitesFilter()` 渲染；`setupEvents()` 统一绑定，画布/资产入口 `target="_blank"`；`init()` 初始化唯一入口。导航是 SPA：`setupHeader()` 用 `sectionMap` 切换 `main > section.is-visible`（`main > section{display:none}`），新增 tab 要同时改 index.html 两处导航、`sectionMap`、`init()` 调用与数据源。网站大全数据源 `websiteDirectory`（按行业大类分组，每组 sites[] 含 name/url/desc），`state.websiteFilter` 控分类筛选。

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
- 本地起停：`start.bat`/`stop.bat` → `python server.py 4173`（`/__health`、`/__open_folder`、`/__gallery_asset/`、`/__comfy/`、`/__textapi/`）。
- 存储键位总表与实体字段：见各 `docs/<域>.md`；改动前 `git log` 核对版本号事实。
- 编码：用户文案/文档默认简体中文，标识符英文；IIFE/`const`/命名函数/`data-*`；React 容器加 DOM 只追加+CSS `order` 排序且可重入；桥接拒绝 `throw new Error(中文)` 不静默成功；一次性脚本放 `_scratch/`。

## 文档分工
`AGENTS.md`=本路由（给 AI）；`docs/<域>.md`=各功能域记忆；`README.md`=用法（给用户）；`MEMORY.md`=跨会话长期约定与踩坑；`docs/acceptance.md`=回归清单；`docs/history.md`=版本流水账。同一信息只在一处展开，别处引用。

## 何时建/拆功能域 docs（路由维护规则）
建一份 `docs/<域>.md` 当且仅当：① 该域 ≥3 个源文件协同；② 累积 ≥5 条踩坑/契约/边界；③ 你经常单独点名提问。反过来：单文件简单域（如主站）不建，留在路由表一行；纯流水账进 `history.md` 不进域文件。新增域文件后，把本路由表加一行。