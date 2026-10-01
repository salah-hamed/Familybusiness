    import {
      registerUser,
      loginUser,
      logoutUser,
      observeAuth,
      requestPasswordReset
    } from './core/auth/auth.js';
import { createGuide } from './core/onboarding/guide.js';
import { buildAuthGuide } from './core/onboarding/guide-state.js';

    const nameInput =
      document.getElementById("name");

    const emailInput =
      document.getElementById("email");

    const passwordInput =
      document.getElementById("password");
const confirmPasswordInput =
  document.getElementById("confirmPassword");

    const status =
      document.getElementById("status");
const nameGroup =
  document.getElementById("nameGroup");

const confirmPasswordGroup =
  document.getElementById("confirmPasswordGroup");

const registerBtn =
  document.getElementById("registerBtn");

const loginBtn =
  document.getElementById("loginBtn");

const pageTitle =
  document.getElementById("pageTitle");

const switchMode =
  document.querySelector(".switch-mode");
const switchPrompt =
  document.getElementById("switchPrompt");
const forgotPasswordBtn =
  document.getElementById("forgotPasswordBtn");
const referralUserId = new URLSearchParams(window.location.search).get("ref") || "";
let currentMode = "register";
const guideController = createGuide(buildAuthGuide({ mode: currentMode }), { autoOpen: true });

function updatePage() {

    if (currentMode === "register") {

        pageTitle.innerText = "ابدأ بناء شركتك";

        nameGroup.style.display = "block";

        confirmPasswordGroup.style.display = "block";

        registerBtn.innerText = "🚀 امتلك شركتك";
        passwordInput.autocomplete = "new-password";
        forgotPasswordBtn.classList.add("hidden");
        switchPrompt.innerText = "لديك حساب بالفعل؟";
        loginBtn.innerText = "تسجيل الدخول";

    } else {

        pageTitle.innerText = "مرحبًا بعودتك";

        nameGroup.style.display = "none";

        confirmPasswordGroup.style.display = "none";

        registerBtn.innerText = "🔐 تسجيل الدخول";
        passwordInput.autocomplete = "current-password";
        forgotPasswordBtn.classList.remove("hidden");
        switchPrompt.innerText = "ليس لديك حساب؟";
        loginBtn.innerText = "إنشاء حساب";

    }

    guideController.update(buildAuthGuide({ mode: currentMode }), { autoOpen: true });

}
// Main Button (Register / Login)

registerBtn.addEventListener("click", async () => {

  status.innerText = "";

  if (currentMode === "register") {

    if (passwordInput.value !== confirmPasswordInput.value) {

      status.innerText = "❌ كلمتا المرور غير متطابقتين.";

      return;

    }

    const result = await registerUser(

      nameInput.value,
      emailInput.value,
      passwordInput.value,
      referralUserId

    );

    if (result.success) {

      status.innerText = referralUserId
        ? "✅ تم إنشاء الحساب وربط الإحالة بنجاح. في انتظار تفعيل الاشتراك."
        : "✅ تم إنشاء الحساب بنجاح. في انتظار تفعيل الاشتراك.";

      guideController.update(buildAuthGuide({ mode: "registered" }), { autoOpen: true });
      guideController.open();

    } else {

      status.innerText = result.error;

    }

  } else {

    const result = await loginUser(

      emailInput.value,
      passwordInput.value

    );

    if (result.success) {

      window.location.href = "./workspace/";

    } else {

      status.innerText = result.error;

    }

  }

});


    // Login
    document
  .getElementById("loginBtn")
  .addEventListener("click", (event) => {

    event.preventDefault();

    currentMode = currentMode === "register" ? "login" : "register";

    status.innerText = "";
    updatePage();

});


    // Logout
    document
      .getElementById("logoutBtn")
      .addEventListener("click", async () => {

        await logoutUser();

        status.innerText =
          "تم تسجيل الخروج ✅";

      });


    // Observe Auth State
    observeAuth(() => {
      // Keep the page synchronized without exposing account details in production logs.
    });

updatePage();
