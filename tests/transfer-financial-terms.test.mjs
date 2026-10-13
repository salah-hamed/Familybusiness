import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  snapshotMerchantTransferTerms,
  transferTermsMatchAgreement,
  formatMerchantTransferTerms
} from "../core/merchants/transfer-financial-terms.js";

const accepted={status:"accepted",currentAmount:6.5,acceptedVersion:3,currency:"EGP"};

test("freeze exact accepted commission terms as a consent quote",()=>{
  const terms=snapshotMerchantTransferTerms(accepted);
  assert.deepEqual(terms,{commissionAmount:6.5,commissionVersion:3,commissionCurrency:"EGP"});
  assert.equal(Object.isFrozen(terms),true);
  assert.match(formatMerchantTransferTerms(terms),/جنيه/);
  assert.equal(transferTermsMatchAgreement(terms,accepted),true);
  assert.equal(transferTermsMatchAgreement(terms,{...accepted,acceptedVersion:4}),false);
  assert.equal(transferTermsMatchAgreement(terms,{...accepted,currentAmount:8}),false);
});

test("never request merchant and recipient consent to missing or nonaccepted terms",()=>{
  for(const agreement of [
    {},{...accepted,status:"pending"},{...accepted,currentAmount:null},
    {...accepted,currentAmount:-1},{...accepted,currentAmount:"NaN"},
    {...accepted,acceptedVersion:0},{...accepted,currency:"USD"}
  ]) assert.throws(()=>snapshotMerchantTransferTerms(agreement),/TRANSFER_COMMISSION_TERMS_NOT_ACCEPTED/);
  assert.throws(()=>formatMerchantTransferTerms({}),/TRANSFER_FINANCIAL_TERMS_MISSING/);
});

test("transfer case snapshots the amount and rules bind it to accepted version",()=>{
  const service=readFileSync("core/merchants/transfer-case-service.js","utf8");
  const rules=readFileSync("firestore.rules","utf8");
  assert.match(service,/\.\.\.snapshotMerchantTransferTerms\(agreement\)/);
  for(const field of ["commissionAmount","commissionVersion","commissionCurrency"]) {
    assert.match(rules,new RegExp('d\\.'+field));
  }
  assert.match(rules,/d\.commissionAmount == agreement\.currentAmount/);
  assert.match(rules,/d\.commissionVersion == agreement\.acceptedVersion/);
  assert.match(rules,/d\.commissionCurrency == agreement\.currency/);
  assert.match(rules,/"commissionAmount","commissionVersion","commissionCurrency"/);
});

test("no actual transfer or payment triggered by these review-only quotes",()=>{
  const finance=readFileSync("core/merchants/transfer-financial-terms.js","utf8");
  const service=readFileSync("core/merchants/transfer-case-service.js","utf8");
  assert.equal(finance.includes("updateDoc("),false);
  assert.equal(finance.includes("runTransaction("),false);
  assert.match(service,/MERCHANT_TRANSFER_CASES_DISABLED/);
});
