const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const file = path.join(root, "assets", "app.js");
let src = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

function need(marker) {
  if (!src.includes(marker)) throw new Error("not found: " + marker.slice(0, 60));
  return true;
}

const startMarker = "function setupHeader() {";
const endMarker = "\nfunction setupHeroTilt() {";
need(startMarker);
need(endMarker);
const start = src.indexOf(startMarker);
const end = src.indexOf(endMarker);

const replacement = [
"function setupHeader() {",
"  const header = $(\"#siteHeader\");",
"  if (!header) return;",
"",
"  const views = $$(\"main > [data-view]\");",
"  const viewIds = [...new Set(views.map((view) => view.dataset.view))];",
"  const navLinks = $$(\".desktop-nav a[href^='#']\");",
"  const currentView = () => document.body.dataset.view || \"top\";",
"",
"  const updateHeader = () => {",
"    // 非首页视图的内容从页面顶部开始，直接沿用压缩后的吸顶导航样式",
"    header.classList.toggle(\"is-scrolled\", window.scrollY > 26 || currentView() !== \"top\");",
"  };",
"",
"  const setActiveTab = (id) => {",
"    navLinks.forEach((link) => {",
"      const isActive = link.getAttribute(\"href\") === `#${id}`;",
"      link.classList.toggle(\"is-active\", isActive);",
"      if (isActive) {",
"        link.setAttribute(\"aria-current\", \"page\");",
"      } else {",
"        link.removeAttribute(\"aria-current\");",
"      }",
"    });",
"  };",
"",
"  const showView = (id) => {",
"    if (!viewIds.includes(id)) return false;",
"    views.forEach((view) => view.classList.toggle(\"is-view-active\", view.dataset.view === id));",
"    document.body.dataset.view = id;",
"    setActiveTab(id);",
"    updateHeader();",
"    window.scrollTo({ top: 0, left: 0, behavior: \"auto\" });",
"    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: \"auto\" }));",
"    return true;",
"  };",
"",
"  // 锚点可能指向视图本身（#library），也可能指向视图内部的元素（#continue）",
"  const viewOfAnchor = (id) => {",
"    if (viewIds.includes(id)) return id;",
"    const holder = document.getElementById(id)?.closest(\"main > [data-view]\");",
"    return holder ? holder.dataset.view : null;",
"  };",
"",
"  const goToAnchor = (href, options = {}) => {",
"    if (!href || !href.startsWith(\"#\") || href.length < 2) return false;",
"    const id = decodeURIComponent(href.slice(1));",
"    const viewId = viewOfAnchor(id);",
"    if (!viewId) return false;",
"",
"    const sameView = currentView() === viewId;",
"    showView(viewId);",
"    if (options.writeHash !== false) history.replaceState(null, \"\", href);",
"    // 已在当前视图时才做滚动定位；跨视图切换后统一回到视图顶部",
"    if (sameView && id !== viewId) {",
"      document.getElementById(id)?.scrollIntoView({ behavior: \"smooth\", block: \"start\" });",
"    }",
"    return true;",
"  };",
"",
"  // 滚轮不切换视图：只有点击导航锚点才切换首页 / 番剧库 / 排行榜 / 新番表 / 社区",
"  document.addEventListener(\"click\", (event) => {",
"    const link = event.target.closest('a[href^=\"#\"]');",
"    if (!link) return;",
"    const href = link.getAttribute(\"href\");",
"    if (!href || href === \"#\") return;",
"    if (link.hasAttribute(\"data-native-anchor\")) return;",
"    if (!goToAnchor(href)) return;",
"    event.preventDefault();",
"    closeMobileMenu();",
"  });",
"",
"  // 支持 #ranking 这类深链，以及浏览器前进后退",
"  const initialHash = location.hash && location.hash.length > 1 ? location.hash : \"#top\";",
"  if (!goToAnchor(initialHash, { writeHash: false })) showView(\"top\");",
"  window.addEventListener(\"hashchange\", () => goToAnchor(location.hash || \"#top\"));",
"",
"  goToAnchorRef = goToAnchor;",
"  window.addEventListener(\"scroll\", updateHeader, { passive: true });",
"  updateHeader();",
"}"
].join("\n");

src = src.slice(0, start) + replacement + src.slice(end);

need("let favorites = readFavorites();\nlet toastTimer;");
src = src.replace("let favorites = readFavorites();\nlet toastTimer;", "let favorites = readFavorites();\nlet toastTimer;\nlet goToAnchorRef = null;");

const oldLine = '    document.getElementById("library")?.scrollIntoView({ behavior: "smooth", block: "start" });';
need(oldLine);
src = src.replace(
  oldLine,
  '    goToAnchorRef?.("#library", { writeHash: false });',
);

fs.writeFileSync(file, src.replace(/\n/g, "\r\n"), "utf8");
console.log("PATCHED app.js, length=" + src.length);
