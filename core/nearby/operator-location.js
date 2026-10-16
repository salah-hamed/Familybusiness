import { roundNearbyCoordinate } from "./geospatial.js";

export function bindOperatorLocationCapture({
  inputId,
  buttonId,
  previewId,
  statusId,
  onSave
}) {
  const input = document.getElementById(inputId);
  const button = document.getElementById(buttonId);
  const preview = document.getElementById(previewId);
  const status = document.getElementById(statusId);
  if (!input || !button || !preview || !status) return;
  const renderLocation = () => {
    const value = input.value.trim();
    let validMapLink = false;
    try {
      const url = new URL(value);
      validMapLink = url.protocol === "https:" && ["google.com", "www.google.com", "maps.app.goo.gl", "goo.gl"].includes(url.hostname);
    } catch {}
    preview.href = validMapLink ? value : "#";
    preview.classList.toggle("hidden", !validMapLink);
    status.textContent = validMapLink
      ? "يوجد موقع محفوظ للمشروع."
      : value
        ? "الموقع المحفوظ قديم أو غير صالح؛ حدده من جديد بالزر."
        : "لم يتم تحديد موقع المشروع بعد.";
  };
  if (button.dataset.bound === "true") { renderLocation(); return; }

  button.dataset.bound = "true";
  renderLocation();

  button.addEventListener("click", () => {
    if (!navigator.geolocation) {
      status.textContent = "تحديد الموقع غير مدعوم على هذا الجهاز.";
      return;
    }

    button.disabled = true;
    status.textContent = "جارٍ تحديد موقع المشروع...";
    navigator.geolocation.getCurrentPosition(async position => {
      const latitude = roundNearbyCoordinate(position.coords.latitude);
      const longitude = roundNearbyCoordinate(position.coords.longitude);
      const mapUrl = new URL("https://www.google.com/maps");
      mapUrl.searchParams.set("q", `${latitude},${longitude}`);
      status.textContent = "تم تحديد الموقع. جارٍ حفظه...";
      try {
        await onSave(mapUrl.toString());
        input.value = mapUrl.toString();
        renderLocation();
        status.textContent = "تم تحديد موقع المشروع وحفظه ✅";
      } catch (error) {
        console.error("Operator location save failed", error);
        status.textContent = "تعذر حفظ الموقع. تحقق من الاتصال وحاول مرة أخرى.";
      } finally {
        button.disabled = false;
      }
    }, () => {
      status.textContent = "تعذر تحديد الموقع. اسمح للمتصفح بالوصول إلى الموقع ثم حاول مرة أخرى.";
      button.disabled = false;
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 300000 });
  });
}
