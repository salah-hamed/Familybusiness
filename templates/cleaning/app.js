import { createOrder } from "./orders.js";
import db from "../../core/firebase/firebase-db.js";

import {
doc,
getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const fields = [
"customerName",
"customerPhone",
"customerAddress",
"location"
];

fields.forEach(id => {
const el = document.getElementById(id);

el.value = localStorage.getItem(id) || "";

el.addEventListener("input", () => {
localStorage.setItem(id, el.value);
});
});

const rooms = document.getElementById("rooms");
const bathrooms = document.getElementById("bathrooms");
const kitchen = document.getElementById("kitchen");
const priceBox = document.getElementById("priceBox");

function calculatePrice(){

let price = 100;

price += Number(rooms.value) * 40;
price += Number(bathrooms.value) * 20;

if(kitchen.value === "yes"){
price += 30;
}

priceBox.innerText = price + " جنيه";

}

rooms.onchange = calculatePrice;
bathrooms.onchange = calculatePrice;
kitchen.onchange = calculatePrice;

calculatePrice();

init();

async function init(){

const params = new URLSearchParams(window.location.search);
const providerId = params.get("user");

if(!providerId) return;

const userSnap = await getDoc(doc(db,"users",providerId));

if(!userSnap.exists()) return;

const userData = userSnap.data();

document.getElementById("businessTitle").innerText =
userData.businessName || "خدمة تنظيف";

document.getElementById("whatsappBtn").href =
`https://wa.me/${userData.whatsappNumber || ""}`;

document.getElementById("paymentBtn").href =
userData.instapayLink || "#";

document
.getElementById("submitOrder")
.addEventListener("click", async ()=>{

const order = {

providerId,
templateType:"cleaning",

customerName:
document.getElementById("customerName").value,

customerPhone:
document.getElementById("customerPhone").value,

customerAddress:
document.getElementById("customerAddress").value,

rooms: rooms.value,
bathrooms: bathrooms.value,
kitchen: kitchen.value,

visitDate:
document.getElementById("visitDate").value,

visitTime:
document.getElementById("visitTime").value,

location:
document.getElementById("location").value,

price:
priceBox.innerText,

status:"new"

};

const result = await createOrder(order);

document.getElementById("status").innerText =
result.success ? "تم الإرسال ✅" : result.error;

document.getElementById("orderState").innerText =
"قيد المراجعة";

});

}
