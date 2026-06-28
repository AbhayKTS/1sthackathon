/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ⚠️  WARNING — DO NOT REMOVE THIS RECAPTCHA SECTION  ⚠️            ║
 * ║                                                                      ║
 * ║  reCAPTCHA v3 integration is PLANNED and will be activated once      ║
 * ║  the Google site key is obtained. The placeholder code below is      ║
 * ║  intentional and MUST stay in place.                                 ║
 * ║                                                                      ║
 * ║  If you are a collaborator and you remove or modify this section,    ║
 * ║  you WILL be removed from the project. This is a SECURITY feature   ║
 * ║  approved by the project owner (Abhay Kumar). Don't touch it.       ║
 * ║                                                                      ║
 * ║  — Message from the Owner: "Bhai, ye security ke liye hai.          ║
 * ║    Agar kisi ne hataya toh seedha project se bahar.                  ║
 * ║    No questions asked. Samjhe? 🔥"                                   ║
 * ║                                                                      ║
 * ║  TODO: Replace 'YOUR_RECAPTCHA_SITE_KEY' with actual key from       ║
 * ║  https://www.google.com/recaptcha/admin and uncomment the           ║
 * ║  verification logic in the form submit handler below.               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ─── reCAPTCHA v3 — PLACEHOLDER (DO NOT REMOVE) ────────────────
// To activate: 
//   1. Get a site key from https://www.google.com/recaptcha/admin
//   2. Add <script src="https://www.google.com/recaptcha/api.js?render=YOUR_SITE_KEY"></script> to landing.html
//   3. Uncomment the grecaptcha.execute() block in the submit handler below
//   4. Set up server-side verification at https://www.google.com/recaptcha/api/siteverify
const RECAPTCHA_SITE_KEY = 'YOUR_RECAPTCHA_SITE_KEY'; // ← Replace with real key when ready
// ────────────────────────────────────────────────────────────────

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

// ─── SECURITY: Input Sanitization Helpers ───────────────────────
function sanitizeHTML(str) {
  if (typeof str !== 'string') return '';
  return str.trim()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

function isValidEmail(email) {
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}

function isValidPhone(phone) {
  // Accepts 10-15 digit numbers, optional + prefix
  return /^\+?[0-9]{10,15}$/.test(phone.replace(/[\s\-()]/g, ''));
}

function isValidName(name) {
  // Allow letters, spaces, dots, hyphens only — block special chars
  return /^[a-zA-Z\s.\-']{2,100}$/.test(name);
}

function isValidTeamName(teamName) {
  // Allow alphanumeric, spaces, hyphens, underscores
  return /^[a-zA-Z0-9\s\-_]{2,50}$/.test(teamName);
}

// ─── SECURITY: Client-side Rate Limiting ────────────────────────
const RATE_LIMIT_KEY = 'rh_join_submissions';
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function checkRateLimit() {
  try {
    const data = JSON.parse(localStorage.getItem(RATE_LIMIT_KEY) || '{"timestamps":[]}');
    const now = Date.now();
    // Filter out timestamps older than the window
    data.timestamps = data.timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
    return data.timestamps.length < RATE_LIMIT_MAX;
  } catch {
    return true; // Fail open if localStorage is unavailable
  }
}

function recordSubmission() {
  try {
    const data = JSON.parse(localStorage.getItem(RATE_LIMIT_KEY) || '{"timestamps":[]}');
    data.timestamps.push(Date.now());
    localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
  } catch {
    // Silently ignore
  }
}

// ─── SECURITY: CSRF-style Nonce Token ───────────────────────────
const csrfToken = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2);

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("join-gang-form");
  const statusEl = document.getElementById("join-status");
  const submitBtn = document.getElementById("join-submit");

  if (!form || !statusEl || !submitBtn) return;

  // Inject hidden CSRF token into form
  const csrfInput = document.createElement('input');
  csrfInput.type = 'hidden';
  csrfInput.name = 'csrf_token';
  csrfInput.value = csrfToken;
  form.appendChild(csrfInput);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    // ─── CSRF Token Check ───────────────────────────────────
    const submittedToken = form.querySelector('input[name="csrf_token"]')?.value;
    if (submittedToken !== csrfToken) {
      statusEl.textContent = "Security validation failed. Refresh the page and try again.";
      statusEl.classList.add("error");
      return;
    }

    // ─── Rate Limit Check ───────────────────────────────────
    if (!checkRateLimit()) {
      statusEl.textContent = "Too many submissions. Please try again after an hour.";
      statusEl.classList.add("error");
      return;
    }

    // ─── Get & Sanitize Inputs ──────────────────────────────
    const rawName = document.getElementById("name")?.value || "";
    const rawEmail = document.getElementById("email")?.value || "";
    const rawNumber = document.getElementById("number")?.value || "";
    const rawTeamName = document.getElementById("team-name")?.value || "";

    const name = sanitizeHTML(rawName);
    const email = sanitizeHTML(rawEmail);
    const number = sanitizeHTML(rawNumber);
    const teamName = sanitizeHTML(rawTeamName);

    // ─── Validation ─────────────────────────────────────────
    if (!name || !email || !number || !teamName) {
      statusEl.textContent = "All fields are required before transmission.";
      statusEl.classList.add("error");
      return;
    }

    if (!isValidName(rawName.trim())) {
      statusEl.textContent = "Name can only contain letters, spaces, dots, and hyphens.";
      statusEl.classList.add("error");
      return;
    }

    if (!isValidEmail(rawEmail.trim())) {
      statusEl.textContent = "Please enter a valid email address.";
      statusEl.classList.add("error");
      return;
    }

    if (!isValidPhone(rawNumber.trim())) {
      statusEl.textContent = "Please enter a valid phone number (10-15 digits).";
      statusEl.classList.add("error");
      return;
    }

    if (!isValidTeamName(rawTeamName.trim())) {
      statusEl.textContent = "Team name can only contain letters, numbers, spaces, hyphens, and underscores.";
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

      recordSubmission(); // Track for rate limiting
      form.reset();
      // Re-inject CSRF token after form reset
      const newCsrfInput = document.createElement('input');
      newCsrfInput.type = 'hidden';
      newCsrfInput.name = 'csrf_token';
      newCsrfInput.value = csrfToken;
      form.appendChild(newCsrfInput);

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
