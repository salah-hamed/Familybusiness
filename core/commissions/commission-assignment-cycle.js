/**
 * A project may be recycled many times. UserId alone cannot segment the
 * platform's repeated earning periods; every post-C4B11 ledger event carries
 * the immutable assignment cycle selected by the atomic rider dispatch.
 */
export function commissionCycleStamp(project={}){
 const cycle=project.assignmentCycle;
 if(cycle==null || cycle===1)return Object.freeze({order:{},ledger:{}});
 if(!Number.isSafeInteger(cycle)||cycle<2||cycle>9999)
  throw new Error("COMMISSION_ASSIGNMENT_CYCLE_INVALID");
 return Object.freeze({
  order:{commissionAssignmentCycle:cycle},
  ledger:{assignmentCycle:cycle}
 });
}
export function isSameCommissionCycle(entry={},project={}){
 const cycle=project.assignmentCycle??1;
 return cycle===1 ? entry.assignmentCycle==null
   : Number.isSafeInteger(cycle)&&cycle>=2&&entry.assignmentCycle===cycle;
}
