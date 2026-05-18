import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";

import { cleaningConfig } from "../../core/templates/cleaning.config.js";

import {
doc,
getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let config = cleaningConfig;

const rooms = document.getElementById("rooms");
const bathrooms = document.getElementById("bathrooms");
const kitchen = document.getElementById("kitchen");
const priceBox = document.getElementById("priceBox");

function calcPrice(){

let price = config.basePrice;

price += Number(rooms.value) * config.fields.rooms.price;
price += Number(bathrooms.value) * config.fields.bathrooms.price;

if(kitchen.value === "yes"){
price += config.fields.kitchen.price;
}

priceBox.innerText = price + " جنيه";
return price;

}

rooms.onchange = calcPrice;
bathrooms.onchange = calcPrice;
kitchen.onchange = calcPrice;

calcPrice();

/* GPS */
document.getElementById("getLocationBtn").onclick = () => {

navigator.geolocation.getCurrentPosition((pos)=>{

document.getElementById("location").value =
`${pos.coords.latitude}, ${pos.coords.longitude}`;

});

};

async function init(){

const providerId =
new URLSearchParams(location.search).get("user");

if(!providerId) return;

const snap = await getDoc(doc(db,"users",providerId));

if(!snap.exists()) return;

const data = snap.data();

document.getElementById("businessTitle").innerText =
data.businessName || "خدمة تنظيف";

/* WhatsApp */
if(data.whatsappNumber){

const clean =
data.whatsappNumber.replace(/\D/g,"");

document.getElementById("whatsappBtn").href =
`https://wa.me/20${clean}`;

}

/* InstaPay */
if(data.instapayLink){

document.getElementById("paymentBtn").href =
data.instapayLink;

}

/* Order submit */
document.getElementById("submitOrder").onclick = async ()=>{

const order = {

providerId,
templateType:"cleaning",

customerName:document.getElementById("customerName").value,
customerPhone:document.getElementById("customerPhone").value,
customerAddress:document.getElementById("customerAddress").value,
location:document.getElementById("location").value,

rooms:rooms.value,
bathrooms:bathrooms.value,
kitchen:kitchen.value,

price:calcPrice(),

status:"new"
};

const res = await createOrder(order);

document.getElementById("status").innerText =
res.success
? "تم استلام الطلب بنجاح 🎉"
: res.error;

};

}

init();
