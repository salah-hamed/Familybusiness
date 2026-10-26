/**
 * Project identity contract for the per-project subscription rollout.
 *
 * Historical projects keep the immutable `ownerId_templateId` ID.
 * New repeated projects must supply a unique, client-generated instance token.
 * Runtime creation must not switch to these IDs until Firestore Rules accept
 * the same contract; this helper intentionally does not alter legacy lookups.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;
const SUPPORTED_TEMPLATES = new Set(["supermarket", "restaurant", "bakery", "laundry"]);

export function getLegacyProjectDocId(ownerId, templateId) {
  const owner = String(ownerId || "");
  const template = String(templateId || "");
  if (!SAFE_SEGMENT.test(owner) || !SUPPORTED_TEMPLATES.has(template)) {
    throw new Error("INVALID_PROJECT_IDENTITY");
  }
  return `${owner}_${template}`;
}

export function getNewProjectDocId(ownerId, templateId, instanceId) {
  const legacyId = getLegacyProjectDocId(ownerId, templateId);
  const instance = String(instanceId || "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(instance)) {
    throw new Error("INVALID_PROJECT_INSTANCE_ID");
  }
  return `${legacyId}_${instance}`;
}

export function isLegacyProjectDocId(projectDocId, ownerId, templateId) {
  try {
    return String(projectDocId || "") === getLegacyProjectDocId(ownerId, templateId);
  } catch {
    return false;
  }
}
