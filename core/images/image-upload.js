import { IMAGE_UPLOAD_CONFIG } from "./image-upload-config.js";

export const IMAGE_UPLOAD_MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const IMAGE_UPLOAD_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
export const IMAGE_UPLOAD_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

export function validateProductImageFile(file) {
  if (!file || typeof file.size !== "number" || typeof file.type !== "string") {
    throw new Error("IMAGE_FILE_REQUIRED");
  }
  if (!IMAGE_UPLOAD_TYPES.includes(file.type)) throw new Error("IMAGE_FORMAT_NOT_SUPPORTED");
  if (file.size <= 0 || file.size > IMAGE_UPLOAD_MAX_INPUT_BYTES) {
    throw new Error("IMAGE_FILE_TOO_LARGE");
  }
  return true;
}

export function isImageUploadConfigured(config = IMAGE_UPLOAD_CONFIG) {
  return config.provider === "cloudinary_unsigned"
    && /^[A-Za-z0-9_-]{2,100}$/.test(String(config.cloudName || ""))
    && /^[A-Za-z0-9_-]{2,100}$/.test(String(config.unsignedUploadPreset || ""));
}

export async function compressProductImage(file, {
  maxDimension = 1024,
  quality = 0.82,
  createBitmap = typeof createImageBitmap === "function" ? createImageBitmap : null,
  createCanvas = () => document.createElement("canvas")
} = {}) {
  validateProductImageFile(file);
  if (typeof createBitmap !== "function") throw new Error("IMAGE_BROWSER_NOT_SUPPORTED");

  const bitmap = await createBitmap(file);
  try {
    const width = Number(bitmap.width);
    const height = Number(bitmap.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      throw new Error("IMAGE_INVALID_DIMENSIONS");
    }
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    const canvas = createCanvas();
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext?.("2d");
    if (!ctx) throw new Error("IMAGE_BROWSER_NOT_SUPPORTED");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    if (typeof canvas.toBlob !== "function") throw new Error("IMAGE_BROWSER_NOT_SUPPORTED");
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error("IMAGE_COMPRESSION_FAILED")), "image/webp", quality);
    });
    if (blob.size > IMAGE_UPLOAD_MAX_OUTPUT_BYTES) throw new Error("IMAGE_COMPRESSED_TOO_LARGE");
    return blob;
  } finally {
    bitmap.close?.();
  }
}

export async function uploadProductImageFile(file, {
  config = IMAGE_UPLOAD_CONFIG,
  fetchRequest = (...args) => fetch(...args),
  compress = compressProductImage
} = {}) {
  // Never upload when no administrator-configured provider exists.
  if (!isImageUploadConfigured(config)) throw new Error("IMAGE_UPLOAD_NOT_CONFIGURED");
  const blob = await compress(file);

  const form = new FormData();
  form.append("file", blob, "familybusiness-product.webp");
  form.append("upload_preset", config.unsignedUploadPreset);

  const response = await fetchRequest(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/image/upload`,
    { method: "POST", body: form }
  );
  if (!response?.ok) throw new Error("IMAGE_UPLOAD_FAILED");
  const result = await response.json();
  const url = String(result?.secure_url || "");
  // Only accept the configured Cloudinary cloud, preserving old source URLs elsewhere.
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "res.cloudinary.com"
      || !parsed.pathname.startsWith(`/${config.cloudName}/image/upload/`)
      || url.length > 1000) {
    throw new Error("IMAGE_UPLOAD_UNTRUSTED_RESPONSE");
  }
  return url;
}

export function productImageErrorMessage(error) {
  const code=String(error?.message || "");
  return ({
    IMAGE_UPLOAD_NOT_CONFIGURED:"رفع الصور من الجهاز غير مفعّل بعد. استخدم رابط صورة أو تواصل مع إدارة المنصة.",
    IMAGE_FILE_REQUIRED:"اختار صورة أولًا.",
    IMAGE_FORMAT_NOT_SUPPORTED:"استخدم صورة JPG أو PNG أو WebP فقط.",
    IMAGE_FILE_TOO_LARGE:"اختار صورة أصغر من 8 ميجابايت.",
    IMAGE_COMPRESSED_TOO_LARGE:"الصورة ما زالت كبيرة جدًا بعد الضغط.",
    IMAGE_BROWSER_NOT_SUPPORTED:"متصفحك لا يدعم معالجة الصورة. جرب تحديث المتصفح.",
    IMAGE_COMPRESSION_FAILED:"تعذر ضغط الصورة.",
    IMAGE_INVALID_DIMENSIONS:"ملف الصورة غير صالح.",
    IMAGE_UPLOAD_FAILED:"تعذر رفع الصورة إلى خدمة الصور. حاول مرة أخرى.",
    IMAGE_UPLOAD_UNTRUSTED_RESPONSE:"رابط الصورة الناتج غير موثوق."
  })[code] || "تعذر تجهيز أو رفع الصورة. جرّب صورة أخرى.";
}
