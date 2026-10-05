import app from "./firebase-config.js";

import {
  getAuth
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const auth = getAuth(app);

export default auth;
