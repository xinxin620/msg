(() => {
  "use strict";

  // 文本节点正文是 contentEditable 富文本，bundle 给外壳打了 `nodrag nopan nowheel`
  // （index-BN-uSJKj.js: canvas-node__text-editor-shell），React Flow 在带 nodrag
  // 的元素上不启动节点拖拽——所以按住正文拖不动节点，只能抓标题栏。
  // 本补丁改成 Figma 式交互：平时正文可拖（壳去 nodrag、富文本禁编辑），
  // 双击进入编辑（光标定位到点击处、可选字），Esc / 点击别处退出。
  // 不动只读 bundle：React 重渲染会还原 nodrag/contenteditable，靠
  // MutationObserver + 定时 sync 持续纠正。

  const SHELL_SEL = ".canvas-node__text-editor-shell";
  const RICHTEXT_SEL = ".canvas-node__richtext";
  const EDITING_ATTR = "data-ms-text-editing";

  function richtextOf(shell) {
    return shell ? shell.querySelector(RICHTEXT_SEL) : null;
  }

  function setEditing(shell, on) {
    if (!shell) return;
    const rt = richtextOf(shell);
    if (on) {
      shell.classList.add("nodrag");
      shell.setAttribute(EDITING_ATTR, "1");
      if (rt) {
        rt.style.pointerEvents = "auto";
        rt.style.userSelect = "text";
        rt.setAttribute("contenteditable", "true");
      }
    } else {
      shell.classList.remove("nodrag");
      shell.removeAttribute(EDITING_ATTR);
      if (rt) {
        rt.style.pointerEvents = "";
        rt.style.userSelect = "";
        rt.setAttribute("contenteditable", "false");
      }
    }
  }

  function exitEditing() {
    const shell = document.querySelector(SHELL_SEL + "[" + EDITING_ATTR + "]");
    if (shell) setEditing(shell, false);
  }

  // 非编辑态保险：bundle 重渲染会重新带上 nodrag 并把富文本置回可编辑
  function sync() {
    for (const shell of document.querySelectorAll(SHELL_SEL)) {
      if (shell.hasAttribute(EDITING_ATTR)) continue;
      if (shell.classList.contains("nodrag")) { setEditing(shell, false); continue; }
      const rt = richtextOf(shell);
      if (rt && rt.getAttribute("contenteditable") !== "false") {
        rt.setAttribute("contenteditable", "false");
      }
    }
  }

  function placeCaret(shell, x, y) {
    const rt = richtextOf(shell);
    if (!rt) return;
    rt.focus();
    const range = document.caretRangeFromPoint
      ? document.caretRangeFromPoint(x, y)
      : null;
    const sel = window.getSelection();
    if (range && sel && rt.contains(range.startContainer)) {
      sel.removeAllRanges();
      sel.addRange(range);
    } else if (range && sel) {
      const last = document.createRange();
      last.selectNodeContents(rt);
      last.collapse(false);
      sel.removeAllRanges();
      sel.addRange(last);
    }
  }

  let queued = false;
  function scheduleSync() {
    if (queued) return;
    queued = true;
    window.requestAnimationFrame(() => { queued = false; sync(); });
  }

  function init() {
    // 捕获阶段先于 React Flow 的拖拽判定：双击正文 → 进入编辑
    document.addEventListener("dblclick", ev => {
      const shell = ev.target && ev.target.closest ? ev.target.closest(SHELL_SEL) : null;
      if (!shell) return;
      ev.stopPropagation();
      ev.preventDefault();
      exitEditing();
      setEditing(shell, true);
      placeCaret(shell, ev.clientX, ev.clientY);
    }, true);

    // 点击编辑壳以外任何地方退出编辑（含点另一文本节点、拖别的节点、点画布）
    document.addEventListener("pointerdown", ev => {
      const editing = document.querySelector(SHELL_SEL + "[" + EDITING_ATTR + "]");
      if (!editing) return;
      if (ev.target && ev.target.closest && ev.target.closest("[" + EDITING_ATTR + "]") === editing) return;
      setEditing(editing, false);
    }, true);

    document.addEventListener("keydown", ev => {
      if (ev.key !== "Escape") return;
      const editing = document.querySelector(SHELL_SEL + "[" + EDITING_ATTR + "]");
      if (!editing) return;
      const rt = richtextOf(editing);
      if (rt) rt.blur();
      setEditing(editing, false);
      ev.stopPropagation();
    }, true);

    new MutationObserver(scheduleSync).observe(document.getElementById("root") || document.documentElement, { childList: true, subtree: true });
    window.setInterval(sync, 400);
    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
