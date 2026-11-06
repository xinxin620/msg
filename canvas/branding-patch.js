(() => {
  "use strict";

  const replacements = new Map([
    ["抖音/B站/小红书：大桶子ai", "抖音/B站/小红书：阿亮啊"],
    ["微信：wmxwz1", "微信：liangliang_0314"],
    ["资料主站：hub.datong-ai.cn", "资料主站：https://github.com/xinxin620"],
  ]);
  const authorLineSelector = ".settings-sidebar__author-line";
  const productNameSelector = ".app-titlebar__text strong";
  const productLogoSelector = ".app-titlebar__logo";
  const productLogoPath = "../assets/favicon-32x32.png";
  const productLogoVersion = "20261104-2";
  const donationQrSelector = ".settings-sidebar__donation img";
  const donationQrFile = "donation-qr-liangliang-20261103.png";
  const donationQrVersion = "20261103-2";
  const root = document.getElementById("root") || document.documentElement;

  function applyCanvasBranding() {
    const productName = document.querySelector(productNameSelector);
    if (productName && productName.textContent !== "画布") {
      productName.textContent = "画布";
    }

    const productLogo = document.querySelector(productLogoSelector);
    if (productLogo) {
      if (productLogo.alt !== "画布") {
        productLogo.alt = "画布";
      }
      const expectedLogoSrc = new URL(
        `${productLogoPath}?v=${productLogoVersion}`,
        window.location.href,
      ).href;
      if (productLogo.src !== expectedLogoSrc) {
        productLogo.src = expectedLogoSrc;
      }
    }

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
