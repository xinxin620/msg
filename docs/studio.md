# AI 创作工作台（studio/）

> 域记忆。AGENTS.md 路由到这里；改动前先读本文件，再进 `studio/assets/studio.js` 头注释与代码。
> 零依赖外壳（IIFE 无构建）。画布/图片工坊为 iframe 实时页，其余四项占位。**只是外壳+路由，不代理 API 配置、不复制资产索引、不重实现工作流**——实际能力全在 `canvas/`、`gallery/`、`server.py`。

## 组成
- `studio/index.html`：静态骨架（`#railList`/`#stageFrame`/顶部工具条/`#assetDirChip`/`#soonTemplate`）+ 版本守卫，缺/过期 `v` 自动重定向。
- `studio/assets/studio.js`：
  - `WORKSPACES` 唯一注册表：`frame`=真实页（可带 `tabs` 分段控制器），`soon`=只渲染 `purpose`/`inputs`/`outputs`/`relation` 规划说明，不做假功能。固定六项：`canvas`/`assets` 在线，`story`/`imagelab`/`human`/`tasks` 占位。
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