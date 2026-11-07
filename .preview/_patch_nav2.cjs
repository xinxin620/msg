const fs = require("fs");
const path = require("path");
const file = path.resolve(__dirname, "..", "assets", "app.js");
let src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function sub(from, to) {
  if (!src.includes(from)) throw new Error("missing: " + from.slice(0, 70));
  src = src.replace(from, to);
}

// 1. 视图切换后补触发入场动画：display:none 的元素不会被 IntersectionObserver 命中
sub(
  "    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: \"auto\" }));\n    return true;",
  "    window.requestAnimationFrame(() => {\n      window.scrollTo({ top: 0, left: 0, behavior: \"auto\" });\n      revealInView(id);\n    });\n    return true;",
);

sub(
  "  // 滚轮不切换视图：",
  "  // 隐藏板块里的 .reveal 不会被 IntersectionObserver 命中，切到该视图时直接补上可见态\n  const revealInView = (id) => {\n    views\n      .filter((view) => view.dataset.view === id)\n      .forEach((view) => {\n        $$(\".reveal\", view).forEach((element) => element.classList.add(\"is-visible\"));\n      });\n  };\n\n  // 滚轮不切换视图：",
);

// 2. 仅在 JS 就绪后启用互斥视图，纯静态打开时不隐藏任何内容
sub(
  "  goToAnchorRef = goToAnchor;",
  "  document.documentElement.classList.add(\"js-views\");\n  goToAnchorRef = goToAnchor;",
);

// 3. 其它视图的内容需要出现在无障碍/查找树里之前，先给首页补一次可见态
sub("  updateHeader();\n}", "  updateHeader();\n  revealInView(currentView());\n}");

src = src.replace("}\nfunction setupHeroTilt() {", "}\n\nfunction setupHeroTilt() {");
fs.writeFileSync(file, src.replace(/\n/g, "\r\n"), "utf8");
console.log("OK");
