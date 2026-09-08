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
  cleanPro: {
    start: "#f7fbf8",
    end: "#e8f5ee",
    accent: "#1f9d55",
    accent2: "#0f766e",
    text: "#0f2942",
    soft: "#ffffff",
    muted: "#526575",
    frame: "#ffffff",
    border: "#dcebe2"
  },
  clean: {
    start: "#4f46e5",
    end: "#7c3aed",
    accent: "#fbbf24",
    accent2: "#ffffff",
    text: "#ffffff",
    soft: "rgba(255,255,255,.16)",
    muted: "rgba(255,255,255,.82)",
    frame: "#ffffff",
    border: "rgba(255,255,255,.35)"
  },
  bold: {
    start: "#111827",
    end: "#4338ca",
    accent: "#22c55e",
    accent2: "#a7f3d0",
    text: "#ffffff",
    soft: "rgba(255,255,255,.13)",
    muted: "rgba(255,255,255,.8)",
    frame: "#ffffff",
    border: "rgba(255,255,255,.28)"
  },
  soft: {
    start: "#eef2ff",
    end: "#ddd6fe",
    accent: "#4f46e5",
    accent2: "#7c3aed",
    text: "#111827",
    soft: "rgba(255,255,255,.72)",
    muted: "#5b6474",
    frame: "#ffffff",
    border: "#d9d6f5"
  }
};

function getBusinessName() {
  return businessNameInput?.value?.trim() ||
    document.getElementById("userName")?.innerText?.trim() ||
    "مزود الخدمة";
}

function getProjectLink() {
  return projectLinkInput?.value?.trim() || "";
}

function roundRect(x, y, width, height, radius, fillStyle, strokeStyle = null, lineWidth = 0) {
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
  if (strokeStyle && lineWidth) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
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

function drawImageCoverInRect(image, x, y, width, height, radius) {
  const imageRatio = image.width / image.height;
  const boxRatio = width / height;
  let sx = 0;
  let sy = 0;
  let sw = image.width;
  let sh = image.height;

  if (imageRatio > boxRatio) {
    sw = image.height * boxRatio;
    sx = (image.width - sw) / 2;
  } else {
    sh = image.width / boxRatio;
    sy = (image.height - sh) / 2;
  }

  ctx.save();
  ctx.beginPath();
  const r = Math.min(radius, width / 2, height / 2);
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
  ctx.restore();
}

function drawFramedImage(image, x, y, width, height, theme, story) {
  const framePad = story ? 20 : 16;
  const radius = story ? 52 : 42;

  ctx.save();
  ctx.shadowColor = "rgba(15,23,42,.20)";
  ctx.shadowBlur = story ? 36 : 28;
  ctx.shadowOffsetY = story ? 18 : 12;
  roundRect(x - framePad, y - framePad, width + framePad * 2, height + framePad * 2, radius, theme.frame, theme.border, 3);
  ctx.restore();

  drawImageCoverInRect(image, x, y, width, height, radius - framePad);
}

function drawDecor(theme, width, height, story) {
  ctx.save();
  ctx.globalAlpha = themeSelect.value === "cleanPro" ? .85 : .16;
  ctx.fillStyle = themeSelect.value === "cleanPro" ? "#d7efdf" : theme.soft;
  ctx.beginPath();
  ctx.arc(width * .08, height * .14, story ? 220 : 150, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width * .94, height * .76, story ? 330 : 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCleanProBenefits(width, y, story, theme) {
  const items = ["تنظيف شامل", "مواعيد مرنة", "جودة موثوقة"];
  const cardWidth = story ? 260 : 250;
  const gap = story ? 22 : 18;
  const total = items.length * cardWidth + (items.length - 1) * gap;
  let startX = (width - total) / 2;

  ctx.textAlign = "center";
  items.forEach((item, index) => {
    const x = startX + index * (cardWidth + gap);
    roundRect(x, y, cardWidth, story ? 94 : 82, 28, "rgba(255,255,255,.9)", theme.border, 2);
    ctx.fillStyle = theme.text;
    ctx.font = `700 ${story ? 26 : 23}px Tahoma, Arial, sans-serif`;
    ctx.fillText(item, x + cardWidth / 2, y + (story ? 58 : 51));
  });
});
}

function drawCreative() {
  if (!canvas || !ctx) return;

  const story = formatSelect.value === "story";
  const width = 1080;
  const height = story ? 1920 : 1080;
  canvas.width = width;
  canvas.height = height;

  const theme = themes[themeSelect.value] || themes.cleanPro;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, theme.start);
  gradient.addColorStop(1, theme.end);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  drawDecor(theme, width, height, story);

  const pad = story ? 82 : 68;
  ctx.direction = "rtl";
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";

  const providerY = story ? 94 : 58;
  roundRect(pad, providerY, width - pad * 2, story ? 128 : 104, 30, theme.soft, theme.border, 2);
  ctx.fillStyle = theme.text;
  ctx.font = `900 ${story ? 47 : 38}px Tahoma, Arial, sans-serif`;
  ctx.fillText(getBusinessName(), width - pad - 34, providerY + (story ? 77 : 64));
  ctx.fillStyle = theme.muted;
  ctx.font = `600 ${story ? 25 : 20}px Tahoma, Arial, sans-serif`;
  ctx.fillText("خدمات تنظيف منزلي", width - pad - 34, providerY + (story ? 109 : 90));

  let headlineY = story ? 330 : 235;
  ctx.fillStyle = theme.text;
  ctx.font = `900 ${story ? 75 : 61}px Tahoma, Arial, sans-serif`;
  const headlineBottom = wrapRTLText(
    headlineInput.value.trim() || "تنظيف بيتك أسهل من أي وقت",
    width - pad,
    headlineY,
    width - pad * 2,
    story ? 96 : 76,
    story ? 3 : 2
  );

  const offer = offerInput.value.trim();
  let nextY = headlineBottom + (story ? 26 : 18);
  if (offer) {
    ctx.font = `800 ${story ? 38 : 30}px Tahoma, Arial, sans-serif`;
    const offerWidth = Math.min(ctx.measureText(offer).width + 70, width - pad * 2);
    const offerX = width - pad - offerWidth;
    roundRect(offerX, nextY - (story ? 45 : 37), offerWidth, story ? 68 : 56, 20, theme.accent);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(offer, width - pad - 28, nextY);
    nextY += story ? 88 : 70;
  }

  ctx.fillStyle = theme.muted;
  ctx.font = `600 ${story ? 31 : 25}px Tahoma, Arial, sans-serif`;
  wrapRTLText("راحة أكبر، وقت أكثر لك ولعائلتك، وحجز سهل في أقل من دقيقة.", width - pad, nextY, width - pad * 2, story ? 48 : 39, 2);

  const imageX = story ? 150 : 250;
  const imageW = story ? 780 : 580;
  const imageH = story ? 610 : 390;
  const imageY = story ? 680 : 470;

  if (uploadedImage) {
    drawFramedImage(uploadedImage, imageX, imageY, imageW, imageH, theme, story);
  } else {
    ctx.save();
    ctx.shadowColor = "rgba(15,23,42,.12)";
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 12;
    roundRect(imageX, imageY, imageW, imageH, story ? 48 : 38, "rgba(255,255,255,.9)", theme.border, 3);
    ctx.restore();
    ctx.textAlign = "center";
    ctx.fillStyle = theme.muted;
    ctx.font = `700 ${story ? 31 : 25}px Tahoma, Arial, sans-serif`;
    ctx.fillText("ارفع صورة لتظهر هنا داخل إطار احترافي", width / 2, imageY + imageH / 2);
  }

  if (themeSelect.value === "cleanPro") {
    drawCleanProBenefits(width, imageY + imageH + (story ? 62 : 36), story, theme);
  }

  const ctaText = ctaInput.value.trim() || "احجز الآن";
  const ctaY = height - (story ? 285 : 145);
  const ctaW = story ? 700 : 620;
  const ctaH = story ? 120 : 88;
  const ctaX = (width - ctaW) / 2;
  roundRect(ctaX, ctaY, ctaW, ctaH, 999, theme.accent);
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.font = `900 ${story ? 45 : 36}px Tahoma, Arial, sans-serif`;
  ctx.fillText(ctaText, width / 2, ctaY + (story ? 76 : 57));

  ctx.fillStyle = theme.muted;
  ctx.font = `700 ${story ? 23 : 18}px Tahoma, Arial, sans-serif`;
  ctx.fillText("اضغط على رابط الحجز المرفق مع الإعلان", width / 2, ctaY + ctaH + (story ? 48 : 35));

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
  const projectLink = getProjectLink();
  const baseText = document.getElementById("marketingMessage")?.value || "احجز خدمتك الآن";
  const shareText = projectLink && !baseText.includes(projectLink)
    ? `${baseText}\n${projectLink}`
    : baseText;

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        title: getBusinessName(),
        text: shareText,
        files: [file]
      });
      statusBox.innerText = "تم فتح المشاركة مع رابط الحجز ✅";
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
  statusBox.innerText = "تم حفظ الصورة. شاركها مع رسالة التسويق التي تحتوي على رابط الحجز.";
});

setTimeout(drawCreative, 1100);
