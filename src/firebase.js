import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAteiUle2s5pz3ZEPM4Pq2r8uGC7p8MknU",
  authDomain: "velite-productivity-app.firebaseapp.com",
  databaseURL: "https://velite-productivity-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "velite-productivity-app",
  storageBucket: "velite-productivity-app.firebasestorage.app",
  messagingSenderId: "508277794346",
  appId: "1:508277794346:web:27d82cd18aef7420ff4553"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
