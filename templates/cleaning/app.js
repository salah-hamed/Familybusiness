import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

function calcPrice(){
let price = priceConfig.base;

price += rooms.value * priceConfig.room;
price += bathrooms.value * priceConfig.bathroom;
if(kitchen.value==="yes") price += priceConfig.kitchen;

priceBox.innerText = price + " جنيه";
return price;
}

rooms.onchange = calcPrice;
bathrooms.onchange = calcPrice;
kitchen.onchange = calcPrice;

async function init(){

const providerId = new URLSearchParams(location.search).get("user");
if(!providerId) return;

const snap = await getDoc(doc(db,"users",providerId));
if(!snap.exists()) return;

const data = snap.data();

document.getElementById("businessTitle").innerText =
data.businessName || "خدمة تنظيف";

document.getElementById("whatsappBtn").href =
`https://wa.me/${data.whatsappNumber || ""}`;

document.getElementById("paymentBtn").href =
data.instapayLink || "#";

// لو صاحب المشروع حاطط تسعير خاص
if(data.priceConfig){
priceConfig = {...priceConfig,...data.priceConfig};
calcPrice();
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
calcPrice();
