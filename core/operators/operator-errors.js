function text(value){
  return String(value || "").trim();
}

export function friendlyOperatorError(error, fallback = "تعذر تنفيذ الإجراء. حاول مرة أخرى.") {
  const code = text(error?.code).toLowerCase();
  const message = text(error?.message);
  const upper = message.toUpperCase();

  if (
    upper === "OPERATOR_ALREADY_CLAIMED"
    || upper === "OPERATOR_INVITE_MISMATCH"
    || upper === "OPERATOR_INVITE_EXPIRED"
  ) {
    return "رابط الدخول ده اتلغى أو تم استبداله. اطلب رابط دخول جديد من صاحب المشروع.";
  }

  if (code.includes("auth/weak-password")) {
    return "كلمة المرور لازم تكون 6 أحرف على الأقل.";
  }
  if (code.includes("auth/too-many-requests")) {
    return "في محاولات دخول كثيرة. حاول مرة أخرى بعد قليل.";
  }
  if (code.includes("auth/network-request-failed") || code.includes("unavailable")) {
    return "تعذر الاتصال بالمنصة. تأكد من الإنترنت وحاول مرة أخرى.";
  }
  if (code.includes("permission-denied")) {
    return "هذه الخطوة غير متاحة حاليًا بإعدادات المنصة الحالية. حدّث الصفحة، وإذا استمرت المشكلة تواصل مع إدارة المنصة.";
  }
  if (code.includes("failed-precondition") && message.toLowerCase().includes("index")) {
    return "هذه الشاشة تحتاج تحديث إعدادات البحث بالمنصة قبل استخدامها.";
  }

  const exact = {
    ORDER_NOT_FOUND: "الطلب غير موجود أو لم يعد متاحًا. حدّث قائمة الطلبات.",
    ORDER_PROJECT_MISMATCH: "الطلب لا يخص هذا المشروع.",
    INVALID_STATUS_TRANSITION: "حالة الطلب تغيّرت بالفعل. حدّث الطلبات وحاول من الحالة الحالية.",
    INVALID_LAUNDRY_TRANSITION: "مرحلة الطلب تغيّرت بالفعل. حدّث الطلبات وحاول مرة أخرى.",
    RIDER_REQUIRED_BEFORE_ASSIGNMENT: "اختار مندوب التوصيل أولًا.",
    RIDER_REQUIRED_BEFORE_DELIVERY: "لا يمكن تأكيد التوصيل قبل تعيين المندوب.",
    PICKUP_AGENT_REQUIRED: "اختار مندوب الاستلام أولًا.",
    DELIVERY_AGENT_REQUIRED: "اختار مندوب التوصيل أولًا.",
    ORDER_NOT_READY_FOR_DELIVERY_ASSIGNMENT: "الطلب ليس جاهزًا للتوصيل حاليًا. حدّث الطلبات وراجع مرحلته.",
    COMMISSION_AGREEMENT_NOT_ACTIVE: "اتفاق العمولة غير نشط حاليًا. راجع الاتفاق قبل إرسال الطلب للتوصيل.",
    AGREEMENT_NOT_FOUND: "اتفاق العمولة غير متاح حاليًا. راجع إعداد المشروع.",
    PRODUCT_ALREADY_EXISTS: "المنتج موجود بالفعل في منتجات السوبرماركت.",
    MENU_ITEM_NAME_REQUIRED: "اكتب اسم الصنف أولًا.",
    INVALID_MENU_PRICE: "راجع سعر الصنف وتأكد أنه رقم صحيح غير سالب.",
    REVERSAL_ALREADY_EXISTS: "تم إرسال طلب عكس العمولة لهذا الأوردر بالفعل.",
    REVERSAL_EXCEEDS_OUTSTANDING: "لا يمكن عكس العمولة لأن الرصيد المستحق الحالي أقل من قيمة العمولة."
  };

  return exact[upper] || fallback;
}
