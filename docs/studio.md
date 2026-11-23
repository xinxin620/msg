# AI 创作工作台（studio/）

> 域记忆。AGENTS.md 路由到这里；改动前先读本文件，再进 `studio/assets/studio.js` 头注释与代码。
> 零依赖外壳（IIFE 无构建）。画布/图片工坊/剧情导演台/看背影识人/设置为 iframe 实时页，其余三项（设定与出图/数字人视频/任务与成片）占位。**只是外壳+路由，不代理 API 配置、不复制资产索引、不重实现工作流**——实际能力全在 `canvas/`、`gallery/`、`story/`、`server.py`。「剧情导演台」是独立域（项目卡片/剧集树/剧本渲染全在 `story/`），见 `docs/story.md`；外壳只做两件事：`story` frame 路由 + 代理项目目录授权（`handleStoryDirectoryRequest()`，只写 token 记录、**不覆盖 `bridge:default` 资产目录），契约见该文件。「设置」工作区只是把画布的设置弹窗整页化（`canvas/settings.html`），配置数据仍与画布同源共享，外壳不另存一份；该页顶栏 `TOP_TABS` 是设置分区切换器（现「API设置」+「SKILL模板」两项：前者选中时侧栏只剩 5 个 API 分区，后者只剩注入的模板项），后续其它设置（常规/快捷键等）在设置页内加分区，不再新增左栏 tab；常规与快捷键目前仍在画布设置里配。

## 组成
- `studio/index.html`：静态骨架（`#railList`/`#stageFrame`/顶部工具条/`#assetDirChip`/`#soonTemplate`）+ 版本守卫，缺/过期 `v` 自动重定向。
- `studio/assets/studio.js`：
  - `WORKSPACES` 唯一注册表：`frame`=真实页（可带 `tabs` 分段控制器），`soon`=只渲染 `purpose`/`inputs`/`outputs`/`relation` 规划说明，不做假功能。八项：`canvas`/`assets`/`story`（剧情导演台，见 `docs/story.md`）/`game`/`settings`（「设置」）在线，`imagelab`/`human`/`tasks` 占位。`buildUrl()` 只对 `assets` 重写 URL，其余 frame 必须在 `url` 里自带 `?v=`（含 `settings` → `../canvas/settings.html?v=`+VERSION）。
  - `renderBar()`：切工作区时同步页头文案，并且**画布/设置/剧情导演台 tab 整行收起**（`studioBar.hidden = id==="canvas"||"settings"||"story"`）——画布 iframe 自带 `.app-titlebar`、设置页自带 `#ms-settings-page-bar`、story 自带 `.story-top` 整页顶栏，外壳那行「CANVAS/SETTINGS/STORY + 首页·重载·新标签页」是重复信息；其它 tab（图片工坊与三个占位区）保持显示。`studio.css` 里 `.studio-bar[hidden]{display:none}` 是必需的，因为 `.studio-bar` 自身声明了 `display:flex` 会盖掉 `hidden`。story 顶栏自带「返回项目列表 + 首页」，重载走 Ctrl+R，与 settings 收起后同口径。
  - `ensureFrame()`/`activate()`：每个 frame 工作区只建一次 iframe，切走隐藏不销毁，切回保留工作流与已载索引，仅「重载」强制刷新；当前工作区写 `localStorage["manshiguang:studio"]`（`workspace`+`assetTab`），hash（`#canvas`/`#assets`）深链。
  - `authorizeFromShell()`：**目录授权必须顶层窗口**——顶层点击一定是真实用户手势，结果按桥接层既有格式写进同源 IndexedDB `directoryHandles`，iframe 内画布直接复用，绕开 iframe 用户激活不稳定。
  - `notifyDirectoryChanged()`：重新授权后向所有已加载 iframe `postMessage` 并用 `BroadcastChannel` 通知独立标签页画布，让桥接层丢弃旧 handle 缓存。
  - `refreshDirChip()`：只读回显「是否已授权+目录名」，从不覆盖已有授权。

## 实体
- Workspace：`id/label/tagline/kicker/icon/type/state`；`frame` 另 `url/tabs`，`soon` 另 `purpose/inputs/outputs/relation`。

## 消息契约（都校验 `event.origin === window.location.origin`；非同源退回整页重赋 `src`）
- 共享目录授权：与画布桥接层共用 4.2 的 IndexedDB 库与 store，同源 iframe 与顶层窗口共享同一份记录，工作台授权一次画布 iframe 立即可用。
- 工作台→画布：`{source:"manshiguang-studio", type:"directory-changed"}`，走 `postMessage`（同源 iframe）+ `BroadcastChannel("manshiguang-canvas-bridge")`（独立标签页）；桥接层收到清空目录 handle 内存缓存，下次读写重新从 IndexedDB 取。
- 图片工坊→画布插入：`asset-select` 由 `deliverToCanvas()` 转交画布 iframe 的 `window.__MS_CANVAS_ASSET_HOST__.receiveAsset(asset)`（`canvas/gallery-patch.js` 提供），成功切回画布；画布补丁未就绪先切过去延迟重试一次，仍失败在舞台区显示中文提示**不静默成功**；最终走画布同一条隐藏 `input[type="file"]`+`change` 流程。
- 设置页→画布重载：`{source:"manshiguang-canvas-settings", type:"apply-to-canvas"}` 由 `canvas/settings-page-patch.js` 的「应用到画布」发出，外壳 `applyCanvasSettings()` 复用 `refreshBtn` 写法只重置画布 iframe 的 `src`（不销毁、不动设置页自身）；画布 frame 尚未创建时直接返回（新建画布首载即读新配置）。设置页在独立标签页打开（`window.self===window.top`）时无父窗口可通知，按钮只提示「请手动刷新画布」，**不伪造自动同步**。
- 剧情导演台→外壳授权：`{source:"manshiguang-story-embed", type:"request-directory", requestId}` → 外壳 `handleStoryDirectoryRequest()` 顶层 `showDirectoryPicker({mode:"readwrite"})`，回 `{source:"manshiguang-story-host", type:"directory-result", requestId, ok, token, name}`；**只写 token 记录，绝不覆盖 `bridge:default`**（换项目不能动画布资产目录）。取消回 `ok:false, cancelled:true`。完整契约见 `docs/story.md`。