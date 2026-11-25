(() => {
  "use strict";

  // 节点浮动编辑器（图片 / 文本）
  // ---------------------------------------------------------------------------
  // 画布原生在选中图片节点或文本节点时会打开右侧 .inspector 属性面板。本补丁
  // 不改压缩 bundle，只在这个面板出现时读取画布 store、找到当前选中节点的
  // DOM，并把原生面板重排成“贴在当前节点正下方”的浮动卡片。
  //
  // 两种模式（由面板里真实渲染的 .action-panel--image / --text 判定）：
  // - 图片模式：模型下拉、参数下拉、参考图 file input 与生成按钮全部复用原生，
  //   底部补一排「模型设置 / 导入图片 / 导出图片 / 预览结果 / 生成图片」。
  // - 文本模式：文本模板（原生“预”按钮）、推理模型下拉、API 下拉与生成按钮
  //   全部复用原生，底部补「模型设置 / 预览结果 / 推理并输出到文本节点」。
  //   原生文本面板没有“参数设置”控件，因此不伪造该按钮；也没有参考图入口，
  //   所以文本模式不提供“导入图片”。
  //
  // 关键边界与踩过的坑：
  // 1. 补丁只做布局与入口转发，不复制任何生成逻辑；导出/预览只读节点真实
  //    results，没有结果时给中文错误提示，绝不伪造成功。
  // 2. 颜色一律使用画布的 --panel-* / --text-* / --accent 变量，随浅色/深色
  //    主题切换，不写死轻语 AI 的深蓝灰。
  // 3. 注入控件的点击监听必须挂在 document 的**捕获阶段**：原生 aside 在
  //    React 根容器上调用 stopPropagation，冒泡阶段的监听永远收不到。
  // 4. dataset 的键名不能含连字符（`dataset["ms-text-action"]` 会抛异常并
  //    中断整条流程），因此属性名手写 setAttribute，读取用 dataset.msTextAction。
  // 5. 清理时写进 .inspector 的内联 opacity/pointer-events/display 必须还原，
  //    否则原生 .inspector--open 被内联值压住，下一次选节点面板再也打不开。
  // 6. 定位只贴节点正下方：不翻到上方、不把 top/left 夹回视口，节点划出屏幕时
  //    卡片跟着一起划出；卡片高度固定，不再按剩余空间压扁（压扁会让卡片尺寸
  //    随滚动反复变化）。React Flow 开了 onlyRenderVisibleElements，节点划出
  //    视口后 DOM 会被卸载，此时用 node.position + viewport transform 反算。
  // 7. 缓存的 zustand 快照可能来自已卸载组件残留的 hook，切换选中节点后会读到
  //    旧 state，因此判定失败时先重扫 fiber，再用 React Flow 的 selected 标记
  //    兜底；本补丁自己改 DOM 会持续触发 MutationObserver，所以只在卡片确实
  //    激活时才做清理，避免“清理 -> 改 DOM -> 再清理”的自激循环。
  // 8. 只有用户真的点过节点才激活，避免打开页面就自动弹卡片。
  // ---------------------------------------------------------------------------

  const EDITOR_CLASS = "ms-image-editor";
  const POSITIONED_CLASS = "ms-image-editor-positioned";
  let hasUserInteracted = false;
  let suppressUntil = Infinity;
  let suppressCheckFrame = 0;
  const STYLE_ID = "ms-image-editor-style";
  const TOAST_ID = "ms-image-editor-toast";
  const MAX_WIDTH = 572;
  const MAX_HEIGHT = 440;
  const NODE_GAP = 10;
  const PLACEHOLDER_TEXT =
    "在这里自由输入图片提示词，内容较长时可滚动或放大编辑。";
  const REFERENCE_HINT = "（输入 @ 可选择已链接图片）";

  // ======= 文本模式常量 =======
  const TEXT_MODE_CLASS = "ms-text-editor";
  const TEXT_PLACEHOLDER =
    "在这里自由输入提示词 / 文本，内容较长时可滚动或放大编辑。";
  const TEXT_PROMPT_LABEL = "提示词 / 文本";
  const TEXT_MODEL_LABEL = "推理模型";
  const TEXT_TEMPLATE_LABEL = "文本模板";
  // dataset 的键名必须是合法 JS 标识符，因此属性名手写、读取走 dataset.msTextAction
  const TEXT_ACTION_ATTR = "data-ms-text-action";

  // 当前浮动卡片服务的节点类别："image" | "text"
  let activeCategory = "image";

  let storeReader = null;
  let observer = null;
  let scheduleFrame = 0;
  let positionFrame = 0;
  let toastTimer = 0;
  let followTimer = 0;
  let cleanupTimer = 0;
  // 诊断：记录最近一次 decorate 的判定结果，便于回归脚本自测
  let lastDecision = "init";

  const STYLE = `
/* Hide all native inspectors by default */
.inspector.inspector--open { opacity: 0 !important; pointer-events: none !important; transform: translate(calc(100% + 28px)) !important; }

    .inspector.${EDITOR_CLASS} {
      position: fixed !important;
      right: auto !important;
      bottom: auto !important;
      left: 72px;
      top: 62px;
      z-index: 40;
      display: flex !important;
      flex-direction: column !important;
      width: min(${MAX_WIDTH}px, calc(100vw - 88px)) !important;
      height: min(${MAX_HEIGHT}px, calc(100vh - 20px)) !important;
      max-height: calc(100vh - 20px) !important;
      padding: 14px 16px 16px !important;
      margin: 0 !important;
      overflow: hidden !important;
      background: var(--panel-bg-strong) !important;
      border: 1px solid var(--panel-border-strong) !important;
      border-radius: 14px !important;
      box-shadow: var(--panel-shadow-strong) !important;
      color: var(--text-primary) !important;
      -webkit-backdrop-filter: blur(18px) saturate(1.08);
      backdrop-filter: blur(18px) saturate(1.08);
      opacity: 0;
      transform: translateY(-4px) scale(0.992);
      transition: opacity 160ms ease, transform 180ms ease;
      pointer-events: auto;
    }

    /* 可见态必须整组带 !important：上面那条针对原生 .inspector--open 的隐藏
       规则虽然优先级更低，但带 !important，不加就会把浮动卡片一起藏掉，
       表现为选中节点后卡片既看不见也点不动。 */
    .inspector.${EDITOR_CLASS}.${POSITIONED_CLASS} {
      opacity: 1 !important;
      transform: none !important;
      pointer-events: auto !important;
    }

    .inspector.${EDITOR_CLASS} .inspector__header {
      flex: 0 0 auto;
      width: 100%;
      height: auto;
      padding: 0 0 10px;
      margin: 0;
      gap: 10px;
      align-items: flex-start;
    }

    .inspector.${EDITOR_CLASS} .inspector__title-wrap {
      flex: 1 1 auto;
      width: auto;
      min-width: 0;
      gap: 5px;
    }

    .inspector.${EDITOR_CLASS} .inspector__eyebrow {
      display: none !important;
    }

    .inspector.${EDITOR_CLASS} .inspector__title {
      margin: 0;
      color: var(--text-primary) !important;
      font-size: 17px;
      line-height: 1.35;
      font-weight: 650;
      letter-spacing: 0.01em;
    }

    .inspector.${EDITOR_CLASS} .inspector__close {
      flex: none;
      width: 28px;
      height: 28px;
      margin-top: -2px;
      color: var(--text-secondary) !important;
      border-radius: 7px;
    }

    .inspector.${EDITOR_CLASS} .inspector__close:hover {
      color: var(--text-primary) !important;
      background: var(--soft-hover) !important;
    }

    .inspector.${EDITOR_CLASS} .ms-image-reference {
      display: block;
      max-width: 100%;
      overflow: hidden;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.5;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inspector.${EDITOR_CLASS} .inspector__tools {
      display: none !important;
    }

    .inspector.${EDITOR_CLASS} .inspector__body {
      flex: 1 1 auto !important;
      width: 100% !important;
      height: auto !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel--image {
      width: 100% !important;
      height: 100% !important;
      min-height: 0 !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__header {
      display: none !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__body {
      display: flex !important;
      flex: 1 1 auto !important;
      flex-direction: column !important;
      width: 100% !important;
      height: 100% !important;
      min-height: 0 !important;
      overflow: hidden !important;
    }

    .inspector.${EDITOR_CLASS} .ms-image-prompt-label {
      flex: 0 0 auto;
      margin: 0 2px 7px;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.4;
    }

    .inspector.${EDITOR_CLASS} .action-panel__prompt-shell {
      position: relative !important;
      flex: 1 1 auto !important;
      width: 100% !important;
      min-height: 96px !important;
      margin: 0 !important;
      overflow: hidden !important;
      background: var(--panel-bg-muted) !important;
      border: 1px solid var(--panel-border) !important;
      border-radius: 10px !important;
      box-shadow: inset 0 1px 0 #ffffff10;
    }

    .inspector.${EDITOR_CLASS} .action-panel__prompt-highlight,
    .inspector.${EDITOR_CLASS} .action-panel__prompt-input {
      width: 100% !important;
      height: 100% !important;
      min-height: 0 !important;
      padding: 14px 16px !important;
      color: var(--text-primary) !important;
      caret-color: var(--text-primary) !important;
      font-family: inherit !important;
      font-size: 13px !important;
      line-height: 1.65 !important;
      background: transparent !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__prompt-input {
      resize: none !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__prompt-input::selection {
      color: var(--canvas-bg);
      background: var(--text-primary);
    }

    .inspector.${EDITOR_CLASS} .action-panel__prompt-placeholder {
      top: 14px !important;
      right: 16px !important;
      left: 16px !important;
      color: var(--text-tertiary) !important;
      font-size: 13px !important;
      line-height: 1.65 !important;
      pointer-events: none;
    }

    .inspector.${EDITOR_CLASS} .action-panel__footer {
      flex: 0 0 auto;
      display: flex !important;
      flex-direction: row !important;
      flex-wrap: nowrap !important;
      width: 100% !important;
      height: auto !important;
      margin: 12px 0 0 !important;
      padding: 0 !important;
      gap: 8px !important;
      align-items: center !important;
      background: transparent !important;
      border: 0 !important;
      border-radius: 0 !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__left {
      display: flex !important;
      flex-direction: row !important;
      flex-wrap: nowrap !important;
      flex: 1 1 auto !important;
      width: 100% !important;
      min-width: 0 !important;
      gap: 8px !important;
      align-items: center !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__left::before {
      content: "图片模型";
      flex: none;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1;
    }

    .inspector.${EDITOR_CLASS} .action-panel__model-select {
      flex: 1 1 auto !important;
      width: auto !important;
      min-width: 0 !important;
      height: 34px !important;
      padding: 0 10px !important;
      gap: 7px !important;
      color: var(--text-primary) !important;
      background: var(--panel-bg-muted) !important;
      border: 1px solid var(--panel-border-strong) !important;
      border-radius: 8px !important;
      font-size: 13px !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__model-select::before {
      content: "图片 API";
      flex: none;
      padding-right: 8px;
      color: var(--text-secondary);
      border-right: 1px solid var(--panel-border);
      font-size: 12px;
      line-height: 1;
    }

    .inspector.${EDITOR_CLASS} .action-panel__model-icon {
      display: none !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__model-select > span {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--text-primary) !important;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inspector.${EDITOR_CLASS} .action-panel__model-select > .chevron {
      flex: none;
      color: var(--text-tertiary) !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__sep-vert {
      display: none !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__params-select {
      flex: none !important;
      display: flex !important;
      width: 96px !important;
      height: 34px !important;
      padding: 0 10px !important;
      gap: 6px !important;
      align-items: center !important;
      justify-content: center !important;
      color: var(--text-primary) !important;
      background: var(--panel-bg-muted) !important;
      border: 1px solid var(--panel-border-strong) !important;
      border-radius: 8px !important;
      font-size: 12px !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__params-select::before {
      content: "参数设置";
      color: var(--text-primary);
      font-size: 12px;
      line-height: 1;
    }

    .inspector.${EDITOR_CLASS} .action-panel__params-select > .action-panel__ratio-icon,
    .inspector.${EDITOR_CLASS} .action-panel__params-select > span,
    .inspector.${EDITOR_CLASS} .action-panel__params-select > .chevron {
      display: none !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__tools {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      padding: 0 !important;
      margin: 0 !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
      clip-path: inset(50%) !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__dropdown {
      width: 100% !important;
      max-width: 100% !important;
      color: var(--text-primary) !important;
      background: var(--panel-bg-strong) !important;
      border: 1px solid var(--panel-border-strong) !important;
      border-radius: 10px !important;
      box-shadow: var(--panel-shadow-strong) !important;
      -webkit-backdrop-filter: blur(18px);
      backdrop-filter: blur(18px);
    }

    .inspector.${EDITOR_CLASS} .action-panel__dropdown-item {
      color: var(--text-primary) !important;
    }

    .inspector.${EDITOR_CLASS} .action-panel__dropdown-item:hover,
    .inspector.${EDITOR_CLASS} .action-panel__dropdown-item.active {
      background: var(--soft-hover) !important;
    }

    /* 图片/文本模型列表统一向下展开，与视频节点一致：bundle 里
       .inspector .action-panel__dropdown 用 inset:auto 0 calc(100% + 8px)
       把面板内所有下拉钉在触发器上方，这里必须用 !important 反向覆盖。
       文本模式必须排除 .action-panel__dropdown--text-preset：那个由
       positionTextPresetDropdown 自己按行矩形定位，套上 top/left 会被拽偏。 */
    .inspector.${EDITOR_CLASS} .action-panel--image .action-panel__model-select > .action-panel__dropdown,
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text .action-panel__model-select > .action-panel__dropdown {
      inset: auto auto auto 0 !important;
      top: calc(100% + 8px) !important;
      bottom: auto !important;
      left: 0 !important;
      right: auto !important;
      width: 100% !important;
    }


    /* 只有真的挂了参数面板时才让 footer 换行，文本节点面板保持单行。 */
    .inspector.${EDITOR_CLASS} .action-panel__footer:has(.action-panel__param-sheet) {
      flex-wrap: wrap !important;
    }

    /* 原生参数面板类名是 .action-panel__param-sheet（不是 dropdown--params）：
       它本就在 footer 第二行整宽显示，这里保持整行，不再被挤成右侧窄列。 */
    .inspector.${EDITOR_CLASS} .action-panel__param-sheet {
      order: 3;
      flex: 1 0 100% !important;
      width: 100% !important;
      min-width: 0 !important;
    }

    /* 面板打开时卡片高度跟随内容，避免底部按钮行和面板最后一行被 overflow:hidden 裁掉。 */
    .inspector.${EDITOR_CLASS}:has(.action-panel__param-sheet) {
      height: auto !important;
      max-height: calc(100vh - 20px) !important;
      overflow-y: auto !important;
    }

    /* 模型列表向下展开会超出卡片底部：卡片根、.inspector__body、.action-panel__body
       在本补丁里都是 overflow:hidden !important，只放开其中一层仍然会被上一层裁掉，
       所以列表打开时整条祖先链一起放开。 */
    .inspector.${EDITOR_CLASS}:has(.action-panel__dropdown--model),
    .inspector.${EDITOR_CLASS}:has(.action-panel__dropdown--model) .inspector__body,
    .inspector.${EDITOR_CLASS}:has(.action-panel__dropdown--model) .action-panel--image,
    .inspector.${EDITOR_CLASS}:has(.action-panel__dropdown--model) .action-panel--text,
    .inspector.${EDITOR_CLASS}:has(.action-panel__dropdown--model) .action-panel__body,
    .inspector.${EDITOR_CLASS}:has(.action-panel__dropdown--model) .action-panel__footer,
    .inspector.${EDITOR_CLASS}:has(.action-panel__dropdown--model) .action-panel__left,
    .inspector.${EDITOR_CLASS}:has(.action-panel__dropdown--model) .action-panel__model-select {
      overflow: visible !important;
    }

    .inspector.${EDITOR_CLASS} .ms-image-model-line {
      flex: 0 0 auto;
      margin: 8px 2px 0;
      overflow: hidden;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.45;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inspector.${EDITOR_CLASS} .ms-image-model-line strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .inspector.${EDITOR_CLASS} .ms-image-actions {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr)) minmax(0, 1.12fr);
      gap: 8px;
      margin-top: 11px;
    }

    .inspector.${EDITOR_CLASS} .ms-image-actions button {
      height: 36px;
      min-width: 0;
      padding: 0 9px;
      overflow: hidden;
      color: var(--text-primary);
      background: var(--panel-bg-muted);
      border: 1px solid var(--panel-border-strong);
      border-radius: 8px;
      font-family: inherit;
      font-size: 12px;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      transition: background 130ms ease, border-color 130ms ease,
        transform 100ms ease, opacity 130ms ease;
    }

    .inspector.${EDITOR_CLASS} .ms-image-actions button:hover {
      background: var(--soft-hover);
      border-color: var(--panel-border-strong);
    }

    .inspector.${EDITOR_CLASS} .ms-image-actions button:active {
      transform: translateY(1px);
    }

    .inspector.${EDITOR_CLASS} .ms-image-actions button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .inspector.${EDITOR_CLASS} .ms-image-actions button[data-ms-image-action="generate"] {
      color: var(--canvas-bg);
      background: var(--accent);
      border-color: var(--accent);
      font-weight: 650;
    }

    .inspector.${EDITOR_CLASS} .ms-image-actions button[data-ms-image-action="generate"]:hover {
      opacity: 0.86;
    }

    .inspector.${EDITOR_CLASS} .ms-image-actions button[data-ms-image-action="generate"]:disabled {
      opacity: 0.48;
      cursor: not-allowed;
    }

    #${TOAST_ID} {
      position: fixed;
      left: 50%;
      bottom: 24px;
      z-index: 999999;
      max-width: min(560px, calc(100vw - 32px));
      padding: 10px 14px;
      overflow: hidden;
      color: var(--text-primary);
      background: var(--panel-bg-strong);
      border: 1px solid var(--panel-border-strong);
      border-radius: 9px;
      box-shadow: var(--panel-shadow-strong);
      font-size: 13px;
      line-height: 1.55;
      opacity: 0;
      pointer-events: none;
      transform: translate(-50%, 10px);
      transition: opacity 160ms ease, transform 180ms ease;
    }

    #${TOAST_ID}.is-visible {
      opacity: 1;
      transform: translate(-50%, 0);
    }

    #${TOAST_ID}[data-type="error"] {
      border-color: #d15a4a;
    }

    :root[data-theme="dark"] #${TOAST_ID}[data-type="error"] {
      color: #ff9a8d;
    }

    @media (max-width: 760px) {
      .inspector.${EDITOR_CLASS} {
        left: 66px !important;
        width: calc(100vw - 76px) !important;
      }
    }
  `;


  // ======= 文本模式样式 =======
  // 只在 .ms-text-editor 上叠加：卡片外框、跟随定位、颜色变量全部复用上面
  // 图片模式的基础样式，这里只重排文本面板内部的顺序与外观。
  const TEXT_STYLE = `
    /* 文本模板行：点它等于点原生「预」按钮，预设下拉由 JS 钉在本行下方 */
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-template-row {
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      height: 34px;
      margin: 0 0 10px;
      padding: 0 10px;
      color: var(--text-primary);
      background: var(--panel-bg-muted);
      border: 1px solid var(--panel-border-strong);
      border-radius: 8px;
      font-family: inherit;
      font-size: 13px;
      cursor: pointer;
      transition: background 130ms ease, border-color 130ms ease;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-template-row:hover {
      background: var(--soft-hover);
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-template-row:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-template-label {
      flex: none;
      color: var(--text-secondary);
      font-size: 12px;
      padding-right: 8px;
      border-right: 1px solid var(--panel-border);
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-template-value {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-template-chevron {
      flex: none;
      color: var(--text-tertiary);
      font-size: 11px;
    }

    /* 原生「预」按钮与圆形生成按钮改为由本补丁转发点击，视觉上收起 */
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel__tool-btn--preset,
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel__generate-btn {
      display: none !important;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel__tools {
      gap: 0 !important;
      min-height: 0 !important;
    }

    /* 「预」按钮与圆形生成按钮改为由模板行/按钮行转发：退出文档流，
       既不再占位，也让预设下拉以它为包含块由 JS 精确定位。 */
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel__tools {
      position: absolute !important;
      width: 0 !important;
      height: 0 !important;
      margin: 0 !important;
      padding: 0 !important;
      gap: 0 !important;
      overflow: visible !important;
    }

    /* 预设下拉：脱离文档流，钉在文本模板行正下方（left/top 由 JS 计算） */
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel__dropdown--text-preset {
      position: absolute !important;
      inset: auto !important;
      width: auto !important;
      max-width: none !important;
      transform: none !important;
      z-index: 60;
      margin: 0;
    }

    /* 提示词标签 + 输入区 */
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-prompt-label {
      flex: 0 0 auto;
      margin: 0 2px 7px;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.4;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text > .action-panel__prompt-input {
      flex: 1 1 auto !important;
      width: 100% !important;
      min-height: 96px !important;
      margin: 0 !important;
      padding: 14px 16px !important;
      color: var(--text-primary) !important;
      caret-color: var(--text-primary) !important;
      font-family: inherit !important;
      font-size: 13px !important;
      line-height: 1.65 !important;
      background: var(--panel-bg-muted) !important;
      border: 1px solid var(--panel-border) !important;
      border-radius: 10px !important;
      resize: none !important;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text > .action-panel__prompt-input::selection {
      color: var(--canvas-bg);
      background: var(--text-primary);
    }

    /* footer 内部：模型行 / API 行 / 模型回显 / 按钮行 */
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text .action-panel__footer {
      flex: 0 0 auto !important;
      flex-direction: column !important;
      align-items: stretch !important;
      gap: 8px !important;
      margin: 12px 0 0 !important;
      padding: 0 !important;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-field-label {
      flex: 0 0 auto;
      margin: 2px 2px 0;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.4;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text .action-panel__model-select {
      flex: none !important;
      width: 100% !important;
      height: 34px !important;
      padding: 0 10px !important;
      gap: 7px !important;
      color: var(--text-primary) !important;
      background: var(--panel-bg-muted) !important;
      border: 1px solid var(--panel-border-strong) !important;
      border-radius: 8px !important;
      font-size: 13px !important;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text .action-panel__model-select::before {
      content: "文本 API";
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text .action-panel__model-select > span {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      color: var(--text-primary) !important;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text .action-panel__model-select > .chevron {
      flex: none;
      color: var(--text-tertiary) !important;
    }

    /* 第二个下拉是 API 来源，加一条分隔标签 */
    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .action-panel--text .action-panel__model-select + .action-panel__model-select {
      margin-top: 0 !important;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-model-line {
      flex: 0 0 auto;
      margin: 2px 2px 0;
      overflow: hidden;
      color: var(--text-secondary);
      font-size: 12px;
      line-height: 1.45;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-model-line strong {
      color: var(--text-primary);
      font-weight: 600;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-actions {
      flex: 0 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 0.8fr) minmax(0, 0.8fr) minmax(0, 1.4fr);
      gap: 8px;
      margin-top: 3px;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-actions button {
      height: 36px;
      min-width: 0;
      padding: 0 9px;
      overflow: hidden;
      color: var(--text-primary);
      background: var(--panel-bg-muted);
      border: 1px solid var(--panel-border-strong);
      border-radius: 8px;
      font-family: inherit;
      font-size: 12px;
      line-height: 1;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
      transition: background 130ms ease, border-color 130ms ease,
        transform 100ms ease, opacity 130ms ease;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-actions button:hover {
      background: var(--soft-hover);
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-actions button:active {
      transform: translateY(1px);
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-actions button:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-actions button[data-ms-text-action="generate"] {
      color: var(--canvas-bg);
      background: var(--accent);
      border-color: var(--accent);
      font-weight: 650;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-actions button[data-ms-text-action="generate"]:hover {
      opacity: 0.86;
    }

    .inspector.${EDITOR_CLASS}.${TEXT_MODE_CLASS} .ms-text-actions button[data-ms-text-action="generate"]:disabled {
      opacity: 0.48;
      cursor: not-allowed;
    }

    /* 「模型设置」跳转后高亮当前启用配置的模型列表（分区由 api-profiles-patch.js 渲染） */
    .ms-api-models--flash {
      outline: 2px solid #ff6a1a;
      outline-offset: 6px;
      border-radius: 12px;
      transition: outline-color 320ms ease;
    }
  `;

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE + TEXT_STYLE;
    document.head.appendChild(style);
  }

  function showToast(message, type) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.dataset.type = type === "error" ? "error" : "info";
    toast.classList.add("is-visible");
    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(
      () => toast.classList.remove("is-visible"),
      4200
    );
  }

  // ======= 读取画布 store =======
  // 与 video-node-patch.js 使用同一套 fiber 查找方式：bundle 的 zustand store
  // 没有挂到 window，只能从 React fiber 的 hook 上取 useSyncExternalStore 快照。
  function isCanvasState(state) {
    return (
      !!state &&
      typeof state === "object" &&
      Array.isArray(state.nodes) &&
      Array.isArray(state.edges) &&
      typeof state.replaceCanvasState === "function"
    );
  }

  function findCanvasStore() {
    // fiber 里可能同时存在「活快照读取器」（getSnapshot，每次返回最新 state）
    // 与某个组件 useState 里残留的「冻结 state 对象」。冻结对象不会随
    // updateNodeData 更新：先返回它的话，新生成的 results 永远读成空，
    // 表现为「刚生成完导出/预览没结果，刷新页面才好」。因此优先找活读取器，
    // 冻结对象只在全树都没有活读取器时才用。
    let fallbackReader = null;
    const rootEl = document.getElementById("root");
    if (!rootEl) return null;
    const containerKey = Object.keys(rootEl).find((key) =>
      key.startsWith("__reactContainer$")
    );
    const startFiber = containerKey ? rootEl[containerKey] : null;
    if (!startFiber) return null;

    const stack = [startFiber];
    const seen = new Set();
    let visited = 0;

    while (stack.length && visited < 200000) {
      const fiber = stack.pop();
      if (!fiber || seen.has(fiber)) continue;
      seen.add(fiber);
      visited += 1;

      let hook = fiber.memoizedState;
      let guard = 0;
      while (hook && typeof hook === "object" && guard++ < 400) {
        const candidates = [
          hook.memoizedState,
          hook.queue && hook.queue.lastRenderedState,
        ];
        for (const candidate of candidates) {
          if (
            !candidate ||
            typeof candidate !== "object" ||
            Array.isArray(candidate)
          ) {
            continue;
          }
          if (typeof candidate.getSnapshot === "function") {
            let latest = null;
            try {
              latest = candidate.getSnapshot();
            } catch (_) {
              latest = null;
            }
            if (isCanvasState(latest)) {
              return () => {
                try {
                  const state = candidate.getSnapshot();
                  return isCanvasState(state) ? state : null;
                } catch (_) {
                  return null;
                }
              };
            }
            continue;
          }
          if (isCanvasState(candidate) && !fallbackReader) {
            fallbackReader = () => candidate;
          }
        }
        hook = hook.next;
      }

      if (fiber.child) stack.push(fiber.child);
      if (fiber.sibling) stack.push(fiber.sibling);
    }
    return fallbackReader;
  }

  function readCanvasState() {
    if (storeReader) {
      const cached = storeReader();
      if (isCanvasState(cached)) return cached;
      storeReader = null;
    }
    storeReader = findCanvasStore();
    return storeReader ? storeReader() : null;
  }

  // zustand 快照可能来自已卸载组件残留的 hook，切换选中节点后会读到旧
  // state。判定失败时先丢弃缓存重扫一次 fiber。
  function refreshCanvasState() {
    storeReader = null;
    return readCanvasState();
  }

  // 最后兜底：原生面板本身就是按「当前唯一选中的图片/文本节点」渲染的，
  // 所以 React Flow 自己的 selected 标记同样可信。
  function getDomSelectedNodeElement(category) {
    const selected = Array.from(
      document.querySelectorAll(".react-flow__node.selected")
    );
    if (selected.length !== 1) return null;
    const element = selected[0];
    const isText = !!element.querySelector("[data-text-editor-id]");
    if (category === "text" && !isText) return null;
    if (category === "image" && isText) return null;
    return element;
  }

  // React Flow 自己维护的 selected 标记：只有一个选中节点时才可信
  function getDomSelectedNodeId() {
    const selected = Array.from(
      document.querySelectorAll(".react-flow__node.selected")
    );
    if (selected.length !== 1) return null;
    return selected[0].dataset?.id || null;
  }

  function getSelectedNodeByCategory(state, category) {
    if (!state || !category) return null;
    const nodes = state.nodes || [];
    const matchCategory = (id) => {
      if (!id) return null;
      const node = nodes.find((item) => item.id === id);
      return node && node.data && node.data.category === category ? node : null;
    };
    const storeId =
      state.selectedNodeId || (state.selectedNodeIds || [])[0] || null;
    const storeNode = matchCategory(storeId);
    const domNode = matchCategory(getDomSelectedNodeId());
    // 两边都命中同一类别时以 DOM 为准：fiber 快照可能滞后，同类别切换
    // （图片→图片）只有 DOM 的 selected 标记是新的，否则卡片粘在上一个节点。
    // 只有一边命中当前类别时以命中的为准：反推等「程序化跨类别选中」时
    // store 已指向新文本节点、DOM 高亮类还挂在旧图片节点，无脑信 DOM 会锚错。
    return domNode || storeNode;
  }

  function getSelectedImageNode(state) {
    return getSelectedNodeByCategory(state, "image");
  }

  // 当前浮动卡片服务的节点：类别由 activeCategory 决定（image / text）
  function getActiveNode(state) {
    return getSelectedNodeByCategory(state, activeCategory);
  }

  function getSelectedNodeElement(state) {
    const node = getActiveNode(state);
    const nodes = Array.from(document.querySelectorAll(".react-flow__node"));
    if (node) {
      const matched = nodes.find((element) => element.dataset.id === node.id);
      if (matched) return matched;
    }
    return getDomSelectedNodeElement(activeCategory);
  }

  function pickResult(data) {
    const results = Array.isArray(data.results) ? data.results : [];
    const index =
      Number.isInteger(data.activeResultIndex) && data.activeResultIndex >= 0
        ? data.activeResultIndex
        : 0;
    const rawResult = results[index] || results[0] || null;
    return typeof rawResult === "string" ? { mediaUrl: rawResult } : rawResult;
  }

  function getResultInfo() {
    let state = readCanvasState();
    let node = getSelectedImageNode(state);
    // 刚生成完 results 却读成空：多半是缓存的冻结快照滞后，丢缓存重扫一次
    if (node && !pickResult(node.data || {})) {
      const fresh = refreshCanvasState();
      const freshNode = getSelectedImageNode(fresh);
      if (freshNode && pickResult(freshNode.data || {})) {
        state = fresh;
        node = freshNode;
      }
    }
    if (!node) {
      return { state: null, node: null, result: null, fileName: "" };
    }

    const data = node.data || {};
    const result = pickResult(data);
    const fileName =
      (result && result.fileName) || data.fileName || `${node.id}.png`;
    return { state, node, result, fileName };
  }

  function getPreviewSource(info) {
    if (!info.result) return "";
    return (
      info.result.mediaUrl ||
      info.result.url ||
      info.result.imageUrl ||
      info.result.dataUrl ||
      info.result.localPath ||
      ""
    );
  }

  function getDownloadSource(info) {
    if (!info.result) return "";
    return (
      info.result.localPath ||
      info.result.mediaUrl ||
      info.result.url ||
      info.result.imageUrl ||
      info.result.dataUrl ||
      ""
    );
  }

  function countReferencedImages(state, node) {
    if (!state || !node) return 0;
    const data = node.data || {};
    for (const key of [
      "referenceImages",
      "referencedImages",
      "referenceAssets",
    ]) {
      if (Array.isArray(data[key])) return data[key].length;
    }

    const incoming = (state.edges || []).filter(
      (edge) => edge.target === node.id
    );
    let count = 0;
    for (const edge of incoming) {
      const source = (state.nodes || []).find((item) => item.id === edge.source);
      if (!source || !source.data) continue;
      const category = String(source.data.category || "");
      const hasImage =
        category === "image" ||
        category === "imageAsset" ||
        category.toLowerCase().includes("image") ||
        (Array.isArray(source.data.results) && source.data.results.length > 0);
      if (hasImage) count += 1;
    }
    return count;
  }

  function getModelLabel(inspector) {
    const modelSpan =
      inspector.querySelector(
        ".action-panel__model-select span[data-ms-native-label]"
      ) ||
      inspector.querySelector(".action-panel__model-select > span");
    const raw = modelSpan ? modelSpan.textContent.trim() : "";
    if (!raw) return "未选择";
    return raw.replace(/\s*[（(][^（）()]*[）)]\s*/g, "").trim() || raw;
  }

  function isGenerating(node, inspector) {
    const status = String((node && node.data && node.data.status) || "");
    if (/run|generat|load|pending|queue|process/i.test(status)) return true;
    const sendButton = inspector.querySelector(".action-panel__send-btn");
    if (!sendButton) return false;
    return (
      sendButton.disabled ||
      sendButton.getAttribute("aria-disabled") === "true" ||
      sendButton.dataset.loading === "true"
    );
  }

  function createElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function ensureReferenceLine(inspector) {
    const titleWrap = inspector.querySelector(".inspector__title-wrap");
    if (!titleWrap) return null;
    let line = titleWrap.querySelector(".ms-image-reference");
    if (!line) {
      line = createElement("span", "ms-image-reference");
      line.dataset.msImageReference = "1";
      titleWrap.appendChild(line);
    }
    return line;
  }

  function ensurePromptLabel(inspector) {
    const panelBody = inspector.querySelector(
      ".action-panel--image .action-panel__body"
    );
    const promptShell = panelBody
      ? panelBody.querySelector(".action-panel__prompt-shell")
      : null;
    if (!panelBody || !promptShell) return null;

    let label = panelBody.querySelector(".ms-image-prompt-label");
    if (!label) {
      label = createElement("div", "ms-image-prompt-label", "提示词 / 文本");
      label.dataset.msImagePromptLabel = "1";
    }
    if (label.parentElement !== panelBody || label.nextElementSibling !== promptShell) {
      panelBody.insertBefore(label, promptShell);
    }
    return label;
  }

  function ensureModelLine(inspector) {
    const panelBody = inspector.querySelector(
      ".action-panel--image .action-panel__body"
    );
    const footer = panelBody
      ? panelBody.querySelector(".action-panel__footer")
      : null;
    if (!panelBody || !footer) return null;

    let line = panelBody.querySelector(".ms-image-model-line");
    if (!line) {
      line = createElement("div", "ms-image-model-line");
      line.dataset.msImageModelLine = "1";
    }
    if (line.parentElement !== panelBody || footer.nextElementSibling !== line) {
      footer.after(line);
    }
    return line;
  }

  function ensureActions(inspector) {
    const panelBody = inspector.querySelector(
      ".action-panel--image .action-panel__body"
    );
    const modelLine = panelBody
      ? panelBody.querySelector(".ms-image-model-line")
      : null;
    if (!panelBody || !modelLine) return null;

    let actions = panelBody.querySelector(".ms-image-actions");
    if (!actions) {
      actions = createElement("div", "ms-image-actions");
      actions.dataset.msImageActions = "1";
      const labels = [
        ["model", "模型设置"],
        ["import", "导入图片"],
        ["export", "导出图片"],
        ["preview", "预览结果"],
        ["generate", "生成图片"],
      ];
      for (const [action, label] of labels) {
        const button = createElement("button", "", label);
        button.type = "button";
        button.dataset.msImageAction = action;
        actions.appendChild(button);
      }
    }
    if (actions.parentElement !== panelBody || modelLine.nextElementSibling !== actions) {
      modelLine.after(actions);
    }
    return actions;
  }

  function ensureChrome(inspector) {
    const title = inspector.querySelector(".inspector__title");
    if (title) {
      if (!title.dataset.msImageOriginalTitle) {
        title.dataset.msImageOriginalTitle = title.textContent;
      }
      if (title.textContent !== "图片节点") title.textContent = "图片节点";
    }

    const placeholder = inspector.querySelector(
      ".action-panel__prompt-placeholder"
    );
    if (placeholder) {
      if (!placeholder.dataset.msImageOriginalPlaceholder) {
        placeholder.dataset.msImageOriginalPlaceholder = placeholder.textContent;
      }
      if (placeholder.textContent !== PLACEHOLDER_TEXT) {
        placeholder.textContent = PLACEHOLDER_TEXT;
      }
    }

    const promptInput = inspector.querySelector(
      ".action-panel__prompt-input"
    );
    if (promptInput) {
      promptInput.setAttribute("aria-label", "提示词 / 文本");
      promptInput.spellcheck = false;
    }

    ensureReferenceLine(inspector);
    ensurePromptLabel(inspector);
    ensureModelLine(inspector);
    ensureActions(inspector);
  }

  function refreshMeta(inspector) {
    const state = readCanvasState();
    const node = getSelectedImageNode(state);

    const referenceLine = inspector.querySelector(".ms-image-reference");
    if (referenceLine) {
      const count = countReferencedImages(state, node);
      referenceLine.textContent =
        count > 0
          ? `已引用：${count} 张${REFERENCE_HINT}`
          : `已引用：无${REFERENCE_HINT}`;
    }

    const modelLine = inspector.querySelector(".ms-image-model-line");
    if (modelLine) {
      const model = getModelLabel(inspector);
      modelLine.textContent = "";
      const prefix = document.createTextNode("模型: ");
      const value = createElement("strong", "", model);
      modelLine.append(prefix, value);
    }

    const generateButton = inspector.querySelector(
      '[data-ms-image-action="generate"]'
    );
    if (generateButton) {
      const generating = isGenerating(node, inspector);
      generateButton.disabled = generating;
      generateButton.textContent = generating ? "生成中…" : "生成图片";
      generateButton.setAttribute("aria-busy", generating ? "true" : "false");
    }
  }

  // ======= 文本模式：DOM 组装 =======
  // 只做三件事：给原生控件加中文标签、把「预」按钮换成一条可读的模板行、
  // 在底部补一排转发按钮。所有实际行为仍然由原生控件完成。

  // 模板名按节点记忆：切换节点后不会显示上一个节点的模板
  const templateNamesByNode = new Map();

  function currentTextNodeId(inspector) {
    const state = readCanvasState();
    const node = getSelectedNodeByCategory(state, "text");
    return node ? node.id : null;
  }

  function getTextPanel(inspector) {
    return inspector.querySelector(".action-panel--text");
  }

  function textSelector(name) {
    return `[${TEXT_ACTION_ATTR}="${name}"]`;
  }

  function ensureTemplateRow(inspector) {
    const panel = getTextPanel(inspector);
    if (!panel) return null;

    let row = panel.querySelector(".ms-text-template-row");
    if (!row) {
      row = createElement("button", "ms-text-template-row");
      row.type = "button";
      row.dataset.msTextTemplate = "1";
      row.setAttribute("aria-label", TEXT_TEMPLATE_LABEL);

      const label = createElement("span", "ms-text-template-label", TEXT_TEMPLATE_LABEL);
      const value = createElement("span", "ms-text-template-value", "选择模板");
      const chevron = createElement("span", "ms-text-template-chevron", "▾");
      row.append(label, value, chevron);
    }
    if (row.parentElement !== panel || panel.firstChild !== row) {
      panel.insertBefore(row, panel.firstChild);
    }

    const value = row.querySelector(".ms-text-template-value");
    if (value) {
      const presetButton = panel.querySelector(".action-panel__tool-btn--preset");
      const open = !!panel.querySelector(".action-panel__dropdown--text-preset");
      const nodeId = currentTextNodeId(inspector);
      const text = (nodeId && templateNamesByNode.get(nodeId)) || "选择模板";
      if (value.textContent !== text) value.textContent = text;
      row.setAttribute(
        "title",
        presetButton
          ? "点击选择文本模板（内置 + 自定义，在 设置 › 文本模板 管理）"
          : "模板入口未就绪，请稍候重试"
      );
      row.setAttribute("aria-expanded", open ? "true" : "false");
    }
    return row;
  }

  function ensureTextFieldLabel(inspector, index, text) {
    const panel = getTextPanel(inspector);
    if (!panel) return null;
    const selects = panel.querySelectorAll(".action-panel__model-select");
    const target = selects[index];
    if (!target) return null;

    const className = index === 0 ? "ms-text-field-label" : "ms-text-field-label ms-text-field-label--api";
    let label = target.previousElementSibling;
    if (!label || !label.classList.contains("ms-text-field-label")) {
      label = createElement("div", "ms-text-field-label", text);
      label.dataset.msTextFieldLabel = String(index);
      target.parentNode.insertBefore(label, target);
    }
    if (label.textContent !== text) label.textContent = text;
    if (label.nextElementSibling !== target) {
      target.parentNode.insertBefore(label, target);
    }
    return label;
  }

  function ensureTextPromptLabel(inspector) {
    const panel = getTextPanel(inspector);
    if (!panel) return null;
    const input = panel.querySelector(".action-panel__prompt-input");
    if (!input) return null;

    let label = panel.querySelector(".ms-text-prompt-label");
    if (!label) {
      label = createElement("div", "ms-text-prompt-label", TEXT_PROMPT_LABEL);
      label.dataset.msTextPromptLabel = "1";
    }
    if (label.nextElementSibling !== input) {
      panel.insertBefore(label, input);
    }
    return label;
  }

  function ensureTextModelLine(inspector) {
    const panel = getTextPanel(inspector);
    if (!panel) return null;
    const footer = panel.querySelector(".action-panel__footer");
    if (!footer) return null;

    let line = footer.querySelector(".ms-text-model-line");
    if (!line) {
      line = createElement("div", "ms-text-model-line");
      line.dataset.msTextModelLine = "1";
    }
    if (line.parentElement !== footer || footer.querySelector(textSelector("actions")) !== line.nextElementSibling) {
      const actions = footer.querySelector(textSelector("actions"));
      if (actions) footer.insertBefore(line, actions);
      else footer.appendChild(line);
    }
    return line;
  }

  function ensureTextActions(inspector) {
    const panel = getTextPanel(inspector);
    if (!panel) return null;
    const footer = panel.querySelector(".action-panel__footer");
    const modelLine = footer ? footer.querySelector(".ms-text-model-line") : null;
    if (!footer || !modelLine) return null;

    let actions = footer.querySelector(textSelector("actions"));
    if (!actions) {
      actions = createElement("div", "ms-text-actions");
      actions.setAttribute(TEXT_ACTION_ATTR, "actions");
      const labels = [
        ["model", "模型设置"],
        ["preview", "预览结果"],
        ["generate", "推理并输出到文本节点"],
      ];
      for (const [action, label] of labels) {
        const button = createElement("button", "", label);
        button.type = "button";
        button.dataset.msTextAction = action;
        actions.appendChild(button);
      }
    }
    if (modelLine.nextElementSibling !== actions) {
      modelLine.after(actions);
    }
    return actions;
  }

  function ensureTextChrome(inspector) {
    const title = inspector.querySelector(".inspector__title");
    if (title) {
      if (!title.dataset.msImageOriginalTitle) {
        title.dataset.msImageOriginalTitle = title.textContent;
      }
      if (title.textContent !== "文本节点") title.textContent = "文本节点";
    }

    const panel = getTextPanel(inspector);
    if (panel) {
      const input = panel.querySelector(".action-panel__prompt-input");
      if (input) {
        if (!input.dataset.msTextOriginalPlaceholder) {
          input.dataset.msTextOriginalPlaceholder = input.getAttribute("placeholder") || "";
        }
        if (input.getAttribute("placeholder") !== TEXT_PLACEHOLDER) {
          input.setAttribute("placeholder", TEXT_PLACEHOLDER);
        }
        input.setAttribute("aria-label", TEXT_PROMPT_LABEL);
        input.spellcheck = false;
      }
    }

    ensureTemplateRow(inspector);
    ensureTextPromptLabel(inspector);
    ensureTextFieldLabel(inspector, 0, TEXT_MODEL_LABEL);
    if (panel && panel.querySelectorAll(".action-panel__model-select").length > 1) {
      ensureTextFieldLabel(inspector, 1, "API 来源");
    }
    ensureTextModelLine(inspector);
    ensureTextActions(inspector);
    orderTextFooter(inspector);
    positionTextPresetDropdown(inspector);
  }

  // footer 里既有原生节点也有注入节点，用内联 order 固定视觉顺序：
  // 模型标签 → 模型下拉 → API 标签 → API 下拉 → 模型回显 → 按钮行。
  // React 不认识我们写入的 order，因此不会在重渲染时被抹掉。
  function orderTextFooter(inspector) {
    const panel = getTextPanel(inspector);
    if (!panel) return;
    const footer = panel.querySelector(".action-panel__footer");
    if (!footer) return;

    const selects = footer.querySelectorAll(".action-panel__model-select");
    const labels = footer.querySelectorAll(".ms-text-field-label");
    const modelLine = footer.querySelector(".ms-text-model-line");
    const actions = footer.querySelector(textSelector("actions"));
    const tools = footer.querySelector(".action-panel__tools");

    const set = (element, value) => {
      if (element && element.style.order !== value) element.style.order = value;
    };

    labels.forEach((label, index) => set(label, String(index * 2 + 1)));
    selects.forEach((select, index) => set(select, String(index * 2 + 2)));
    set(modelLine, String(selects.length * 2 + 3));
    set(actions, String(selects.length * 2 + 4));
    set(tools, "99");
  }

  function getApiLabel(inspector) {
    const selects = inspector.querySelectorAll(".action-panel--text .action-panel__model-select");
    if (selects.length < 2) return "";
    const span = selects[1].querySelector("span");
    return span ? span.textContent.trim() : "";
  }

  function refreshTextMeta(inspector) {
    const state = readCanvasState();
    const node = getSelectedNodeByCategory(state, "text");

    ensureTemplateRow(inspector);

    const line = inspector.querySelector(".ms-text-model-line");
    if (line) {
      const model = getModelLabel(inspector);
      const api = getApiLabel(inspector);
      line.textContent = "";
      const parts = [];
      parts.push(document.createTextNode("模型: "));
      parts.push(createElement("strong", "", model));
      if (api) {
        parts.push(document.createTextNode(" · API: "));
        parts.push(createElement("strong", "", api));
      }
      line.append(...parts);
    }

    const generateButton = inspector.querySelector(textSelector("generate"));
    if (generateButton) {
      const generating = isGenerating(node, inspector);
      generateButton.disabled = generating;
      generateButton.textContent = generating
        ? "推理中…"
        : "推理并输出到文本节点";
      generateButton.setAttribute("aria-busy", generating ? "true" : "false");
    }
  }

  // 预设下拉原本是内联展开的；在浮动卡片里改成钉在模板行正下方。
  // 包含块到底是哪一层由原生 CSS 决定，所以先用 left/top = 0 量出包含块
  // 原点，再换算成需要的偏移，避免硬编码层级关系。
  function positionTextPresetDropdown(inspector) {
    const panel = getTextPanel(inspector);
    if (!panel) return;
    const dropdown = panel.querySelector(".action-panel__dropdown--text-preset");
    const row = panel.querySelector(".ms-text-template-row");
    if (!dropdown || !row) return;

    const rowRect = row.getBoundingClientRect();
    const cardRect = inspector.getBoundingClientRect();

    dropdown.style.setProperty("left", "0px", "important");
    dropdown.style.setProperty("top", "0px", "important");
    const base = dropdown.getBoundingClientRect();

    const left = rowRect.left - base.left;
    const top = rowRect.bottom - base.top + 6;
    const width = Math.max(260, Math.min(rowRect.width, cardRect.width - 32));
    const maxHeight = Math.max(
      140,
      Math.min(420, cardRect.bottom - (rowRect.bottom + 16))
    );

    dropdown.style.setProperty("left", `${Math.round(left)}px`, "important");
    dropdown.style.setProperty("top", `${Math.round(top)}px`, "important");
    dropdown.style.setProperty("width", `${Math.round(width)}px`, "important");
    dropdown.style.setProperty(
      "max-height",
      `${Math.round(maxHeight)}px`,
      "important"
    );
  }

  function rememberPresetPick(event) {
    const item = event.target.closest(".action-panel__preset-item");
    if (!item) return;
    const buttons = item.querySelectorAll(".action-panel__preset-apply");
    if (!buttons.length) return;
    const name = item.querySelector(".action-panel__preset-name");
    const text = name ? name.textContent.trim() : "";
    const inspector = item.closest(".inspector");
    if (!inspector || !text) return;
    const nodeId = currentTextNodeId(inspector);
    if (!nodeId) return;
    if (templateNamesByNode.get(nodeId) !== text) {
      templateNamesByNode.set(nodeId, text);
    }
    // 让 React 先处理这次点击，再刷新模板行文案与下拉位置
    window.setTimeout(() => {
      ensureTemplateRow(inspector);
      positionTextPresetDropdown(inspector);
    }, 0);
  }

  function textResultText(node) {
    if (!node || !node.data) return "";
    const results = Array.isArray(node.data.results) ? node.data.results : [];
    const index =
      Number.isInteger(node.data.activeResultIndex) && node.data.activeResultIndex >= 0
        ? node.data.activeResultIndex
        : 0;
    const result = results[index] || results[0] || null;
    return String((result && (result.textContent || result.htmlContent)) || "").trim();
  }

  function previewTextResult(inspector) {
    // 每次现读活状态，不用缓存快照：缓存 reader 可能停在冻结 state，
    // 第二次推理后的新 results 读不到 → 预览停在旧内容（实测：再推理一次仍是第一次的）。
    const state = refreshCanvasState();
    const node = getSelectedNodeByCategory(state, "text");
    if (!node) {
      showToast("预览失败：当前没有选中的文本节点。", "error");
      return;
    }
    const text = textResultText(node);
    if (!text) {
      showToast("当前文本节点还没有生成结果，请先推理或手动输入内容。", "error");
      return;
    }
    if (typeof state.setFullscreenTextNodeId !== "function") {
      showToast("预览失败：未能接入画布状态，请刷新页面后重试。", "error");
      return;
    }
    state.setFullscreenTextNodeId(node.id);
  }

  function triggerTextGenerate(inspector) {
    const button = inspector.querySelector(".action-panel__generate-btn");
    if (!button) {
      showToast("推理失败：没有找到画布原生生成按钮。", "error");
      return;
    }
    if (button.disabled || button.getAttribute("aria-disabled") === "true") {
      showToast("当前无法推理：请先补齐模型/API 配置或等待当前任务结束。", "error");
      return;
    }
    const panel = getTextPanel(inspector);
    const input = panel ? panel.querySelector(".action-panel__prompt-input") : null;
    if (input && typeof input.blur === "function") input.blur();

    button.click();
    refreshTextMeta(inspector);
    window.setTimeout(() => {
      refreshTextMeta(inspector);
    }, 260);
  }

  function handleTextActionClick(event) {
    const button = event.target.closest(`[${TEXT_ACTION_ATTR}]`);
    if (!button) return;
    const inspector = button.closest(`.inspector.${EDITOR_CLASS}`);
    if (!inspector) return;

    const action = button.dataset.msTextAction;
    if (!action || action === "actions") return;

    event.preventDefault();
    event.stopPropagation();

    if (action === "model") {
      openApiSettings("text");
      return;
    }
    if (action === "preview") {
      previewTextResult(inspector);
      return;
    }
    if (action === "generate") {
      triggerTextGenerate(inspector);
    }
  }

  function openTextPresetDropdown(inspector) {
    const panel = getTextPanel(inspector);
    if (!panel) return false;
    const presetButton = panel.querySelector(".action-panel__tool-btn--preset");
    if (!presetButton) return false;
    presetButton.click();
    return true;
  }

  // ======= 节点屏幕矩形（含节点 DOM 被卸载后的反算） =======
  // React Flow 开了 onlyRenderVisibleElements，节点划出视口后其 DOM 会被卸载，
  // 量不到矩形时用 node.position + viewport transform 反算，卡片才能继续跟着节点走。
  const lastNodeSizes = new Map();

  function firstFiniteNumber() {
    for (let i = 0; i < arguments.length; i += 1) {
      const num = Number(arguments[i]);
      if (Number.isFinite(num)) return num;
    }
    return null;
  }

  function readViewportTransform(state) {
    const vp = (state && state.viewport) || {};
    const zoom = firstFiniteNumber(vp.zoom);
    return {
      zoom: zoom && zoom > 0 ? zoom : 1,
      x: firstFiniteNumber(vp.x, 0),
      y: firstFiniteNumber(vp.y, 0),
    };
  }

  function rectFromFlowPosition(state, node, width, height) {
    const host =
      document.querySelector(".react-flow__viewport") ||
      document.querySelector(".react-flow");
    if (!host) return null;
    const hostRect = host.getBoundingClientRect();
    if (!(hostRect.width > 0) || !(hostRect.height > 0)) return null;

    const position = node.positionAbsolute || node.position || {};
    const posX = firstFiniteNumber(position.x);
    const posY = firstFiniteNumber(position.y);
    if (posX === null || posY === null) return null;

    const vp = readViewportTransform(state);
    // .react-flow__viewport 自身带 translate(x, y) scale(zoom)，getBoundingClientRect
    // 已含平移，直接拿它的左上角当画布原点；回退到 .react-flow 时才需要补上平移量。
    const isViewportHost = host.classList.contains("react-flow__viewport");
    const originLeft = isViewportHost ? hostRect.left : hostRect.left + vp.x;
    const originTop = isViewportHost ? hostRect.top : hostRect.top + vp.y;
    const left = originLeft + posX * vp.zoom;
    const top = originTop + posY * vp.zoom;
    // measured / cached 是 flow 坐标尺寸，屏幕上还要再乘 zoom，
    // 否则缩小画布时卡片会按未缩放尺寸贴到节点右下方。
    const screenWidth = width * vp.zoom;
    const screenHeight = height * vp.zoom;
    return {
      left,
      top,
      width: screenWidth,
      height: screenHeight,
      right: left + screenWidth,
      bottom: top + screenHeight,
    };
  }

  function getActiveNodeScreenRect(state) {
    const node = state ? getActiveNode(state) : null;
    const element = state ? getSelectedNodeElement(state) : null;

    if (element) {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        if (node) {
          const zoom = readViewportTransform(state).zoom;
          lastNodeSizes.set(node.id, {
            width: rect.width / zoom,
            height: rect.height / zoom,
          });
        }
        return rect;
      }
    }

    if (!node) return null;

    const measured = node.measured || {};
    const cached = lastNodeSizes.get(node.id) || {};
    const realWidth = firstFiniteNumber(measured.width, cached.width, node.width);
    const realHeight = firstFiniteNumber(measured.height, cached.height, node.height);
    // 反推等「刚程序化建好、React 尚未测量」的一刻：DOM 没挂上且没有任何
    // 真实尺寸，此时用 260×120 假尺寸反算会把卡片贴到节点右下（top 按 120
    // 算、水平按 260 居中，都与文本节点真实尺寸错位）。宁可这一拍不锚定
    // （positionEditor 保留默认居中位），等 React 测完由下一次重算贴正，
    // 也好过先跳到明显错误的地方再纠回。节点滚出视口的兜底仍走下面反算
    // （那种情况 measured/缓存必有真实值，不会命中此 return）。
    if (realWidth === null || realHeight === null) return null;

    return rectFromFlowPosition(state, node, realWidth, realHeight);
  }

  // ======= 贴着节点定位 =======
  function positionEditor(inspector) {
    if (!inspector || !inspector.isConnected) return;
    if (!inspector.classList.contains(EDITOR_CLASS)) return;
    if (!isInspectorVisible(inspector)) return;

    // 面板展开动画期间跳过定位，避免量到中间尺寸
    const rect = inspector.getBoundingClientRect();
    if (rect.width < 200) return;

    const state = readCanvasState();
    const nodeRect = getActiveNodeScreenRect(state);
    const viewportWidth = window.innerWidth;

    let left = Math.max(
      viewportWidth <= 760 ? 66 : 72,
      (viewportWidth - rect.width) / 2
    );
    let top = 62;

    // 卡片永远钉在节点正下方：不翻到节点上方，也不把 top/left 夹回视口，
    // 所以节点滑出屏幕时卡片跟着一起滑出；卡片高度保持固定，不再按剩余空间压扁。
    if (nodeRect) {
      left = nodeRect.left + nodeRect.width / 2 - rect.width / 2;
      top = nodeRect.bottom + NODE_GAP;
    }

    inspector.style.setProperty("left", `${Math.round(left)}px`, "important");
    inspector.style.setProperty("top", `${Math.round(top)}px`, "important");

    inspector.style.removeProperty("height");
    inspector.style.removeProperty("overflow-y");
    const body = inspector.querySelector(".inspector__body");
    if (body) {
      body.style.removeProperty("overflow");
      body.style.removeProperty("overflow-y");
    }

    inspector.classList.add(POSITIONED_CLASS);

    if (inspector.classList.contains(TEXT_MODE_CLASS)) {
      positionTextPresetDropdown(inspector);
    }
    // 图片/文本的模型列表都要按视口剩余高度收敛，否则向下展开会被屏幕底边切掉
    fitModelDropdownHeight(inspector);
  }

  // 列表本身仍由 model-patch.js / text-node-model-patch.js 渲染，
  // 这里只保证向下展开时不被视口底部切掉。
  function fitModelDropdownHeight(inspector) {
    // 文本面板里有「模型」和「API 来源」两个 model-select，都要各自按剩余空间收敛
    const dropdowns = inspector.querySelectorAll(
      ".action-panel--image .action-panel__model-select > .action-panel__dropdown--model, " +
        ".action-panel--text .action-panel__model-select > .action-panel__dropdown--model"
    );
    dropdowns.forEach((dropdown) => {
      const rect = dropdown.getBoundingClientRect();
      const room = window.innerHeight - rect.top - 12;
      const maxHeight = Math.max(140, Math.min(300, room));
      dropdown.style.setProperty("max-height", `${Math.round(maxHeight)}px`, "important");
    });
  }

  function schedulePosition() {
    if (positionFrame) return;
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = 0;
      const inspector = document.querySelector(`.inspector.${EDITOR_CLASS}`);
      if (inspector) positionEditor(inspector);
    });
  }

  // 切到图片模式时撤掉文本模式注入的东西（保留图片模式自己的）
  function removeTextChrome(inspector) {
    inspector
      .querySelectorAll(
        ".ms-text-template-row, .ms-text-prompt-label, .ms-text-field-label, .ms-text-model-line, .ms-text-actions"
      )
      .forEach((element) => element.remove());

    const panel = getTextPanel(inspector);
    const input = panel
      ? panel.querySelector(".action-panel__prompt-input")
      : null;
    if (input && input.dataset.msTextOriginalPlaceholder !== undefined) {
      input.setAttribute(
        "placeholder",
        input.dataset.msTextOriginalPlaceholder
      );
      delete input.dataset.msTextOriginalPlaceholder;
    }
  }

  // 切到文本模式时撤掉图片模式注入的东西
  function removeImageChrome(inspector) {
    inspector
      .querySelectorAll(
        ".ms-image-reference, .ms-image-prompt-label, .ms-image-model-line, .ms-image-actions, .ms-navigator"
      )
      .forEach((element) => element.remove());
  }

  function cleanupInspector(inspector) {
    if (!inspector) return;
    if (cleanupTimer) window.clearTimeout(cleanupTimer);

    // 立即隐藏 inspector，防止闪现。注意这些内联样式必须在下面还原，
    // 否则原生 .inspector--open 的 opacity/pointer-events 会被内联值压住，
    // 导致下一次选节点时浮动卡片永远看不见也点不动。
    inspector.style.opacity = "0";
    inspector.style.pointerEvents = "none";

    // 先让这一帧把「隐藏」画出来，下一帧再关掉过渡动画后交还原生：
    // 若立即移除 class 并还原内联样式，原生的 0.28s 位移动画会把面板
    // 从右侧滑回去，表现成「刚进画布右侧先闪一下旧侧边栏」。
    cleanupTimer = window.setTimeout(() => {
      inspector.style.transitionDuration = "0s";
      inspector.classList.remove(
        EDITOR_CLASS,
        POSITIONED_CLASS,
        TEXT_MODE_CLASS,
        "is-active"
      );

      const title = inspector.querySelector(".inspector__title");
      if (title && title.dataset.msImageOriginalTitle) {
        title.textContent = title.dataset.msImageOriginalTitle;
        delete title.dataset.msImageOriginalTitle;
      }
      const placeholder = inspector.querySelector(
        ".action-panel__prompt-placeholder"
      );
      if (placeholder && placeholder.dataset.msImageOriginalPlaceholder) {
        placeholder.textContent =
          placeholder.dataset.msImageOriginalPlaceholder;
        delete placeholder.dataset.msImageOriginalPlaceholder;
      }

      // 交还给原生：清掉本补丁写过的所有内联样式与模式标记
      const input = inspector.querySelector(".action-panel__prompt-input");
      if (input && input.dataset.msTextOriginalPlaceholder !== undefined) {
        input.setAttribute("placeholder", input.dataset.msTextOriginalPlaceholder);
        delete input.dataset.msTextOriginalPlaceholder;
      }
      inspector.querySelectorAll(".action-panel__footer > *").forEach((element) => {
        if (element.style.order) element.style.removeProperty("order");
      });
      restoreInspectorAppearance(inspector);
      activeCategory = null;
      stopFollowLoop();
      cleanupTimer = 0;
      suppressCheckFrame = 0;
    }, 10);
  }

  function restoreInspectorAppearance(inspector) {
    ["opacity", "pointer-events", "transition-duration", "display"].forEach(
      (property) => inspector.style.removeProperty(property)
    );
  }

  function isInspectorVisible(inspector) {
    if (inspector.getAttribute("aria-hidden") === "true") return false;
    if (inspector.style.display === "none") return false;
    const style = window.getComputedStyle(inspector);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (inspector.offsetWidth < 10 && inspector.offsetHeight < 10) return false;
    return true;
  }

  function resolveMode(inspector) {
    // 以面板里真实渲染的 action-panel 为准：原生只在选中图片/文本节点时
    // 才挂对应面板，因此这是最可靠的模式来源。
    if (inspector.querySelector(".action-panel--image")) return "image";
    if (inspector.querySelector(".action-panel--text")) return "text";
    return null;
  }

  function decorate() {
    // 只有用户真的点过节点才激活，避免打开页面就自动弹卡片
    if (!hasUserInteracted) {
      lastDecision = "skip:not-interacted";
      return;
    }

    const inspector = document.querySelector(".inspector");
    if (!inspector) {
      lastDecision = "skip:no-inspector";
      stopFollowLoop();
      return;
    }

    // 只有在浮动卡片确实处于激活状态时才做清理。本补丁自己写入的 DOM 与
    // 样式会持续触发 MutationObserver，若每次都无条件清理，就会形成
    // “清理 -> 改 DOM -> 再清理” 的自激循环。
    const isActive = inspector.classList.contains(EDITOR_CLASS);

    const mode = resolveMode(inspector);
    if (!mode) {
      lastDecision = "bail:no-panel";
      if (isActive) cleanupInspector(inspector);
      else {
        activeCategory = null;
        stopFollowLoop();
      }
      return;
    }

    // 必须确认当前选中节点类别与面板一致，避免默认打开侧边栏时误触
    let state = readCanvasState();
    let selectedNode = getSelectedNodeByCategory(state, mode);
    if (!selectedNode) {
      state = refreshCanvasState();
      selectedNode = getSelectedNodeByCategory(state, mode);
    }
    if (!selectedNode && !getDomSelectedNodeElement(mode)) {
      lastDecision = "bail:no-selected-node:" + mode;
      if (isActive) cleanupInspector(inspector);
      else {
        activeCategory = null;
        stopFollowLoop();
      }
      return;
    }
    if (!selectedNode) {
      // store 暂时不可靠，但 DOM 明确选中了这个类别的节点：按 DOM 走
      state = null;
    }

    // 必须先撤销上一轮清理写进去的内联样式，否则 isInspectorVisible 会被
    // 自己的 display:none 永久判成不可见，面板再也打不开。
    restoreInspectorAppearance(inspector);

    if (!isInspectorVisible(inspector)) {
      lastDecision = "bail:inspector-hidden";
      if (isActive) cleanupInspector(inspector);
      else {
        activeCategory = null;
        stopFollowLoop();
      }
      return;
    }

    // 取消可能仍在排队的那次清理，避免它把刚激活的面板再关一遍
    if (cleanupTimer) {
      window.clearTimeout(cleanupTimer);
      cleanupTimer = 0;
    }

    const switched = activeCategory !== null && activeCategory !== mode;

    inspector.classList.add(EDITOR_CLASS);
    if (mode === "text") {
      inspector.classList.add(TEXT_MODE_CLASS);
      if (switched) removeImageChrome(inspector);
      ensureTextChrome(inspector);
      refreshTextMeta(inspector);
    } else {
      inspector.classList.remove(TEXT_MODE_CLASS);
      if (switched) removeTextChrome(inspector);
      ensureChrome(inspector);
      refreshMeta(inspector);
    }
    activeCategory = mode;
    lastDecision = "active:" + mode;

    schedulePosition();
    // 注：不再递归调用 decorate()，由 scheduleDecorate / MutationObserver 处理后续更新
  }

  function scheduleDecorate() {
    if (scheduleFrame) return;
    scheduleFrame = window.requestAnimationFrame(() => {
      scheduleFrame = 0;
      decorate();
    });
  }

  function startFollowLoop() {
    if (followTimer) return;
    // 画布缩放/平移时 React Flow 只改 transform，不一定触发 childList；
    // 轻量定时跟随作为兜底，pointermove/wheel 仍会即时刷新。
    followTimer = window.setInterval(schedulePosition, 120);
  }

  function stopFollowLoop() {
    if (!followTimer) return;
    window.clearInterval(followTimer);
    followTimer = 0;
  }

  // ======= 导出 / 预览 =======
  function sanitizeFileName(name) {
    return String(name || "")
      .replace(/[\\/:*?"<>|]/g, "_")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sourceExtension(source) {
    if (!source) return "";
    if (source.startsWith("data:")) {
      const mediaType = source.slice(5).split(/[;,]/)[0].toLowerCase();
      if (mediaType.includes("jpeg")) return ".jpg";
      if (mediaType.includes("webp")) return ".webp";
      if (mediaType.includes("gif")) return ".gif";
      if (mediaType.includes("svg")) return ".svg";
      return ".png";
    }
    try {
      const pathname = new URL(source, window.location.href).pathname;
      const match = pathname.match(/\.(png|jpg|jpeg|webp|gif|avif|bmp|svg)$/i);
      return match ? `.${match[1].toLowerCase()}` : "";
    } catch (_) {
      return "";
    }
  }

  function normalizeFileName(name, source) {
    let fileName = sanitizeFileName(name) || "image.png";
    if (!/\.(png|jpg|jpeg|webp|gif|avif|bmp|svg)$/i.test(fileName)) {
      fileName += sourceExtension(source) || ".png";
    }
    return fileName;
  }

  function looksLikeLocalPath(source) {
    return (
      /^[A-Za-z]:[\\/]/.test(source) ||
      source.startsWith("file://") ||
      source.startsWith("webdir:")
    );
  }

  async function fetchAsObjectUrl(source) {
    const response = await window.fetch(source, { credentials: "include" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  async function makeDownloadableSource(source) {
    if (!source) throw new Error("当前图片节点还没有可导出的结果");

    if (source.startsWith("data:") || source.startsWith("blob:")) {
      return { href: source, revoke: null };
    }

    if (looksLikeLocalPath(source)) {
      const api = window.electronAPI;
      if (api && typeof api.readLocalMediaDataUrl === "function") {
        const dataUrl = await api.readLocalMediaDataUrl(source);
        if (dataUrl) return { href: dataUrl, revoke: null };
      }
      if (api && typeof api.getLocalMediaFileUrl === "function") {
        const objectUrl = await api.getLocalMediaFileUrl(source);
        if (objectUrl) return { href: objectUrl, revoke: null };
      }
      throw new Error("图片路径无法读取，请重新选择素材目录或重新上传");
    }

    if (/^https?:\/\//i.test(source)) {
      const api = window.electronAPI;
      if (api && typeof api.fetchRemoteImageDataUrl === "function") {
        try {
          const dataUrl = await api.fetchRemoteImageDataUrl(source);
          if (dataUrl) return { href: dataUrl, revoke: null };
        } catch (_) {
          // 远程代理失败时继续尝试浏览器 fetch。
        }
      }
      try {
        const objectUrl = await fetchAsObjectUrl(source);
        return { href: objectUrl, revoke: objectUrl };
      } catch (error) {
        throw new Error(
          "远程图片读取失败，可能受跨域限制：" +
            ((error && error.message) || "未知错误")
        );
      }
    }

    try {
      const objectUrl = await fetchAsObjectUrl(source);
      return { href: objectUrl, revoke: objectUrl };
    } catch (error) {
      throw new Error("图片读取失败：" + ((error && error.message) || "未知错误"));
    }
  }

  async function exportCurrentResult() {
    const info = getResultInfo();
    const source = getDownloadSource(info);
    if (!source) {
      showToast("当前图片节点还没有可导出的结果。", "error");
      return;
    }

    const fileName = normalizeFileName(info.fileName, source);
    try {
      const downloadable = await makeDownloadableSource(source);
      const anchor = document.createElement("a");
      anchor.href = downloadable.href;
      anchor.download = fileName;
      anchor.rel = "noopener";
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      showToast(`已提交导出：${fileName}`);
      if (downloadable.revoke) {
        window.setTimeout(() => URL.revokeObjectURL(downloadable.revoke), 30000);
      }
    } catch (error) {
      showToast(
        "导出失败：" + ((error && error.message) || "未知错误"),
        "error"
      );
    }
  }

  function previewCurrentResult() {
    const info = getResultInfo();
    const source = getPreviewSource(info);
    if (!source) {
      showToast("当前图片节点还没有可预览的结果。", "error");
      return;
    }
    if (!info.state || typeof info.state.setFullscreenImage !== "function") {
      showToast("预览失败：未能接入画布状态，请刷新页面后重试。", "error");
      return;
    }

    const fileName = normalizeFileName(info.fileName, source);
    try {
      info.state.setFullscreenImage(source, fileName);
      showToast(`正在预览：${fileName}`);
    } catch (error) {
      showToast(
        "预览失败：" + ((error && error.message) || "未知错误"),
        "error"
      );
    }
  }

  function triggerGenerate(inspector) {
    const sendButton = inspector.querySelector(".action-panel__send-btn");
    if (!sendButton) {
      showToast("生成失败：没有找到画布原生生成按钮。", "error");
      return;
    }

    const beforeDisabled =
      sendButton.disabled ||
      sendButton.getAttribute("aria-disabled") === "true";
    if (beforeDisabled) {
      showToast("当前无法生成：请先补齐模型/API 配置或等待当前任务结束。", "error");
      return;
    }

    sendButton.click();
    refreshMeta(inspector);
    window.setTimeout(() => {
      const state = readCanvasState();
      const node = getSelectedImageNode(state);
      const busy = isGenerating(node, inspector);
      if (busy) {
        showToast("已提交生成任务，正在等待画布返回结果。");
      }
      refreshMeta(inspector);
    }, 260);
  }

  // ======= 「模型设置」→ 对应 API 来源设置 =======
  // 原生模型下拉只列画布内置模型，真正可选的模型来自设置里勾选的「模型列表」，
  // 所以这个按钮的语义是「去那里勾选模型」，而不是打开原生下拉。
  // 坑一：设置弹窗没打开时侧栏条目还没渲染，直接 querySelector().click() 就是「点了没反应」，
  //        必须先点画布自带齿轮打开弹窗，再轮询等条目出现。
  // 坑二：图片那一项是**原生**条目（api-profiles-patch.js 只负责改名），只能按文本匹配；
  //        文本/视频那两项是各自补丁注入的，有固定 id，优先按 id 找。
  const SETTINGS_GEAR_TITLE = "模型与接口设置";

  const API_SETTINGS_TARGETS = {
    image: {
      label: "图片API来源设置",
      sectionId: "ms-api-profiles",
      cardSelector: ".ms-api-card",
      refreshSelector: '[data-ms-action="models-refresh"]',
      navTexts: ["图片API来源设置", "API 来源设置"],
      navTextPattern: /^API\s*来源设置$/,
    },
    text: {
      label: "文本API来源设置",
      tabId: "ms-text-api-tab-btn",
      sectionId: "ms-text-api-section",
      cardSelector: ".ms-text-api-card",
      refreshSelector: '[data-ms-text-action="models-refresh"]',
      navTexts: ["文本API来源设置"],
    },
  };

  function findApiNavItem(target) {
    if (target.tabId) {
      const byId = document.getElementById(target.tabId);
      if (byId) return byId;
    }
    const items = [...document.querySelectorAll(".settings-sidebar__item")].filter(
      (el) => !(el.id || "").endsWith("-api-tab-btn")
    );
    const texts = items.map((el) => (el.textContent || "").trim());
    for (const text of target.navTexts) {
      const index = texts.indexOf(text);
      if (index >= 0) return items[index];
    }
    if (target.navTextPattern) {
      return items.find((el, index) => target.navTextPattern.test(texts[index])) || null;
    }
    return items.find((el) => (el.textContent || "").indexOf(target.label) >= 0) || null;
  }

  function flashModelList(models) {
    models.scrollIntoView({ behavior: "smooth", block: "start" });
    models.classList.add("ms-api-models--flash");
    window.setTimeout(() => models.classList.remove("ms-api-models--flash"), 1600);
  }

  // 目标分区由各 API 补丁注入，比原生分区渲染更晚，所以短轮询而不是固定延时。
  function focusApiModelList(target, tries) {
    const root = document.getElementById(target.sectionId);
    if (!root) {
      if ((tries || 0) < 20) {
        window.setTimeout(() => focusApiModelList(target, (tries || 0) + 1), 60);
        return;
      }
      showToast("未找到「" + target.label + "」分区，请重新打开设置面板。", "error");
      return;
    }
    const card =
      root.querySelector(target.cardSelector + ".is-active") ||
      root.querySelector(target.cardSelector);
    const models = card && card.querySelector("[data-ms-model-section]");
    if (models) {
      flashModelList(models);
      return;
    }
    if ((tries || 0) < 20) {
      window.setTimeout(() => focusApiModelList(target, (tries || 0) + 1), 60);
      return;
    }
    const refresh = card && card.querySelector(target.refreshSelector);
    if (refresh) {
      refresh.click();
      showToast("该配置还没有模型列表，已尝试拉取模型。");
      return;
    }
    showToast("当前" + target.label + "还没有模型列表，请先填写 API 密钥并拉取模型。", "error");
  }

  function openApiSettings(kind) {
    const target = API_SETTINGS_TARGETS[kind];
    if (!target) return;
    const openAndFocus = (item) => {
      item.click();
      window.setTimeout(() => focusApiModelList(target, 0), 120);
    };
    const existing = findApiNavItem(target);
    if (existing) {
      openAndFocus(existing);
      return;
    }
    const gear = [...document.querySelectorAll(".sidebar__icon-btn")].find(
      (el) => (el.title || "").indexOf(SETTINGS_GEAR_TITLE) >= 0
    );
    if (!gear) {
      showToast("未找到画布「" + SETTINGS_GEAR_TITLE + "」入口，请从侧栏手动打开设置。", "error");
      return;
    }
    gear.click();
    let tries = 0;
    const wait = window.setInterval(() => {
      const item = findApiNavItem(target);
      if (item) {
        window.clearInterval(wait);
        openAndFocus(item);
        return;
      }
      if (++tries > 40) {
        window.clearInterval(wait);
        showToast("「" + target.label + "」入口注入失败，请重新打开设置面板。", "error");
      }
    }, 60);
  }
  function handleActionClick(event) {
    const button = event.target.closest("[data-ms-image-action]");
    if (!button) return;
    const inspector = button.closest(`.inspector.${EDITOR_CLASS}`);
    if (!inspector) return;

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.msImageAction;
    if (action === "model") {
      openApiSettings("image");
      return;
    }
    if (action === "import") {
      const fileInput = inspector.querySelector(
        '.action-panel--image input[type="file"]'
      );
      if (!fileInput) {
        showToast("导入失败：未找到画布图片文件入口。", "error");
        return;
      }
      fileInput.click();
      return;
    }
    if (action === "export") {
      exportCurrentResult();
      return;
    }
    if (action === "preview") {
      previewCurrentResult();
      return;
    }
    if (action === "generate") {
      triggerGenerate(inspector);
    }
  }

  function handleTemplateRowClick(event) {
    const row = event.target.closest("[data-ms-text-template]");
    if (!row) return;
    const inspector = row.closest(`.inspector.${EDITOR_CLASS}`);
    if (!inspector) return;

    event.preventDefault();
    event.stopPropagation();

    // 优先委托文本模板补丁（数据=设置页「文本模板」体系：内置+自定义）。
    // 补丁没加载/没选中文本节点时，回退原生「预」按钮下拉。
    const ext = window.__MS_TEXT_TEMPLATES__;
    if (ext && typeof ext.openFromRow === "function" && ext.openFromRow(inspector, row)) return;

    if (!openTextPresetDropdown(inspector)) {
      showToast("模板列表尚未就绪，请稍后再试。", "error");
      return;
    }
    window.setTimeout(() => positionTextPresetDropdown(inspector), 0);
  }

  function handleUserInteraction(event) {
    // 只有真的点到节点才算用户操作过：此时立即解除启动期的自动弹窗抑制，
    // 并主动重算一次，避免「节点已选中、点它不产生 class 变化」时卡片不出来。
    if (event.target.closest(".react-flow__node")) {
      if (!hasUserInteracted) {
        hasUserInteracted = true;
        suppressUntil = 0;
      }
      scheduleDecorate();
    }
  }

  function handleLayoutChange() {
    schedulePosition();
  }

  function start() {
    injectStyles();

    // 监听节点点击，标记「用户真的操作过画布」
    document.addEventListener("click", handleUserInteraction, true);

    observer = new MutationObserver(scheduleDecorate);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "aria-disabled", "aria-hidden"],
    });

    // 关键：原生 aside 在 React 根容器上调用 stopPropagation，冒泡阶段的
    // document 监听收不到面板内点击，因此本补丁的注入控件一律用捕获阶段。
    document.addEventListener("click", handleActionClick, true);
    document.addEventListener("click", handleTextActionClick, true);
    document.addEventListener("click", handleTemplateRowClick, true);
    document.addEventListener("click", rememberPresetPick, true);
    document.addEventListener("pointermove", handleLayoutChange, true);
    document.addEventListener("wheel", handleLayoutChange, {
      capture: true,
      passive: true,
    });
    document.addEventListener("scroll", handleLayoutChange, true);
    window.addEventListener("resize", handleLayoutChange);

    window.__MS_IMAGE_EDITOR__ = {
      version: "20261125-2",
      refresh: decorate,
      reposition: schedulePosition,
      // 供其它补丁复用「跳到 API 来源设置并定位模型列表」
      openApiSettings,
      // 文本模板补丁套用模板后回显模板名（templateNamesByNode 在本闭包内，只能走 setter）
      setTemplateName(nodeId, name) {
        if (!nodeId) return;
        templateNamesByNode.set(nodeId, name || "选择模板");
        const inspector = document.querySelector(".inspector." + EDITOR_CLASS + "." + TEXT_MODE_CLASS);
        if (inspector) ensureTemplateRow(inspector);
      },
      // 当前浮动卡片服务的节点类别；没有卡片时为 null
      mode: () => activeCategory,
      // 最近一次 decorate 的判定结果，供回归脚本定位「面板没出来」的原因
      lastDecision: () => lastDecision,
    };

    // Suppress auto-opening inspector within first 3 seconds
    const suppressInspector = () => {
      if (!hasUserInteracted && Date.now() < suppressUntil) {
        const ins = document.querySelector(".inspector.inspector--open");
        if (ins) cleanupInspector(ins);
        suppressCheckFrame = window.requestAnimationFrame(suppressInspector);
      } else {
        suppressCheckFrame = 0;
      }
    };
    suppressUntil = Math.min(suppressUntil, Date.now() + 3000);
    suppressInspector();
    decorate();
  }

  start();
})();

