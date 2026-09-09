function isCarWash() {
  return document.getElementById("projectLink")?.value?.includes("/templates/carwash/");
}

function roundRect(ctx, x, y, w, h, r, fill) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function cover(ctx, img, x, y, w, h) {
  const ir = img.width / img.height, br = w / h;
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (ir > br) { sw = img.height * br; sx = (img.width - sw) / 2; }
  else { sh = img.width / br; sy = (img.height - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

const palettes = {
  clean: { start: "#f0fdfa", end: "#ccfbf1", card: "#ffffff", text: "#134e4a", muted: "#0f766e", accent: "#0f766e", imageBg: "#f8fafc" },
  bold: { start: "#0f172a", end: "#115e59", card: "rgba(255,255,255,.12)", text: "#ffffff", muted: "#ccfbf1", accent: "#14b8a6", imageBg: "#1e293b" },
  soft: { start: "#ecfdf5", end: "#dbeafe", card: "rgba(255,255,255,.9)", text: "#164e63", muted: "#0f766e", accent: "#14b8a6", imageBg: "#ffffff" }
};

function activateCarWashVisual() {
  if (!isCarWash()) return false;
  const oldCanvas = document.getElementById("marketingCanvas");
  if (!oldCanvas) return false;
  const canvas = oldCanvas.cloneNode(true);
  oldCanvas.replaceWith(canvas);
  const ctx = canvas.getContext("2d");
  const format = document.getElementById("creativeFormat");
  const theme = document.getElementById("creativeTheme");
  const headline = document.getElementById("creativeHeadline");
  const offer = document.getElementById("creativeOffer");
  const cta = document.getElementById("creativeCta");
  const imageInput = document.getElementById("creativeImage");
  const status = document.getElementById("creativeStatus");
  let image = null;
  const business = () => document.getElementById("businessName")?.value?.trim() || document.getElementById("userName")?.innerText?.trim() || "مزود الخدمة";
  headline.value = "خلي سيارتك نظيفة طول الشهر";

  function draw() {
    const story = format.value === "story", w = 1080, h = story ? 1920 : 1080;
    const p = palettes[theme?.value] || palettes.clean;
    canvas.width = w;
    canvas.height = h;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, p.start);
    g.addColorStop(1, p.end);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const pad = story ? 82 : 68;
    ctx.direction = "rtl";
    ctx.textAlign = "right";

    roundRect(ctx, pad, story ? 90 : 55, w - pad * 2, story ? 130 : 105, 30, p.card);
    ctx.fillStyle = p.text;
    ctx.font = `900 ${story ? 47 : 38}px Tahoma,Arial`;
    ctx.fillText(business(), w - pad - 34, story ? 168 : 120);
    ctx.fillStyle = p.muted;
    ctx.font = `600 ${story ? 25 : 20}px Tahoma,Arial`;
    ctx.fillText("اشتراك غسيل سيارات خارجي", w - pad - 34, story ? 202 : 148);

    ctx.fillStyle = p.text;
    ctx.font = `900 ${story ? 70 : 56}px Tahoma,Arial`;
    ctx.textAlign = "center";
    ctx.fillText(headline.value.trim() || "خلي سيارتك نظيفة طول الشهر", w / 2, story ? 360 : 255);

    if (offer.value.trim()) {
      roundRect(ctx, w * .18, story ? 410 : 300, w * .64, story ? 72 : 58, 22, p.accent);
      ctx.fillStyle = "#fff";
      ctx.font = `800 ${story ? 36 : 29}px Tahoma,Arial`;
      ctx.fillText(offer.value.trim(), w / 2, story ? 460 : 340);
    }

    const x = story ? 140 : 230, y = story ? 610 : 410, iw = story ? 800 : 620, ih = story ? 650 : 390;
    if (image) {
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, iw, ih, 34);
      ctx.clip();
      cover(ctx, image, x, y, iw, ih);
      ctx.restore();
    } else {
      roundRect(ctx, x, y, iw, ih, 34, p.imageBg);
      ctx.fillStyle = p.muted;
      ctx.font = `700 ${story ? 30 : 24}px Tahoma,Arial`;
      ctx.fillText("ارفع صورة السيارة أو الخدمة", w / 2, y + ih / 2);
    }

    const by = y + ih + (story ? 70 : 45);
    ["اشتراك شهري", "غسيل خارجي", "في مكان سيارتك"].forEach((t, i) => {
      const cw = story ? 260 : 245, gap = 18, total = cw * 3 + gap * 2, sx = (w - total) / 2, cx = sx + i * (cw + gap);
      roundRect(ctx, cx, by, cw, story ? 90 : 76, 24, p.card);
      ctx.fillStyle = p.text;
      ctx.font = `700 ${story ? 25 : 21}px Tahoma,Arial`;
      ctx.fillText(t, cx + cw / 2, by + (story ? 56 : 48));
    });

    const cy = h - (story ? 270 : 135), cw = story ? 700 : 620, ch = story ? 118 : 86;
    roundRect(ctx, (w - cw) / 2, cy, cw, ch, 999, p.accent);
    ctx.fillStyle = "#fff";
    ctx.font = `900 ${story ? 44 : 35}px Tahoma,Arial`;
    ctx.fillText(cta.value.trim() || "اشترك الآن", w / 2, cy + (story ? 75 : 56));
    ctx.fillStyle = p.muted;
    ctx.font = `700 ${story ? 23 : 18}px Tahoma,Arial`;
    ctx.fillText("اضغط على رابط الاشتراك المرفق مع الإعلان", w / 2, cy + ch + (story ? 46 : 34));
    status.innerText = "تم تحديث تصميم غسيل السيارات ✅";
  }

  imageInput.addEventListener("change", () => {
    const f = imageInput.files?.[0];
    if (!f) { image = null; draw(); return; }
    const r = new FileReader();
    r.onload = () => {
      const im = new Image();
      im.onload = () => { image = im; draw(); };
      im.src = r.result;
    };
    r.readAsDataURL(f);
  });

  [format, theme, headline, offer, cta].forEach(el => {
    el?.addEventListener("change", draw);
    el?.addEventListener("input", draw);
  });
  document.getElementById("renderCreativeBtn")?.addEventListener("click", draw);
  draw();
  return true;
}

let attempts = 0;
const timer = setInterval(() => {
  attempts += 1;
  if (activateCarWashVisual() || attempts >= 12) clearInterval(timer);
}, 150);
