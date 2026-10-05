import app from "./firebase-config.js";
import { FIREBASE_SECURITY_CONFIG } from "../config/security-config.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";

const siteKey = String(FIREBASE_SECURITY_CONFIG.appCheckRecaptchaEnterpriseSiteKey || "").trim();
const requiredHere = FIREBASE_SECURITY_CONFIG.appCheckRequiredHostnames.includes(location.hostname);

let appCheck = null;

if (siteKey) {
  appCheck = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true
  });
} else if (requiredHere) {
  console.error("SECURITY_APP_CHECK_NOT_CONFIGURED");
}

export const appCheckConfigured = Boolean(siteKey);
export default appCheck;
