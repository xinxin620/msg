# 漫时光 · MANSHIGUANG

一个以「夜航星海」为视觉主题的二次元动漫网站原型。整体强调沉浸、精致和轻赛博感，不使用传统门户模板式布局。

## 直接预览

双击打开 `index.html` 即可浏览主站。项目为零依赖静态站点，不需要安装依赖或启动开发服务器。

> 在线字体需要网络；离线时会自动回退到系统中文字体，不影响页面使用。
>
> 画布的目录授权、文件保存和网络请求建议通过本地 HTTP 地址使用。可直接运行：
>
> ```powershell
> python -m http.server 4173 --bind 127.0.0.1
> ```
>
> 然后访问 `http://127.0.0.1:4173/`。

## 当前功能

- 沉浸式首页 Hero、主视觉海报与动态星光背景
- 12 部原创虚构番剧资料，支持分类筛选
- 番剧搜索、搜索结果跳转与详情弹层
- 追番收藏，使用 `localStorage` 保留在当前浏览器
- 本周排行榜、每日新番表和社区内容区
- 选集切换、移动端菜单、键盘快捷键和基础无障碍状态
- 主导航「社区」右侧新增「画布」入口，点击后在浏览器新标签页打开
- 「简单画布」工作流界面：节点编排、工作流导入/导出、AI 服务商配置、素材上传与生成结果管理
- 画布 API 来源管理：保留云雾并支持任意多个第三方配置，同一时间只启用一个，配置与 Key/Base URL 刷新后保留
- 画布 API 配置存储：默认浏览器存储；首次点击「本地目录」会打开系统目录选择窗口并创建 `manshiguang-api-config.json`，后续切回本地目录自动更新，切换浏览器存储不会删除该文件
- 画布第三方模型列表：添加并填写第三方 API 后自动拉取模型，可勾选或全选图片模型；图片节点只显示当前启用配置勾选的模型；Grsai 请求自动适配 `/v1/draw/nano-banana` / `/v1/draw/completions`
- 画布浏览器桥接：本地目录授权、文本/媒体保存、HTTP 请求、multipart 上传、OSS/签名上传等

交互快捷键：

- `/`：打开搜索
- `Esc`：关闭详情、搜索或移动端菜单

## 画布使用

从主站顶部导航点击「画布」，会在浏览器新标签页打开画布，主站页面保持当前标签页不变。若浏览器拦截新标签页，请允许本站打开新标签后重试。

画布入口：

- `canvas/index.html`
- 打开方式：浏览器原生新标签页（`target="_blank"`）

画布由已打包的 React 前端、`canvas/web-bridge.js`、`canvas/branding-patch.js`、`canvas/api-profiles-patch.js` 和 `canvas/model-patch.js` 组成。桥接层提供与原 Electron preload 同名的 `window.electronAPI`，用于把桌面版文件、网络和窗口能力映射到浏览器可用的能力；品牌补丁替换设置侧栏作者信息，并通过带日期的唯一文件名和版本参数刷新收款码；API 来源补丁负责拉取并勾选模型，模型补丁只展示已选模型并适配 Grsai 请求协议，不修改压缩 bundle。

### API 来源配置

「模型与接口设置 → API 来源设置」支持在保留内置「云雾」的同时新增任意多个第三方 API。每张配置卡都包含申请地址、API Key 和 Base URL，并保留「申请」按钮；其右侧的「启用」按钮用于切换当前配置，同一时间只有一个配置处于启用状态。

配置保存在 `localStorage["manshiguang:canvas-api-profiles"]`，刷新页面后继续保留。启用项会同步到画布原有的 `canvas-api-settings`，后续请求使用当前配置的 Key 与 Base URL。

### API 配置存储

「模型与接口设置 → 常规设置 → API 配置存储」默认使用浏览器存储。首次点击「本地目录」会立即打开 Windows 系统目录选择窗口；选定后，当前 API 配置会创建或覆盖固定文件 `manshiguang-api-config.json`。修改 API Key、Base URL 或模型勾选时会自动续写。切到「浏览器存储」只会停止本地续写，不会删除该 JSON；再次切到「本地目录」时会直接更新原文件，无需重新选择目录。「从本地恢复」可把该文件重新载入画布。存储模式使用 `localStorage["manshiguang:canvas-api-storage"]` 记录，刷新后保留。

本地文件是**明文 JSON**，会包含 API 密钥，只能放在本人可控的私有目录；浏览器存储与本地文件都只属于当前设备，不会同步到服务器。

### 第三方模型列表

添加第三方配置并填写 Base URL 后，`canvas/api-profiles-patch.js` 会自动尝试 `${base}/v1/models` 与 `${base}/models`；也可以点击「拉取全部模型」。首次拉取默认勾选图片模型，之后可在模型列表中逐项勾选、全选图片或清空，并可用「拉取全部模型」刷新目录。模型目录与勾选保存在 `localStorage["manshiguang:canvas-api-profiles"]`，刷新后保留；同源重新拉取只保留仍存在且此前勾选的模型，不无故覆盖用户选择。

`canvas/model-patch.js` 只把当前启用 Profile 的 `selectedModels` 注入图片节点下拉。未勾选任何模型时显示配置提示；切回云雾时恢复画布原生的 4 个模型和原始按钮文案。当前 Grsai 返回 30 个模型，其中 16 个 `gpt-image-*` / `nano-banana-*` 图片模型。单次节点选择另存于 `localStorage["manshiguang:canvas-model-choice"]`。

Grsai 的请求协议与云雾不同：画布仍调用 OpenAI 风格 `/v1/images/generations` 或 `/v1/images/edits`，补丁会转发到 `/v1/draw/nano-banana` 或 `/v1/draw/completions` 并轮询 `/v1/draw/result`。文本节点暂未接入第三方文本模型，仍使用原画布云雾模型名。

### 浏览器版能力限制

画布不是原 Electron 桌面版的完全等价替代：

- AI 服务商、上传服务和 OSS 端点若未允许跨域，浏览器请求会失败；CORS 不能由前端绕过。
- 浏览器无法读取任意本地绝对路径。请使用画布上传，或在支持的 Chromium 中先选择素材目录。
- 网页版不能打开系统文件管理器。
- 网页版没有 FFmpeg，视频剪辑接口会明确报错。
- 自定义网络代理属于浏览器外部配置，画布设置页中的代理不能接管浏览器网络栈。
- 未选择素材目录时，保存操作会回退为浏览器下载；不会写入原桌面版的默认资产目录。
- 第三方模型列表依赖平台 `/v1/models` 的 CORS；实际出图仍需要有效的第三方 API Key。当前只适配了图片节点，文本节点仍使用原云雾模型名。
- 选择本地 API 配置目录后，导出的 `manshiguang-api-config.json` 是明文文件，包含 API Key；请避免放在公开目录、公共网盘或版本库中。
- 画布内窗口最大化使用 Fullscreen API；浏览器新标签页的关闭行为由浏览器控制。

## 设计系统

「夜航星海」核心色：

| 用途 | 色值 |
| --- | --- |
| 深海背景 | `#070B18` |
| 次级背景 | `#0D1428` |
| 卡片表面 | `#141D36` |
| 星云紫 | `#7C5CFF` |
| 冰蓝青光 | `#22D3EE` |
| 月光粉 | `#FF6FB5` |
| 星芒金 | `#FFD166` |
| 主文字 | `#F7F8FF` |
| 次要文字 | `#99A4C5` |

字体采用圆润标题字、清晰中文正文和几何英文辅助字，形成“动漫感 + 杂志感”的层次。

## 文件结构

```text
msg/
├─ index.html                  主站页面结构与图标
├─ assets/
│  ├─ styles.css              视觉系统、布局与动效
│  ├─ app.js                  番剧数据、交互与画布新标签页入口
│  ├─ hero-art.svg            原创首页主视觉
│  └─ favicon.svg             站点图标
├─ canvas/
│  ├─ index.html              画布宿主页与启动诊断
│  ├─ web-bridge.js           浏览器兼容桥接层
│  ├─ branding-patch.js       设置页作者信息品牌替换补丁
│  ├─ api-profiles-patch.js   云雾/第三方 API 多配置、唯一启用、模型勾选与 API 配置存储
│  ├─ model-patch.js          已选模型下拉注入与第三方请求协议适配
│  ├─ assets/
│  │  ├─ index-BN-uSJKj.js    已打包 React 画布
│  │  └─ index-BfAuAU0s.css   画布样式
│  ├─ dt-canvas-logo.png      画布品牌图
│  ├─ donation-qr.png         阿亮啊支付宝收款码兼容副本
│  ├─ donation-qr-liangliang-20261103.png
│  │                          运行时加载的阿亮啊支付宝收款码卡片
│  └─ icon.ico                画布图标
├─ .preview/                  桌面与手机验收截图
├─ AGENTS.md                  项目基准、技术栈与协作约束
├─ MEMORY.md                  项目长期记忆
└─ README.md                  项目说明
```

## 静态检查

```powershell
node --check assets/app.js
node --check canvas/web-bridge.js
node --check canvas/branding-patch.js
node --check canvas/api-profiles-patch.js
node --check canvas/model-patch.js
```

## 内容与后续接入

当前 12 部番剧、制作公司、社区帖子和用户均属演示用虚构内容。画布 bundle 属于从外部桌面应用提取的预构建前端，升级时不要直接修改压缩文件，应整体替换后重新核对桥接接口、`branding-patch.js` 的文本选择器和 `api-profiles-patch.js` 的 vendor 卡片选择器。

后续正式上线时建议依次接入：

1. 番剧内容 API 与后台管理
2. 用户登录、追番同步和多端收藏
3. 视频播放器、清晰度切换和播放进度
4. 真实搜索服务、社区发布与内容审核
5. 画布后端代理，用于规避 CORS、安全保存第三方 API Key 和执行服务端 FFmpeg
6. 访问统计、SEO、分享卡片和部署配置

播放器、登录、社区后端和画布后端目前均未接入，相关操作会以演示提示或明确的浏览器能力错误反馈。
