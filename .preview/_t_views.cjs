const req = require("module").createRequire("C:/Users/liliang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { chromium } = req("playwright");
const tabs = ["top", "library", "ranking", "schedule", "community"];
(async () => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
  await page.goto("http://127.0.0.1:4173/index.html?cb=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(1200);

  const snap = () => page.evaluate(() => ({
    view: document.body.dataset.view,
    active: [...document.querySelectorAll(".desktop-nav a.is-active")].map((a) => a.textContent.trim()),
    visibleSections: [...document.querySelectorAll("main > [data-view]")].filter((s) => s.getBoundingClientRect().height > 4).map((s) => s.id),
    scrollY: Math.round(window.scrollY),
    docH: Math.round(document.documentElement.scrollHeight),
    cards: document.querySelectorAll("#animeGrid > *").length,
  }));

  const results = [];
  const assert = (name, cond, extra) => results.push({ name, pass: !!cond, detail: extra });

  const s0 = await snap();
  assert("初始只展示首页视图", s0.view === "top" && s0.visibleSections.join() === "top,continue,join-section", JSON.stringify(s0));

  // 滚轮在首页：只在视图内滚动，不切换
  await page.mouse.wheel(0, 1500); await page.waitForTimeout(500);
  const s1 = await snap();
  assert("首页滚轮后视图不变", s1.view === "top", JSON.stringify(s1));

  // 逐个点击 tab
  for (const label of ["番剧库", "排行榜", "新番表", "社区"]) {
    await page.click(`.desktop-nav a:has-text("${label}")`);
    await page.waitForTimeout(450);
    const s = await snap();
    const expected = tabs[["番剧库", "排行榜", "新番表", "社区"].indexOf(label) + 1];
    assert(`点击 ${label} 切到 ${expected}`, s.view === expected && s.active.join() === label, JSON.stringify(s));
    assert(`${label} 视图内只有自己的板块`, s.visibleSections.length === 1 && s.visibleSections[0] === expected, JSON.stringify(s.visibleSections));
  }

  // 回到番剧库，验证滚轮能正常滚动页面内容且不跳到别的 tab
  await page.click('.desktop-nav a:has-text("番剧库")'); await page.waitForTimeout(400);
  await page.mouse.wheel(0, 1200); await page.waitForTimeout(500);
  const sw = await snap();
  assert("番剧库内滚轮可滚动内容", sw.scrollY > 200, JSON.stringify(sw));
  assert("番剧库滚轮后仍是番剧库", sw.view === "library" && sw.active.join() === "番剧库", JSON.stringify(sw));

  // 首页到底部再滚轮，不会滑进番剧库
  await page.click('.desktop-nav a:has-text("首页")'); await page.waitForTimeout(400);
  await page.mouse.wheel(0, 5000); await page.waitForTimeout(600);
  const sh = await snap();
  assert("首页滚到底不会进入番剧库", sh.view === "top" && sh.scrollY < 700, JSON.stringify(sh));

  // 收藏按钮定位到番剧库视图
  await page.click(".favorites-trigger"); await page.waitForTimeout(500);
  const sf = await snap();
  const favCount = await page.evaluate(() => JSON.parse(localStorage.getItem("manshiguang:favorites") || "[]").length);
  if (favCount > 0) assert("追番按钮切到番剧库视图", sf.view === "library", JSON.stringify(sf));

  // 深链
  await page.goto("http://127.0.0.1:4173/index.html?cb=" + Date.now() + "#ranking", { waitUntil: "load" });
  await page.waitForTimeout(1100);
  const sd = await snap();
  assert("深链 #ranking 直达排行榜", sd.view === "ranking" && sd.active.join() === "排行榜", JSON.stringify(sd));

  // 移动端菜单点击同样切视图
  await page.setViewportSize({ width: 420, height: 900 });
  await page.goto("http://127.0.0.1:4173/index.html?cb=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.click(".mobile-menu-trigger"); await page.waitForTimeout(300);
  await page.click("#mobileMenu a:has-text(\"新番表\")"); await page.waitForTimeout(450);
  const sm = await snap();
  assert("移动菜单点击切到新番表", sm.view === "schedule", JSON.stringify(sm));
  const menuOpen = await page.evaluate(() => document.querySelector("#mobileMenu")?.classList.contains("is-open"));
  assert("移动菜单点击后自动收起", menuOpen === false, String(menuOpen));

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:4173/index.html?cb=" + Date.now() + "#community", { waitUntil: "load" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: ".preview/view-community.png" });
  await page.evaluate(() => document.querySelector(".desktop-nav a[href='#library']").click());
  await page.waitForTimeout(900);
  await page.screenshot({ path: ".preview/view-library.png" });
  await page.evaluate(() => document.querySelector(".desktop-nav a[href='#top']").click());
  await page.waitForTimeout(900);
  await page.screenshot({ path: ".preview/view-home.png" });

  console.log(JSON.stringify(results, null, 1));
  console.log("FAILED " + results.filter((r) => !r.pass).length + "/" + results.length);
  console.log("ERRORS " + JSON.stringify(errs));
  await browser.close();
})().catch((e) => { console.error("FATAL " + e.stack); process.exit(1); });
