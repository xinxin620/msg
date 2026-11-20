(() => {
  "use strict";

  // 小地图「缩到最小看不见」两个独立原因，都在只读 bundle 里：
  // ① 配色被顶掉：`.custom-minimap` 的深色渐变底（index-BfAuAU0s.css offset
  //    141771）被更靠后、同权重的 `.react-flow__minimap{background:var(--minimap-bg)
  //    !important}`（151570，值 #e5e3e0）覆盖，而画布底色是 #eeecea（差 3%）、
  //    边框 --node-border 是 #e0deda，于是整块面板糊进画布；遮罩 fill:#f5efe71f
  //    与描边 #fff6ebc7 本来就是按深底设计的，落在浅底上等于没有。
  // ② 节点尺寸：MiniMap 把全部节点装进固定 200×150 视框，节点铺得越散，
  //    每个 rect 的 width/height 属性越小（缩到 1~2px 就只剩几个像素点）。
  // 本补丁：① 恢复深色高对比底 + 视口外压暗 + 视口亮描边；② 按「1 用户单位
  //    实际等于多少 CSS px」把每个节点非等比放大到最低 4.5px（transform-origin
  //    中心，位置不动），上限 10× 防止把细长节点撑成色块。
  // React 重渲染会连 style 一起重写，靠 MutationObserver + 定时 sync 持续纠正；
  // 期望值记在 data-* 上比对，避免自己触发的属性变更把观察器点成死循环。

  const MINIMAP_SEL = ".react-flow__minimap.custom-minimap";
  const NODE_SEL = ".react-flow__minimap-node";
  const MIN_PX = 4.5;
  const MAX_SCALE = 10;
  const SCALE_ATTR = "msMinimapScale";

  function injectStyles() {
    if (document.getElementById("ms-minimap-styles")) return;
    const style = document.createElement("style");
    style.id = "ms-minimap-styles";
    style.textContent = [
      // 0,3,0 权重压过 bundle 的 `.custom-minimap .react-flow__minimap-node`（0,2,0）
      `${MINIMAP_SEL}{background:radial-gradient(circle at 0 0,#ffffff21,#0000 46%),linear-gradient(#2a241ff2,#16130ef7)!important;border:1px solid #ffffff2e!important;box-shadow:0 18px 40px #1f1a166b,inset 0 1px 0 #ffffff21!important}`,
      `${MINIMAP_SEL} .react-flow__minimap-background{fill:#0000!important}`,
      `${MINIMAP_SEL} ${NODE_SEL}{fill:#f4e3bd!important;stroke:#100d0ab0!important;stroke-width:.5px!important;vector-effect:non-scaling-stroke!important;transform-box:fill-box!important;transform-origin:center!important}`,
      `${MINIMAP_SEL} ${NODE_SEL}.selected{fill:#ffb02e!important;stroke:#100d0a!important}`,
      // 遮罩是 evenodd 路径（整块减去视口矩形）：fill 压暗视口外，stroke 即视口描边
      `${MINIMAP_SEL} .react-flow__minimap-mask{fill:#0000006b!important;stroke:#ffd68fd9!important;stroke-width:1.5px!important}`,
    ].join("");
    document.head.appendChild(style);
  }

  // viewBox 随节点分布动态算（不是固定 200×150），而 SVG 被 `.custom-minimap`
  // 的 width/height 钉死，所以不能假设 1 用户单位 = 1px，按实际渲染宽度换算。
  function unitsToPx(svg) {
    const box = svg.viewBox && svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    if (!box || !(box.width > 0) || !(rect.width > 0)) return 1;
    return rect.width / box.width;
  }

  function sync() {
    const svg = document.querySelector(`${MINIMAP_SEL} svg`);
    if (!svg) return;
    const k = unitsToPx(svg);
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
  }

  let queued = false;
  function scheduleSync() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; sync(); });
  }

  function init() {
    injectStyles();
    const host = document.getElementById("root") || document.documentElement;
    new MutationObserver(scheduleSync).observe(host, { childList: true, subtree: true });
    // 平移/缩放只改视口遮罩、不改节点属性，但会改节点bounds → 定时兜底
    window.setInterval(sync, 300);
    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
