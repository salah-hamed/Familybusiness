import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import { cleaningConfig } from "../../core/templates/cleaning.config.js";

import {
doc,
getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let config = cleaningConfig;

/* =========================
   SAFE DOM INIT
========================= */

function getEl(id){
return document.getElementById(id);
}

const rooms = getEl("rooms");
const bathrooms = getEl("bathrooms");
const kitchen = getEl("kitchen");
const priceBox = getEl("priceBox");

/* =========================
   PRICE ENGINE
========================= */

function calcPrice(){

if(!priceBox) return 0;

let price = config.basePrice;

price += Number(rooms?.value || 0) * config.fields.rooms.price;
price += Number(bathrooms?.value || 0) * config.fields.bathrooms.price;

if(kitchen?.value === "yes"){
price += config.fields.kitchen.price;
}

priceBox.innerText = price + " جنيه";
return price;
}

/* =========================
   INIT EVENTS
========================= */

function initPriceListeners(){

if(!rooms || !bathrooms || !kitchen) return;

rooms.onchange = calcPrice;
bathrooms.onchange = calcPrice;
kitchen.onchange = calcPrice;

calcPrice();
}

/* =========================
   GPS
========================= */

const gpsBtn = getEl("getLocationBtn");

if(gpsBtn){
gpsBtn.onclick = () => {

navigator.geolocation.getCurrentPosition((pos)=>{

const loc = getEl("location");
if(loc){
loc.value = `${pos.coords.latitude}, ${pos.coords.longitude}`;
}

});

};
}

/* =========================
   LOAD USER TEMPLATE
========================= */

async function init(){

const providerId =
new URLSearchParams(location.search).get("user");

if(!providerId) return;

const snap = await getDoc(doc(db,"users",providerId));

if(!snap.exists()) return;

const data = snap.data();

/* title */
const title = getEl("businessTitle");
if(title){
title.innerText = data.businessName || "خدمة تنظيف";
}

/* WhatsApp */
const wa = getEl("whatsappBtn");
if(wa && data.whatsappNumber){

const clean = data.whatsappNumber.replace(/\D/g,"");
wa.href = `https://wa.me/20${clean}`;

}

/* Payment */
const pay = getEl("paymentBtn");
if(pay && data.instapayLink){
pay.href = data.instapayLink;
}

/* ORDER */
const submit = getEl("submitOrder");

if(submit){
submit.onclick = async ()=>{

const order = {
providerId,
templateType:"cleaning",

customerName:getEl("customerName")?.value || "",
customerPhone:getEl("customerPhone")?.value || "",
customerAddress:getEl("customerAddress")?.value || "",
location:getEl("location")?.value || "",

rooms:rooms?.value,
bathrooms:bathrooms?.value,
kitchen:kitchen?.value,

price:calcPrice(),
status:"new"
};

const res = await createOrder(order);

const status = getEl("status");
if(status){
status.innerText = res.success
? "تم استلام الطلب بنجاح 🎉"
: res.error;
}

};

}

/* start pricing */
initPriceListeners();
calcPrice();

}

init();
