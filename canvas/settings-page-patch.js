(() => {
  "use strict";

  // ⚠ 仅由 canvas/settings.html 加载，切勿加进 canvas/index.html。
  // 作用：把画布 bundle 的「模型与接口设置」弹窗铺满整页，做成独立的设置工作区。
  // 原则：纯 CSS + 程序化打开弹窗，不改只读 bundle、不动任何 DOM 结构、不碰画布节点。
  //   经核实 isSettingsOpen 不在 bundle persist 的 partialize 白名单内，
  //   所以在这里打开弹窗不会写盘、也不会让画布那边自动弹窗。

  const STYLE_ID = "ms-settings-page-style";
  const BAR_ID = "ms-settings-page-bar";
  const ROOT_CLASS = "ms-settings-page";
  const OPEN_CLASS = "ms-sp-open";
  const SETTINGS_GEAR_TITLE = "模型与接口设置";

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      html.${ROOT_CLASS} body { overflow: hidden; }

      /* overlay 变成不透明全屏舞台：盖住标题栏(z90)/侧栏(z68)/画布，无需逐条隐藏 chrome。
         pointer-events:none 让 overlay 自身的「点空白关闭」永远点不到；
         modal 内再恢复 pointer-events:auto，正常交互不受影响。 */
      html.${ROOT_CLASS} .settings-overlay {
        position: fixed; inset: 0; z-index: 1000;
        display: block; overflow: auto; padding: 48px 0 0;
        background: #eeecea;
        -webkit-backdrop-filter: none; backdrop-filter: none;
        pointer-events: none;
      }
      html.${ROOT_CLASS} .settings-modal,
      html.${ROOT_CLASS} .settings-modal.settings-modal--sectioned {
        pointer-events: auto;
        width: min(1040px, 100%); max-width: 1040px;
        height: calc(100% - 48px); max-height: none;
        margin: 0 auto; border: 0; border-radius: 0;
        box-shadow: none; overflow: hidden;
      }

      /* 去掉所有会误关弹窗的出口：右上角叉 + 底部「保存配置」（其 onClick 即关闭）。 */
      html.${ROOT_CLASS} .settings-modal__header .close-btn,
      html.${ROOT_CLASS} .settings-modal__footer { display: none !important; }

      html.${ROOT_CLASS} #${BAR_ID} {
        position: fixed; top: 0; left: 0; right: 0; height: 48px; z-index: 1100;
        display: flex; align-items: center; gap: 12px; padding: 0 18px;
        background: #241d17; color: #fff8f2;
        font: 13px/1.4 "Noto Sans SC", "Microsoft YaHei", sans-serif;
      }
      #${BAR_ID} .ms-sp-title { font-weight: 700; font-size: 14px; }
      #${BAR_ID} .ms-sp-hint { color: #d9cdbf; font-size: 12px; margin-right: auto; }
      #${BAR_ID} button {
        border: 0; border-radius: 999px; padding: 8px 18px; cursor: pointer;
        font: 600 13px/1 "Noto Sans SC", "Microsoft YaHei", sans-serif;
        background: #ff6a1a; color: #fff;
      }
      #${BAR_ID} button:disabled { opacity: .6; cursor: default; }
      #${BAR_ID} .ms-sp-reopen { background: #3a3027; }
      /* 「重新打开设置」仅在弹窗确实不在时出现（兜底；本 bundle 无 Escape 关弹窗）。 */
      html.${ROOT_CLASS}.${OPEN_CLASS} #${BAR_ID} .ms-sp-reopen { display: none; }
      html.${ROOT_CLASS}:not(.${OPEN_CLASS}) #${BAR_ID} .ms-sp-reopen { display: inline-block; }
    `;
    document.head.appendChild(style);
  }

  function settingsStore() {
    try {
      return typeof window.Jh === "function" && typeof window.Jh.getState === "function"
        ? window.Jh
        : null;
    } catch {
      return null;
    }
  }

  // 打开弹窗：优先 store API（与视图无关，home 视图也能开），回退点齿轮。
  function ensureOpen() {
    const store = settingsStore();
    if (store) {
      try {
        if (!store.getState().isSettingsOpen) store.getState().toggleSettings(true);
        return;
      } catch {
        /* store 形态异常，落到齿轮回退 */
      }
    }
    const gear = [...document.querySelectorAll(".sidebar__icon-btn")].find(
      (el) => (el.title || "").indexOf(SETTINGS_GEAR_TITLE) >= 0,
    );
    if (gear) gear.click();
  }

  function flash(el, text) {
    if (!el) return;
    const original = el.textContent;
    el.textContent = text;
    el.disabled = true;
    window.setTimeout(() => {
      el.textContent = original;
      el.disabled = false;
    }, 1800);
  }

  // 「应用到画布」：在 iframe 里通知工作台重载画布 frame；独立标签页只给手动提示，不伪造同步。
  function applyToCanvas(button) {
    const inFrame = window.self !== window.top;
    if (inFrame) {
      try {
        window.parent.postMessage(
          { source: "manshiguang-canvas-settings", type: "apply-to-canvas" },
          window.location.origin,
        );
        flash(button, "已通知画布重载");
        return;
      } catch {
        /* postMessage 失败落到手动提示 */
      }
    }
    flash(button, "设置已保存，请手动刷新画布标签页");
  }

  function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.innerHTML =
      '<span class="ms-sp-title">API设置</span>' +
      '<span class="ms-sp-hint">改完点「应用到画布」让画布重新载入生效；本页只调整本地配置，不画节点。</span>' +
      '<button type="button" class="ms-sp-reopen">重新打开设置</button>' +
      '<button type="button" class="ms-sp-apply">应用到画布</button>';
    bar.querySelector(".ms-sp-reopen").addEventListener("click", ensureOpen);
    bar.querySelector(".ms-sp-apply").addEventListener("click", (event) => {
      applyToCanvas(event.currentTarget);
    });
    document.body.appendChild(bar);
    return bar;
  }

  function sync() {
    document.documentElement.classList.add(ROOT_CLASS);
    ensureBar();
    const open = !!document.querySelector(".settings-overlay");
    document.documentElement.classList.toggle(OPEN_CLASS, open);
    if (!open) ensureOpen();
  }

  let observer = null;
  function boot() {
    installStyles();
    ensureOpen();
    sync();
    if (!observer) {
      observer = new MutationObserver(sync);
      observer.observe(document.body, { childList: true, subtree: true });
    }
    // store 可能在首帧后才 hydrate，短轮询兜住时序，可重入不重复注入。
    window.setInterval(sync, 800);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
