import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const operatorHtml=[
  "supermarket-operator/index.html",
  "restaurant-operator/index.html",
  "bakery-operator/index.html",
  "laundry-operator/index.html"
];

test("all operator login screens explain the correct invite-based recovery path",()=>{
  for(const path of operatorHtml){
    const html=readFileSync(path,"utf8");
    assert.match(html,/operatorRecoveryHelp/);
    assert.match(html,/إصدار رابط دخول جديد/);
    assert.match(html,/الطلبات والعمولة وبيانات المشروع لن تتغير/);
    assert.match(html,/autocomplete="current-password"/);
  }
});

test("operator login screens do not advertise email password reset",()=>{
  for(const path of operatorHtml){
    const html=readFileSync(path,"utf8");
    assert.doesNotMatch(html,/sendPasswordResetEmail|إرسال رابط.*البريد|استعادة.*البريد/);
  }
});

test("all owner project dashboards keep the controlled rotate-access recovery action",()=>{
  for(const path of [
    "supermarket/index.html",
    "restaurant/index.html",
    "bakery/index.html",
    "laundry/index.html"
  ]){
    const html=readFileSync(path,"utf8");
    assert.match(html,/id="resetOperatorAccessBtn"/);
    assert.match(html,/إصدار رابط دخول جديد/);
  }
});

test("owner recovery actions do not expose raw rotate-access exceptions",()=>{
  for(const path of [
    "supermarket/app.js",
    "restaurant/app.js",
    "bakery/app.js",
    "laundry/app.js"
  ]){
    const source=readFileSync(path,"utf8");
    const start=source.indexOf('$("resetOperatorAccessBtn").onclick');
    assert.ok(start>=0,path);
    const end=source.indexOf('$("sendOperatorWhatsappBtn")',start);
    const block=source.slice(start,end);
    assert.match(block,/rotateOperatorInviteAccess/);
    assert.match(block,/الرابط القديم لم يعد صالحًا/);
    assert.doesNotMatch(block,/e\.message|error\.message/);
  }
});
