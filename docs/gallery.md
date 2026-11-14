# 图片工坊 / 资产库（gallery/）

> 域记忆。AGENTS.md 路由到这里；改动前先读本文件，再进 `gallery/assets/gallery.js`、`gallery.css` 头注释与代码。
> 零依赖静态页（IIFE 无构建），视觉延续主站。数据：姿势 1439 / 服装 3224 / 人像 1499（安全模式 4769 条，关后 6162 条）。

## 组成
- `gallery/index.html`：宿主页，支持 `?embed=1&host=&tab=` 嵌入模式。
- `gallery/assets/gallery.css`：三库 tab/筛选/网格/详情弹层/来源说明/安全模式的全部视觉与断点；沿用 `asset-*` 与 CSS 变量。**宿主显隐只写这里**，靠 `gallery.js` 追加宿主类名生效，不改画布 bundle。
- `gallery/assets/gallery.js`：`DATA_FILES` 列三库索引（服装合并 4 来源）；`state` 存当前库/搜索/筛选/安全模式/分页/姿势显示模式/详情；`loadLibrary()`/`loadLibraryFiles()` 读 `local-assets/data/*.json`（单文件失败保留其余并报错，嵌入模式只载当前 tab、`loadingLibraries` 防并发）；`HOST`/`SIZE_STORAGE_KEY` 按宿主选尺寸键；`renderFilters()`/`renderGrid()`/`updateDialog()` 渲染；`assetPath()`/`poseDepthPath()` 映射到只读代理，页面代码不写本地绝对路径。

## 数据
- 外部只读目录 `D:\data\workData\codex\Projects\ai-pose-gallery-zh-main`（`MSG_GALLERY_DIR` 可覆盖），原始来源 `https://ai-pose-gallery.anhao.app/`。
- 资产已复制到 `gallery/local-assets/`（~1.1GB，**必须留 `.gitignore` 不提交**）供静态服务器直读；`server.py` 的 `/__gallery_asset/` 只读代理仍保留。
- 条目字段以 `local-assets/data/*.json` 实际索引为准。

## 嵌入契约
- 抽屉与图片工坊都通过 `gallery/index.html?v=<版本>&embed=1&host=<canvas|studio>&tab=<库>` 加载。
- `host` 决定尺寸档位键（`manshiguang:gallery:size:<studio|canvas|embed>`，按宿主分键互不影响，首次各继承一次旧全局档带 `<键>:inherited` 标记）；缺 `host` 但带 `embed=1` 的旧链接回退 `:size:embed`，绝不与 studio/canvas 混用。
- iframe→宿主：`{source:"manshiguang-asset-embed", type:"asset-select", asset}` 与 `{..., type:"close-drawer"}`；宿主→iframe：`{source:"manshiguang-asset-host", type:"switch-tab", tab}`；所有消息校验 `event.origin === window.location.origin`。独立标签页用 `BroadcastChannel("manshiguang:asset-transfer")`。
- 嵌入模式 `boot()` 把 `is-embed-host-<HOST>` 追加到 `body` 供宿主差异化样式；卡片右上角「发送到画布合成台」（`.asset-card__send`）只在 `body.is-embed-host-studio` 下 `display:none`，画布抽屉、独立资产页与旧链接一律保留；详情弹层 `#dialogSend` 入口不受影响。

## 安全模式
- 默认 `true`，关闭需 18+ 确认并重置筛选与分页。默认隐藏敏感体系/分类：「全身单人・性感系」「双人缠绵」「内衣・睡衣」「性感穿搭」与 `敏感:true`。

## 只读代理白名单
- `GET /__gallery_asset/data/*.json`、`/thumbs/*`、`/img/*`；根目录白名单 `data`/`thumbs`/`img`，扩展名 JSON/JPG/JPEG/PNG/WebP/GIF/AVIF；拒绝对路径/反斜杠/NUL/`.`/`..`/越界路径。
- 部分图为远程源站 URL，不代理不缓存，可用性取决于对方站点。
- 数据与图片版权归原作者，仅限个人学习与合法创作，禁止倒卖侵权。

## 存储
- 仅「紧凑/标准/放大」尺寸档位持久化且按宿主分键；其余筛选/搜索/安全模式只在当前页会话内。