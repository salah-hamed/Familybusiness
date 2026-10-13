import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveMerchantFinancePeriod } from "../core/commissions/merchant-finance-period.js";
import { PLATFORM_COMMISSION_BENEFICIARY } from "../core/merchants/merchant-commission-beneficiary.js";

const shop={
  ownerId:"original_subscriber",
  merchantId:"m_"+"a".repeat(32),
  originalSubscriberId:"original_subscriber",
  assignedSubscriberId:"",
  assignmentStatus:"platform_managed",
  platformManaged:true,
  recoveryAuditId:"original_subscriber_supermarket",
  recoveryAt:new Date("2026-10-13T10:00:00Z"),
  recoveryAdminUid:"admin_account"
};

test("platform period uses a distinct beneficiary, and cannot declare payment as verified",()=>{
  const result=resolveMerchantFinancePeriod(shop);
  assert.equal(result.beneficiaryId,PLATFORM_COMMISSION_BENEFICIARY);
  assert.equal(result.platformPeriod,true);
  assert.equal(result.canDeclarePayment,false);
  assert.equal(result.requiresExternalVerification,true);
});

test("standard original subscriber settlement remains unchanged",()=>{
  const period=resolveMerchantFinancePeriod({ownerId:"uid",assignedSubscriberId:"uid",platformManaged:false});
  assert.equal(period.beneficiaryId,"uid");
  assert.equal(period.canDeclarePayment,true);
  assert.equal(period.platformPeriod,false);
});

test("partial forged recovery and unsupported incoming assignment fail closed",()=>{
  for(const p of [
    {...shop,recoveryAuditId:""},
    {...shop,recoveryAt:null},
    {...shop,assignedSubscriberId:"uid"},
    {...shop,platformManaged:false},
    {ownerId:"original",assignedSubscriberId:"new",assignmentStatus:"assigned_to_new_subscriber"},
  ]) assert.throws(()=>resolveMerchantFinancePeriod(p));
});

test("operator only sees settlement records for current beneficiary, not mixed historical ones",()=>{
  const src=readFileSync("core/commissions/finance-panel.js","utf8");
  const i=src.indexOf("export async function renderOperatorFinancePanel");
  const body=src.slice(i);
  assert.match(body,/getMerchantFinancePeriod\(projectId\)/);
  assert.match(body,/ownerId: period\.beneficiaryId/);
  assert.match(body,/period\.platformPeriod\s*\?/);
  assert.match(body,/مستحقات المنصة بعد الاسترداد منفصلة/);
  assert.match(body,/لا تحول عمولات الفترة الجديدة للمشترك السابق/);
  assert.equal(body.includes('period.platformPeriod ? `'),true);
});

test("operator cannot declare recovered platform payment or offset the prior subscriber",()=>{
  const src=readFileSync("core/commissions/settlement-service.js","utf8");
  assert.match(src,/const period = resolveMerchantFinancePeriod\(project\)/);
  assert.ok(src.includes("if (!period.canDeclarePayment)"));
  assert.match(src,/PLATFORM_SETTLEMENT_FLOW_NOT_CONFIGURED/);
  assert.match(src,/beneficiaryId = oid \|\|/);
  assert.match(src,/paymentScope\.push\(where\("ownerId", "==", beneficiaryId\)\)/);
});

test("admin observes both separated balances without modifying ledgers",()=>{
  const src=readFileSync("admin/admin.js","utf8");
  const i=src.indexOf('if (button.dataset.action === "show-platform-recovery-dues")');
  const j=src.indexOf('if (button.dataset.action === "view-project-payments")',i);
  const body=src.slice(i,j);
  assert.ok(body.length>400);
  assert.match(body,/getProjectPaymentSummary\(projectId, \{ ownerId: PLATFORM_COMMISSION_BENEFICIARY \}\)/);
  assert.match(body,/getProjectPaymentSummary\(projectId, \{ ownerId: oldUid \}\)/);
  for(const v of ["updateDoc(", "runTransaction(", "setDoc(", "deleteDoc("]) {
    assert.equal(body.includes(v),false,v);
  }
});
