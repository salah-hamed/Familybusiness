export const MASTER_PRICE_META = Object.freeze({
  currency: "EGP",
  priceAsOf: "2026-09-24",
  source: "Carrefour Egypt online spot-check",
  note: "سعر استرشادي قابل للتعديل حسب سعر السوبرماركت الفعلي"
});

export const SUPERMARKET_MASTER_CATALOG = Object.freeze([
  { masterId:"water-15l", name:"مياه شرب طبيعية 1.5 لتر", category:"مياه ومشروبات", size:"1.5 لتر", referencePrice:10.50, image:"" },
  { masterId:"water-600ml", name:"مياه معدنية 600 مل", category:"مياه ومشروبات", size:"600 مل", referencePrice:6.50, image:"" },
  { masterId:"cola-1l", name:"مشروب كولا حوالي 1 لتر", category:"مياه ومشروبات", size:"950 مل - 1 لتر", referencePrice:24.99, image:"" },
  { masterId:"cola-can", name:"مشروب غازي عبوة صغيرة", category:"مياه ومشروبات", size:"300 مل", referencePrice:11.99, image:"" },
  { masterId:"juice-1l", name:"عصير كلاسيك 1 لتر", category:"مياه ومشروبات", size:"1 لتر", referencePrice:37.99, image:"" },

  { masterId:"milk-1l", name:"لبن كامل الدسم 1 لتر", category:"ألبان", size:"1 لتر", referencePrice:44.50, image:"" },
  { masterId:"yogurt", name:"زبادي طبيعي", category:"ألبان", size:"180 جم", referencePrice:15.99, image:"" },
  { masterId:"white-cheese", name:"جبنة بيضاء", category:"ألبان", size:"250 جم", referencePrice:47.50, image:"" },
  { masterId:"eggs-12", name:"بيض أبيض", category:"ألبان", size:"30 بيضة", referencePrice:99.99, image:"" },

  { masterId:"sugar-1kg", name:"سكر أبيض 1 كجم", category:"بقالة", size:"1 كجم", referencePrice:27.50, image:"" },
  { masterId:"rice-1kg", name:"أرز أبيض مصري 1 كجم", category:"بقالة", size:"1 كجم", referencePrice:25.50, image:"" },
  { masterId:"pasta-400g", name:"مكرونة 400 جم", category:"بقالة", size:"400 جم", referencePrice:10.99, image:"" },
  { masterId:"oil-1l", name:"زيت عباد الشمس 1 لتر", category:"بقالة", size:"1 لتر", referencePrice:107.50, image:"" },
  { masterId:"tea", name:"شاي أسود", category:"بقالة", size:"100 جم", referencePrice:31.50, image:"" },
  { masterId:"coffee", name:"قهوة سريعة الذوبان", category:"بقالة", size:"100 جم", referencePrice:129.99, image:"" },

  { masterId:"chips", name:"سناكس / مقرمشات", category:"سناكس وحلويات", size:"70 جم تقريبًا", referencePrice:14.99, image:"" },
  { masterId:"biscuits", name:"بسكويت شاي", category:"سناكس وحلويات", size:"80 جم", referencePrice:19.99, image:"" },
  { masterId:"chocolate", name:"شوكولاتة / ويفر", category:"سناكس وحلويات", size:"قطعة صغيرة", referencePrice:9.99, image:"" },

  { masterId:"tissues", name:"مناديل ورقية", category:"منظفات ومنزل", size:"عبوة", referencePrice:33.50, image:"" },
  { masterId:"dish-soap", name:"سائل غسيل أطباق", category:"منظفات ومنزل", size:"4 لتر", referencePrice:99.99, image:"" },
  { masterId:"laundry-powder", name:"مسحوق غسيل", category:"منظفات ومنزل", size:"1 كجم", referencePrice:59.99, image:"" },

  { masterId:"soap", name:"صابون استحمام", category:"عناية شخصية", size:"4 قطع", referencePrice:54.99, image:"" },
  { masterId:"shampoo", name:"شامبو", category:"عناية شخصية", size:"180 مل", referencePrice:91.99, image:"" },
  { masterId:"toothpaste", name:"معجون أسنان", category:"عناية شخصية", size:"120 مل", referencePrice:48.50, image:"" }
]);

export const SUPERMARKET_CATEGORIES = Object.freeze(
  [...new Set(SUPERMARKET_MASTER_CATALOG.map(item => item.category))]
);

export function findMasterProduct(masterId) {
  return SUPERMARKET_MASTER_CATALOG.find(item => item.masterId === masterId) || null;
}
