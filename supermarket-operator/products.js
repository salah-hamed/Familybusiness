import auth from "../core/firebase/firebase-auth.js";
import { claimOperatorAccess, getOperator, operatorCanOperate, buildOperatorAuthEmail } from "../core/partners/partner-service.js";
import { getCommissionAgreement } from "../core/commissions/commission-service.js";
import { getSupermarket } from "../core/supermarket/supermarket-service.js";
import { SUPERMARKET_MASTER_CATALOG, MASTER_PRICE_META, canonicalMasterId } from "../core/supermarket/master-catalog.js";
import {
  addStoreProduct,
  bulkAddMasterProducts,
  deleteStoreProduct,
  getStoreProduct,
  listStoreProducts,
  updateStoreProduct,
  findStoreProductByBarcode,
  bulkImportStoreProducts,
  mergeDuplicateStoreProducts,
  bulkUpdateStoreProducts,
  bulkDeleteStoreProducts,
  refreshSupermarketCatalogMeta
} from "../core/supermarket/catalog-service.js";
import {
  buildUnifiedCatalog,
  filterUnifiedCatalog,
  unifiedCatalogStats
} from "../core/supermarket/catalog-view-model.js";

import {
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const projectId = params.get("project") || "";
const inviteToken = params.get("invite") || "";
const inviteAuthEmail = buildOperatorAuthEmail(inviteToken);

let currentUser = null;
let operator = null;
let agreement = null;
let store = null;
let products = [];
let barcodeStream = null;
let renderLimit = 48;
let searchText = "";
let categoryFilter = "الكل";
let statusFilter = "الكل";
let imageFilter = "الكل";

const selectedMasterIds = new Set();
const selectedStoreIds = new Set();
const masterPriceDrafts = new Map();

function money(value) {
  return `${Number(value || 0).toLocaleString("ar-EG")} جنيه`;
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function categoryEmoji(category) {
  const value = String(category || "");
  if (/مياه|مشروبات|عصائر/.test(value)) return "🥤";
  if (/ألبان|بيض|جبن/.test(value)) return "🥛";
  if (/أرز|مكرونة|بقول|دقيق|سكر/.test(value)) return "🌾";
  if (/زيوت|سمن/.test(value)) return "🫗";
  if (/سناكس|بسكويت|شوكولاتة|حلويات/.test(value)) return "🍫";
  if (/منظفات|منزل|ورقيات/.test(value)) return "🧽";
  if (/عناية/.test(value)) return "🧴";
  if (/مجمدات/.test(value)) return "❄️";
  if (/لحوم|دواجن/.test(value)) return "🍗";
  if (/أسماك/.test(value)) return "🐟";
  if (/خضروات|فواكه/.test(value)) return "🥬";
  return "🛒";
}

function dashboardUrl() {
  const url = new URL("./", location.href);
  url.searchParams.set("project", projectId);
  if (inviteToken) url.searchParams.set("invite", inviteToken);
  return url.toString();
}

function setVisible(id, visible) {
  $(id).classList.toggle("hidden", !visible);
}

function normalizedProducts() {
  return products.map(product => ({
    ...product,
    masterId: canonicalMasterId(product.masterId)
  }));
}

function unifiedEntries() {
  return buildUnifiedCatalog(SUPERMARKET_MASTER_CATALOG, normalizedProducts());
}

function entryByMasterId(masterId) {
  return unifiedEntries().find(entry => entry.kind === "master" && entry.master.masterId === masterId) || null;
}

function filteredEntries() {
  return filterUnifiedCatalog(unifiedEntries(), {
    search: searchText,
    category: categoryFilter,
    status: statusFilter,
    image: imageFilter
  });
}

function imageMarkup(entry) {
  const fallback = categoryEmoji(entry.category);
  if (!entry.image) {
    return `<span class="catalogImageFallback">${fallback}</span>`;
  }

  return `<img src="${escapeHTML(entry.image)}" alt="" loading="lazy" data-image-fallback="${escapeHTML(fallback)}">`;
}

function attachImageFallbacks() {
  document.querySelectorAll(".catalogProductImage img").forEach(img => {
    img.addEventListener("error", () => {
      const span = document.createElement("span");
      span.className = "catalogImageFallback";
      span.textContent = img.dataset.imageFallback || "🛒";
      img.replaceWith(span);
    }, { once: true });
  });
}

async function authorize() {
  if (!currentUser || !projectId || !inviteAuthEmail) return false;

  try {
    await claimOperatorAccess(projectId, currentUser);
  } catch (error) {
    const code = String(error?.code || "");
    const message = String(error?.message || "");
    $("pageStatus").innerText =
      code.includes("permission-denied")
      || ["OPERATOR_ALREADY_CLAIMED","OPERATOR_INVITE_MISMATCH"].includes(message)
        ? "رابط الدخول ده اتلغى أو تم استبداله. اطلب رابط دخول جديد من صاحب المشروع."
        : `تعذر فتح الكتالوج: ${message || "UNKNOWN_ERROR"}`;
    return false;
  }

  [operator, agreement, store] = await Promise.all([
    getOperator(projectId),
    getCommissionAgreement(projectId),
    getSupermarket(projectId)
  ]);

  const canOperate =
    operatorCanOperate(operator)
    && agreement?.status === "accepted"
    && agreement?.currentAmount != null;

  if (!canOperate) {
    $("pageStatus").innerText = "كتالوج المنتجات يتفعل بعد تفعيل حساب السوبرماركت وقبول العمولة.";
    return false;
  }

  $("pageStatus").innerText = `${store?.name || operator?.name || "السوبرماركت"} — أضف وعدّل وفعّل المنتجات من كتالوج واحد.`;
  return true;
}

async function syncCatalogMeta() {
  const result = await refreshSupermarketCatalogMeta(projectId, products);
  store = {
    ...store,
    catalogCategories: result.categories,
    catalogProductCount: result.productCount
  };
}

async function loadProducts({ syncMeta = false } = {}) {
  products = await listStoreProducts(projectId);

  const validIds = new Set(products.map(product => product.productId));
  for (const id of [...selectedStoreIds]) {
    if (!validIds.has(id)) selectedStoreIds.delete(id);
  }

  if (syncMeta) {
    await syncCatalogMeta();
  }

  renderCatalog();
}

function sortLocalProducts(items = products) {
  return [...items].sort((a, b) =>
    String(a.name || "").localeCompare(String(b.name || ""), "ar")
  );
}

function upsertLocalProduct(product) {
  if (!product?.productId) return;
  const index = products.findIndex(item => item.productId === product.productId);
  if (index >= 0) products[index] = { ...products[index], ...product };
  else products.push(product);
}

function patchLocalProducts(productIds, patch = {}) {
  const ids = new Set(productIds || []);
  products = products.map(product =>
    ids.has(product.productId) ? { ...product, ...patch } : product
  );
}

function removeLocalProducts(productIds) {
  const ids = new Set(productIds || []);
  products = products.filter(product => !ids.has(product.productId));
  for (const id of ids) selectedStoreIds.delete(id);
}

async function refreshLocalCatalog({ syncMeta = false } = {}) {
  products = sortLocalProducts();

  if (syncMeta) {
    await syncCatalogMeta();
  }

  renderCatalog();
}

function refreshCategoryOptions(entries) {
  const categories = [...new Set(entries.map(entry => entry.category).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "ar"));

  const select = $("catalogCategoryFilter");
  const previous = categoryFilter;
  select.innerHTML = '<option value="الكل">كل التصنيفات</option>'
    + categories.map(value => `<option value="${escapeHTML(value)}">${escapeHTML(value)}</option>`).join("");

  if (previous === "الكل" || categories.includes(previous)) {
    select.value = previous;
  } else {
    categoryFilter = "الكل";
    select.value = "الكل";
  }
}

function renderStats(entries) {
  const stats = unifiedCatalogStats(entries);
  $("statTotal").innerText = stats.total;
  $("statActive").innerText = stats.active;
  $("statPaused").innerText = stats.paused;
  $("statNotAdded").innerText = stats.not_added;
  $("statWithoutImage").innerText = stats.withoutImage;

  document.querySelectorAll("[data-status-filter]").forEach(btn => {
    btn.classList.toggle("isActive", btn.dataset.statusFilter === statusFilter);
  });
  document.querySelectorAll("[data-image-filter]").forEach(btn => {
    btn.classList.toggle("isActive", btn.dataset.imageFilter === imageFilter);
  });
}

function pruneSelections(entries) {
  const masterIds = new Set(entries.filter(entry => entry.kind === "master" && !entry.added).map(entry => entry.master.masterId));
  const storeIds = new Set(entries.filter(entry => entry.added && entry.product?.productId).map(entry => entry.product.productId));

  for (const id of [...selectedMasterIds]) {
    if (!masterIds.has(id)) selectedMasterIds.delete(id);
  }
  for (const id of [...selectedStoreIds]) {
    if (!storeIds.has(id)) selectedStoreIds.delete(id);
  }
}

function refreshSelectionBar() {
  const total = selectedMasterIds.size + selectedStoreIds.size;
  $("catalogSelectionCount").innerText = total
    ? `${total} محدد · ${selectedMasterIds.size} غير مضاف · ${selectedStoreIds.size} من المتجر`
    : "0 محدد";

  $("addSelectedBtn").disabled = selectedMasterIds.size === 0;
  ["bulkActivateBtn", "bulkPauseBtn", "bulkCategoryBtn", "bulkDeleteBtn"]
    .forEach(id => $(id).disabled = selectedStoreIds.size === 0);
}

function masterDraftPrice(master) {
  if (!masterPriceDrafts.has(master.masterId)) {
    masterPriceDrafts.set(master.masterId, Number(master.referencePrice || 0));
  }
  return masterPriceDrafts.get(master.masterId);
}

function renderNotAddedControls(entry) {
  const master = entry.master;
  const price = masterDraftPrice(master);

  return `
    <div class="catalogPriceBlock">
      <small>سعر استرشادي: <b>${money(master.referencePrice)}</b></small>
      <label>سعر متجرك
        <input class="catalogPriceInput" data-master-price="${escapeHTML(master.masterId)}" type="number" min="0" step="0.25" value="${Number(price || 0)}">
      </label>
    </div>
    <button class="primary addCatalogProduct" data-master-add="${escapeHTML(master.masterId)}" type="button">+ إضافة للمتجر</button>
  `;
}

function renderAddedControls(entry) {
  const product = entry.product;
  const active = entry.status === "active";

  return `
    <div class="catalogQuickEdit">
      <label>السعر
        <input class="quickPrice" type="number" min="0" step="0.25" value="${Number(product.price || 0)}">
      </label>
      <button class="primary saveQuickPrice" type="button">حفظ السعر</button>
      <button class="secondary toggleCatalogProduct" type="button">${active ? "إيقاف" : "إعادة التفعيل"}</button>
    </div>

    <details class="catalogAdvanced">
      <summary>تعديل التفاصيل</summary>
      <div class="productEditGrid">
        <label>اسم المنتج<input class="editName" value="${escapeHTML(product.name || "")}"></label>
        <label>التصنيف<input class="editCategory" value="${escapeHTML(product.category || "أخرى")}"></label>
        <label>الحجم<input class="editSize" value="${escapeHTML(product.size || "")}"></label>
        <label>رابط الصورة<input class="editImage" value="${escapeHTML(product.image || "")}" placeholder="https://..."></label>
      </div>
      <div class="productControls">
        <button class="primary saveProductDetails" type="button">حفظ التفاصيل</button>
        <button class="danger deleteCatalogProduct" type="button">حذف من المتجر</button>
      </div>
    </details>
  `;
}

function renderEntry(entry) {
  const isMasterNotAdded = entry.kind === "master" && !entry.added;
  const selectType = isMasterNotAdded ? "master" : "store";
  const selectId = isMasterNotAdded ? entry.master.masterId : entry.product.productId;
  const selected = isMasterNotAdded
    ? selectedMasterIds.has(selectId)
    : selectedStoreIds.has(selectId);

  const statusLabel = entry.status === "not_added"
    ? "غير مضاف"
    : entry.status === "active"
      ? "متاح للعملاء"
      : "متوقف";

  const sourceLabel = entry.kind === "master"
    ? "مكتبة Family Business"
    : entry.source === "import"
      ? "Excel / CSV"
      : "منتج خاص بالمتجر";

  return `
    <article class="catalogProductCard status-${entry.status}" data-entry-key="${escapeHTML(entry.key)}" data-product-id="${escapeHTML(entry.product?.productId || "")}">
      <div class="catalogCardTop">
        <label class="catalogSelectBox" title="تحديد">
          <input type="checkbox" data-select-type="${selectType}" data-select-id="${escapeHTML(selectId)}" ${selected ? "checked" : ""}>
        </label>
        <div class="catalogProductImage">${imageMarkup(entry)}</div>
        <div class="catalogProductIdentity">
          <div class="catalogBadges">
            <span class="sourceBadge">${escapeHTML(sourceLabel)}</span>
            <span class="statusBadge status-${entry.status}">${statusLabel}</span>
          </div>
          <h3>${escapeHTML(entry.name)}</h3>
          <p>${escapeHTML(entry.category)}${entry.size ? ` · ${escapeHTML(entry.size)}` : ""}</p>
          ${entry.brand ? `<small>${escapeHTML(entry.brand)}</small>` : ""}
        </div>
      </div>

      ${isMasterNotAdded ? renderNotAddedControls(entry) : renderAddedControls(entry)}
    </article>
  `;
}

function bindCatalogCardEvents(visibleEntries) {
  const byKey = new Map(visibleEntries.map(entry => [entry.key, entry]));

  document.querySelectorAll("[data-select-type]").forEach(input => {
    input.onchange = () => {
      const set = input.dataset.selectType === "master" ? selectedMasterIds : selectedStoreIds;
      if (input.checked) set.add(input.dataset.selectId);
      else set.delete(input.dataset.selectId);
      refreshSelectionBar();
    };
  });

  document.querySelectorAll("[data-master-price]").forEach(input => {
    input.oninput = () => {
      masterPriceDrafts.set(input.dataset.masterPrice, Number(input.value || 0));
    };
  });

  document.querySelectorAll("[data-master-add]").forEach(btn => {
    btn.onclick = async () => {
      const masterId = btn.dataset.masterAdd;
      const entry = entryByMasterId(masterId);
      if (!entry?.master) return;

      btn.disabled = true;
      $("catalogMessage").innerText = "جاري إضافة المنتج...";

      try {
        const productId = await addStoreProduct(projectId, currentUser.uid, {
          masterId,
          name: entry.master.name,
          category: entry.master.category,
          size: entry.master.size,
          image: entry.image,
          price: masterDraftPrice(entry.master)
        });
        const addedProduct = await getStoreProduct(projectId, productId);
        if (addedProduct) upsertLocalProduct(addedProduct);
        selectedMasterIds.delete(masterId);
        await refreshLocalCatalog({ syncMeta: true });
        $("catalogMessage").innerText = `تمت إضافة ${entry.master.name} ✅`;
      } catch (error) {
        $("catalogMessage").innerText = error.message === "PRODUCT_ALREADY_EXISTS"
          ? "المنتج موجود بالفعل في متجرك."
          : `تعذر الإضافة: ${error.message}`;
        btn.disabled = false;
      }
    };
  });

  document.querySelectorAll(".catalogProductCard[data-product-id]").forEach(card => {
    const productId = card.dataset.productId;
    if (!productId) return;

    const entry = byKey.get(card.dataset.entryKey);
    const product = entry?.product;
    if (!product) return;

    const quickSave = card.querySelector(".saveQuickPrice");
    if (quickSave) {
      quickSave.onclick = async () => {
        quickSave.disabled = true;
        try {
          const nextPrice = Number(card.querySelector(".quickPrice").value || 0);
          await updateStoreProduct(projectId, productId, currentUser.uid, {
            price: nextPrice
          });
          patchLocalProducts([productId], { price: Math.round(nextPrice * 100) / 100 });
          await refreshLocalCatalog();
          $("catalogMessage").innerText = `تم تحديث سعر ${product.name} ✅`;
        } catch (error) {
          $("catalogMessage").innerText = `تعذر حفظ السعر: ${error.message}`;
          quickSave.disabled = false;
        }
      };
    }

    const toggle = card.querySelector(".toggleCatalogProduct");
    if (toggle) {
      toggle.onclick = async () => {
        const nextActive = !(product.isActive === true && product.inStock === true);
        toggle.disabled = true;
        try {
          await updateStoreProduct(projectId, productId, currentUser.uid, {
            isActive: nextActive,
            inStock: nextActive
          });
          patchLocalProducts([productId], {
            isActive: nextActive,
            inStock: nextActive
          });
          await refreshLocalCatalog({ syncMeta: true });
          $("catalogMessage").innerText = nextActive ? "تم تفعيل المنتج ✅" : "تم إيقاف المنتج مؤقتًا.";
        } catch (error) {
          $("catalogMessage").innerText = `تعذر تغيير الحالة: ${error.message}`;
          toggle.disabled = false;
        }
      };
    }

    const saveDetails = card.querySelector(".saveProductDetails");
    if (saveDetails) {
      saveDetails.onclick = async () => {
        saveDetails.disabled = true;
        try {
          const patch = {
            name: card.querySelector(".editName").value.trim(),
            category: card.querySelector(".editCategory").value.trim(),
            size: card.querySelector(".editSize").value.trim(),
            image: card.querySelector(".editImage").value.trim()
          };
          await updateStoreProduct(projectId, productId, currentUser.uid, patch);
          patchLocalProducts([productId], patch);
          await refreshLocalCatalog({ syncMeta: true });
          $("catalogMessage").innerText = "تم حفظ بيانات المنتج ✅";
        } catch (error) {
          $("catalogMessage").innerText = `تعذر حفظ البيانات: ${error.message}`;
          saveDetails.disabled = false;
        }
      };
    }

    const remove = card.querySelector(".deleteCatalogProduct");
    if (remove) {
      remove.onclick = async () => {
        if (!confirm(`حذف "${product.name}" من متجرك؟`)) return;
        try {
          await deleteStoreProduct(projectId, productId);
          removeLocalProducts([productId]);
          await refreshLocalCatalog({ syncMeta: true });
          $("catalogMessage").innerText = "تم حذف المنتج من المتجر.";
        } catch (error) {
          $("catalogMessage").innerText = `تعذر الحذف: ${error.message}`;
        }
      };
    }
  });

  attachImageFallbacks();
}

function renderCatalog() {
  const entries = unifiedEntries();
  pruneSelections(entries);
  refreshCategoryOptions(entries);
  renderStats(entries);

  const filtered = filteredEntries();
  const visible = filtered.slice(0, renderLimit);

  $("catalogVisibleCount").innerText = filtered.length === entries.length
    ? `${entries.length} منتج`
    : `${filtered.length} نتيجة من ${entries.length}`;

  $("unifiedCatalog").innerHTML = visible.length
    ? visible.map(renderEntry).join("")
    : '<p class="muted emptyCatalog">لا توجد منتجات مطابقة للفلاتر الحالية.</p>';

  $("loadMoreCatalogBtn").classList.toggle("hidden", visible.length >= filtered.length);
  refreshSelectionBar();
  bindCatalogCardEvents(visible);
}

function resetCatalogWindow() {
  renderLimit = 48;
  renderCatalog();
}

$("catalogSearch").addEventListener("input", event => {
  searchText = event.target.value;
  resetCatalogWindow();
});

$("catalogCategoryFilter").addEventListener("change", event => {
  categoryFilter = event.target.value;
  resetCatalogWindow();
});

$("catalogStatusFilter").addEventListener("change", event => {
  statusFilter = event.target.value;
  resetCatalogWindow();
});

$("catalogImageFilter").addEventListener("change", event => {
  imageFilter = event.target.value;
  resetCatalogWindow();
});

document.querySelectorAll("[data-status-filter]").forEach(btn => {
  btn.onclick = () => {
    statusFilter = btn.dataset.statusFilter;
    $("catalogStatusFilter").value = statusFilter;
    resetCatalogWindow();
  };
});

document.querySelectorAll("[data-image-filter]").forEach(btn => {
  btn.onclick = () => {
    imageFilter = btn.dataset.imageFilter;
    $("catalogImageFilter").value = imageFilter;
    resetCatalogWindow();
  };
});

$("loadMoreCatalogBtn").onclick = () => {
  renderLimit += 48;
  renderCatalog();
};

$("selectVisibleBtn").onclick = () => {
  filteredEntries().slice(0, renderLimit).forEach(entry => {
    if (entry.kind === "master" && !entry.added) selectedMasterIds.add(entry.master.masterId);
    else if (entry.product?.productId) selectedStoreIds.add(entry.product.productId);
  });
  renderCatalog();
};

$("clearSelectionBtn").onclick = () => {
  selectedMasterIds.clear();
  selectedStoreIds.clear();
  renderCatalog();
};

$("addSelectedBtn").onclick = async () => {
  if (!selectedMasterIds.size) return;

  const selections = [...selectedMasterIds]
    .map(masterId => entryByMasterId(masterId))
    .filter(entry => entry?.master)
    .map(entry => ({
      masterId: entry.master.masterId,
      price: masterDraftPrice(entry.master),
      image: entry.image
    }));

  $("addSelectedBtn").disabled = true;
  $("catalogMessage").innerText = `جاري إضافة ${selections.length} منتج...`;

  try {
    const result = await bulkAddMasterProducts(projectId, currentUser.uid, selections);
    (result.addedProducts || []).forEach(upsertLocalProduct);
    selectedMasterIds.clear();
    await refreshLocalCatalog({ syncMeta: true });
    $("catalogMessage").innerText = `تمت إضافة ${result.added} منتج ✅${result.skipped ? ` — تم تخطي ${result.skipped} موجود بالفعل` : ""}`;
  } catch (error) {
    $("catalogMessage").innerText = `تعذر الإضافة الجماعية: ${error.message}`;
    $("addSelectedBtn").disabled = false;
  }
};

$("bulkActivateBtn").onclick = async () => {
  if (!selectedStoreIds.size) return;
  try {
    const ids = [...selectedStoreIds];
    await bulkUpdateStoreProducts(projectId, ids, currentUser.uid, {
      isActive: true,
      inStock: true
    });
    patchLocalProducts(ids, { isActive: true, inStock: true });
    selectedStoreIds.clear();
    await refreshLocalCatalog({ syncMeta: true });
    $("catalogMessage").innerText = "تم تفعيل المنتجات المحددة ✅";
  } catch (error) {
    $("catalogMessage").innerText = `تعذر التفعيل: ${error.message}`;
  }
};

$("bulkPauseBtn").onclick = async () => {
  if (!selectedStoreIds.size) return;
  try {
    const ids = [...selectedStoreIds];
    await bulkUpdateStoreProducts(projectId, ids, currentUser.uid, {
      isActive: false,
      inStock: false
    });
    patchLocalProducts(ids, { isActive: false, inStock: false });
    selectedStoreIds.clear();
    await refreshLocalCatalog({ syncMeta: true });
    $("catalogMessage").innerText = "تم إيقاف المنتجات المحددة.";
  } catch (error) {
    $("catalogMessage").innerText = `تعذر الإيقاف: ${error.message}`;
  }
};

$("bulkCategoryBtn").onclick = async () => {
  if (!selectedStoreIds.size) return;
  const category = prompt("اكتب التصنيف الجديد للمنتجات المحددة:");
  if (!category?.trim()) return;

  try {
    const ids = [...selectedStoreIds];
    const nextCategory = category.trim();
    await bulkUpdateStoreProducts(projectId, ids, currentUser.uid, { category: nextCategory });
    patchLocalProducts(ids, { category: nextCategory });
    selectedStoreIds.clear();
    await refreshLocalCatalog({ syncMeta: true });
    $("catalogMessage").innerText = "تم تغيير التصنيف ✅";
  } catch (error) {
    $("catalogMessage").innerText = `تعذر تغيير التصنيف: ${error.message}`;
  }
};

$("bulkDeleteBtn").onclick = async () => {
  if (!selectedStoreIds.size) return;
  if (!confirm(`حذف ${selectedStoreIds.size} منتج من المتجر؟`)) return;

  try {
    const ids = [...selectedStoreIds];
    await bulkDeleteStoreProducts(projectId, ids);
    removeLocalProducts(ids);
    selectedStoreIds.clear();
    await refreshLocalCatalog({ syncMeta: true });
    $("catalogMessage").innerText = "تم حذف المنتجات المحددة من المتجر.";
  } catch (error) {
    $("catalogMessage").innerText = `تعذر الحذف: ${error.message}`;
  }
};

$("addProductBtn").onclick = async () => {
  $("productMessage").innerText = "جاري الإضافة...";
  try {
    const productId = await addStoreProduct(projectId, currentUser.uid, {
      name: $("productName").value,
      category: $("productCategory").value,
      price: $("productPrice").value,
      barcode: $("productBarcode").value,
      size: $("productSize").value,
      image: $("productImage").value
    });
    const addedProduct = await getStoreProduct(projectId, productId);
    if (addedProduct) upsertLocalProduct(addedProduct);

    ["productName", "productCategory", "productPrice", "productBarcode", "productSize", "productImage"]
      .forEach(id => $(id).value = "");

    await refreshLocalCatalog({ syncMeta: true });
    $("productMessage").innerText = "تمت إضافة المنتج داخل نفس الكتالوج ✅";
  } catch (error) {
    $("productMessage").innerText = error.message === "PRODUCT_ALREADY_EXISTS"
      ? "المنتج موجود بالفعل بنفس الاسم والحجم."
      : `تعذر الإضافة: ${error.message}`;
  }
};

async function scanBarcode() {
  const Detector = window.BarcodeDetector;

  if (!Detector || !navigator.mediaDevices?.getUserMedia) {
    const manual = prompt("ميزة الكاميرا غير متاحة على الجهاز. اكتب الباركود:");
    if (manual) $("productBarcode").value = manual;
    return;
  }

  try {
    const detector = new Detector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128"] });
    barcodeStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });

    const video = $("barcodeVideo");
    video.srcObject = barcodeStream;
    video.classList.remove("hidden");
    await video.play();

    const started = Date.now();

    const detect = async () => {
      if (!barcodeStream) return;
      const codes = await detector.detect(video);

      if (codes.length) {
        const value = codes[0].rawValue;
        $("productBarcode").value = value;
        stopBarcode();

        const existing = await findStoreProductByBarcode(projectId, value);
        $("productMessage").innerText = existing
          ? `الباركود موجود بالفعل: ${existing.name}`
          : "تم قراءة الباركود.";
        return;
      }

      if (Date.now() - started > 15000) {
        stopBarcode();
        $("productMessage").innerText = "لم يتم التقاط باركود. تقدر تكمل بدونه.";
        return;
      }

      setTimeout(detect, 350);
    };

    detect();
  } catch (error) {
    stopBarcode();
    $("productMessage").innerText = `تعذر تشغيل الكاميرا: ${error.message}`;
  }
}

function stopBarcode() {
  if (barcodeStream) {
    barcodeStream.getTracks().forEach(track => track.stop());
    barcodeStream = null;
  }
  $("barcodeVideo").classList.add("hidden");
}

$("scanBarcodeBtn").onclick = scanBarcode;

function normalizeImportHeader(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function findImportHeaderRow(rows) {
  const nameAliases = new Set(["name", "product", "اسم المنتج", "المنتج", "اسم الصنف"]);
  const priceAliases = new Set(["price", "السعر", "السعر (ج.م)", "سعر", "السعر بالجنيه"]);

  return rows.findIndex(row => {
    const headers = (Array.isArray(row) ? row : []).map(normalizeImportHeader);
    return headers.some(value => nameAliases.has(value))
      && headers.some(value => priceAliases.has(value));
  });
}

function imageValueFromCell(cell, fallback = "") {
  const direct = String(fallback ?? "").trim();
  if (/^https?:\/\//i.test(direct)) return direct;

  const hyperlink = String(cell?.l?.Target || "").trim();
  if (/^https?:\/\//i.test(hyperlink)) return hyperlink;

  const formula = String(cell?.f || "").trim();
  const match = formula.match(/^IMAGE\(\s*"([^"]+)"/i);
  if (match && /^https?:\/\//i.test(match[1])) return match[1];

  return direct;
}

function worksheetToImportRows(worksheet) {
  const matrix = window.XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: "",
    raw: true
  });

  if (!matrix.length) return [];

  const headerIndex = findImportHeaderRow(matrix);
  if (headerIndex < 0) throw new Error("IMPORT_HEADERS_NOT_FOUND");

  const headers = matrix[headerIndex].map(value => String(value ?? "").trim());
  const imageAliases = new Set(["image", "الصورة", "رابط الصورة"]);

  return matrix
    .slice(headerIndex + 1)
    .map((row, offset) => {
      const actualRow = headerIndex + 1 + offset;
      return Object.fromEntries(headers.map((header, columnIndex) => {
        const fallback = row?.[columnIndex] ?? "";
        if (!imageAliases.has(normalizeImportHeader(header))) {
          return [header, fallback];
        }

        const address = window.XLSX.utils.encode_cell({ r: actualRow, c: columnIndex });
        return [header, imageValueFromCell(worksheet[address], fallback)];
      }));
    })
    .filter(row => Object.values(row).some(value => String(value ?? "").trim() !== ""));
}

async function parseImportFile(file) {
  if (!window.XLSX) throw new Error("XLSX_LIBRARY_NOT_READY");

  const ext = file.name.split(".").pop().toLowerCase();
  let workbook;

  if (ext === "csv") {
    const text = await file.text();
    workbook = window.XLSX.read(text, { type: "string" });
  } else {
    const data = await file.arrayBuffer();
    workbook = window.XLSX.read(data, { type: "array", cellFormula: true, cellHTML: false });
  }

  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  return worksheetToImportRows(worksheet);
}

$("importBtn").onclick = async () => {
  const file = $("importFile").files[0];
  if (!file) {
    $("importMessage").innerText = "اختار ملف الأول.";
    return;
  }

  $("importMessage").innerText = "جاري الاستيراد وربط الصور والمنتجات...";

  try {
    const rows = await parseImportFile(file);
    const result = await bulkImportStoreProducts(projectId, currentUser.uid, rows);
    products = Array.isArray(result.products) ? result.products : products;
    await refreshLocalCatalog({ syncMeta: true });

    $("importMessage").innerText =
      `تمت معالجة ${result.imported} منتج ✅ — جديد: ${result.added} — موجود وتم إثراؤه: ${result.updated}. لو الصور داخل Excel كرسومات مضمّنة وليست روابط فلن يستطيع المتصفح استخراجها.`;
  } catch (error) {
    $("importMessage").innerText = `فشل الاستيراد: ${error.message}`;
  }
};

$("mergeDuplicatesBtn").onclick = async () => {
  $("mergeDuplicatesBtn").disabled = true;
  $("duplicateMessage").innerText = "جاري فحص المنتجات بالاسم والحجم...";

  try {
    const result = await mergeDuplicateStoreProducts(projectId, currentUser.uid);
    products = Array.isArray(result.products) ? result.products : products;
    await refreshLocalCatalog({ syncMeta: true });

    $("duplicateMessage").innerText = result.groups
      ? `تم الدمج ✅ ${result.groups} مجموعة — حذف ${result.removed} نسخة زائدة — إثراء ${result.enriched} منتج.`
      : "تم الفحص ✅ لم نجد تكرارات مؤكدة.";
  } catch (error) {
    $("duplicateMessage").innerText = `تعذر الفحص: ${error.message}`;
  } finally {
    $("mergeDuplicatesBtn").disabled = false;
  }
};

onAuthStateChanged(auth, async user => {
  currentUser = user;
  $("backToDashboard").href = dashboardUrl();

  if (!projectId || !inviteAuthEmail) {
    $("pageStatus").innerText = "رابط كتالوج المنتجات غير مكتمل.";
    return;
  }

  if (user && String(user.email || "").toLowerCase() !== inviteAuthEmail.toLowerCase()) {
    await signOut(auth);
    return;
  }

  if (!user) {
    $("pageStatus").innerText = "سجل دخولك من لوحة تشغيل السوبرماركت أولًا ثم افتح الكتالوج.";
    return;
  }

  if (!await authorize()) return;

  setVisible("productsPanel", true);
  $("masterPriceMeta").innerText =
    `${MASTER_PRICE_META.source} — تحديث ${MASTER_PRICE_META.priceAsOf}. الأسعار استرشادية ويمكن تعديلها قبل أو بعد الإضافة.`;

  try {
    await loadProducts({ syncMeta: true });
  } catch (error) {
    $("catalogMessage").innerText = `تعذر تحميل الكتالوج: ${error.message}`;
  }
});
