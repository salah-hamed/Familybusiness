import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";

import {
doc,
getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let priceConfig = {
base:100,
room:40,
bathroom:20,
kitchen:30
};

const rooms = document.getElementById("rooms");
const bathrooms = document.getElementById("bathrooms");
const kitchen = document.getElementById("kitchen");
const priceBox = document.getElementById("priceBox");

const whatsappBtn = document.getElementById("whatsappBtn");
const paymentBtn = document.getElementById("paymentBtn");

function calcPrice(){

let price = priceConfig.base;

price += Number(rooms.value) * priceConfig.room;
price += Number(bathrooms.value) * priceConfig.bathroom;
if(kitchen.value === "yes") price += priceConfig.kitchen;

priceBox.innerText = price + " جنيه";
return price;

}

rooms.onchange = calcPrice;
bathrooms.onchange = calcPrice;
kitchen.onchange = calcPrice;

calcPrice();

async function init(){

const providerId =
new URLSearchParams(location.search).get("user");

if(!providerId) return;

const snap = await getDoc(doc(db,"users",providerId));

if(!snap.exists()) return;

const data = snap.data();

document.getElementById("businessTitle").innerText =
data.businessName || "خدمة تنظيف";

// WhatsApp fix
if(data.whatsappNumber){

const cleanNumber = data.whatsappNumber.replace(/\D/g,"");

whatsappBtn.href = cleanNumber
? `https://wa.me/20${cleanNumber}`
: "#";

}else{
whatsappBtn.classList.add("hidden");
}

// InstaPay fix
if(data.instapayLink && data.instapayLink.startsWith("http")){
paymentBtn.href = data.instapayLink;
}else{
paymentBtn.classList.add("hidden");
}

document.getElementById("submitOrder").onclick = async ()=>{

const order = {
providerId,
templateType:"cleaning",
customerName:document.getElementById("customerName").value,
customerPhone:document.getElementById("customerPhone").value,
customerAddress:document.getElementById("customerAddress").value,
rooms:rooms.value,
bathrooms:bathrooms.value,
kitchen:kitchen.value,
price:calcPrice(),
status:"new"
};

const res = await createOrder(order);

document.getElementById("status").innerText =
res.success ? "تم استلام طلبك بنجاح 🎉" : res.error;

};

}

init();
