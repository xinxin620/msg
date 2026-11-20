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
  // ⑤ 固定尺寸导航框：面板内叠一个 88×44 的 HTML div（不是 svg rect，所以
  //    不跟着 viewBox/缩放变大小），中心钉在当前画布视口中心（flow 坐标经
  //    getScreenCTM 投影，并 clamp 在面板内）。按住它拖 = 把视口中心拖到哪，
  //    走 centerViewport(x,y,0) 跟手；拖完位置由 sync 从 viewportCenter 校准。
  //    pointerdown 上 stopPropagation，避开 bundle 在 svg 上的 d3 pannable。
  // React 重渲染会连 style 一起重写，靠 MutationObserver + 定时 sync 纠正；
  // 期望值记在 data-* 上比对，避免自己触发的属性变更把观察器点成死循环。

  const MINIMAP_SEL = ".react-flow__minimap.custom-minimap";
  const NODE_SEL = ".react-flow__minimap-node";
  const MIN_PX = 6;
  const MAX_SCALE = 10;
  const SCALE_ATTR = "msMinimapScale";
  const DRAG_GUARD_PX = 4;
  const NAV_CLS = "ms-minimap-nav";
  const NAV_W = 88;
  const NAV_H = 44;
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
      // 视口框：bundle 遮罩 stroke 是浅底不可见，改成深色描边即可突出边框
      `${MINIMAP_SEL} .react-flow__minimap-mask{stroke:#4a4540cc!important;stroke-width:2px!important}`,
      // 固定导航框：HTML div 叠在 svg 上，尺寸写死 CSS px，不随 viewBox 变
      `.${NAV_CLS}{position:absolute;box-sizing:border-box;width:${NAV_W}px;height:${NAV_H}px;`
        + `border:2px solid #3b9eff;border-radius:6px;background:#3b9eff14;cursor:move;`
        + `z-index:2;touch-action:none}`,
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
    // 导航框：拖拽中不动它（用户正拿着），其余每次 sync 跟随真实视口中心
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

  function ensureNav(minimap) {
    if (navEl && navEl.isConnected && navEl.parentElement === minimap) return navEl;
    navEl = minimap.querySelector(`.${NAV_CLS}`);
    if (!navEl) {
      navEl = document.createElement("div");
      navEl.className = NAV_CLS;
      navEl.title = "拖动导航框定位画布";
      minimap.appendChild(navEl);
      bindNavDrag(navEl);
    }
    return navEl;
  }

  function clampNavLeft(minimap, cx) {
    const w = minimap.clientWidth || 206;
    return Math.min(Math.max(cx, NAV_PAD + NAV_W / 2), w - NAV_PAD - NAV_W / 2);
  }
  function clampNavTop(minimap, cy) {
    const h = minimap.clientHeight || 136;
    return Math.min(Math.max(cy, NAV_PAD + NAV_H / 2), h - NAV_PAD - NAV_H / 2);
  }

  function placeNav(minimap, cx, cy) {
    cx = clampNavLeft(minimap, cx);
    cy = clampNavTop(minimap, cy);
    navEl.style.left = `${(cx - NAV_W / 2).toFixed(1)}px`;
    navEl.style.top = `${(cy - NAV_H / 2).toFixed(1)}px`;
  }

  function syncNav(minimap) {
    const api = window.__MS_VIDEO_NODE_PATCH__;
    if (!api || typeof api.viewportCenter !== "function") return;
    const c = api.viewportCenter();
    if (!c) return;
    const p = flowToPanel(minimap, c.x, c.y);
    if (!p) return;
    placeNav(minimap, p.x, p.y);
  }

  function bindNavDrag(el) {
    let start = null;
    el.addEventListener("pointerdown", ev => {
      if (ev.button !== 0) return;
      ev.stopPropagation(); // 不落到 svg 上，避开 bundle d3 pannable
      navDragging = true;
      el.setPointerCapture(ev.pointerId);
      start = { x: ev.clientX, y: ev.clientY, moved: false };
    });
    el.addEventListener("pointermove", ev => {
      if (!navDragging || !el.isConnected) return;
      const minimap = el.parentElement;
      if (!minimap) return;
      if (start && Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > DRAG_GUARD_PX) start.moved = true;
      const rect = minimap.getBoundingClientRect();
      const cx = clampNavLeft(minimap, ev.clientX - rect.left - minimap.clientLeft);
      const cy = clampNavTop(minimap, ev.clientY - rect.top - minimap.clientTop);
      placeNav(minimap, cx, cy);
      if (start && start.moved) {
        // 导航框（钳位后的）中心 → flow 坐标 → 视口跟过去（duration 0 跟手）
        const f = panelToFlow(minimap, cx, cy);
        const api = window.__MS_VIDEO_NODE_PATCH__;
        if (f && api && typeof api.centerViewport === "function") api.centerViewport(f.x, f.y, 0);
      }
    });
    const end = ev => {
      if (!navDragging) return;
      navDragging = false;
      try { el.releasePointerCapture(ev.pointerId); } catch (_) {}
      const wasMoved = !!(start && start.moved);
      start = null;
      if (el.isConnected) syncNav(el.parentElement); // 拖完从真实视口校准一次
      else navEl = null;
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
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
