import { qrcode } from "./vendor/qrcode.mjs";

let stylesInjected = false;

function ensureStyles() {
  if (stylesInjected || document.getElementById("customerQrStyles")) return;
  stylesInjected = true;

  const style = document.createElement("style");
  style.id = "customerQrStyles";
  style.textContent = `
    .customerQrPanel{
      margin-top:16px;
      padding:18px;
      border:1px solid rgba(148,163,184,.35);
      border-radius:18px;
      background:linear-gradient(180deg,#fff,#f8fafc);
      display:grid;
      grid-template-columns:auto minmax(0,1fr);
      gap:18px;
      align-items:center;
    }
    .customerQrPreview{
      width:190px;
      min-height:190px;
      display:grid;
      place-items:center;
      padding:10px;
      border-radius:16px;
      background:#fff;
      border:1px solid #e2e8f0;
      box-shadow:0 8px 24px rgba(15,23,42,.08);
    }
    .customerQrCanvas{
      display:block;
      width:170px;
      height:170px;
      max-width:100%;
      image-rendering:pixelated;
    }
    .customerQrPlaceholder{
      max-width:160px;
      text-align:center;
      line-height:1.7;
      color:#64748b;
      font-size:.88rem;
    }
    .customerQrCopy strong{
      display:block;
      margin-bottom:6px;
      font-size:1.05rem;
    }
    .customerQrCopy p{
      margin:0 0 12px;
      color:#64748b;
      line-height:1.8;
    }
    .customerQrActions{
      display:flex;
      flex-wrap:wrap;
      gap:8px;
      align-items:center;
    }
    .customerQrActions button:disabled{
      opacity:.5;
      cursor:not-allowed;
    }
    .customerQrStatus{
      display:block;
      min-height:1.4em;
      margin-top:10px;
      color:#475569;
      font-size:.86rem;
    }
    @media (max-width:640px){
      .customerQrPanel{grid-template-columns:1fr;text-align:center}
      .customerQrPreview{margin-inline:auto}
      .customerQrActions{justify-content:center}
    }
    @media print{
      .customerQrPanel{break-inside:avoid}
    }
  `;
  document.head.appendChild(style);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeFileName(value) {
  const cleaned = String(value || "project")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return cleaned || "project";
}

function buildQr(link) {
  const qr = qrcode(0, "M");
  qr.addData(link, "Byte");
  qr.make();
  return qr;
}

function drawQr(canvas, link, targetSize = 720) {
  const qr = buildQr(link);
  const moduleCount = qr.getModuleCount();
  const quietModules = 4;
  const totalModules = moduleCount + quietModules * 2;
  const cellSize = Math.max(1, Math.floor(targetSize / totalModules));
  const actualSize = totalModules * cellSize;

  canvas.width = actualSize;
  canvas.height = actualSize;

  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, actualSize, actualSize);
  ctx.fillStyle = "#000000";

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.isDark(row, col)) continue;
      ctx.fillRect(
        (col + quietModules) * cellSize,
        (row + quietModules) * cellSize,
        cellSize,
        cellSize
      );
    }
  }

  return canvas;
}

function canvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error("QR_EXPORT_FAILED"));
    }, "image/png");
  });
}

function createPanel(input) {
  ensureStyles();

  const panel = document.createElement("section");
  panel.className = "customerQrPanel";
  panel.setAttribute("aria-label", "QR رابط العملاء");
  panel.innerHTML = `
    <div class="customerQrPreview">
      <canvas class="customerQrCanvas" aria-label="QR Code لرابط العملاء"></canvas>
      <div class="customerQrPlaceholder hidden">سيظهر QR Code هنا بمجرد تفعيل رابط العملاء.</div>
    </div>
    <div class="customerQrCopy">
      <strong>QR رابط العملاء</strong>
      <p>حمّله واطبعه داخل النشاط، أو ابعته للعملاء. أي عميل يعمل Scan يفتح واجهة الطلب الخاصة بهذا المشروع مباشرة.</p>
      <div class="customerQrActions">
        <button type="button" class="primaryBtn customerQrDownload">تحميل QR</button>
        <button type="button" class="copyBtn customerQrShare">مشاركة</button>
        <button type="button" class="copyBtn customerQrPrint">طباعة</button>
      </div>
      <small class="customerQrStatus" aria-live="polite"></small>
    </div>
  `;

  const host = input.closest(".linkBox") || input.parentElement;
  host.insertAdjacentElement("afterend", panel);

  const canvas = panel.querySelector(".customerQrCanvas");
  const status = panel.querySelector(".customerQrStatus");

  panel.querySelector(".customerQrDownload").onclick = async () => {
    const link = panel.dataset.qrLink || "";
    if (!link) return;
    try {
      const blob = await canvasBlob(canvas);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = `QR-${safeFileName(panel.dataset.projectName)}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      status.textContent = "تم تحميل صورة الـQR ✅";
    } catch {
      status.textContent = "تعذر تحميل صورة الـQR. حاول مرة أخرى.";
    }
  };

  panel.querySelector(".customerQrShare").onclick = async () => {
    const link = panel.dataset.qrLink || "";
    if (!link) return;

    const projectName = panel.dataset.projectName || "المشروع";
    const shareText = `افتح ${projectName} واطلب مباشرة من هنا:`;

    try {
      const blob = await canvasBlob(canvas);
      const file = new File([blob], `QR-${safeFileName(projectName)}.png`, { type: "image/png" });

      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: projectName,
          text: shareText + "\n" + link,
          files: [file]
        });
        status.textContent = "تم فتح خيارات المشاركة ✅";
        return;
      }

      if (navigator.share) {
        await navigator.share({
          title: projectName,
          text: shareText,
          url: link
        });
        status.textContent = "تم فتح خيارات المشاركة ✅";
        return;
      }

      await navigator.clipboard.writeText(link);
      status.textContent = "المشاركة غير متاحة هنا؛ تم نسخ رابط العملاء بدلًا منها ✅";
    } catch (error) {
      if (error?.name === "AbortError") return;

      try {
        await navigator.clipboard.writeText(link);
        status.textContent = "تم نسخ رابط العملاء ✅";
      } catch {
        status.textContent = "تعذرت المشاركة. استخدم زر نسخ الرابط الموجود بالأعلى.";
      }
    }
  };

  panel.querySelector(".customerQrPrint").onclick = () => {
    const link = panel.dataset.qrLink || "";
    if (!link) return;

    const projectName = panel.dataset.projectName || "المشروع";
    const dataUrl = canvas.toDataURL("image/png");
    const popup = window.open("", "_blank", "noopener,noreferrer");

    if (!popup) {
      status.textContent = "المتصفح منع نافذة الطباعة. اسمح بالنوافذ المنبثقة وحاول مرة أخرى.";
      return;
    }

    popup.document.open();
    popup.document.write(`<!doctype html>
      <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8">
          <title>QR - ${escapeHtml(projectName)}</title>
          <style>
            body{font-family:Arial,sans-serif;text-align:center;padding:40px;color:#0f172a}
            h1{margin:0 0 8px;font-size:28px}
            p{margin:0 auto 22px;max-width:700px;line-height:1.7}
            img{width:420px;max-width:90vw;height:auto}
            .url{font-size:12px;direction:ltr;word-break:break-all;margin-top:20px;color:#475569}
            @page{margin:16mm}
          </style>
        </head>
        <body>
          <h1>${escapeHtml(projectName)}</h1>
          <p>امسح الـQR بالموبايل لفتح صفحة الطلب مباشرة.</p>
          <img id="qrPrintImage" src="${dataUrl}" alt="QR Code">
          <div class="url">${escapeHtml(link)}</div>
          <script>
            const image=document.getElementById("qrPrintImage");
            image.onload=()=>setTimeout(()=>window.print(),100);
          <\/script>
        </body>
      </html>`);
    popup.document.close();
  };

  return panel;
}

export function renderCustomerQr({
  inputId = "customerLink",
  projectName = "المشروع"
} = {}) {
  const input = document.getElementById(inputId);
  if (!input) return null;

  let panel = input.closest(".card")?.querySelector(".customerQrPanel");
  if (!panel) panel = createPanel(input);

  const link = String(input.value || "").trim();
  panel.dataset.qrLink = link;
  panel.dataset.projectName = String(projectName || "المشروع").trim() || "المشروع";

  const canvas = panel.querySelector(".customerQrCanvas");
  const placeholder = panel.querySelector(".customerQrPlaceholder");
  const buttons = panel.querySelectorAll(".customerQrActions button");
  const status = panel.querySelector(".customerQrStatus");

  if (!link) {
    canvas.classList.add("hidden");
    placeholder.classList.remove("hidden");
    buttons.forEach(button => { button.disabled = true; });
    status.textContent = "الـQR سيتفعل تلقائيًا بعد تفعيل رابط العملاء.";
    return panel;
  }

  drawQr(canvas, link);
  canvas.classList.remove("hidden");
  placeholder.classList.add("hidden");
  buttons.forEach(button => { button.disabled = false; });
  status.textContent = "جاهز للمشاركة والطباعة.";
  return panel;
}
