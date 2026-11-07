const req = require("module").createRequire("C:/Users/liliang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { chromium } = req("playwright");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
  await page.goto("http://127.0.0.1:4173/index.html?cb=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const before = await page.evaluate(() => {
    const t = document.querySelector(".mobile-menu-trigger");
    const m = document.querySelector("#mobileMenu");
    return { triggerDisplay: t && getComputedStyle(t).display, menuClass: m && m.className, menuDisplay: m && getComputedStyle(m).display, innerWidth: window.innerWidth };
  });
  await page.click(".mobile-menu-trigger");
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => {
    const m = document.querySelector("#mobileMenu");
    return { menuClass: m.className, menuDisplay: getComputedStyle(m).display, box: m.getBoundingClientRect().toJSON() };
  });
  console.log(JSON.stringify({ before, after, errs }, null, 1));
  await browser.close();
})().catch((e) => { console.error("FATAL " + e.stack); process.exit(1); });
