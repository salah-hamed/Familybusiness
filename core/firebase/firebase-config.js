// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD8_Kbs2-xUmZtzln9RP-ZwrCoeIewYWag",
  authDomain: "business-2a2e0.firebaseapp.com",
  projectId: "business-2a2e0",
  storageBucket: "business-2a2e0.firebasestorage.app",
  messagingSenderId: "6539318209",
  appId: "1:6539318209:web:7a6d42e67330ce16465540",
  measurementId: "G-H7337EK33P"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
