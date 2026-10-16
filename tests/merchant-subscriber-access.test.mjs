import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveSubscriberMerchantAccess } from "../core/merchants/merchant-subscriber-access.js";
const pid="former_supermarket";
const merchantId="m_"+"c".repeat(32);
const recovered={ownerId:"former",originalSubscriberId:"former",platformManaged:true,
 merchantId,assignmentStatus:"platform_managed",assignedSubscriberId:"",
 recoveryAuditId:pid,recoveryAt:new Date(),recoveryAdminUid:"admin"};
const assigned={...recovered,assignedSubscriberId:"incoming",
 assignmentStatus:"assigned_to_new_subscriber",cutoverAuditId:pid,
 cutoverAt:new Date(),cutoverAdminUid:"admin"};
test("former subscriber keeps statement only; stranger and incomplete assignee never gain it",()=>{
 assert.deepEqual(resolveSubscriberMerchantAccess(recovered,pid,"former"),
  {role:"former",canOperate:false,canViewStatement:true});
 assert.equal(resolveSubscriberMerchantAccess(recovered,pid,"incoming").canViewStatement,false);
 assert.equal(resolveSubscriberMerchantAccess(assigned,pid,"former").role,"former");
 assert.equal(resolveSubscriberMerchantAccess(assigned,pid,"incoming").role,"assigned");
 assert.equal(resolveSubscriberMerchantAccess(assigned,pid,"incoming").canOperate,false);
 assert.equal(resolveSubscriberMerchantAccess({...assigned,cutoverAuditId:"forged"},pid,"incoming").canViewStatement,false);
 assert.equal(resolveSubscriberMerchantAccess(assigned,pid,"stranger").canViewStatement,false);
});
test("C4B12 prior assigned subscriber gets historic-only rights with matching grant",()=>{
 const project={ownerId:"former",originalSubscriberId:"former",
  merchantId:"m_"+"a".repeat(32),platformManaged:true,
  assignmentStatus:"assigned_to_new_subscriber",assignedSubscriberId:"newest",
  recoveryAuditId:"former_supermarket_3",cutoverAuditId:"former_supermarket_3",
  cutoverAdminUid:"admin",cutoverAt:new Date(),recoveryAt:new Date()};
 const grant={projectDocId:"former_supermarket",subscriberUid:"previous",
  merchantId:project.merchantId,firstRecoveredCycle:3,status:"historic_only"};
 assert.deepEqual(resolveSubscriberMerchantAccess(project,"former_supermarket","previous",grant),
  {role:"former",canOperate:false,canViewStatement:true});
 for(const bad of [{...grant,subscriberUid:"attacker"},
  {...grant,merchantId:"other"},{...grant,status:"current"},{...grant,firstRecoveredCycle:0}]){
   assert.equal(resolveSubscriberMerchantAccess(project,"former_supermarket","previous",bad).canViewStatement,false);
 }
});
test("original working subscriber can operate non-recovered merchant",()=>{
 assert.equal(resolveSubscriberMerchantAccess({ownerId:"former",platformManaged:false},pid,"former").canOperate,true);
 assert.equal(resolveSubscriberMerchantAccess({ownerId:"former",platformManaged:false},pid,"incoming").canOperate,false);
});
test("historical and incoming statement only queries signed-in user's ledger and settlement scope",()=>{
 const source=readFileSync("merchant-statement/app.js","utf8");
 assert.match(source,/resolveSubscriberMerchantAccess\([\s\S]*?project,projectId,user.uid,grantSnap/);
 assert.match(source,/getProjectCommissionSummary\(user.uid,projectId\)/);
 assert.match(source,/listProjectPaymentRequests\(projectId,\{ownerId:user.uid,pageSize:20\}\)/);
 for(const banned of ["updateDoc(","setDoc(","deleteDoc(","runTransaction(","adminUid:","PLATFORM_COMMISSION_BENEFICIARY"]){
  assert.equal(source.includes(banned),false,banned);
 }
});
test("no original partner setup can reopen after platform recovery",()=>{
 for(const p of ["supermarket/app.js","restaurant/app.js","bakery/app.js","laundry/app.js"]){
  const source=readFileSync(p,"utf8");
  assert.match(source,/\.platformManaged===true\s*\|\|/);
 }
 const engine=readFileSync("templates/engine/project-engine.js","utf8");
 assert.match(engine,/where\("assignedSubscriberId","==",ownerId\)/);
 assert.match(engine,/where\("assignmentStatus","==","assigned_to_new_subscriber"\)/);
 assert.match(engine,/where\("platformManaged","==",true\)/);
 const indexes=JSON.parse(readFileSync("firestore.indexes.json","utf8"));
 const i=indexes.indexes.find(i=>i.collectionGroup==="projects");
 assert.deepEqual(i?.fields.map(f=>f.fieldPath),["assignedSubscriberId","assignmentStatus","platformManaged"]);
});
test("workspace displays two projects from same template and links former to financial statement",()=>{
 const src=readFileSync("workspace/app.js","utf8");
 assert.match(src,/myProjects\.filter\(item => item.projectId === project.id\)/);
 assert.match(src,/matches\.some\(item => item.ownerId === user.uid\)/);
 assert.match(src,/merchant-statement\/\?project=/);
 assert.match(src,/data-statement=/);
 assert.match(src,/ownPaymentStateIds/);
});
