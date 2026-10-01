import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildOperatorGuide } from "../core/onboarding/guide-state.js";

function currentId(journey){
  return journey.steps.find(step=>step.status==="current")?.id;
}

test("operator guide starts with missing business settings",()=>{
  const journey=buildOperatorGuide({
    templateId:"restaurant",
    partner:{name:"مطعم",whatsapp:"010",address:"",isAcceptingOrders:false},
    contentReady:false,
    teamReady:false
  });
  assert.equal(currentId(journey),"business-settings");
});

test("operator guide moves through content, team and accepting-orders readiness",()=>{
  const partner={name:"مطعم",whatsapp:"010",address:"القاهرة",isAcceptingOrders:false};
  assert.equal(currentId(buildOperatorGuide({templateId:"restaurant",partner,contentReady:false,teamReady:false})),"content");
  assert.equal(currentId(buildOperatorGuide({templateId:"restaurant",partner,contentReady:true,teamReady:false})),"delivery-team");
  assert.equal(currentId(buildOperatorGuide({templateId:"restaurant",partner,contentReady:true,teamReady:true})),"accepting-orders");
});

test("ready operator is guided to share the customer link",()=>{
  const journey=buildOperatorGuide({
    templateId:"supermarket",
    partner:{name:"سوبرماركت",phone:"010",address:"الجيزة",isAcceptingOrders:true},
    contentReady:true,
    teamReady:true
  });
  assert.equal(currentId(journey),"share-customer-link");
});

test("laundry guide targets service pricing and delivery team sections",()=>{
  const journey=buildOperatorGuide({templateId:"laundry",partner:{},contentReady:false,teamReady:false});
  assert.equal(journey.steps.find(step=>step.id==="content").selector,"#pricingSection");
  assert.equal(journey.steps.find(step=>step.id==="delivery-team").selector,"#ridersSection");
});

test("all launch operator dashboards use the shared first-run guide",()=>{
  for(const path of [
    "supermarket-operator/app.js",
    "restaurant-operator/app.js",
    "bakery-operator/app.js",
    "laundry-operator/app.js"
  ]){
    const source=readFileSync(path,"utf8");
    assert.match(source,/createGuide/);
    assert.match(source,/buildOperatorGuide/);
    assert.match(source,/refreshOperatorFirstRunGuide/);
  }
});

test("operator onboarding selectors exist in each dashboard",()=>{
  const supermarket=readFileSync("supermarket-operator/index.html","utf8");
  assert.match(supermarket,/id="settingsSection"/);
  assert.match(supermarket,/id="ridersSection"/);
  assert.match(supermarket,/id="openProductLibraryBtn"/);
  assert.match(supermarket,/id="ordersMessage"/);

  for(const path of ["restaurant-operator/index.html","bakery-operator/index.html"]){
    const html=readFileSync(path,"utf8");
    assert.match(html,/id="settingsSection"/);
    assert.match(html,/id="ridersSection"/);
    assert.match(html,/id="openMenuBtn"/);
  }

  const laundry=readFileSync("laundry-operator/index.html","utf8");
  for(const id of ["settingsSection","pricingSection","ridersSection","ordersSection"]){
    assert.match(laundry,new RegExp(`id="${id}"`));
  }
});
