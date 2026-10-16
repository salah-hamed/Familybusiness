import { PLATFORM_BILLING, formatEgp } from "../config/platform-config.js";
import { resolveSubscriptionAccess } from "../subscriptions/trial-policy.js";
import { TRIAL_REGISTRATION_ENABLED } from "../subscriptions/trial-rollout.js?v=20261016-free-trial1";

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
        TRIAL_REGISTRATION_ENABLED ? "ابدأ من غير دفع" : "ادفع وفعّل الاشتراك",
        TRIAL_REGISTRATION_ENABLED
          ? "جهّز نشاطك 7 أيام مجانًا، وبعد أول اتفاق مقبول تبدأ مهلة 3 أيام. الاشتراك الشهري 59 جنيه."
          : `أول تفعيل حاليًا ${formatEgp(PLATFORM_BILLING.initialActivationFee)}، وبعد مراجعة الدفع يتفعّل حسابك.`,
        "pending",
        { selector: "#pricing", actionLabel: "شوف تفاصيل الاشتراك" }
      ),
      step(
        "launch",
        "اختار مشروعك وشغّله",
        TRIAL_REGISTRATION_ENABLED ? "اختار مشروعك فور التسجيل واربط أول محل لتبدأ فترة السماح." : "بعد التفعيل اختار مشروع، اربط جهة التشغيل، وبعد جاهزيته شارك رابط العملاء.",
        "pending",
        { selector: "#projects", actionLabel: "شوف المشاريع" }
      )
    ]
  };
}

export function buildAuthGuide({ mode = "register" } = {}) {
  if (mode === "registered" && TRIAL_REGISTRATION_ENABLED) {
    return {
      id: "account-start-trial",
      title: "حسابك جاهز — ابدأ مشروعك",
      intro: "ابدأ 7 أيام مجانية للتجهيز؛ ومهلة 3 أيام تبدأ بعد أول اتفاق عمولة مقبول مع محل.",
      steps: [
        step("account","إنشاء الحساب","تم إنشاء الحساب.","done"),
        step("project","اختار أول مشروع","اختار نشاطًا شغالًا حواليك، وابعت له دعوة التشغيل.","current",
          {href:"./workspace/",actionLabel:"افتح مساحة العمل"}),
        step("agreement","المحل يقبل العمولة","بمجرد موافقته تبدأ 3 أيام سماح.","pending"),
        step("payment","الاشتراك الشهري","بعد المهلة 59 جنيه شهريًا عبر InstaPay.","pending")
      ]
    };
  }

  if (mode === "register" && TRIAL_REGISTRATION_ENABLED) {
    return {
      id:"account-register-trial",
      title:"ابدأ مجانًا خلال دقيقة",
      intro:"سجّل بياناتك الآن. ما فيش دفع مطلوب قبل تجهيز وربط نشاطك.",
      steps:[
        step("register","اكتب بيانات الحساب","الاسم والبريد وكلمة المرور.","current",
          {selector:"#registerBtn",actionLabel:"أنشئ حسابك"}),
        step("project","اربط أول محل","ابدأ 7 أيام مجانية من وقت التسجيل.","pending"),
        step("agreement","تأكيد العمولة","بعد موافقة أول محل تبدأ 3 أيام.","pending"),
        step("payment","الاشتراك الشهري","59 جنيه شهريًا بعد انتهاء المهلة.","pending")
      ]
    };
  }

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
          "اكتب البريد الإلكتروني وكلمة المرور ثم اضغط تسجيل الدخول. لو نسيت كلمة المرور استخدم رابط الاستعادة الظاهر تحت الحقل.",
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

  if (userData.accessModel === "merchant_trial_v1") {
    const access = resolveSubscriptionAccess(userData);
    const hasMerchant = access.phase === "merchant_grace" || access.phase === "merchant_grace_expired";
    const withinTrial = access.phase === "setup_trial" || access.phase === "merchant_grace";
    const hasProjects = projects.length > 0;
    const subscriberMessage = access.phase === "setup_trial"
      ? "ابدأ تجهيز مشروعك خلال 7 أيام من التسجيل. مهلة 3 أيام تبدأ من قبول أول اتفاق عمولة."
      : hasMerchant
        ? "تم الاتفاق مع أول محل. لديك مهلة 3 أيام من وقت الموافقة لإكمال الاشتراك الشهري."
        : "افتح حسابك وشغّل أنشطتك المدفوعة.";
    return {
      id: "owner-workspace-trial",
      title: "انطلق بالمشروع قبل أول اشتراك",
      intro: withinTrial ? subscriberMessage : access.allowed
        ? "اشتراكك الشهري مفعل. تقدر تكمل تشغيل أنشطتك."
        : "انتهت المهلة المجانية. مطلوب اشتراك شهري بقيمة 59 جنيه للاستمرار.",
      steps: [
        step("account", "إنشاء الحساب", "حسابك جاهز.", "done"),
        step("project", "اربط أول محل", hasProjects
          ? "مشروعك موجود. أرسل الدعوة لصاحب المحل واتفِقوا على العمولة."
          : "أنشئ مشروعًا واربط محلًا شغالًا مع زباينه.",
          hasMerchant ? "done" : withinTrial ? "current" : "pending",
          {selector: ".projectBtn:not([disabled])", actionLabel: "اختار المشروع"}),
        step("agreement", "تأكيد اتفاق العمولة", hasMerchant
          ? "صاحب المحل وافق على أول اتفاق عمولة."
          : "دعوة المحل وحدها لا تبدأ مهلة الثلاثة أيام؛ تبدأ عند موافقته.",
          hasMerchant ? "done" : (hasProjects ? "current" : "pending")),
        step("monthly", "ابدأ الاشتراك الشهري", "59 جنيه شهريًا بعد انتهاء المهلة، عبر InstaPay وواتساب.",
          access.phase === "paid" ? "done" : withinTrial ? "pending" : "current",
          {selector:"#subscriptionStatus",actionLabel:"حالة الاشتراك"})
      ]
    };
  }

  const hasProjects = projects.length > 0;
  const initialPaid = userData.initialActivationPaid === true;
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
        initialPaid ? "جدّد الاشتراك" : "الدفع وإرسال إثبات التحويل",
        subscriptionActive
          ? "الاشتراك الحالي مسجل كمفعّل."
          : initialPaid
            ? `جدّد الاشتراك بقيمة ${formatEgp(PLATFORM_BILLING.monthlyRenewalFee)} عبر طريقة الدفع الرسمية، ثم أرسل إثبات التحويل للمراجعة.`
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


const operatorGuideLabels = {
  supermarket: {
    partner: "السوبرماركت",
    contentTitle: "راجع المنتجات والأسعار",
    contentDescription: "أضف منتجًا واحدًا على الأقل واضبط السعر والتوفر قبل استقبال الطلبات.",
    contentSelector: "#openProductLibraryBtn"
  },
  restaurant: {
    partner: "المطعم",
    contentTitle: "جهّز المنيو والأسعار",
    contentDescription: "أضف طبقًا واحدًا على الأقل واجعله متاحًا للعملاء قبل بدء التشغيل.",
    contentSelector: "#openMenuBtn"
  },
  bakery: {
    partner: "المخبز",
    contentTitle: "جهّز المخبوزات والأسعار",
    contentDescription: "أضف صنفًا واحدًا على الأقل واجعله متاحًا للعملاء قبل بدء التشغيل.",
    contentSelector: "#openMenuBtn"
  },
  laundry: {
    partner: "المغسلة",
    contentTitle: "راجع أسعار الخدمات",
    contentDescription: "أدخل أسعار خدمة واحدة على الأقل قبل استقبال أول طلب.",
    contentSelector: "#pricingSection"
  }
};

function operatorStepStatus(ready, blockedByPrevious) {
  if (ready) return "done";
  return blockedByPrevious ? "pending" : "current";
}

export function buildOperatorGuide({
  templateId,
  partner = {},
  contentReady = false,
  teamReady = false
} = {}) {
  const labels = operatorGuideLabels[templateId] || {
    partner: "جهة التشغيل",
    contentTitle: "راجع المنتجات أو الخدمات",
    contentDescription: "تأكد أن المنتجات أو الخدمات والأسعار جاهزة للعملاء.",
    contentSelector: ""
  };

  const settingsReady = Boolean(
    String(partner?.name || "").trim()
    && String(partner?.whatsapp || partner?.phone || "").trim()
    && String(partner?.address || "").trim()
  );
  const acceptingOrders = partner?.isAcceptingOrders === true;

  const settingsStatus = operatorStepStatus(settingsReady, false);
  const contentStatus = operatorStepStatus(contentReady, !settingsReady);
  const teamStatus = operatorStepStatus(teamReady, !settingsReady || !contentReady);
  const acceptingStatus = operatorStepStatus(
    acceptingOrders,
    !settingsReady || !contentReady || !teamReady
  );
  const launchReady = settingsReady && contentReady && teamReady && acceptingOrders;

  return {
    id: `operator-first-run-${templateId || "partner"}`,
    title: launchReady ? "التشغيل جاهز" : "جهّز التشغيل خطوة بخطوة",
    intro: launchReady
      ? `${labels.partner} جاهز لاستقبال الطلبات. شارك رابط العملاء وابدأ المتابعة من لوحة الطلبات.`
      : "الدعوة والعمولة تم تفعيلهما. أكمل خطوات التشغيل الأساسية قبل مشاركة الرابط على نطاق واسع.",
    steps: [
      step(
        "operator-access",
        "تفعيل الدخول والعمولة",
        "تم تفعيل حساب التشغيل وقبول اتفاق العمولة.",
        "done"
      ),
      step(
        "business-settings",
        "راجع بيانات النشاط",
        "تأكد من الاسم ووسيلة التواصل والعنوان ثم احفظ الإعدادات.",
        settingsStatus,
        { selector: "#settingsSection", actionLabel: "افتح الإعدادات" }
      ),
      step(
        "content",
        labels.contentTitle,
        labels.contentDescription,
        contentStatus,
        { selector: labels.contentSelector, actionLabel: "راجع المنتجات والخدمات" }
      ),
      step(
        "delivery-team",
        templateId === "laundry" ? "جهّز الاستلام والتوصيل" : "أضف مندوب توصيل",
        templateId === "laundry"
          ? "لازم يكون عندك عامل استلام نشط وعامل توصيل نشط حتى يكتمل مسار الطلب."
          : "أضف مندوبًا نشطًا واحدًا على الأقل حتى تقدر ترسل الطلبات للتوصيل.",
        teamStatus,
        { selector: "#ridersSection", actionLabel: "راجع فريق التوصيل" }
      ),
      step(
        "accepting-orders",
        "فعّل استقبال الطلبات",
        "شغّل خيار «استقبال الطلبات» بعد التأكد أن التشغيل والأسعار والفريق جاهزين.",
        acceptingStatus,
        { selector: "#acceptingOrders", actionLabel: "راجع استقبال الطلبات" }
      ),
      step(
        "share-customer-link",
        "شارك رابط العملاء",
        launchReady
          ? "كل الأساسيات جاهزة. انسخ رابط العملاء وشاركه، ثم تابع الطلبات والتنبيهات من اللوحة."
          : "الرابط موجود، لكن الأفضل إكمال خطوات الجاهزية السابقة قبل نشره للعملاء.",
        launchReady ? "current" : "pending",
        { selector: "#customerOrderLink", actionLabel: launchReady ? "اعرض رابط العملاء" : "" }
      )
    ]
  };
}
