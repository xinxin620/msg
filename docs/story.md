# 剧情导演台（story/）

> 域记忆。AGENTS.md 路由到这里；改动前先读本文件，再进 `story/assets/*.js` 头注释与代码。
> 零依赖静态页（IIFE 无构建），工作台 `story` 工作区的 frame 目标页（`?host=story` 嵌入，也可独立打开）。
> 定位：**项目/剧集管理 + 剧本专用查看**，不重实现写作——生成能力（小说→剧本、剧本→分镜、资产提取）归 `liang-drama-prompts` 等 skills 与后续「生成」批次，本域只读写文件、渲染、组织。

## 组成
- `story/index.html`：骨架（`#storyBody`/`#backBtn`/`#topTitle`/`#storyToast`/`#apiChip`）+ 图标 sprite + 版本守卫（`20261126-1`）。脚本顺序：`canvas/skill-templates-data.js` → `story-fs.js` → `story-render.js` → `story-gen.js` → `story.js`（defer）。**顺序不能乱**：story-gen.templates() 读 `__MS_SKILL_TEMPLATES_BUILTIN__`，story.js 的 boot 检查 FS/RENDER 且流水线要用 GEN。
- `story/assets/story-fs.js`：文件层。直连共享 IndexedDB `manshiguang-canvas-bridge`/`directoryHandles`（同 game.js 先例，**不加载 web-bridge.js**，避免画布 fetch/图片 src 补丁副作用）。挂 `window.__MS_STORY_FS__`。
- `story/assets/story-render.js`：专用解析器。挂 `window.__MS_STORY_RENDER__`：`parseScreenplay`/`speakerColors`/`countStats`/`parseH3`/`parseVisualAssets`/`parseAssetPrompts`。
- `story/assets/story.js`：外壳路由与视图（项目卡片 → 剧集树 + 三阶段 tab）。
- `story/assets/story.css`：主题。**与 studio 外壳同一套浅色 token**（`--bg:#eeecea` 等，抄自 `studio.css` :root）——外壳不是夜航星海深色，别按深色做。
- `story/assets/story-gen.js`：生成层（复用画布文本 API 配置 + skill 骨架，`generate`/`previewConfig`/`templates`/`templateById`），`20261123-4` 起随流水线挂页。

## 导演台布局（`20261123-5`，参考桶老师 H3 导演台重做）
项目内不再是「卡片列表点进项目」，而是**单页工作台**：
- **顶栏 `#apiChip`**：文本 API 配置/模型/缺项。
- **`.desk-bar`**：项目下拉（`projectSelect()`，含「＋ 添加项目…」）+ 刷新 + 删除项目。一个授权目录＝一部剧＝下拉一项。`20261126-1` 起整条做成卡片（边框/圆角/阴影），下拉自绘箭头（`appearance:none` + 内联 SVG chevron），右侧用 `.db-spacer` 把操作按钮推到尾部。
- **未选项目时**：`renderEmptyState()` 渲染 `.desk-intro`（标题「选择一个项目继续」+ 提示 + `.project-grid` 项目卡，卡名带紫色圆点 `::before`），不再用旧的「从上方下拉选择项目，或：」一行字。
- **`.phase-cards`**：01 剧本创作 / 02 资产提炼 / 03 分镜制作 三张大卡（`PHASES`），卡上显示「本集已就绪/等待产出」（`phaseReady()` 看本集该阶段视图文件是否存在）。
- **`.ep-row`**：本集下拉（`state.activeEp`，默认最新一集）+ 文件计数。
- **`.panel`**：所选阶段面板 = 该阶段动作卡（`GEN_TASKS[phase]`）+ 查看区（`viewSection()` 用 `PHASE_VIEWS[phase]` 复用专用渲染器）。
- 深链 `?project=<token>` 命中注册项目直接载入。

**动作卡**：01 有「导入小说」卡（file input→写 原文.md，EP 自增新建 `nextEpName()`，>6 万字拒）+「小说转剧本」；02「资产提取（视觉设定）」「资产生图提示词」；03「剧本转分镜」。查看区 01=原文(raw)+剧本(screenplay)、02=视觉设定(visual)+生图提示词(prompts)、03=H3分镜(h3)。
**生成门禁不变**：`genCard()` 点「生成」只进预览 textarea，点「保存到本集」才 `writeText`（覆盖 confirm）；失败/`AbortController` 停止不写文件。API/骨架/回退链同下「生成」段。

> 旧 M1~M3 的「项目卡片网格 / 剧集树 / 三阶段子标签 / 制作流水线+剧集浏览双 tab」已被这版单页工作台取代；`story-render.js`/`story-fs.js`/`story-gen.js` 三个能力层不变，只重写了 `story.js` 视图层与 `story.css`。

## 三阶段 tab（`20261123-3`，已并入上面 phase-cards）
项目内按制作阶段分三个 tab（`STAGES` 注册表，files 顺序即子标签顺序）：
1. **原文与剧本**：`原文.md`（小说/大纲原文，raw 预览）+ `剧本.md`（专用渲染）。`原文.md` 是本域新增约定（skills 没有这个契约），生成批次「小说转剧本」从这里取输入。
2. **分镜工作台**：`H3分镜.md` → `parseH3` 单元卡（时长徽标 **4–15 秒越界标红**、模式、SHOT 表、英文正文块/中文对照块分块 + 一键复制）。
3. **资产列表**：`视觉设定.md` → `parseVisualAssets` 按四类分组（空组也显示）；`资产生图提示词.md` → `parseAssetPrompts` IMG 项 + 缺可复制正文计数。
剧集树状态点随之改为按阶段 3 个（script=紫 / storyboard=粉 / assets=绿）。

## 实体与键位
- 项目注册表：同 store 键 `story:projects` = `[{token,name,createdAt,lastOpened}]`。一个授权目录＝一部剧（方案①，用户 2026-11-23 拍板）。
- 项目 handle 记录：键 `webdir:<uuid>:<encoded-name>`，**只写 token 记录、绝不覆盖 `bridge:default`**——否则换项目会把画布资产目录一起改掉。
- 移除项目＝删注册表行 + 删 token 记录，不碰本地文件、不碰画布授权。
- 剧集目录约定：`<root>/剧集/EPxxx/{原文.md,剧本.md,视觉设定.md,资产生图提示词.md,H3分镜.md}`，文件名精确匹配（大小写敏感），缺失显示「缺」不放假数据。

## 消息契约
- story iframe → 外壳：`{source:"manshiguang-story-embed",type:"request-directory",requestId}`（iframe 内点「添加项目」时，`showDirectoryPicker` 必须顶层窗口，同资产授权先例）。
- 外壳 → story：`{source:"manshiguang-story-host",type:"directory-result",requestId,ok,token,name|error}`；取消回 `ok:false,cancelled:true`，story 侧静默返回。外壳处理器在 `studio/assets/studio.js` `handleStoryDirectoryRequest()`。
- story 独立标签页打开时不走 postMessage，直接顶层 `showDirectoryPicker`（`FS.isEmbedded()` 判别）。

## 剧本渲染器口径（story-render.js）
- 格式契约跟 `liang-drama-prompts`：`# EPxxx 集名`、`## EPxxx-SCxxx 内/外/内外 · 地点 · 时间`（**内外 必须排 alternation 最前**）、`角色（提示）：台词`、六个生产标签 `[VO][OS][SFX][画面文字][连续性][转场]`。
- **注释块必须整段吞掉（含跨行）**：模板示意注释（`<!-- ... -->`）不吞会污染视图；`inComment` 状态机，解析与名册预扫两处各一份，改动要同改。
- **对白消歧＝两遍名册法**（对齐 skills 索引脚本的 `--speaker` 名册思路）：预扫收集「带括注对白行 + VO/OS 行」的说话者名册；裸 `X：` 行只有 X 在名册、或（≤3 字且不含虚词 NON_NAME_RE）才判对白，否则算动作。「她有个习惯：数台阶」这类含冒号动作靠这条不跑偏。**纯正则永远无法完全消歧，别退回单遍判定**。
- 时长是粗估（可发声字÷4.1，VO 计入），页面明写「权威估算以 skills 的 duration_estimate 为准」——导演台不做门禁。
- 未知结构降级为动作段落原样显示，正文一字不丢。

## 分镜/资产解析口径（`20261123-3`）
- `parseH3` 跟 `liang-h3-storyboard-prompts` 骨架：`## H3-UNIT-… · 标题` / `- 时长：N 秒` / `### SHOT-…` / `### H3 提示词` 下英文 ```text 块 / `### 中文对照` 下中文块。**双块按 section 归属，不混**（英文块混中文=提示词污染，是 skill 点名的事故源）。解析不出单元时整篇 raw 兜底显示，不白屏。
- `parseVisualAssets`/`parseAssetPrompts` 跟 `liang-visual-assets-prompts` 的 `references/documents-and-extraction.md` 骨架：四分组标题精确匹配、`CHAR-/LOC-/PROP-/LOOK-/IMG-` ID 前缀；分组外内容（项目视觉方向/跨场连续性）只显示不解析。
- 浏览器侧解析只做**即时反馈**（越界/缺块计数），结构校验权威仍在 skills 的 `validate_h3_storyboard.py`——两边规则冲突时以 skills 为准并回改这里。

## 已知边界与坑
- **原生错误必须过 `friendlyError`**：File System Access 抛的是英文 `NotFoundError` 等，直接 `error.message` 上界面就是「A requested file or directory could not be found…」（用户 4173 实测截图抓到过）。fs 层读写入口统一 catch 翻中文；story.js 展示层拿到的应当已是中文。
- `fileMeta` 的 `lastModified` 是浏览器缓存的元数据，可能滞后于磁盘；显示文案别写成「实时」。
- 逐集探测文件存在性 = 每集一次 `listDir`，几十集会有一串 IO；剧集数上千要改成懒探测（现状漫剧规模不需要）。
- 授权 token 与画布资产目录 token 同 store 混存，story 只认自己注册表里的 token；`removeProject` 只删自己那条。
- 生成批次（story-gen.js 挂页 + 任务面板 + 确认表单）是下一批；启用时把 `skill-templates-data.js` 一并挂进 `story/index.html`（它无 DOM 无副作用，可安全直载）。
