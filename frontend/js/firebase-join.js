import { initializeApp } from "firebase/app";
import { getAnalytics, isSupported as analyticsSupported } from "firebase/analytics";
import { getFirestore, addDoc, collection, serverTimestamp } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth";

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
const db = getFirestore(app);
const auth = getAuth(app);

// Try anonymous sign-in on load so writes that require auth will succeed
signInAnonymously(auth).catch((err) => {
  // Non-fatal: we'll surface errors if write fails
  console.warn('Anonymous sign-in failed:', err);
});

analyticsSupported().then((supported) => {
  if (supported) {
    getAnalytics(app);
  }
}).catch(() => {
  // Ignore analytics errors in unsupported environments.
});

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("join-gang-form");
  const statusEl = document.getElementById("join-status");
  const submitBtn = document.getElementById("join-submit");

  if (!form || !statusEl || !submitBtn) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("name")?.value.trim() || "";
    const email = document.getElementById("email")?.value.trim() || "";
    const number = document.getElementById("number")?.value.trim() || "";
    const teamName = document.getElementById("team-name")?.value.trim() || "";

    if (!name || !email || !number || !teamName) {
      statusEl.textContent = "All fields are required before transmission.";
      statusEl.classList.add("error");
      return;
    }

    submitBtn.disabled = true;
    // Ensure we have auth (in case sign-in hasn't completed yet)
    if (!auth.currentUser) {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.warn('Anonymous sign-in attempt failed at submit:', err);
      }
    }
    statusEl.textContent = "Transmitting intel...";
    statusEl.classList.remove("error", "success");

    try {
      await addDoc(collection(db, "joinGangLeads"), {
        name,
        email,
        number,
        teamName,
        source: "landing-page",
        createdAt: serverTimestamp()
      });

      form.reset();
      statusEl.textContent = "Intel received. We will contact you soon.";
      statusEl.classList.add("success");
    } catch (error) {
      // Better error feedback for permission issues
      console.error("Join submission failed:", error);
      if (error && error.code === 'permission-denied') {
        statusEl.textContent = "Permission denied: Firestore rules block this write. See console for details.";
      } else {
        statusEl.textContent = "Transmission failed. Please try again.";
      }
      statusEl.classList.add("error");
    } finally {
      submitBtn.disabled = false;
    }
  });
});
