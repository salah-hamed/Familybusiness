import { isVerifiedAssignedAfterCutover } from "./merchant-commission-beneficiary.js";

// Presentation-only projection. Firestore Rules remain the sole authorization
// source. In particular, historical ownerId is never operational ownership
// after recovery, but its immutable accounting entitlement remains visible.
export function resolveSubscriberMerchantAccess(project={},projectDocId="",uid=""){
  if (!project || !projectDocId || !uid) return {role:"none",canOperate:false,canViewStatement:false};
  const current=project.platformManaged===true
    && project.cutoverAuditId===projectDocId
    && project.assignedSubscriberId===uid
    && isVerifiedAssignedAfterCutover(project);
  if (current) return {role:"assigned",canOperate:false,canViewStatement:true};
  const historical=project.ownerId===uid || project.originalSubscriberId===uid;
  if (project.platformManaged===true){
    return historical ? {role:"former",canOperate:false,canViewStatement:true}
      : {role:"none",canOperate:false,canViewStatement:false};
  }
  return project.ownerId===uid
    ? {role:"original",canOperate:true,canViewStatement:true}
    : {role:"none",canOperate:false,canViewStatement:false};
}
