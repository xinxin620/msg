# msg 项目记忆

> 本文件只记录**长期有效的决策、约定与踩过的坑**。架构、文件职责、存储键位与桥接契约以 `AGENTS.md` 为准，使用者视角的功能与用法以 `README.md` 为准，逐条历史验收项与逐版本流水账分别在 `docs/acceptance.md` 与 `docs/history.md`；它们与源码冲突时，一律以当前代码和实测结果为准并同步修正。

## 项目定位与已确认决策

- 本项目是**动漫网站项目**，品牌名「漫时光 / MANSHIGUANG」，面向中文二次元用户。
- 视觉主题「夜航星海」：沉浸、精致、轻赛博；不使用传统模板站、门户式密集布局和廉价霓虹感。
- 项目根目录：`D:\data\workData\codex\Projects\msg`。零依赖静态原型，无构建、无 npm 依赖、无后端。
- 四个入口：主站 `index.html`、AI 创作工作台 `studio/index.html`（主站导航指向这里）、画布 `canvas/index.html`、资产参考库 `gallery/index.html`；后两者仍可直达，但不进主站导航。
- 本地服务：`start.bat` / `stop.bat` + `server.py`，监听 `http://127.0.0.1:4173`。涉及目录授权、文件保存、资产索引时必须用它访问，不能双击 `file://`。
- 番剧、制作公司、社区帖子与用户全部为**原创虚构数据**；主视觉是原创 `assets/hero-art.svg`，卡片封面由 CSS 渐变生成；追番收藏键名 `manshiguang:favorites`。
- 主站图标定稿（2026-11-04）：完整保留用户原版 MSG 字形、字距与比例、不作重描，统一改为星空金 `#FFD166`；深蓝渐变底 `#111A3E → #070B18`，中央蓝紫光晕、青蓝 `#22D3EE` 倾斜椭圆轨道、金/青/粉星点，圆角约占边长 24%。同步 `assets/favicon.ico`（16/32/48/64/128/256）、16/32px PNG、Apple Touch Icon、`assets/site.webmanifest` 与 `canvas/icon.ico`，原 `assets/favicon.svg` 已移除。
- 核心色板：深海背景 `#070B18`、次级背景 `#0D1428`、卡片表面 `#141D36`、星云紫 `#7C5CFF`、冰蓝青光 `#22D3EE`、月光粉 `#FF6FB5`、星芒金 `#FFD166`、主文字 `#F7F8FF`、次要文字 `#99A4C5`（完整表见 `README.md`「设计系统」）。字体为圆润标题 + 清晰中文正文 + 几何英文辅助，动效只服务氛围与层级，不高饱和大面积闪烁。
- 资产参考库的原始数据来自参考站点 `https://ai-pose-gallery.anhao.app/`，以本机下载目录为只读来源，不得在 `msg` 内修改（路径、代理与数据规模见 `AGENTS.md` 2.3）。

## 关键约定（改代码前必读）

- **缓存版本号**：全站资源统一用 `?v=YYYYMMDD-N`，`canvas/index.html` 与 `studio/index.html` 的版本守卫必须和脚本上的 `?v=` 一致，否则已打开的旧标签页会继续跑旧补丁。每次改前端整体提升一次并同步文档。
- **压缩包只读**：不手改 `canvas/assets/index-*.js` / `index-*.css`。需要升级就整体替换 bundle 再复测桥接契约；画布的浏览器适配一律写在 `canvas/web-bridge.js`、`canvas/*-patch.js` 与 `studio/assets/studio.js`。
- **不得假装成功**：目录未授权、绝对路径读不到、FFmpeg 缺失、系统资源管理器打不开、桥接映射缺失等情况一律中文明确报错或写明降级行为，禁止用假数据、假提示掩盖。
- **种子数据要负责到底**：写进用户 `localStorage` / IndexedDB 的种子，功能下线时必须一并清理。原生 bundle 启动时会把这些数据读进内存并在状态变化时整体回写，只删 IndexedDB 会让残留复活。
- **同名函数陷阱**：同一文件里不要留两个同名函数声明——函数声明提升会让后者悄悄覆盖前者，路径跑偏且完全不报错。改完除了 `node --check`，还要确认「实际生效的是哪一个」。
- **重绘陷阱**：不要用序列化后的 `innerHTML` 与模板字符串比较来决定是否重排（浏览器会规范化布尔属性与空白，比较永远不等，导致每秒重绘并替换按钮节点，表现为「点了没反应」）。要缓存上一次写入的模板再比较。
- **目录授权时机**：`showDirectoryPicker()` 必须在点击处理函数里第一个 `await` 之前调用，否则浏览器丢失用户激活，Windows 选择窗口可能完全不出现。iframe 里的授权也不可靠，工作台必须在顶层窗口授权后写入共享 IndexedDB。
- **资产尺寸档位按宿主分键**：独立页 `manshiguang:gallery:size`、工作台 `:size:studio`、画布抽屉 `:size:canvas`、只带 `embed=1` 的未知宿主 `:size:embed`；分键后首次加载各自继承一次旧全局档位（`<键>:inherited` 标记），此后互不影响。
- **临时脚本**：一次性补丁写入器、headless 自测与截图脚本统一放仓库根目录 `_scratch/`（已 gitignore），不得被正式代码引用。
- **主站导航外链**：`index.html` 桌面 `.desktop-nav` 与移动 `.mobile-menu` 各两条——`studio/index.html`（文案「AI 创作工作台」）与 `gallery/index.html`（文案「资产」），均 `target="_blank"`；主站不再直链 `canvas/index.html`。

## 协作与最小改动原则（必须遵守）

- 动手前先读 `AGENTS.md` 与相关代码；新增能力优先沿用已确认方案，保持零依赖。
- **只改明确要求改动的部分**：修 bug 不得顺手改无关代码，不做顺带的格式化或重构。
- 每次改完用 `git diff` 核对只动了预期范围；静态检查（`node --check`、`python -m py_compile server.py`、`git diff --check`）要实跑，没跑过不得声称通过。
- **改完先停下等用户实测**；确认没问题后才提交/推送，commit message 由用户提供，未获要求不自作提交推送。
- 历史教训：「从资产库拖姿势图到画布会出现两张图」的根因是补丁自定义 drop handler 与画布原生 handler 同时触发，删除 `canvas/gallery-patch.js` 的 `setupDropTarget()` 才修好——给画布加交互前先确认原生是否已经处理。

## Git 推送

GitHub 直连经常超时或被重置（`Failed to connect to github.com:443`、`Connection was reset`）。直连失败时走 socks5 代理：

```powershell
git -c http.proxy=socks5://127.0.0.1:7897 push -u origin main
```

需要覆盖远端历史时用 `--force-with-lease`，推送后用 `git status -sb` 确认与 `origin/main` 一致。

## 当前边界

- 视频播放器、登录、社区后端、内容 API、数据库、画布后端均未接入，相关按钮为演示反馈。
- 第三方 AI / OSS / 上传接口受浏览器 CORS 限制；自定义代理设置无法接管浏览器网络栈。
- API Key 同时保存在当前浏览器与应用数据目录的明文 JSON 中，没有服务端同步，也不能安全共享；不要把密钥、绝对路径或生成的配置写进仓库、日志或提交。
- 文本节点仍使用原画布云雾模型名，未接入第三方文本模型；第三方真实出图尚未验证（缺少有效 API Key）。
- 画布视频节点当前只能创建、显示、连线与随工作流保存；这份 bundle 的视频模型注册表为空，点运行会本地失败提示 `Video model config is missing`，实测不发任何网络请求。
- 原 Electron 桌面版独有能力（FFmpeg、Node 网络栈、任意本地路径、原生窗口）在网页版一律明确降级。
