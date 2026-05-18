export const cleaningConfig = {
  name: "خدمة تنظيف",
  basePrice: 100,
  fields: {
    rooms: { type: "select", options: [1,2,3,4], price: 40 },
    bathrooms: { type: "select", options: [1,2,3], price: 20 },
    kitchen: { type: "boolean", price: 30 }
  },
  hasGPS: true,
  ctaText: "ابدأ مشروعك الخاص الآن وامتلك نشاطك الخدمي"
};
