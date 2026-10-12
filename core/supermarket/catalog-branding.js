// Presentation-only catalog branding compatibility. Do not modify stored
// product IDs, source image URLs, customer links, or historical order records.
const RETIRED_RETAILER = /carrefour|كارفور/gi;

export function neutralCatalogProductName(value = "") {
  const original = String(value ?? "");
  RETIRED_RETAILER.lastIndex = 0;
  if (!RETIRED_RETAILER.test(original)) return original;
  RETIRED_RETAILER.lastIndex = 0;
  return original.replace(RETIRED_RETAILER, " ").replace(/\s+/g, " ").trim() || "منتج";
}
