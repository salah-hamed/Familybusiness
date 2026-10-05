import auth from "../firebase/firebase-auth.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";


export function protectPage(callback) {

  onAuthStateChanged(auth, (user) => {

    if (!user) {

      window.location.href = "/Familybusiness/";

      return;

    }

    if (callback) {

      callback(user);

    }

  });

}
