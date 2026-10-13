import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IMAGE_UPLOAD_CONFIG } from "../core/images/image-upload-config.js";
import {
  validateProductImageFile,
  isImageUploadConfigured,
  compressProductImage,
  uploadProductImageFile,
  IMAGE_UPLOAD_MAX_INPUT_BYTES,
  productImageErrorMessage
} from "../core/images/image-upload.js";

const file={size:1234,type:"image/jpeg"};
const config={provider:"cloudinary_unsigned",cloudName:"familybusiness",unsignedUploadPreset:"products_unsigned"};

test("Phase F file picker stays safely disabled with no external uploader configured", async () => {
  assert.equal(IMAGE_UPLOAD_CONFIG.provider,"disabled");
  assert.equal(isImageUploadConfigured(),false);
  assert.equal(isImageUploadConfigured(config),true);
  assert.equal(isImageUploadConfigured({...config,cloudName:"../unsafe"}),false);
  let sent=false;
  await assert.rejects(uploadProductImageFile(file,{
    fetchRequest:async()=>{sent=true;throw new Error("UNEXPECTED_UPLOAD");}
  }),/IMAGE_UPLOAD_NOT_CONFIGURED/);
  assert.equal(sent,false);
});

test("only supported formats and safe input file sizes can be selected", () => {
  assert.equal(validateProductImageFile(file),true);
  assert.throws(()=>validateProductImageFile({size:2,type:"image/svg+xml"}),/IMAGE_FORMAT_NOT_SUPPORTED/);
  assert.throws(()=>validateProductImageFile({size:4,type:"text/html"}),/IMAGE_FORMAT_NOT_SUPPORTED/);
  assert.throws(()=>validateProductImageFile({size:IMAGE_UPLOAD_MAX_INPUT_BYTES+1,type:"image/png"}),/IMAGE_FILE_TOO_LARGE/);
  assert.throws(()=>validateProductImageFile(null),/IMAGE_FILE_REQUIRED/);
});

test("browser compressor caps dimensions, closes decoded bitmap and emits WebP", async () => {
  let output = null;
  let closed = false;
  const image = {width:2048,height:1024,close:()=>{closed=true;}};
  const canvas = {
    width:0,height:0,
    getContext:()=>({drawImage:(bitmap,x,y,w,h)=>{output={bitmap,x,y,w,h};}}),
    toBlob:cb=>cb(new Blob(["ok"],{type:"image/webp"}))
  };
  const blob=await compressProductImage(file,{
    createBitmap:async()=>image,createCanvas:()=>canvas
  });
  assert.equal(blob.type,"image/webp");
  assert.equal(canvas.width,1024);
  assert.equal(canvas.height,512);
  assert.equal(output.bitmap,image);
  assert.equal(closed,true);
});

test("uploader only accepts HTTPS asset URL for the configured provider", async () => {
  let called=false;
  const uri="https://res.cloudinary.com/familybusiness/image/upload/v2/image.webp";
  const result=await uploadProductImageFile(file,{
    config,
    compress:async()=>new Blob(["compressed"],{type:"image/webp"}),
    fetchRequest:async(url,options)=>{
      called=true;
      assert.equal(url,"https://api.cloudinary.com/v1_1/familybusiness/image/upload");
      assert.equal(options.method,"POST");
      assert.equal(options.body.get("upload_preset"),"products_unsigned");
      assert.ok(options.body.get("file") instanceof Blob);
      return {ok:true,json:async()=>({secure_url:uri})};
    }
  });
  assert.equal(called,true);
  assert.equal(result,uri);
});

test("never persist injected image CDN URLs even if upload API reports success", async () => {
  for (const url of [
    "http://res.cloudinary.com/familybusiness/image/upload/bad",
    "https://example.com/fake.png",
    "https://res.cloudinary.com/other/image/upload/fake.jpg",
    "https://res.cloudinary.com/familybusiness/raw/upload/fake.svg"
  ]) {
    await assert.rejects(uploadProductImageFile(file,{
      config,
      compress:async()=>new Blob(["compressed"],{type:"image/webp"}),
      fetchRequest:async()=>({ok:true,json:async()=>({secure_url:url})})
    }),/IMAGE_UPLOAD_UNTRUSTED_RESPONSE/);
  }
});

test("new file selectors do not touch existing imported image links", () => {
  const raw=readFileSync("core/supermarket/master-catalog-data.js","utf8");
  assert.equal((raw.match(/"image":"https:\/\//g)||[]).length,2000);
  for(const path of ["supermarket-operator/products.js","restaurant-operator/menu.js","bakery-operator/menu.js"]) {
    const source=readFileSync(path,"utf8");
    assert.equal(source.includes("isImageUploadConfigured()"),true,path);
    assert.equal(source.includes("uploadProductImageFile("),true,path);
  }
  assert.match(productImageErrorMessage(new Error("IMAGE_UPLOAD_NOT_CONFIGURED")),/غير مفعّل/);
});
