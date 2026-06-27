import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBA9iXHl8WQdmoJ7QUiABxu7AXfizeRzfk",
  authDomain: "sthack-88def.firebaseapp.com",
  projectId: "sthack-88def",
  storageBucket: "sthack-88def.firebasestorage.app",
  messagingSenderId: "676755311648",
  appId: "1:676755311648:web:77041fc026d8a7b5910045",
  measurementId: "G-K8NRWB6NXF"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const googleLoginBtn = document.getElementById("googleLoginBtn");
    const errorEl = document.getElementById("authError");
    const submitBtn = document.getElementById("loginBtn");

    if (!loginForm || !googleLoginBtn || !errorEl) return;

    // Helper to route users based on role
    const routeUser = async (user) => {
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userDocRef);
            
            let role = 'participant'; // Default role

            if (userSnap.exists()) {
                role = userSnap.data().role || 'participant';
            } else {
                // First time login (e.g. Google auth), create a basic user doc
                await setDoc(userDocRef, {
                    uid: user.uid,
                    email: user.email,
                    role: 'participant',
                    teamId: null,
                    createdAt: new Date()
                });
            }

            if (role === 'admin') {
                window.location.href = '/admin.html';
            } else {
                window.location.href = '/dashboard.html';
            }
        } catch (error) {
            console.error("Error fetching user role:", error);
            errorEl.textContent = "Error fetching user permissions.";
            submitBtn.disabled = false;
        }
    };

    // If user is already logged in, redirect them
    onAuthStateChanged(auth, (user) => {
        // Only redirect if they are not anonymous
        if (user && !user.isAnonymous) {
            routeUser(user);
        }
    });

    // Email/Password Login
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.textContent = "";
        submitBtn.disabled = true;
        submitBtn.textContent = "AUTHENTICATING...";

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        try {
            const userCredential = await signInWithEmailAndPassword(auth, email, password);
            await routeUser(userCredential.user);
        } catch (error) {
            console.error("Login Error:", error);
            errorEl.textContent = error.message.replace("Firebase: ", "");
            submitBtn.disabled = false;
            submitBtn.textContent = "ACCESS TERMINAL";
        }
    });

    // Google Login
    googleLoginBtn.addEventListener("click", async () => {
        errorEl.textContent = "";
        try {
            const userCredential = await signInWithPopup(auth, googleProvider);
            await routeUser(userCredential.user);
        } catch (error) {
            console.error("Google Auth Error:", error);
            errorEl.textContent = error.message.replace("Firebase: ", "");
        }
    });
});
