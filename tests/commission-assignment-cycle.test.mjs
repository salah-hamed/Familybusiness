import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {commissionCycleStamp,isSameCommissionCycle} from "../core/commissions/commission-assignment-cycle.js";
test("legacy and first recovered/cutover order writes retain the original ledger contract",()=>{
 for(const project of [{},{assignmentCycle:1}]){
  assert.deepEqual(commissionCycleStamp(project),{order:{},ledger:{}});
  assert.equal(isSameCommissionCycle({userId:"platform"},project),true);
 }
});
test("every repeated recovery or assignment earns only inside its current cycle",()=>{
 for(const cycle of [2,3,4,15]){
  const s=commissionCycleStamp({assignmentCycle:cycle});
  assert.deepEqual(s.order,{commissionAssignmentCycle:cycle});
  assert.deepEqual(s.ledger,{assignmentCycle:cycle});
  assert.equal(isSameCommissionCycle({assignmentCycle:cycle},{assignmentCycle:cycle}),true);
  assert.equal(isSameCommissionCycle({assignmentCycle:cycle-1},{assignmentCycle:cycle}),false);
 }
 for(const assignmentCycle of ["2",0,-1,1.4,10000]){
  assert.throws(()=>commissionCycleStamp({assignmentCycle}),/INVALID/);
 }
});
test("all four template products stamp ledger and order at rider-assignment transaction",()=>{
 const sources=["core/supermarket/order-service.js","core/restaurant/order-service.js",
 "core/laundry/order-service.js"];
 for(const path of sources){
  const text=readFileSync(path,"utf8");
  assert.equal(text.split("...commissionCycleStamp(projectSnap.data()).order").length-1,2,path);
  assert.equal(text.split("...commissionCycleStamp(projectSnap.data()).ledger").length-1,2,path);
  assert.match(text,/runTransaction/);
  assert.match(text,/resolveCommissionBeneficiary\(projectSnap\.data\(\), agreementSnap\.data\(\)\)/);
 }
 const payments=readFileSync("core/commissions/settlement-service.js","utf8");
 assert.match(payments,/ledgerScope\.push\(where\("assignmentCycle","==",currentCycle\)\)/);
 assert.match(payments,/paymentScope\.push\(where\("assignmentCycle","==",currentCycle\)\)/);
});
