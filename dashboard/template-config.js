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
  carwash: {
    label: "غسيل السيارات",
    todayLabel: "سيارات اليوم",
    pricing: [
      ["basePrice", "سعر الغسلة الخارجية", "base"]
    ],
    marketing: {
      serviceLabel: "غسيل سيارات خارجي",
      headline: "سيارتك نظيفة من غير ما تتحرك من مكانك",
      description: "غسيل خارجي لسيارتك في مكانها، بموعد تختاره وحجز سهل في أقل من دقيقة.",
      benefits: ["غسيل خارجي", "في مكان سيارتك", "مواعيد مرنة"]
    }
  }
};

export function getTemplateKey(project = {}) {
  return project.template || project.projectType || "cleaning";
}

export function getDashboardTemplate(project = {}) {
  const key = getTemplateKey(project);
  return dashboardTemplates[key] || dashboardTemplates.cleaning;
}

export function templateFromProjectLink(link = "") {
  const match = String(link).match(/\/templates\/([^/?#]+)/);
  return match?.[1] || "cleaning";
}
