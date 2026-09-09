export const dashboardTemplates = {
  cleaning: {
    label: "تنظيف المنازل",
    todayLabel: "طلبات اليوم",
    pricing: [
      ["basePrice", "السعر الأساسي", "base"],
      ["roomPrice", "سعر الغرفة", "room"],
      ["bathroomPrice", "سعر الحمام", "bathroom"],
      ["kitchenPrice", "سعر المطبخ", "kitchen"],
      ["stairsPrice", "سعر تنظيف السلم", "stairs"]
    ],
    marketing: {
      serviceLabel: "خدمات تنظيف منزلي",
      headline: "تنظيف بيتك أسهل من أي وقت",
      description: "راحة أكبر، وقت أكثر لك ولعائلتك، وحجز سهل في أقل من دقيقة.",
      benefits: ["تنظيف شامل", "مواعيد مرنة", "جودة موثوقة"]
    }
  },
  laundry: {
    label: "غسيل ومكواة الملابس",
    todayLabel: "استلامات اليوم",
    pricing: [["basePrice", "تسعير الغسيل والمكواة", "shirtWash"]],
    marketing: {
      serviceLabel: "غسيل ومكواة بالقطعة مع استلام وتوصيل",
      headline: "غسيل أو مكواة أو الاتنين — لحد باب البيت",
      description: "اختار القطع والخدمة المناسبة لكل قطعة وحدد موعد الاستلام، وإحنا نهتم بالباقي.",
      benefits: ["غسيل ومكواة بأسعار منفصلة", "استلام من المنزل", "غسيل كوتشي"]
    }
  },
  carwash: {
    label: "غسيل السيارات",
    todayLabel: "سيارات اليوم",
    pricing: [
      ["basePrice", "سعر الاشتراك الشهري", "monthly"],
      ["roomPrice", "عدد الغسلات في الشهر", "monthlyWashes"]
    ],
    marketing: {
      serviceLabel: "اشتراك غسيل سيارات خارجي",
      headline: "خلي سيارتك نظيفة طول الشهر",
      description: "اشتراك شهري لغسيل سيارتك خارجيًا في مكانها مع متابعة رصيد الغسلات وتجديد سهل كل شهر.",
      benefits: ["اشتراك شهري", "غسلات متعددة", "في مكان سيارتك"]
    }
  }
};
export function getTemplateKey(project = {}) { return project.template || project.projectType || "cleaning"; }
export function getDashboardTemplate(project = {}) { return dashboardTemplates[getTemplateKey(project)] || dashboardTemplates.cleaning; }
export function templateFromProjectLink(link = "") { const match=String(link).match(/\/templates\/([^/?#]+)/); return match?.[1] || "cleaning"; }
import("./carwash-theme.js");
import("./carwash-visual.js");
import("./carwash-subscriptions.js");
import("./laundry-pricing.js");
import("./laundry-operations.js");
