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

    const status =
      document.getElementById("status");


    // Register
    document
      .getElementById("registerBtn")
      .addEventListener("click", async () => {

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
      .addEventListener("click", async () => {

        const result =
          await loginUser(
            emailInput.value,
            passwordInput.value
          );

       if(result.success) {

  window.location.href = "./dashboard/";

} else {

  status.innerText = result.error;

}

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

