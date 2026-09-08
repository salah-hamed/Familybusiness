const canvas = document.getElementById("marketingCanvas");
const ctx = canvas?.getContext("2d");
const formatSelect = document.getElementById("creativeFormat");
const themeSelect = document.getElementById("creativeTheme");
const headlineInput = document.getElementById("creativeHeadline");
const offerInput = document.getElementById("creativeOffer");
const ctaInput = document.getElementById("creativeCta");
const imageInput = document.getElementById("creativeImage");
const statusBox = document.getElementById("creativeStatus");
const projectLinkInput = document.getElementById("projectLink");
const businessNameInput = document.getElementById("businessName");

let uploadedImage = null;

const themes = {
  clean: {
    start: "#4f46e5",
    end: "#7c3aed",
    accent: "#fbbf24",
    text: "#ffffff",
    soft: "rgba(255,255,255,.16)"
  },
  bold: {
    start: "#111827",
    end: "#4338ca",
    accent: "#22c55e",
    text: "#ffffff",
    soft: "rgba(255,255,255,.13)"
  },
  soft: {
    start: "#eef2ff",
    end: "#ddd6fe",
    accent: "#4f46e5",
    text: "#111827",
    soft: "rgba(255,255,255,.55)"
  }
};

function getBusinessName() {
  return businessNameInput?.value?.trim() || document.getElementById("userName")?.innerText?.trim() || "مشروعي";
}

function getProjectLink() {
  return projectLinkInput?.value?.trim() || "";
}

function roundRect(x, y, width, height, radius, fillStyle) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
}

function drawCoverImage(image, width, height) {
  const imageRatio = image.width / image.height;
  const canvasRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;

  if (imageRatio > canvasRatio) {
    sw = image.height * canvasRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / canvasRatio;
    sy = (image.height - sh) / 2;
  }

  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
}

function wrapRTLText(text, x, y, maxWidth, lineHeight, maxLines = 4) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });

  if (line) lines.push(line);

  lines.slice(0, maxLines).forEach((currentLine, index) => {
    ctx.fillText(currentLine, x, y + index * lineHeight);
  });

  return y + Math.min(lines.length, maxLines) * lineHeight;
}

function drawCreative() {
  if (!canvas || !ctx) return;

  const story = formatSelect.value === "story";
  const width = 1080;
  const height = story ? 1920 : 1080;
  canvas.width = width;
  canvas.height = height;

  const theme = themes[themeSelect.value] || themes.clean;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, theme.start);
  gradient.addColorStop(1, theme.end);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  if (uploadedImage) {
    ctx.save();
    drawCoverImage(uploadedImage, width, height);
    ctx.fillStyle = themeSelect.value === "soft" ? "rgba(238,242,255,.82)" : "rgba(17,24,39,.56)";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  } else {
    ctx.fillStyle = theme.soft;
    ctx.beginPath();
    ctx.arc(width * .13, height * .15, story ? 220 : 165, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(width * .88, height * .74, story ? 300 : 205, 0, Math.PI * 2);
    ctx.fill();
  }

  const pad = story ? 90 : 76;
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";

  roundRect(pad, story ? 120 : 70, width - pad * 2, story ? 120 : 95, 28, theme.soft);
  ctx.fillStyle = theme.text;
  ctx.font = `700 ${story ? 42 : 34}px Tahoma, Arial, sans-serif`;
  ctx.fillText(getBusinessName(), width - pad - 36, story ? 198 : 132);

  const contentTop = story ? 500 : 300;
  ctx.fillStyle = theme.text;
  ctx.font = `900 ${story ? 82 : 68}px Tahoma, Arial, sans-serif`;
  const headlineBottom = wrapRTLText(
    headlineInput.value.trim() || "تنظيف بيتك أسهل من أي وقت",
    width - pad,
    contentTop,
    width - pad * 2,
    story ? 112 : 88,
    story ? 5 : 4
  );

  const offer = offerInput.value.trim();
  let nextY = headlineBottom + (story ? 55 : 35);

  if (offer) {
    ctx.font = `800 ${story ? 44 : 34}px Tahoma, Arial, sans-serif`;
    const offerWidth = Math.min(ctx.measureText(offer).width + 70, width - pad * 2);
    const offerX = width - pad - offerWidth;
    roundRect(offerX, nextY - (story ? 54 : 43), offerWidth, story ? 78 : 62, 22, theme.accent);
    ctx.fillStyle = themeSelect.value === "soft" ? "#ffffff" : "#111827";
    ctx.fillText(offer, width - pad - 30, nextY);
    nextY += story ? 130 : 95;
  }

  ctx.fillStyle = theme.text;
  ctx.globalAlpha = .9;
  ctx.font = `500 ${story ? 40 : 30}px Tahoma, Arial, sans-serif`;
  wrapRTLText("حدد تفاصيل الخدمة والموعد واعرف السعر قبل تأكيد الحجز.", width - pad, nextY, width - pad * 2, story ? 62 : 48, 3);
  ctx.globalAlpha = 1;

  const ctaText = ctaInput.value.trim() || "احجز الآن";
  const ctaY = height - (story ? 380 : 255);
  roundRect(pad, ctaY, width - pad * 2, story ? 125 : 100, 28, theme.accent);
  ctx.fillStyle = themeSelect.value === "soft" ? "#ffffff" : "#111827";
  ctx.textAlign = "center";
  ctx.font = `900 ${story ? 48 : 40}px Tahoma, Arial, sans-serif`;
  ctx.fillText(ctaText, width / 2, ctaY + (story ? 80 : 66));

  const link = getProjectLink();
  ctx.fillStyle = theme.text;
  ctx.globalAlpha = .78;
  ctx.textAlign = "center";
  ctx.font = `500 ${story ? 27 : 22}px Arial, sans-serif`;
  const displayLink = link.length > 74 ? `${link.slice(0, 71)}...` : link;
  if (displayLink) ctx.fillText(displayLink, width / 2, ctaY + (story ? 185 : 145));
  ctx.globalAlpha = 1;

  ctx.textAlign = "right";
  ctx.fillStyle = theme.text;
  ctx.globalAlpha = .72;
  ctx.font = `700 ${story ? 25 : 20}px Tahoma, Arial, sans-serif`;
  ctx.fillText("احجز خدمتك أونلاين بسهولة", width - pad, height - (story ? 95 : 65));
  ctx.globalAlpha = 1;

  statusBox.innerText = "تم تحديث التصميم ✅";
}

function canvasBlob() {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png", 0.95));
}

imageInput?.addEventListener("change", () => {
  const file = imageInput.files?.[0];
  if (!file) {
    uploadedImage = null;
    drawCreative();
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      uploadedImage = image;
      drawCreative();
    };
    image.src = reader.result;
  };
  reader.readAsDataURL(file);
});

[formatSelect, themeSelect, headlineInput, offerInput, ctaInput].forEach((element) => {
  element?.addEventListener("change", drawCreative);
});

headlineInput?.addEventListener("input", drawCreative);
offerInput?.addEventListener("input", drawCreative);
ctaInput?.addEventListener("input", drawCreative);

document.getElementById("renderCreativeBtn")?.addEventListener("click", drawCreative);

document.getElementById("saveCreativeBtn")?.addEventListener("click", async () => {
  drawCreative();
  const blob = await canvasBlob();
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${getBusinessName().replace(/\s+/g, "-")}-ad.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  statusBox.innerText = "تم تجهيز الصورة وحفظها ✅";
});

document.getElementById("shareCreativeBtn")?.addEventListener("click", async () => {
  drawCreative();
  const blob = await canvasBlob();
  if (!blob) return;

  const file = new File([blob], "family-business-ad.png", { type: "image/png" });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        title: getBusinessName(),
        text: document.getElementById("marketingMessage")?.value || "احجز خدمتك الآن",
        files: [file]
      });
      statusBox.innerText = "تم فتح المشاركة ✅";
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${getBusinessName().replace(/\s+/g, "-")}-ad.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  statusBox.innerText = "جهازك لا يدعم مشاركة الصور مباشرة؛ تم حفظ الصورة بدلًا من ذلك";
});

setTimeout(drawCreative, 1100);
