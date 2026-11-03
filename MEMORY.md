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
- 画布入口：`canvas/index.html`
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

- 2026-11-03 已从「简单画布」Electron 安装包中静态解包并复制已构建前端资源。
- 主站导航「社区」右侧新增「画布」，移动菜单同步新增。
- 点击画布使用浏览器原生 `target="_blank"` 在新标签页打开；主站当前标签页保持不变，不强制窗口尺寸或复用命名窗口。
- 画布宿主页：`canvas/index.html`，包含 React 根节点、启动遮罩和加载失败提示。
- 浏览器桥接层：`canvas/web-bridge.js`，以 IIFE 方式暴露 `window.electronAPI`，共 29 个方法：保留原 Electron preload 的 26 个兼容方法，并新增 `pickApiConfigDirectory`、`saveApiConfigFile`、`readApiConfigFile` 三项 API 配置存储扩展。
- 画布 bundle：`canvas/assets/index-BN-uSJKj.js`、`canvas/assets/index-BfAuAU0s.css`，与解包后的 `dist` 文件 SHA-256 一致。
- 设置页品牌补丁：`canvas/branding-patch.js`，通过 `MutationObserver` 将作者信息替换为「抖音/B站/小红书：阿亮啊」「微信：liangliang_0314」「资料主站：https://github.com/xinxin620」；同时把收款码切换为带日期的唯一文件名并追加 `?v=` 参数以避开旧缓存，不修改压缩 bundle。
- 收款码：`canvas/donation-qr-liangliang-20261103.png` 是运行时加载的新卡片（934×1037，中心真人头像、底部「恋心心 (*亮)」）；`canvas/donation-qr.png` 是同内容兼容副本，二者不再与原始 `dist` 一致。
- 2026-11-03 新增 `canvas/api-profiles-patch.js`：在「API 来源设置」中隐藏原始云雾卡片并管理任意多个云雾/第三方 API 配置。每项包含名称、申请地址、API Key、Base URL，每卡保留「申请」并在右侧提供「启用/已启用」；`activeId` 保证同一时间只启用一个。第三方配置的 `modelCatalog` / `selectedModels` / `modelsFetchedAt` / `modelsError` / `modelsBaseUrl` 也存入 `localStorage["manshiguang:canvas-api-profiles"]`；填写或变更 Base URL / Key 后自动拉取，支持拉取全部、全选图片、清空和逐项勾选。启用项同步到 `canvas-api-settings` 与 `state.vendorConfigs.yunwu`，刷新后保持。
- 画布设置和目录授权使用浏览器存储；目录 handle 保存到 IndexedDB 数据库 `manshiguang-canvas-bridge` 的 `directoryHandles` object store。
- 2026-11-04 新增「常规设置 → API 配置存储」卡片，位于「资产存储目录」下方。默认浏览器存储；首次点击「本地目录」会立即打开系统目录选择窗口，选定后创建或覆盖明文 JSON `manshiguang-api-config.json`，包含当前 API Key、Base URL 和模型勾选；配置变化时自动续写，并提供「从本地恢复」。切到浏览器存储只停止续写，不删除本地 JSON；再次切到本地目录会直接更新原文件，无需重新选目录。位置元数据保存在 `localStorage["manshiguang:canvas-api-storage"]`；API 配置目录使用独立 token，不覆盖素材目录。已验证真实桥接写入/读取、恢复不覆盖源文件、刷新保持和切回浏览器后停止本地写入；目录选择窗口用 OPFS 模拟，未实际操作 Windows 授权窗口。
- 选择素材目录后使用 `webdir:<uuid>:<encoded-name>` 虚拟路径；没有目录授权时，保存回退为浏览器下载。
- 网络能力通过浏览器 `fetch` 实现，保留 URL、方法、状态和 CORS 提示；OSS 使用 Web Crypto 做 V1 签名。
- 2026-11-03 新增 canvas/model-patch.js：启用非内置云雾 API 时只读取当前 Profile 的 `selectedModels` 注入图片节点下拉，不再自行拉取、缓存 10 分钟或失败回退内置清单；下拉只高亮当前节点正在使用的模型，单次选择（含 `lastPicked`）写入 localStorage["manshiguang:canvas-model-choice"]，取消勾选或切回云雾时清理失效选择并恢复原生文案。Grsai 请求从 /v1/images/generations / /v1/images/edits 改写为 /v1/draw/nano-banana 或 /v1/draw/completions，并轮询 /v1/draw/result；未勾选模型时返回明确中文错误。canvas/api-profiles-patch.js 会先归一化 Base URL，去掉重复的 /v1、/v1/api/*、/v1/draw/*、/v1/images/* 后缀。

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
  - 不能打开系统文件管理器
  - 没有 FFmpeg，`clipVideo()` 会明确失败
  - 自定义代理配置无法接管浏览器网络栈
  - 画布内窗口最大化使用 Fullscreen API，新标签页关闭由浏览器控制
- 未提供画布后端，因此 API Key 默认只保存在当前浏览器本地；用户也可显式选择本地目录保存明文 JSON 副本，但不能安全共享或服务端同步
- 第三方模型列表依赖平台 /v1/models（或 /models）的 CORS；本机已验证 Grsai 返回 30 个模型、其中 16 个图片模型，并验证自动拉取、勾选持久化、重新拉取保留选择、清空与云雾回退。真实出图尚未验证，因为当前没有有效 API Key。文本节点仍使用原画布云雾模型名，未接入 Grsai 文本模型。

## 协作约定

- 修改前先检查当前项目结构和已有代码；项目基准文档为 `AGENTS.md`。
- 新增设定或功能时，优先沿用项目中已经确认的方案。
- 保持直接打开 `index.html` 可预览，非必要不引入构建依赖。
- 新增视觉内容应延续「夜航星海」，并优先使用原创或已授权素材。
- 不要手改 `canvas/assets/index-*.js` / `index-*.css`；画布的浏览器适配写在 `canvas/web-bridge.js`、`canvas/index.html`、`canvas/branding-patch.js`、`canvas/api-profiles-patch.js` 和 `canvas/model-patch.js`。
- 修改画布能力、外部接口、存储格式或技术栈时，同步更新 `AGENTS.md`、`README.md` 与本文件中的长期有效信息。
