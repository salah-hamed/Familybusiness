export const MASTER_PRICE_META = Object.freeze({
  currency: "EGP",
  priceAsOf: "2026-09-24",
  source: "Carrefour Egypt online spot-check",
  note: "أسعار استرشادية قابلة للتعديل وقد تختلف حسب المنطقة والعروض"
});

export const SUPERMARKET_MASTER_CATALOG = Object.freeze([
  { masterId:"water-aquafina-15l", name:"أكوافينا مياه طبيعية - 1.5 لتر", category:"مياه ومشروبات", size:"1.5 لتر", referencePrice:10.50, image:"" },
  { masterId:"pepsi-300ml", name:"بيبسي - 300 مل", category:"مياه ومشروبات", size:"300 مل", referencePrice:17.99, image:"" },
  { masterId:"cocacola-950ml", name:"كوكاكولا - 950 مل", category:"مياه ومشروبات", size:"950 مل", referencePrice:24.99, image:"" },
  { masterId:"juhayna-apple-1l", name:"جهينه كلاسيك عصير تفاح - 1 لتر", category:"مياه ومشروبات", size:"1 لتر", referencePrice:37.99, image:"" },

  { masterId:"beyti-milk-900ml", name:"بيتي لبن كامل الدسم - 900 مل", category:"ألبان", size:"900 مل", referencePrice:44.50, image:"" },
  { masterId:"juhayna-greek-yogurt-180g", name:"جهينه زبادي يوناني 2% دسم - 180 جم", category:"ألبان", size:"180 جم", referencePrice:40.99, image:"" },
  { masterId:"domty-feta-250g", name:"دومتي جبنة فيتا طبيعي - 250 جم", category:"ألبان", size:"250 جم", referencePrice:47.50, image:"" },
  { masterId:"royal-eggs-30", name:"رويال بيض أبيض - 30 بيضة", category:"ألبان", size:"30 بيضة", referencePrice:91.99, image:"" },

  { masterId:"aldoha-sugar-1kg", name:"الضحى سكر أبيض - 1 كجم", category:"بقالة", size:"1 كجم", referencePrice:34.99, image:"" },
  { masterId:"aldoha-rice-1kg", name:"الضحى أرز مصري - 1 كجم", category:"بقالة", size:"1 كجم", referencePrice:39.99, image:"" },
  { masterId:"regina-spaghetti-400g", name:"ريجينا مكرونة اسباجتي - 400 جم", category:"بقالة", size:"400 جم", referencePrice:30.99, image:"" },
  { masterId:"aldoha-pasta-400g", name:"الضحى مكرونة هلالية - 400 جم", category:"بقالة", size:"400 جم", referencePrice:25.99, image:"" },
  { masterId:"crystal-oil-1l", name:"كريستال زيت عباد الشمس - 1 لتر", category:"بقالة", size:"1 لتر", referencePrice:107.50, image:"" },
  { masterId:"lipton-tea-100g", name:"ليبتون شاي - 100 جم", category:"بقالة", size:"100 جم", referencePrice:31.50, image:"" },
  { masterId:"nescafe-classic-190g", name:"نسكافيه كلاسيك قهوة سريعة الذوبان - 190 جم", category:"بقالة", size:"190 جم", referencePrice:280.99, image:"" },

  { masterId:"chipsy-cheese-140g", name:"شيبسي رقائق بطاطس بالجبنة والبصل - 140 جم", category:"سناكس وحلويات", size:"140 جم", referencePrice:18.50, image:"" },
  { masterId:"balance-puffs-70g", name:"بالانس بروتين بافس بطعم الذرة الحلوة - 70 جم", category:"سناكس وحلويات", size:"70 جم", referencePrice:14.99, image:"" },
  { masterId:"katakito-wafer", name:"كتاكيتو إكسترا ويفر بالحليب - قطعة", category:"سناكس وحلويات", size:"قطعة", referencePrice:21.99, image:"" },

  { masterId:"fairy-lemon-620g", name:"فيري سائل غسيل أطباق برائحة الليمون - 620 جم", category:"منظفات ومنزل", size:"620 جم", referencePrice:109.99, image:"" },
  { masterId:"shiny-dish-4l", name:"شايني سائل غسيل أطباق بالليمون - 4 لتر", category:"منظفات ومنزل", size:"4 لتر", referencePrice:99.99, image:"" },
  { masterId:"persil-lavender-1kg", name:"برسيل مسحوق غسيل برائحة اللافندر - 1 كجم", category:"منظفات ومنزل", size:"1 كجم", referencePrice:78.50, image:"" },

  { masterId:"lux-soap-4x115g", name:"لوكس صابون - 115 جم × 4 قطع", category:"عناية شخصية", size:"4 قطع × 115 جم", referencePrice:102.50, image:"" },
  { masterId:"signal-anticavity-120ml", name:"سيجنال معجون أسنان مكافح للتسوس - 120 مل", category:"عناية شخصية", size:"120 مل", referencePrice:48.50, image:"" },
  { masterId:"closeup-100ml", name:"كلوس أب معجون أسنان بالمينتول الأخضر - 100 مل", category:"عناية شخصية", size:"100 مل", referencePrice:48.50, image:"" }
]);

export const LEGACY_MASTER_NAME_MAP = Object.freeze({
  "water-15l":"مياه معدنية 1.5 لتر",
  "water-600ml":"مياه معدنية 600 مل",
  "cola-1l":"مشروب كولا حوالي 1 لتر",
  "cola-can":"مشروب غازي عبوة صغيرة",
  "juice-1l":"عصير كلاسيك 1 لتر",
  "milk-1l":"لبن كامل الدسم 1 لتر",
  "yogurt":"زبادي طبيعي",
  "white-cheese":"جبنة بيضاء",
  "eggs-12":"بيض أبيض",
  "sugar-1kg":"سكر أبيض 1 كجم",
  "rice-1kg":"أرز أبيض مصري 1 كجم",
  "pasta-400g":"مكرونة 400 جم",
  "oil-1l":"زيت عباد الشمس 1 لتر",
  "tea":"شاي أسود",
  "coffee":"قهوة سريعة الذوبان",
  "chips":"سناكس / مقرمشات",
  "biscuits":"بسكويت شاي",
  "chocolate":"شوكولاتة / ويفر",
  "tissues":"مناديل ورقية",
  "dish-soap":"سائل غسيل أطباق",
  "laundry-powder":"مسحوق غسيل",
  "soap":"صابون استحمام",
  "shampoo":"شامبو",
  "toothpaste":"معجون أسنان"
});

export const SUPERMARKET_CATEGORIES = Object.freeze(
  [...new Set(SUPERMARKET_MASTER_CATALOG.map(item => item.category))]
);

export function findMasterProduct(masterId) {
  return SUPERMARKET_MASTER_CATALOG.find(item => item.masterId === masterId) || null;
}
