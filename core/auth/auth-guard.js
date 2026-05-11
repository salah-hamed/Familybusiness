import auth from "../firebase/firebase-auth.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export function protectPage() {

  onAuthStateChanged(auth, (user) => {

    if (!user) {

      window.location.href = "/";

    }

  });

}
