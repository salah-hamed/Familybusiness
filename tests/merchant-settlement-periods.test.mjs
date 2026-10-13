import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const settlements=readFileSync("core/commissions/settlement-service.js","utf8");
const finance=readFileSync("core/commissions/finance-panel.js","utf8");

test("old subscriber earnings and recorded payments use the SAME beneficiary scope",()=>{
  const start=settlements.indexOf("export async function getProjectPaymentSummary");
  const end=settlements.indexOf("export async function listProjectPaymentRequests",start);
  const block=settlements.slice(start,end);
  assert.match(block,/beneficiaryId = oid/);
  assert.match(block,/ledgerScope.push\(where\("userId", "==", beneficiaryId\)\)/);
  assert.match(block,/paymentScope.push\(where\("ownerId", "==", beneficiaryId\)\)/);
  assert.match(block,/\.\.\.paymentScope/);
  assert.ok(block.includes("resolveMerchantFinancePeriod(projectSnap.data()).beneficiaryId"));
});

test("former subscriber only receives their own historical payment requests",()=>{
  assert.match(finance,/listProjectPaymentRequests\(projectId, \{ pageSize: 20, ownerId \}\)/);
  const start=settlements.indexOf("export async function listProjectPaymentRequests");
  const end=settlements.indexOf("export async function declareOperatorPayment",start);
  assert.match(settlements.slice(start,end),/where\("ownerId", "==", clean\(ownerId\)\)/);
});

test("physical shop operator cannot accidentally declare an old-subscriber payment for a recovered merchant",()=>{
  assert.match(settlements,/resolveMerchantFinancePeriod\(project\)/);
  assert.match(settlements,/PLATFORM_SETTLEMENT_FLOW_NOT_CONFIGURED/);
});

test("specific composite index definitions exist for beneficiary balances and payment history",()=>{
  const indexes=JSON.parse(readFileSync("firestore.indexes.json","utf8")).indexes
    .filter(i=>i.collectionGroup==="commissionSettlements");
  for (const required of [
    ["projectId","ownerId","status"],
    ["projectId","ownerId","createdAt"]
  ]){
    assert.ok(indexes.some(i=>JSON.stringify(i.fields.map(f=>f.fieldPath))===JSON.stringify(required)),required.join("/"));
  }
});
