function clean(value) {
  return String(value || "").trim();
}

export function friendlyAuthError(error, fallback = "تعذر تنفيذ الطلب. حاول مرة أخرى.") {
  const code = clean(error?.code).toLowerCase();
  const message = clean(error?.message);
  const upper = message.toUpperCase();

  if (code.includes("auth/invalid-email") || upper === "INVALID_EMAIL") {
    return "راجع البريد الإلكتروني وتأكد أنه مكتوب بشكل صحيح.";
  }
  if (code.includes("auth/email-already-in-use")) {
    return "البريد الإلكتروني مسجل بالفعل. استخدم تسجيل الدخول أو استعادة كلمة المرور.";
  }
  if (code.includes("auth/weak-password")) {
    return "كلمة المرور لازم تكون 6 أحرف على الأقل.";
  }
  if (
    code.includes("auth/invalid-credential")
    || code.includes("auth/wrong-password")
    || code.includes("auth/user-not-found")
  ) {
    return "البريد الإلكتروني أو كلمة المرور غير صحيحة.";
  }
  if (code.includes("auth/too-many-requests")) {
    return "تمت محاولات كثيرة. حاول مرة أخرى بعد قليل.";
  }
  if (code.includes("auth/network-request-failed") || code.includes("unavailable")) {
    return "تعذر الاتصال بالمنصة. تأكد من الإنترنت وحاول مرة أخرى.";
  }
  if (upper === "INVALID_NAME") {
    return "اكتب اسمًا صحيحًا لا يزيد عن 100 حرف.";
  }

  return fallback;
}
