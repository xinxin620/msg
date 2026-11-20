(() => {
  "use strict";

  // 小地图四处改动，面板底色与节点色一律不动（保持 bundle 原样式）：
  // ① 节点最小尺寸：MiniMap 把所有节点塞进固定 200×150 视框，viewBox 随节点
  //    分布变（`ee B V H`），节点铺得越散，每个 rect 的 width/height 越小，
  //    缩到最小就只剩几个像素点。这里按「1 用户单位实际等于多少 CSS px」把每个
  //    节点非等比放大到最低 6px：transform-box:fill-box + transform-origin:center
  //    保证位置不动，上限 10× 防止把细长节点撑成大色块，
  //    vector-effect:non-scaling-stroke 防止描边跟着变粗。
  // ② 点击定位：bundle 只传了 pannable/zoomable、没传 onClick，所以点小地图
  //    不跳（只有拖动才平移）。这里给整块面板补点击：用 svg 的 getScreenCTM
  //    反算出点击处的 flow 坐标，再调 video-node-patch 暴露的 centerViewport
  //    把画布中心移过去（保持当前缩放）。监听挂在外层 div，所以被
  //    `.custom-minimap{overflow:hidden}` 裁掉的右/下边缘一样能点（CTM 外推）。
  // ③ 视口遮罩描边、④ 面板外边框：bundle 边框 `2px solid var(--node-border)`
  //    （浅底 #e0deda）与画布底色 #eeecea 几乎同色，边框糊住；只压深边框色，
  //    底色/圆角/阴影不动。
  // ⑤ 固定尺寸导航框：面板内叠一个 HTML div（不是 svg rect，所以不跟着
  //    viewBox/缩放变大小），宽、高各为面板的 1/3。它是「尺寸固定的视口框」：
  //    平时跟随当前画布视口中心（flow 坐标经 getScreenCTM 投影、clamp 在面板
  //    内），按住它拖 = 把视口中心拖到哪，走 centerViewport(x,y,0) 跟手。
  //    viewportCenter() 取不到时原地不动（仅首次摆面板中央），绝不每帧强钉
  //    中央——那会把刚拖到的位置弹回去。move/up 挂 window（框只有面板 1/3，
  //    指针很容易滑出框外丢事件）；pointerdown 上 stopPropagation，避开
  //    bundle 在 svg 上的 d3 pannable。
  //    bundle 视口遮罩同时整条隐藏（它按 flow 坐标画、缩放必变，与固定框重复）。
  // React 重渲染会连 style 一起重写，靠 MutationObserver + 定时 sync 纠正；
  // 期望值记在 data-* 上比对，避免自己触发的属性变更把观察器点成死循环。

  const MINIMAP_SEL = ".react-flow__minimap.custom-minimap";
  const NODE_SEL = ".react-flow__minimap-node";
  const MIN_PX = 6;
  const MAX_SCALE = 10;
  const SCALE_ATTR = "msMinimapScale";
  const DRAG_GUARD_PX = 4;
  const NAV_CLS = "ms-minimap-nav";
  const NAV_RATIO = 1 / 3; // 用户定：导航框宽、高各为外层面板的 1/3
  const NAV_FALLBACK_W = 68; // 面板量不到尺寸时兜底（≈206/3）
  const NAV_FALLBACK_H = 45;
  const NAV_PAD = 6; // .custom-minimap 的 padding，导航框不许压到面板圆角外

  function injectStyles() {
    if (document.getElementById("ms-minimap-styles")) return;
    const style = document.createElement("style");
    style.id = "ms-minimap-styles";
    style.textContent = [
      // 面板外边框：bundle 用 border:2px solid var(--node-border)（浅底 #e0deda，
      // 与画布底色 #eeecea 几乎同色）；#b9b4ad 一档用户仍嫌淡，加深到中灰棕
      `${MINIMAP_SEL}{cursor:pointer;border-color:#8f8880!important}`,
      `${MINIMAP_SEL} ${NODE_SEL}{transform-box:fill-box!important;transform-origin:center!important;vector-effect:non-scaling-stroke!important}`,
      // 视口遮罩：bundle 遮罩按 flow 坐标画视口，缩放时必然跟着变大变小，与
      // 固定导航框功能重复且让用户误以为「导航框会缩小」——整条隐藏，
      // 小地图里只留导航框一个视口指示。fill 是视口外淡米色压暗、stroke 是
      // 视口边框，两者都清掉。
      `${MINIMAP_SEL} .react-flow__minimap-mask{fill:none!important;stroke:none!important}`,
      // 固定导航框：HTML div 叠在 svg 上，尺寸按面板 1/3 由 JS 写死 CSS px，
      // 不随 viewBox/画布缩放变（border 用 currentColor，颜色只在这一处定义）
      `.${NAV_CLS}{position:absolute;box-sizing:border-box;`
        + `border:3px solid currentColor;border-radius:6px;background:#2f8ef71f;cursor:move;`
        + `color:#2f8ef7;z-index:2;touch-action:none}`,
    ].join("");
    document.head.appendChild(style);
  }

  // viewBox 宽高随节点分布变，svg 自身尺寸来自 width/height 属性（bundle 默认
  // 200×150），且 preserveAspectRatio 默认 xMidYMid meet，所以真实缩放取两轴较小值。
  // 用 getBoundingClientRect 而不是 CSS width：`.custom-minimap` 是 border-box
  // 206×136 带 6px padding，内容框只有 194×124，svg 会被 overflow:hidden 裁掉
  // 右 6px/下 26px，但 rect 仍是 svg 自己的完整布局盒，比例算得对。
  function pxPerUnit(svg) {
    const box = svg.viewBox && svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    if (!box || !(box.width > 0) || !(box.height > 0) || !(rect.width > 0) || !(rect.height > 0)) return 1;
    return Math.min(rect.width / box.width, rect.height / box.height);
  }

  function sync() {
    const minimap = document.querySelector(MINIMAP_SEL);
    const svg = minimap ? minimap.querySelector("svg") : null;
    if (!svg) return;
    const k = pxPerUnit(svg);
    for (const node of svg.querySelectorAll(NODE_SEL)) {
      const w = parseFloat(node.getAttribute("width") || "0") * k;
      const h = parseFloat(node.getAttribute("height") || "0") * k;
      let want = "";
      if (w > 0 && h > 0) {
        const sx = Math.min(MAX_SCALE, Math.max(1, MIN_PX / w));
        const sy = Math.min(MAX_SCALE, Math.max(1, MIN_PX / h));
        if (sx > 1.001 || sy > 1.001) want = `scale(${sx.toFixed(3)},${sy.toFixed(3)})`;
      }
      if (node.dataset[SCALE_ATTR] === want) continue;
      node.dataset[SCALE_ATTR] = want;
      node.style.transform = want;
    }
    // 导航框：视口指示器（尺寸固定），非拖拽时每帧跟随视口中心；
    // 拖拽中不动它（用户正拿着），松手下一帧 syncNav 从真实视口校准
    if (!navDragging && ensureNav(minimap)) syncNav(minimap);
  }

  // 点击 → flow 坐标 → 画布中心移过去
  function jumpTo(minimap, clientX, clientY) {
    const svg = minimap.querySelector("svg");
    if (!svg || !svg.getScreenCTM) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const pt = svg.createSVGPoint
      ? svg.createSVGPoint()
      : new DOMPoint();
    pt.x = clientX;
    pt.y = clientY;
    const flow = pt.matrixTransform(ctm.inverse());
    if (!Number.isFinite(flow.x) || !Number.isFinite(flow.y)) return;
    const api = window.__MS_VIDEO_NODE_PATCH__;
    if (!api || typeof api.centerViewport !== "function") return;
    api.centerViewport(flow.x, flow.y);
  }

  // ======= 固定尺寸导航框 =======
  // flow 坐标 → 面板内 CSS 坐标（svg 的 screen CTM 投影后减去面板 rect 偏移）。
  // 导航框 absolute 定位原点在 padding box（rect 是 border box），要再扣掉
  // clientLeft/clientTop（bundle 给面板 2px 边框）。
  function flowToPanel(minimap, x, y) {
    const svg = minimap.querySelector("svg");
    if (!svg || !svg.getScreenCTM) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(x, y).matrixTransform(ctm);
    const rect = minimap.getBoundingClientRect();
    return { x: p.x - rect.left - minimap.clientLeft, y: p.y - rect.top - minimap.clientTop };
  }

  function panelToFlow(minimap, px, py) {
    const svg = minimap.querySelector("svg");
    if (!svg || !svg.getScreenCTM) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const rect = minimap.getBoundingClientRect();
    const f = new DOMPoint(rect.left + minimap.clientLeft + px, rect.top + minimap.clientTop + py)
      .matrixTransform(ctm.inverse());
    return Number.isFinite(f.x) && Number.isFinite(f.y) ? f : null;
  }

  let navEl = null;
  let navDragging = false;
  let navPlaced = false; // 自由手柄：只在首次出现摆中央，之后位置全由拖动决定

  function ensureNav(minimap) {
    if (navEl && navEl.isConnected && navEl.parentElement === minimap) return navEl;
    navEl = minimap.querySelector(`.${NAV_CLS}`);
    if (!navEl) {
      navEl = document.createElement("div");
      navEl.className = NAV_CLS;
      navEl.title = "拖动导航框定位画布";
      minimap.appendChild(navEl);
      bindNavDrag(navEl);
      navPlaced = false; // 新建（含小地图重开后重建）需重新摆中央
    }
    return navEl;
  }

  // 导航框尺寸 = 面板 content 区（clientWidth/Height，已去边框）的 1/3。
  // 面板 CSS 尺寸固定（206×136），所以它不会随画布缩放变。
  function navSize(minimap) {
    const w = (minimap.clientWidth || NAV_FALLBACK_W + 2 * NAV_PAD) * NAV_RATIO;
    const h = (minimap.clientHeight || NAV_FALLBACK_H + 2 * NAV_PAD) * NAV_RATIO;
    return { w: Math.round(w), h: Math.round(h) };
  }

  function clampNav(minimap, cx, cy, s) {
    const W = minimap.clientWidth || NAV_FALLBACK_W + 2 * NAV_PAD;
    const H = minimap.clientHeight || NAV_FALLBACK_H + 2 * NAV_PAD;
    // minX > maxX（框比可用区大）时 Math.min/max 退化为贴左上，次序仍安全
    const minX = NAV_PAD + s.w / 2, maxX = W - NAV_PAD - s.w / 2;
    const minY = NAV_PAD + s.h / 2, maxY = H - NAV_PAD - s.h / 2;
    return { x: Math.min(Math.max(cx, minX), maxX), y: Math.min(Math.max(cy, minY), maxY) };
  }

  function placeNav(minimap, cx, cy) {
    const s = navSize(minimap);
    const p = clampNav(minimap, cx, cy, s);
    navEl.style.width = `${s.w}px`;
    navEl.style.height = `${s.h}px`;
    navEl.style.left = `${(p.x - s.w / 2).toFixed(1)}px`;
    navEl.style.top = `${(p.y - s.h / 2).toFixed(1)}px`;
    return p; // 钳位后的中心（padding-box 坐标），拖动时反算 flow 用
  }

  // 导航框 = 视口指示器，但尺寸固定（面板 1/3，不随缩放变）：
  // 平时跟随当前视口中心（反映你在画布哪儿），拖动它 = 移动视口。
  // 关键：viewportCenter() 取不到（store 未就绪/transform 异常）时**原地不动**，
  // 绝不强钉面板中央——否则每帧 sync 会把用户刚拖到的位置弹回中间。
  function syncNav(minimap) {
    const api = window.__MS_VIDEO_NODE_PATCH__;
    const c = api && typeof api.viewportCenter === "function" ? api.viewportCenter() : null;
    if (!c) {
      // 还没拿到视口：首次摆面板中央当起点，之后保持不动
      if (!navPlaced) { navPlaced = true; placeNav(minimap, minimap.clientWidth / 2, minimap.clientHeight / 2); }
      return;
    }
    const p = flowToPanel(minimap, c.x, c.y);
    if (!p) return;
    navPlaced = true;
    placeNav(minimap, p.x, p.y);
  }

  // 拖拽 move/up 挂 window 而非只挂导航框：框只有面板 1/3（约 67px），指针
  // 很容易滑出框外，只挂框上会丢 pointermove → 画布不跟手；setPointerCapture
  // 失败时（合成事件等）同样丢事件。挂 window 两者都兜住。
  function bindNavDrag(el) {
    el.addEventListener("pointerdown", ev => {
      if (ev.button !== 0) return;
      ev.stopPropagation(); // 不落到 svg 上，避开 bundle d3 pannable
      ev.preventDefault();  // 防选字/原生拖拽
      navDragging = true;
      try { el.setPointerCapture(ev.pointerId); } catch (_) {}
    });
  }

  function navPointerMove(ev) {
    if (!navDragging || !navEl || !navEl.isConnected) return;
    const minimap = navEl.parentElement;
    if (!minimap) return;
    const rect = minimap.getBoundingClientRect();
    const p = placeNav(minimap, ev.clientX - rect.left - minimap.clientLeft, ev.clientY - rect.top - minimap.clientTop);
    // 钳位后的框中心 → flow 坐标 → 视口跟过去（duration 0 跟手）
    const f = panelToFlow(minimap, p.x, p.y);
    const api = window.__MS_VIDEO_NODE_PATCH__;
    if (f && api && typeof api.centerViewport === "function") api.centerViewport(f.x, f.y, 0);
  }

  function navPointerEnd() {
    // 松手只解锁，位置交给 syncNav 从真实视口校准（取不到视口则原地不动）
    navDragging = false;
  }

  let downAt = null;
  let downOn = null;

  function init() {
    injectStyles();

    document.addEventListener("pointerdown", ev => {
      const minimap = ev.target && ev.target.closest ? ev.target.closest(MINIMAP_SEL) : null;
      if (!minimap) { downOn = null; return; }
      downOn = minimap;
      downAt = { x: ev.clientX, y: ev.clientY };
    }, true);

    // 导航框拖拽的 move/up 挂 window（框只有面板 1/3，指针很容易移出框外；
    // 只挂框上丢事件 → 画布不跟、松手被 syncNav 拉回视口中心，看着像
    // 「框拖不动、永远弹回中间」）
    window.addEventListener("pointermove", navPointerMove);
    window.addEventListener("pointerup", navPointerEnd);
    window.addEventListener("pointercancel", navPointerEnd);

    document.addEventListener("click", ev => {
      // 点/拖在导航框上的，归导航框自己管：清掉面板点击状态后直接返回
      if (ev.target && ev.target.closest && ev.target.closest(`.${NAV_CLS}`)) {
        downOn = null;
        downAt = null;
        return;
      }
      const minimap = ev.target && ev.target.closest ? ev.target.closest(MINIMAP_SEL) : null;
      if (!minimap || minimap !== downOn || !downAt) return;
      // 在小地图里按住拖动是 bundle 的 pannable 平移，别把它当点击再跳一次
      const moved = Math.abs(ev.clientX - downAt.x) + Math.abs(ev.clientY - downAt.y);
      downOn = null;
      downAt = null;
      if (moved > DRAG_GUARD_PX) return;
      jumpTo(minimap, ev.clientX, ev.clientY);
    }, true);

    const host = document.getElementById("root") || document.documentElement;
    new MutationObserver(scheduleSync).observe(host, { childList: true, subtree: true });
    // 平移/缩放不改节点属性，但会改 viewBox 与 bounds → 定时兜底
    window.setInterval(sync, 300);
    sync();
  }

  let queued = false;
  function scheduleSync() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; sync(); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
