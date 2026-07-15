    import {
      registerUser,
      loginUser,
      logoutUser,
      observeAuth
    } from './core/auth/auth.js';

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
let currentMode = "register";

function updatePage() {

    if (currentMode === "register") {

        pageTitle.innerText = "ابدأ بناء شركتك";

        nameGroup.style.display = "block";

        confirmPasswordGroup.style.display = "block";

    } else {

        pageTitle.innerText = "مرحبًا بعودتك";

        nameGroup.style.display = "none";

        confirmPasswordGroup.style.display = "none";

    }

}
    // Register
    document
      .getElementById("registerBtn")
      .addEventListener("click", async () => {
if (passwordInput.value !== confirmPasswordInput.value) {

  status.innerText = "❌ كلمتا المرور غير متطابقتين.";

  return;

}
        const result =
          await registerUser(
            nameInput.value,
            emailInput.value,
            passwordInput.value
          );

        if(result.success) {

          status.innerText =
            "Registered Successfully ✅";

        } else {

          status.innerText =
            result.error;

        }

      });


    // Login
    document
  .getElementById("loginBtn")
  .addEventListener("click", (event) => {

    event.preventDefault();

    currentMode = "login";

    updatePage();

});


    // Logout
    document
      .getElementById("logoutBtn")
      .addEventListener("click", async () => {

        await logoutUser();

        status.innerText =
          "Logged Out ✅";

      });


    // Observe Auth State
    observeAuth((user) => {

      if(user) {

        console.log("Current User:", user.email);

      } else {

        console.log("No User Logged In");

      }

    });

updatePage();
