import { PLATFORM_BILLING, formatEgp } from "../config/platform-config.js";

function step(id, title, description, status, options = {}) {
  return {
    id,
    title,
    description,
    status,
    selector: options.selector || "",
    href: options.href || "",
    actionLabel: options.actionLabel || ""
  };
}

export function buildMarketingGuide() {
  return {
    id: "platform-intro",
    title: "رحلتك مع Family Business",
    intro: "المنصة هتمشي معاك من إنشاء الحساب لحد تشغيل مشروعك ومشاركة رابط العملاء.",
    steps: [
      step(
        "understand",
        "اعرف الفكرة بسرعة",
        "اشتراك واحد يفتح لك المشاريع المتاحة، وكل مشروع له لوحة تشغيل ورابط عملاء مستقل.",
        "current",
        { selector: "#how-it-works", actionLabel: "ورّيني طريقة العمل" }
      ),
      step(
        "register",
        "أنشئ حسابك",
        "سجّل اسمك وبريدك وكلمة المرور. الحساب الواحد يدير كل مشاريعك.",
        "pending",
        { href: "../", actionLabel: "ابدأ التسجيل" }
      ),
      step(
        "activate",
        "ادفع وفعّل الاشتراك",
        `أول تفعيل حاليًا ${formatEgp(PLATFORM_BILLING.initialActivationFee)}، وبعد مراجعة الدفع يتفعّل حسابك.`,
        "pending",
        { selector: "#pricing", actionLabel: "شوف تفاصيل الاشتراك" }
      ),
      step(
        "launch",
        "اختار مشروعك وشغّله",
        "بعد التفعيل اختار مشروع، اربط جهة التشغيل، وبعد جاهزيته شارك رابط العملاء.",
        "pending",
        { selector: "#projects", actionLabel: "شوف المشاريع" }
      )
    ]
  };
}

export function buildAuthGuide({ mode = "register" } = {}) {
  if (mode === "registered") {
    return {
      id: "account-start",
      title: "حسابك اتعمل — نكمل",
      intro: "دلوقتي هننقلك لمرحلة الدفع والتفعيل، وبعدها اختيار أول مشروع.",
      steps: [
        step("account", "إنشاء الحساب", "تم إنشاء حسابك بنجاح.", "done"),
        step(
          "payment",
          "الدفع وإثبات التحويل",
          `قيمة أول تفعيل ${formatEgp(PLATFORM_BILLING.initialActivationFee)}. تابع من مساحة العمل تعليمات الدفع وحالة المراجعة.`,
          "current",
          { href: "./workspace/", actionLabel: "افتح مساحة العمل" }
        ),
        step("activation", "تفعيل الحساب", "بعد مراجعة الدفع هتظهر حالة اشتراكك كمفعّل.", "pending"),
        step("project", "إنشاء أول مشروع", "بعد التفعيل هنوجّهك لاختيار أول مشروع.", "pending")
      ]
    };
  }

  if (mode === "login") {
    return {
      id: "account-login",
      title: "مرحبًا بعودتك",
      intro: "سجّل الدخول، والمنصة هتحدد تلقائيًا أنت وصلت لفين وإيه الخطوة الجاية.",
      steps: [
        step(
          "login",
          "سجّل الدخول",
          "اكتب البريد الإلكتروني وكلمة المرور ثم اضغط تسجيل الدخول.",
          "current",
          { selector: "#registerBtn", actionLabel: "روح لزر الدخول" }
        ),
        step("resume", "كمّل من مكانك", "بعد الدخول هنقرأ حالة اشتراكك ومشاريعك ونوجّهك للخطوة التالية.", "pending")
      ]
    };
  }

  return {
    id: "account-register",
    title: "نبدأ حسابك",
    intro: "هنمشي خطوة خطوة. دلوقتي المطلوب منك إنشاء الحساب فقط.",
    steps: [
      step(
        "register",
        "اكتب بيانات الحساب",
        "اكتب الاسم والبريد وكلمة المرور وتأكيدها، ثم اضغط «امتلك شركتك».",
        "current",
        { selector: "#registerBtn", actionLabel: "روح لزر إنشاء الحساب" }
      ),
      step(
        "payment",
        "الدفع والتفعيل",
        `بعد التسجيل هتتابع أول تفعيل بقيمة ${formatEgp(PLATFORM_BILLING.initialActivationFee)} ومراجعة التحويل.`,
        "pending"
      ),
      step("project", "اختار أول مشروع", "بعد التفعيل هتدخل مساحة العمل وتبدأ أول مشروع.", "pending")
    ]
  };
}

export function buildWorkspaceGuide({
  loading = false,
  userData = {},
  projects = [],
  subscriptionActive = false
} = {}) {
  if (loading) {
    return {
      id: "workspace-loading",
      title: "بنحدد خطوتك الجاية",
      intro: "ثواني بسيطة لقراءة حالة حسابك ومشاريعك.",
      steps: [
        step("loading", "جاري تحميل رحلتك", "هنظهر لك الخطوة المطلوبة فورًا.", "current")
      ]
    };
  }

  const hasProjects = projects.length > 0;
  const firstProject = projects[0];
  const projectSelector = firstProject?.projectId
    ? `.projectBtn[data-template-id="${firstProject.projectId}"]`
    : ".projectBtn:not([disabled])";

  return {
    id: "owner-workspace",
    title: "إيه الخطوة الجاية؟",
    intro: subscriptionActive
      ? "اشتراكك شغال. هنركز دلوقتي على إطلاق مشروعك وتشغيله."
      : "حسابك موجود، لكن لازم يكتمل التفعيل قبل إنشاء المشاريع.",
    steps: [
      step("account", "إنشاء الحساب", "حسابك موجود بالفعل.", "done"),
      step(
        "payment",
        "الدفع وإرسال إثبات التحويل",
        userData.initialActivationPaid === true
          ? "تم تسجيل أول دفعة على حسابك."
          : `أكمل أول دفعة بقيمة ${formatEgp(PLATFORM_BILLING.initialActivationFee)} عبر InstaPay باستخدام بيانات الدفع الرسمية، ثم أرسل إثبات التحويل بالطريقة المعتمدة للمراجعة.`,
        subscriptionActive ? "done" : "current",
        { selector: "#subscriptionStatus", actionLabel: "شوف حالة الاشتراك" }
      ),
      step(
        "activation",
        "تفعيل الاشتراك",
        subscriptionActive
          ? "اشتراكك مفعّل وتقدر تستخدم المشاريع المتاحة."
          : "بعد مراجعة التحويل هتتغير الحالة هنا تلقائيًا إلى اشتراك مفعّل.",
        subscriptionActive ? "done" : "pending",
        { selector: ".subscriptionCard", actionLabel: "شوف حالة التفعيل" }
      ),
      step(
        "create-project",
        "أنشئ أول مشروع",
        hasProjects
          ? "عندك مشروع واحد على الأقل، وتقدر ترجع لمساحة العمل وتضيف مشاريع أخرى من نفس الحساب."
          : "اختار مشروع متاح واضغط «إنشاء المشروع». وبعدها تقدر تضيف مشاريع أخرى من نفس الحساب.",
        hasProjects ? "done" : (subscriptionActive ? "current" : "pending"),
        { selector: ".projectBtn:not([disabled])", actionLabel: "اختار مشروع" }
      ),
      step(
        "setup-project",
        "استكمل إعداد وتشغيل المشروع",
        "افتح إدارة المشروع، اربط جهة التشغيل وحدد العمولة وابعت دعوة الشريك.",
        hasProjects && subscriptionActive ? "current" : "pending",
        {
          selector: hasProjects ? projectSelector : "",
          actionLabel: hasProjects ? "افتح إدارة المشروع" : ""
        }
      ),
      step(
        "share-link",
        "شارك رابط العملاء",
        "بعد موافقة جهة التشغيل وتفعيلها هيظهر رابط العملاء جاهز للنسخ والمشاركة.",
        "pending"
      ),
      step(
        "referral",
        "استخدم برنامج الإحالة",
        "من مساحة العمل تقدر تنسخ رابط الإحالة الخاص بيك. بعد تفعيل مستخدم مؤهل من رابطك تُسجل عمولة الإحالة حسب سياسة المنصة.",
        "pending",
        { selector: ".referralCard", actionLabel: "ورّيني رابط الإحالة" }
      )
    ]
  };
}

const partnerLabels = {
  supermarket: { partner: "السوبرماركت", setup: "اربط السوبرماركت" },
  restaurant: { partner: "المطعم", setup: "اربط المطعم" },
  bakery: { partner: "المخبز", setup: "اربط المخبز" },
  laundry: { partner: "المغسلة", setup: "اربط المغسلة" }
};

export function buildPartnerProjectGuide({ templateId, bundle } = {}) {
  const labels = partnerLabels[templateId] || { partner: "جهة التشغيل", setup: "اربط جهة التشغيل" };
  const partnerRecord = bundle?.supermarket || bundle?.restaurant || bundle?.laundry || null;
  const operator = bundle?.operator || null;
  const agreement = bundle?.agreement || null;
  const configured = Boolean(partnerRecord && operator);
  const accepted = agreement?.status === "accepted" && agreement?.currentAmount != null;
  const operatorActive = operator?.isActive === true;
  const ready = configured && accepted && operatorActive;

  return {
    id: `partner-project-${templateId || "unknown"}`,
    title: "تشغيل مشروعك خطوة بخطوة",
    intro: ready
      ? "المشروع جاهز. ركّز دلوقتي على مشاركة رابط العملاء ومتابعة النتائج."
      : `هنجهّز المشروع مع ${labels.partner} لحد ما رابط العملاء يبقى جاهز.`,
    steps: [
      step("project-created", "إنشاء المشروع", "المشروع موجود ومفتوح من مساحة العمل.", "done"),
      step(
        "partner-setup",
        labels.setup,
        `أدخل بيانات ${labels.partner} ورقم واتساب المسؤول والعمولة المقترحة، ثم احفظ الإعداد.`,
        configured ? "done" : "current",
        { selector: "#setupSection", actionLabel: configured ? "" : "روح لإعداد التشغيل" }
      ),
      step(
        "invite",
        `ابعت دعوة التشغيل إلى ${labels.partner}`,
        accepted
          ? `تم اعتماد اتفاق العمولة مع ${labels.partner}.`
          : "ابعت رابط لوحة التشغيل على واتساب. المسؤول ينشئ دخوله ويقبل العمولة قبل بدء التشغيل.",
        ready ? "done" : (configured ? "current" : "pending"),
        { selector: "#sendOperatorWhatsappBtn", actionLabel: configured ? "ورّيني زر الدعوة" : "" }
      ),
      step(
        "customer-link",
        "شارك رابط العملاء",
        ready
          ? "رابط العملاء جاهز. انسخه وشاركه مع العملاء لبدء استقبال الطلبات."
          : "الرابط هيتفعّل بعد قبول العمولة وتفعيل جهة التشغيل.",
        ready ? "current" : "pending",
        { selector: "#customerLink", actionLabel: ready ? "ورّيني رابط العملاء" : "" }
      ),
      step(
        "earnings",
        "تابع العمولة والأداء",
        "الكروت أعلى الصفحة تعرض الطلبات المحتسبة والعمولة المكتسبة والمدفوع والمستحق.",
        "pending",
        { selector: ".statGrid, .stats", actionLabel: "شوف الأداء" }
      ),
      step(
        "commission",
        "عدّل العمولة عند الحاجة",
        "تقدر تقترح عمولة جديدة، والقيمة الحالية تفضل سارية لحد ما جهة التشغيل توافق.",
        "pending",
        { selector: "#newCommissionAmount", actionLabel: "شوف تعديل العمولة" }
      )
    ]
  };
}
