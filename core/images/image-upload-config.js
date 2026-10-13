// Image uploads are OFF until the platform administrator configures
// a dedicated, restricted Cloudinary unsigned upload preset.
// No Firebase Storage billing or credential is required by this adapter.
// Never place Cloudinary API secrets or Firebase service accounts here.
export const IMAGE_UPLOAD_CONFIG = Object.freeze({
  provider: "disabled",
  cloudName: "",
  unsignedUploadPreset: ""
});
