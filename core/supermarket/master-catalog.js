export const SUPERMARKET_MASTER_CATALOG = Object.freeze([
  { masterId:"water-15l", name:"مياه معدنية 1.5 لتر", category:"مياه ومشروبات", size:"1.5 لتر", image:"" },
  { masterId:"water-600ml", name:"مياه معدنية 600 مل", category:"مياه ومشروبات", size:"600 مل", image:"" },
  { masterId:"cola-1l", name:"مشروب كولا 1 لتر", category:"مياه ومشروبات", size:"1 لتر", image:"" },
  { masterId:"cola-can", name:"مشروب كولا كان", category:"مياه ومشروبات", size:"كان", image:"" },
  { masterId:"juice-1l", name:"عصير 1 لتر", category:"مياه ومشروبات", size:"1 لتر", image:"" },
  { masterId:"milk-1l", name:"لبن 1 لتر", category:"ألبان", size:"1 لتر", image:"" },
  { masterId:"yogurt", name:"زبادي", category:"ألبان", size:"عبوة", image:"" },
  { masterId:"white-cheese", name:"جبنة بيضاء", category:"ألبان", size:"عبوة", image:"" },
  { masterId:"eggs-12", name:"بيض 12 بيضة", category:"ألبان", size:"12 بيضة", image:"" },
  { masterId:"sugar-1kg", name:"سكر 1 كجم", category:"بقالة", size:"1 كجم", image:"" },
  { masterId:"rice-1kg", name:"أرز 1 كجم", category:"بقالة", size:"1 كجم", image:"" },
  { masterId:"pasta-400g", name:"مكرونة 400 جم", category:"بقالة", size:"400 جم", image:"" },
  { masterId:"oil-1l", name:"زيت 1 لتر", category:"بقالة", size:"1 لتر", image:"" },
  { masterId:"tea", name:"شاي", category:"بقالة", size:"عبوة", image:"" },
  { masterId:"coffee", name:"قهوة", category:"بقالة", size:"عبوة", image:"" },
  { masterId:"chips", name:"شيبسي", category:"سناكس وحلويات", size:"عبوة", image:"" },
  { masterId:"biscuits", name:"بسكويت", category:"سناكس وحلويات", size:"عبوة", image:"" },
  { masterId:"chocolate", name:"شوكولاتة", category:"سناكس وحلويات", size:"قطعة", image:"" },
  { masterId:"tissues", name:"مناديل ورقية", category:"منظفات ومنزل", size:"عبوة", image:"" },
  { masterId:"dish-soap", name:"سائل غسيل أطباق", category:"منظفات ومنزل", size:"عبوة", image:"" },
  { masterId:"laundry-powder", name:"مسحوق غسيل", category:"منظفات ومنزل", size:"عبوة", image:"" },
  { masterId:"soap", name:"صابون", category:"عناية شخصية", size:"قطعة", image:"" },
  { masterId:"shampoo", name:"شامبو", category:"عناية شخصية", size:"عبوة", image:"" },
  { masterId:"toothpaste", name:"معجون أسنان", category:"عناية شخصية", size:"عبوة", image:"" }
]);

export const SUPERMARKET_CATEGORIES = Object.freeze(
  [...new Set(SUPERMARKET_MASTER_CATALOG.map(item => item.category))]
);

export function findMasterProduct(masterId) {
  return SUPERMARKET_MASTER_CATALOG.find(item => item.masterId === masterId) || null;
}
