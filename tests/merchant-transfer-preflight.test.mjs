import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assessMerchantTransfer,
  formatMerchantTransferPreflight
} from "../core/merchants/merchant-transfer-preflight.js";

function linkedMerchant() {
  return {
    projectDocId:"owner_supermarket",
    project:{
      ownerId:"owner", projectId:"supermarket", template:"supermarket",
      operatingModel:"partner_operated",
      merchantId:"m_"+"a".repeat(32),
      originalSubscriberId:"owner", assignedSubscriberId:"owner",
      assignmentStatus:"assigned_to_subscriber"
    },
    operator:{
      authUid:"operator_auth",isActive:true,status:"active",
      agreementStatus:"accepted"
    },
    agreement:{status:"accepted",acceptedVersion:1},
    candidate:{uid:"target",isActive:true,subscriptionStatus:"active"},
    candidateUid:"target"
  };
}

test("eligible merchant produces a preflight, never an automatic transfer approval", () => {
  const data=linkedMerchant();
  const before=JSON.stringify(data);
  const result=assessMerchantTransfer(data);
  assert.equal(result.merchantId,"m_"+"a".repeat(32));
  assert.equal(result.canOpenCase,true);
  assert.equal(result.canTransferNow,false);
  assert.equal(result.outstandingChecks.length,4);
  assert.equal(result.originalSubscriberId,"owner");
  assert.equal(result.assignedSubscriberId,"owner");
  assert.equal(JSON.stringify(data),before);
});

test("reassignment must reject subscriber transfer to self or original owner", () => {
  for(const candidateUid of ["owner",""]) {
    const result=assessMerchantTransfer({
      ...linkedMerchant(),
      candidateUid,candidate:{uid:candidateUid,isActive:true,subscriptionStatus:"active"}
    });
    assert.equal(result.canOpenCase,false);
    assert.equal(result.canTransferNow,false);
  }
});

test("refuses unverified operator, agreement or destination status", () => {
  const base=linkedMerchant();
  for(const changes of [
    { operator:{...base.operator,authUid:""} },
    { operator:{...base.operator,isActive:false} },
    { agreement:{status:"pending",acceptedVersion:0} },
    { candidate:{uid:"target",isActive:true,subscriptionStatus:"trial"} },
    { candidate:{uid:"wrong",isActive:true,subscriptionStatus:"active"} },
    { project:{...base.project,operatingModel:"owner_operated"} }
  ]){
    const result=assessMerchantTransfer({...base,...changes});
    assert.equal(result.canOpenCase,false);
    assert.equal(result.canTransferNow,false);
  }
});

test("legacy project identities require audited backfill before any reassignment case", () => {
  const sample=linkedMerchant();
  delete sample.project.merchantId;
  const result=assessMerchantTransfer(sample);
  assert.equal(result.identityNeedsBackfill,true);
  assert.equal(result.merchantId,"legacy_owner_supermarket");
  assert.equal(result.canOpenCase,false);
});

test("preflight never mutates ownership, orders, ledger or subscriptions", () => {
  const logic=readFileSync("core/merchants/merchant-transfer-preflight.js","utf8");
  const admin=readFileSync("admin/admin.js","utf8");
  const from=admin.indexOf('if (button.dataset.action === "preflight-merchant-transfer")');
  const to=admin.indexOf('if (button.dataset.action === "toggle-project")',from);
  const handler=admin.slice(from,to);
  assert.ok(handler.length>500);
  for(const forbidden of ["updateDoc(", "setDoc(", "runTransaction(", "deleteDoc(", "transaction.update("]) {
    assert.equal(logic.includes(forbidden),false,forbidden);
    assert.equal(handler.includes(forbidden),false,forbidden);
  }
  assert.equal(handler.includes("getDoc("),true);
  assert.equal(handler.includes("textContent = formatMerchantTransferPreflight(report)"),true);
  assert.match(formatMerchantTransferPreflight(assessMerchantTransfer(linkedMerchant())),/بدون نقل فعلي/);
});
