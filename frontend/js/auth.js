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

// ─── SECURITY: Login Attempt Limiting ───────────────────────────
const LOGIN_ATTEMPTS_KEY = 'rh_login_attempts';
const MAX_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

function getLoginAttempts() {
    try {
        return JSON.parse(localStorage.getItem(LOGIN_ATTEMPTS_KEY) || '{"count":0,"lockedUntil":0}');
    } catch {
        return { count: 0, lockedUntil: 0 };
    }
}

function isLockedOut() {
    const data = getLoginAttempts();
    if (data.lockedUntil && Date.now() < data.lockedUntil) {
        return true;
    }
    // Reset if lockout expired
    if (data.lockedUntil && Date.now() >= data.lockedUntil) {
        localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify({ count: 0, lockedUntil: 0 }));
    }
    return false;
}

function getRemainingLockoutTime() {
    const data = getLoginAttempts();
    if (data.lockedUntil && Date.now() < data.lockedUntil) {
        return Math.ceil((data.lockedUntil - Date.now()) / 60000); // minutes
    }
    return 0;
}

function recordFailedAttempt() {
    const data = getLoginAttempts();
    data.count += 1;
    if (data.count >= MAX_ATTEMPTS) {
        data.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
        data.count = 0; // Reset count, lockout is active
    }
    localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(data));
    return MAX_ATTEMPTS - data.count;
}

function resetLoginAttempts() {
    localStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify({ count: 0, lockedUntil: 0 }));
}

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const googleLoginBtn = document.getElementById("googleLoginBtn");
    const errorEl = document.getElementById("authError");
    const submitBtn = document.getElementById("loginBtn");
    const authTitle = document.getElementById("authTitle");
    const toggleAuthMode = document.getElementById("toggleAuthMode");

    let isSignupMode = false;

    if (!loginForm || !googleLoginBtn || !errorEl) return;

    if (toggleAuthMode) {
        toggleAuthMode.addEventListener("click", (e) => {
            e.preventDefault();
            isSignupMode = !isSignupMode;
            if (isSignupMode) {
                authTitle.textContent = "Create Account";
                submitBtn.textContent = "REGISTER";
                toggleAuthMode.textContent = "Already have an account? Log in";
            } else {
                authTitle.textContent = "Authentication Required";
                submitBtn.textContent = "ACCESS TERMINAL";
                toggleAuthMode.textContent = "Don't have an account? Sign up";
            }
            errorEl.textContent = "";
        });
    }

    // Helper to route users based on role
    const routeUser = async (user) => {
        try {
            const userDocRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userDocRef);
            
            let role = 'participant'; // Default role

            if (userSnap.exists()) {
                role = userSnap.data().role || 'participant';
            } else {
                // First time login (e.g. Google auth or signup), create a basic user doc
                await setDoc(userDocRef, {
                    uid: user.uid,
                    email: user.email,
                    role: 'participant',
                    teamId: null,
                    createdAt: new Date()
                });
            }

            resetLoginAttempts(); // Clear on successful login

            if (role === 'admin') {
                window.location.href = '/cmd-center.html';
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

    // Email/Password Login & Signup
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.textContent = "";

        // ─── Lockout Check ──────────────────────────────────
        if (isLockedOut()) {
            const mins = getRemainingLockoutTime();
            errorEl.textContent = `Account locked. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`;
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "PROCESSING...";

        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;

        try {
            let userCredential;
            if (isSignupMode) {
                userCredential = await import("firebase/auth").then(m => m.createUserWithEmailAndPassword(auth, email, password));
            } else {
                userCredential = await import("firebase/auth").then(m => m.signInWithEmailAndPassword(auth, email, password));
            }
            await routeUser(userCredential.user);
        } catch (error) {
            console.error("Auth Error:", error);
            const remaining = recordFailedAttempt();

            if (isLockedOut()) {
                errorEl.textContent = `Too many failed attempts. Account locked for 15 minutes.`;
            } else {
                errorEl.textContent = `${error.message.replace("Firebase: ", "")} (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)`;
            }
            submitBtn.disabled = false;
            submitBtn.textContent = isSignupMode ? "REGISTER" : "ACCESS TERMINAL";
        }
    });

    // Google Login
    googleLoginBtn.addEventListener("click", async () => {
        errorEl.textContent = "";

        if (isLockedOut()) {
            const mins = getRemainingLockoutTime();
            errorEl.textContent = `Account locked. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.`;
            return;
        }

        try {
            const userCredential = await signInWithPopup(auth, googleProvider);
            await routeUser(userCredential.user);
        } catch (error) {
            console.error("Google Auth Error:", error);
            errorEl.textContent = error.message.replace("Firebase: ", "");
        }
    });
});
