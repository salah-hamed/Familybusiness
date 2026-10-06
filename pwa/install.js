const manifestLink = document.querySelector('link[rel="manifest"]');
const surface = document.querySelector('meta[name="fb-pwa-surface"]')?.content || "platform";
const scriptUrl = new URL(import.meta.url);
const repoRoot = new URL("../", scriptUrl);
const swUrl = new URL("service-worker.js", repoRoot);
const projectId = new URLSearchParams(location.search).get("project") || "";

const CUSTOMER_SURFACES = new Set(["supermarket","restaurant","bakery","laundry"]);
const SURFACE_CONFIG = {
  platform: { name: "Family Business", icon: "icon", theme: "#0f172a" },
  workspace: { name: "مساحة عمل Family Business", icon: "icon", theme: "#0f172a" },
  admin: { name: "لوحة إدارة Family Business", icon: "icon", theme: "#0f172a" },
  supermarket: { name: "السوبرماركت", icon: "supermarket", theme: "#16a34a" },
  restaurant: { name: "المطعم", icon: "restaurant", theme: "#EA580C" },
  bakery: { name: "المخبز", icon: "bakery", theme: "#D97706" },
  laundry: { name: "المغسلة", icon: "laundry", theme: "#0ea5e9" }
};

const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)")?.matches
  || window.navigator.standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent || "")
  || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function isLikelyMobile(){
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent || "")
    || window.matchMedia?.("(max-width: 820px)")?.matches === true;
}

function templateSurface(){
  return CUSTOMER_SURFACES.has(surface);
}

function stableProjectToken(value){
  const text = String(value || "");
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;

  for(let index = 0; index < text.length; index++){
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }

  return (h1 >>> 0).toString(16).padStart(8,"0")
    + (h2 >>> 0).toString(16).padStart(8,"0");
}

const projectToken = templateSurface() && projectId ? stableProjectToken(projectId) : "";
const storageIdentity = projectToken ? surface + ":" + projectToken : surface;
const installKey = "familybusiness:pwa:launch:" + storageIdentity;
const dismissKey = "familybusiness:pwa:dismissed:" + storageIdentity;
let deferredPrompt = null;
let dynamicManifestUrl = "";
let currentBrandName = SURFACE_CONFIG[surface]?.name || "Family Business";

function iconUrl(size){
  const icon = SURFACE_CONFIG[surface]?.icon || "icon";
  return new URL("pwa/icons/" + icon + "-" + size + ".png", repoRoot).href;
}

function customerScopeUrl(){
  return new URL("./", location.href);
}

function buildProjectManifest(name = currentBrandName){
  if(!templateSurface() || !projectId) return null;

  const safeName = String(name || SURFACE_CONFIG[surface]?.name || "التطبيق").trim().slice(0,80);
  const start = new URL(location.href);
  start.hash = "";
  start.search = "";
  start.searchParams.set("project", projectId);
  start.searchParams.set("source", "pwa");

  const scope = customerScopeUrl();
  scope.search = "";
  scope.hash = "";

  return {
    name: safeName,
    short_name: safeName.slice(0,30),
    lang: "ar",
    dir: "rtl",
    id: new URL("pwa/apps/" + surface + "/" + projectToken, repoRoot).href,
    start_url: start.href,
    scope: scope.href,
    display: "standalone",
    background_color: "#ffffff",
    theme_color: SURFACE_CONFIG[surface]?.theme || "#0f172a",
    icons: [
      { src: iconUrl(192), sizes: "192x192", type: "image/png", purpose: "any maskable" },
      { src: iconUrl(512), sizes: "512x512", type: "image/png", purpose: "any maskable" }
    ]
  };
}

function applyProjectManifest(name = currentBrandName){
  const manifest = buildProjectManifest(name);
  if(!manifest || !manifestLink) return;

  const previous = dynamicManifestUrl;
  dynamicManifestUrl = URL.createObjectURL(
    new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" })
  );
  manifestLink.href = dynamicManifestUrl;

  if(previous){
    window.setTimeout(() => URL.revokeObjectURL(previous), 30000);
  }

  const touchIcon = document.querySelector('link[rel="apple-touch-icon"]');
  if(touchIcon) touchIcon.href = iconUrl(192);

  let appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]');
  if(!appleTitle){
    appleTitle = document.createElement("meta");
    appleTitle.name = "apple-mobile-web-app-title";
    document.head.appendChild(appleTitle);
  }
  appleTitle.content = manifest.short_name;
}

function refreshInstallUi(){
  const installTitle = document.querySelector("#fbPwaInstall .fbPwaInstallCopy strong");
  if(installTitle) installTitle.textContent = "ثبّت " + currentBrandName + " على موبايلك";
  const iosTitle = document.querySelector("#fbPwaIosHelp h3");
  if(iosTitle) iosTitle.textContent = "ثبّت " + currentBrandName;
}

function setProjectBrand(name){
  if(!templateSurface()) return;
  const normalized = String(name || "").trim();
  if(normalized) currentBrandName = normalized.slice(0,80);
  applyProjectManifest(currentBrandName);
  refreshInstallUi();
  document.title = currentBrandName;
}

window.FamilyBusinessPwa = Object.freeze({
  setBrand: setProjectBrand,
  surface,
  projectId
});

function persistTemplateLaunch(){
  if(!templateSurface() || !projectId) return;

  const saved = new URL(location.href);
  saved.search = "";
  saved.searchParams.set("project", projectId);
  localStorage.setItem(installKey, saved.toString());

  // Backward compatibility for apps installed before project-specific identities.
  localStorage.setItem("familybusiness:pwa:launch:" + surface, saved.toString());
}

function restoreTemplateLaunch(){
  if(!templateSurface() || !isStandalone()) return false;
  const params = new URLSearchParams(location.search);
  if(params.get("project")) return false;

  const saved =
    localStorage.getItem(installKey)
    || localStorage.getItem("familybusiness:pwa:launch:" + surface);
  if(!saved) return false;

  try{
    const target = new URL(saved);
    if(target.origin !== location.origin) return false;
    if(target.pathname !== location.pathname) return false;
    location.replace(target.toString());
    return true;
  }catch{
    return false;
  }
}

function recentlyDismissed(){
  const raw = Number(localStorage.getItem(dismissKey) || 0);
  return raw > 0 && (Date.now() - raw) < 7 * 24 * 60 * 60 * 1000;
}

function installIconMarkup(extraClass = ""){
  if(templateSurface()){
    return '<div class="fbPwaInstallIcon ' + extraClass + '"><img src="' + iconUrl(192) + '" alt=""></div>';
  }
  return '<div class="fbPwaInstallIcon ' + extraClass + '">FB</div>';
}

function injectUi(){
  if(document.getElementById("fbPwaInstall")) return;

  const wrapper = document.createElement("aside");
  wrapper.id = "fbPwaInstall";
  wrapper.className = "fbPwaInstall hidden";
  wrapper.setAttribute("role","dialog");
  wrapper.setAttribute("aria-live","polite");
  wrapper.innerHTML =
    installIconMarkup()
    + '<div class="fbPwaInstallCopy">'
    + '<strong>ثبّت ' + currentBrandName + ' على موبايلك</strong>'
    + '<span>افتحه بعد كده كتطبيق مستقل من الشاشة الرئيسية.</span>'
    + '</div>'
    + '<button class="fbPwaInstallBtn" type="button">تثبيت التطبيق</button>'
    + '<button class="fbPwaDismissBtn" type="button" aria-label="إغلاق">✕</button>';

  const help = document.createElement("div");
  help.id = "fbPwaIosHelp";
  help.className = "fbPwaIosHelp hidden";
  help.setAttribute("role","dialog");
  help.setAttribute("aria-modal","true");
  help.innerHTML =
    '<div class="fbPwaIosCard">'
    + '<button class="fbPwaIosClose" type="button" aria-label="إغلاق">✕</button>'
    + installIconMarkup("large")
    + '<h3>ثبّت ' + currentBrandName + '</h3>'
    + '<p>على iPhone / iPad:</p>'
    + '<ol>'
    + '<li>اضغط زر <b>المشاركة Share</b> في Safari.</li>'
    + '<li>اختار <b>Add to Home Screen / إضافة إلى الشاشة الرئيسية</b>.</li>'
    + '<li>اضغط <b>Add / إضافة</b>.</li>'
    + '</ol>'
    + '</div>';

  document.body.append(wrapper, help);

  wrapper.querySelector(".fbPwaDismissBtn").onclick = () => {
    localStorage.setItem(dismissKey, String(Date.now()));
    wrapper.classList.add("hidden");
  };

  wrapper.querySelector(".fbPwaInstallBtn").onclick = async () => {
    if(deferredPrompt){
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if(result?.outcome === "accepted") wrapper.classList.add("hidden");
      return;
    }

    if(isIos()){
      help.classList.remove("hidden");
      return;
    }

    wrapper.querySelector(".fbPwaInstallCopy span").textContent =
      "من قائمة المتصفح اختار تثبيت التطبيق أو Add to Home screen.";
  };

  help.querySelector(".fbPwaIosClose").onclick = () => help.classList.add("hidden");
  help.addEventListener("click", event => {
    if(event.target === help) help.classList.add("hidden");
  });
}

function showInstallUi(){
  if(isStandalone() || recentlyDismissed()) return;
  injectUi();
  document.getElementById("fbPwaInstall")?.classList.remove("hidden");
}

async function registerServiceWorker(){
  if(!("serviceWorker" in navigator)) return;
  try{
    await navigator.serviceWorker.register(swUrl.pathname, { scope: repoRoot.pathname });
  }catch(error){
    console.warn("PWA_SERVICE_WORKER_REGISTRATION_FAILED", error);
  }
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  showInstallUi();
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  document.getElementById("fbPwaInstall")?.classList.add("hidden");
  localStorage.removeItem(dismissKey);
});

if(templateSurface() && projectId){
  applyProjectManifest(currentBrandName);
}
persistTemplateLaunch();

if(restoreTemplateLaunch()) {
  // Stop normal page boot from doing useful work before the redirect completes.
} else {
  registerServiceWorker();
  injectUi();

  if(isLikelyMobile() && !isStandalone()){
    window.setTimeout(showInstallUi, 900);
  }
}
