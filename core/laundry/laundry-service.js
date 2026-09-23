import db from "../firebase/firebase-db.js";
import { createOperator, getOperator, updateOperatorContact } from "../partners/partner-service.js";
import { proposeCommission, getCommissionAgreement } from "../commissions/commission-service.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const clean=value=>String(value||"").trim();

export async function getLaundry(projectId){
  const snap=await getDoc(doc(db,"laundries",projectId));
  return snap.exists()?{laundryId:snap.id,...snap.data()}:null;
}

export async function createOrResumeLaundrySetup({
  projectId,ownerId,name,contactName="",phone="",whatsapp="",email,address="",location="",commissionAmount
}){
  const projectSnap=await getDoc(doc(db,"projects",projectId));
  if(!projectSnap.exists())throw new Error("PROJECT_NOT_FOUND");
  const project=projectSnap.data();
  if(project.ownerId!==ownerId||project.template!=="laundry"||project.operatingModel!=="partner_operated"){
    throw new Error("LAUNDRY_PROJECT_MISMATCH");
  }

  let operator=await getOperator(projectId);
  if(!operator){
    await createOperator({projectDocId:projectId,ownerId,templateId:"laundry",name,contactName,phone,whatsapp,email});
  }else{
    await updateOperatorContact(projectId,{name,contactName,phone,whatsapp,email});
  }

  const laundryRef=doc(db,"laundries",projectId);
  const existingLaundry=await getDoc(laundryRef);
  const laundryPayload={
    laundryId:projectId,projectId,ownerId,operatorId:projectId,
    name:clean(name),contactName:clean(contactName),phone:clean(phone),
    whatsapp:clean(whatsapp||phone),email:clean(email).toLowerCase(),
    address:clean(address),location:clean(location),
    isAcceptingOrders:true,currency:"EGP",
    updatedAt:serverTimestamp()
  };
  if(!existingLaundry.exists())laundryPayload.createdAt=serverTimestamp();
  await setDoc(laundryRef,laundryPayload,{merge:true});

  await proposeCommission({projectDocId:projectId,ownerId,operatorId:projectId,templateId:"laundry",amount:commissionAmount});

  return getLaundryBundle(projectId);
}

export async function updateLaundrySettings(projectId,updates={}){
  const next={};
  ["name","contactName","phone","whatsapp","address","location"].forEach(k=>{if(k in updates)next[k]=clean(updates[k]);});
  if("isAcceptingOrders" in updates)next.isAcceptingOrders=updates.isAcceptingOrders===true;
  if(!Object.keys(next).length)return;
  next.updatedAt=serverTimestamp();
  await updateDoc(doc(db,"laundries",projectId),next);
}

export async function getLaundryBundle(projectId){
  const [projectSnap,laundry,operator,agreement]=await Promise.all([
    getDoc(doc(db,"projects",projectId)),getLaundry(projectId),getOperator(projectId),getCommissionAgreement(projectId)
  ]);
  return {project:projectSnap.exists()?{projectDocId:projectSnap.id,...projectSnap.data()}:null,laundry,operator,agreement};
}


export async function migrateLegacyLaundryProject(projectId, ownerId) {
  const ref = doc(db, "projects", projectId);
  const snap = await getDoc(ref);

  if (!snap.exists()) throw new Error("PROJECT_NOT_FOUND");

  const project = snap.data();

  if (project.ownerId !== ownerId || project.template !== "laundry") {
    throw new Error("LAUNDRY_PROJECT_MISMATCH");
  }

  if (project.operatingModel === "partner_operated") {
    return false;
  }

  await updateDoc(ref, {
    operatingModel: "partner_operated",
    templateVersion: 3,
    operatorId: "",
    partnerSetupStatus: "not_started"
  });

  return true;
}
