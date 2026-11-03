(() => {
  "use strict";

  const replacements = new Map([
    ["抖音/B站/小红书：大桶子ai", "抖音/B站/小红书：阿亮啊"],
    ["微信：wmxwz1", "微信：liangliang_0314"],
    ["资料主站：hub.datong-ai.cn", "资料主站：https://github.com/xinxin620"],
  ]);
  const authorLineSelector = ".settings-sidebar__author-line";
  const donationQrSelector = ".settings-sidebar__donation img";
  const donationQrFile = "donation-qr-liangliang-20261103.png";
  const donationQrVersion = "20261103-2";
  const root = document.getElementById("root") || document.documentElement;

  function applyCanvasBranding() {
    for (const line of document.querySelectorAll(authorLineSelector)) {
      const replacement = replacements.get(line.textContent?.trim() || "");
      if (replacement && line.textContent !== replacement) {
        line.textContent = replacement;
      }
    }

    const donationQr = document.querySelector(donationQrSelector);
    if (donationQr) {
      const expectedSrc = new URL(
        `./${donationQrFile}?v=${donationQrVersion}`,
        window.location.href,
      ).href;
      if (donationQr.src !== expectedSrc) {
        donationQr.src = expectedSrc;
      }
    }
  }

  new MutationObserver(applyCanvasBranding).observe(root, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  applyCanvasBranding();
})();
