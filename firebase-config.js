// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAQSSoEH_EKAdEUJftgPKOnEusGnTyMH4Q",
  authDomain: "estatus-tabla.firebaseapp.com",
  projectId: "estatus-tabla",
  storageBucket: "estatus-tabla.firebasestorage.app",
  messagingSenderId: "817262502710",
  appId: "1:817262502710:web:5c030a61541dc588d34997",
  measurementId: "G-R2G79QKX11"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);