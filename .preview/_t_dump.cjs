const { createRequire } = require("module");
const req = createRequire("C:/Users/liliang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/");
const { chromium } = req("playwright");
(async () => {
  const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto("http://127.0.0.1:4173/?cb=" + Date.now(), { waitUntil: "load" });
  await page.waitForTimeout(1200);
  const dump = await page.evaluate(() => {
    const out = {};
    out.scheduleHTML = (document.querySelector("#schedule") || {}).outerHTML?.slice(0, 1500);
    out.gridHTML = (document.querySelector("#animeGrid") || {}).outerHTML?.slice(0, 400);
    return out;
  });
  const raw = await page.content();
  const ids = [...raw.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
  process.stdout.write(JSON.stringify({ ids, dump }, null, 2).slice(0, 6000));
  await browser.close();
})().catch(e => { process.stdout.write("FATAL " + e.message); process.exit(1); });
