import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PLATFORM_COMMISSION_BENEFICIARY,
  resolveCommissionBeneficiary,
  isVerifiedPlatformManagedMerchant,
  isPreviouslyEarnedCommissionPreserved
} from "../core/merchants/merchant-commission-beneficiary.js";

const owner="subscriber_old";
const agreement={ownerId:owner,status:"accepted",currentAmount:5};
const project={ownerId:owner,template:"supermarket"};

test("legacy projects keep all existing commission ownership",()=>{
  assert.equal(resolveCommissionBeneficiary(project,agreement),owner);
  assert.equal(resolveCommissionBeneficiary({
    ...project,assignedSubscriberId:owner,
    assignmentStatus:"assigned_to_subscriber",platformManaged:false
  },agreement),owner);
});

test("only fully audited recovered merchants can credit the platform treasury",()=>{
  const managed={
    ...project,assignedSubscriberId:"",assignmentStatus:"platform_managed",
    platformManaged:true,recoveryAuditId:"subscriber_old_supermarket",
    recoveryAt:new Date(),recoveryAdminUid:"admin_1"
  };
  assert.equal(isVerifiedPlatformManagedMerchant(managed),true);
  assert.equal(resolveCommissionBeneficiary(managed,agreement),PLATFORM_COMMISSION_BENEFICIARY);
  assert.notEqual(PLATFORM_COMMISSION_BENEFICIARY,owner);
  for(const invalid of [
    {...managed,recoveryAuditId:""},
    {...managed,recoveryAt:null},
    {...managed,recoveryAdminUid:null},
    {...managed,assignedSubscriberId:owner},
    {...managed,assignmentStatus:"assigned_to_subscriber"}
  ]){
    assert.equal(isVerifiedPlatformManagedMerchant(invalid),false);
    assert.throws(()=>resolveCommissionBeneficiary(invalid,agreement),/MERCHANT_RECOVERY_AUDIT_REQUIRED/);
  }
});

test("a half-finished recovery or later unapproved reassignment never pays the original subscriber",()=>{
  assert.throws(()=>resolveCommissionBeneficiary({...project,assignmentStatus:"platform_managed"},agreement),/MERCHANT_RECOVERY_STATE_MISMATCH/);
  assert.throws(()=>resolveCommissionBeneficiary({
    ...project,platformManaged:false,
    assignedSubscriberId:"subscriber_new",assignmentStatus:"assigned_to_new_subscriber"
  },agreement),/SUBSCRIBER_REASSIGNMENT_ROUTING_NOT_ENABLED/);
  assert.throws(()=>resolveCommissionBeneficiary(project,{ownerId:"wrong"}),/COMMISSION_AGREEMENT_PROJECT_OWNER_MISMATCH/);
});

test("historic earned ledger recipient and amount cannot change during cutover",()=>{
  const oldLedger={
    userId:owner,projectId:"subscriber_old_supermarket",orderId:"order_old",
    amount:9.25
  };
  const oldSnapshot={...oldLedger};
  assert.equal(isPreviouslyEarnedCommissionPreserved(oldLedger,oldSnapshot),true);
  assert.equal(isPreviouslyEarnedCommissionPreserved({...oldLedger,userId:PLATFORM_COMMISSION_BENEFICIARY},oldSnapshot),false);
  assert.equal(isPreviouslyEarnedCommissionPreserved({...oldLedger,amount:10},oldSnapshot),false);
});

test("all operator paths read the live project WITHIN the ledger creation transaction",()=>{
  for(const path of [
    "core/supermarket/order-service.js",
    "core/restaurant/order-service.js",
    "core/laundry/order-service.js"
  ]){
    const source=readFileSync(path,"utf8");
    const occurrences=(source.match(/resolveCommissionBeneficiary\(projectSnap.data\(\), agreementSnap.data\(\)\)/g)||[]).length;
    assert.equal(occurrences,2,path);
    const projectReads=(source.match(/transaction.get\(projectRef\)/g)||[]).length;
    assert.equal(projectReads,2,path);
    assert.equal(/userId:\s*agreementSnap.data\(\).ownerId/.test(source),false,path);
    assert.equal(source.includes("projectRef"),true);
  }
});

test("no assignment or ledger history is ever modified in the pure resolver",()=>{
  const source=readFileSync("core/merchants/merchant-commission-beneficiary.js","utf8");
  for(const forbidden of ["updateDoc(", "setDoc(", "runTransaction(", "deleteDoc("]){
    assert.equal(source.includes(forbidden),false);
  }
});
