const projectLinkInput = document.getElementById("projectLink");
const businessNameInput = document.getElementById("businessName");
const marketingMessage = document.getElementById("marketingMessage");
const marketingTone = document.getElementById("marketingTone");
const marketingStatus = document.getElementById("marketingStatus");

function getProjectLink() {
  return projectLinkInput?.value?.trim() || "";
}

function getBusinessName() {
  return businessNameInput?.value?.trim() ||
    document.getElementById("userName")?.innerText?.trim() ||
    "مشروعي";
}

function buildMarketingMessage(tone) {
  const name = getBusinessName();
  const link = getProjectLink();

  const messages = {
    short:
      `✨ ${name}\nاحجز خدمتك بسهولة وفي أقل من دقيقة.\n${link}`,

    offer:
      `🎉 محتاج خدمة تنظيف مريحة وسريعة؟\nمع ${name} تقدر تحدد تفاصيل الخدمة والموعد وتشوف السعر قبل الحجز.\nاحجز من هنا 👇\n${link}`,

    personal:
      `أهلاً 👋\nلو محتاج تنظيف للبيت، تقدر تحجز مباشرة من صفحة ${name} وتحدد الموعد والمكان بسهولة.\nده رابط الحجز:\n${link}`
  };

  return messages[tone] || messages.short;
}

function refreshMessage() {
  if (!marketingMessage) return;
  marketingMessage.value = buildMarketingMessage(marketingTone?.value || "short");
  if (marketingStatus) marketingStatus.innerText = "";
}

async function copyText(text, successMessage) {
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    marketingStatus.innerText = successMessage;
  } catch (error) {
    marketingStatus.innerText = "تعذر النسخ تلقائيًا — يمكنك تحديد النص ونسخه يدويًا";
  }
}

marketingTone?.addEventListener("change", refreshMessage);
document.getElementById("refreshMarketingTextBtn")?.addEventListener("click", refreshMessage);

document.getElementById("copyMarketingTextBtn")?.addEventListener("click", async () => {
  await copyText(marketingMessage.value, "تم نسخ الرسالة التسويقية ✅");
});

document.getElementById("copyMarketingLinkBtn")?.addEventListener("click", async () => {
  await copyText(getProjectLink(), "تم نسخ رابط المشروع ✅");
});

document.getElementById("whatsappMarketingBtn")?.addEventListener("click", () => {
  const text = marketingMessage.value || buildMarketingMessage(marketingTone?.value || "short");
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
});

document.getElementById("nativeMarketingShareBtn")?.addEventListener("click", async () => {
  const link = getProjectLink();
  const text = marketingMessage.value || buildMarketingMessage(marketingTone?.value || "short");

  if (navigator.share) {
    try {
      await navigator.share({
        title: getBusinessName(),
        text,
        url: link
      });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
});

let attempts = 0;
const projectReadyTimer = setInterval(() => {
  attempts++;

  if (getProjectLink() || attempts >= 20) {
    clearInterval(projectReadyTimer);
    refreshMessage();
  }
}, 500);
