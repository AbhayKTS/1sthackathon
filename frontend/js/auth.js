import { auth, db, API_BASE, doc, getDoc, setDoc } from "./firebase-init.js";
import { signInWithCustomToken, onAuthStateChanged } from "firebase/auth";

// ─── Constants ──────────────────────────────────────────────────────────────
const RESEND_COOLDOWN_SEC = 60;

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const errorEl = document.getElementById("authError");
    
    // Step 1 Elements
    const stepEmail = document.getElementById("stepEmail");
    const emailInput = document.getElementById("email");
    const requestOtpBtn = document.getElementById("requestOtpBtn");
    
    // Step 2 Elements
    const stepOtp = document.getElementById("stepOtp");
    const otpInput = document.getElementById("otpCode");
    const verifyOtpBtn = document.getElementById("verifyOtpBtn");
    const resendOtpBtn = document.getElementById("resendOtpBtn");
    
    let currentStep = 1;
    let currentEmail = "";
    let resendTimer = null;

    if (!loginForm || !errorEl) return;

    // Helper to route users based on role
    const routeUser = async (user) => {
        try {
            // Note: The customToken includes the role as a custom claim,
            // but we can also fetch it from Firestore as a fallback or for consistency.
            const userDocRef = doc(db, "users", user.uid);
            const userSnap = await getDoc(userDocRef);
            
            let role = 'participant'; 

            if (userSnap.exists()) {
                role = userSnap.data().role || 'participant';
            }

            if (role === 'admin' || role === 'super_admin') {
                window.location.href = '/cmd-center.html';
            } else {
                window.location.href = '/dashboard.html';
            }
        } catch (error) {
            console.error("Error fetching user role:", error);
            errorEl.textContent = "Error fetching user permissions.";
            verifyOtpBtn.disabled = false;
        }
    };

    // If user is already logged in, redirect them
    onAuthStateChanged(auth, (user) => {
        // Only redirect if they are not anonymous
        if (user && !user.isAnonymous && currentStep === 1) {
            routeUser(user);
        }
    });

    const startResendCooldown = () => {
        let secondsLeft = RESEND_COOLDOWN_SEC;
        resendOtpBtn.style.pointerEvents = "none";
        resendOtpBtn.style.opacity = "0.5";
        
        if (resendTimer) clearInterval(resendTimer);
        
        resendTimer = setInterval(() => {
            secondsLeft--;
            resendOtpBtn.textContent = `Resend Code (${secondsLeft}s)`;
            
            if (secondsLeft <= 0) {
                clearInterval(resendTimer);
                resendOtpBtn.textContent = "Resend Code";
                resendOtpBtn.style.pointerEvents = "auto";
                resendOtpBtn.style.opacity = "1";
            }
        }, 1000);
    };

    const requestOtp = async (email) => {
        const res = await fetch(`${API_BASE}/auth/request-otp`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error?.message || 'Failed to request OTP');
        }
        
        return data;
    };

    // Form Submit Handler (Handles both Steps)
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.textContent = "";

        if (currentStep === 1) {
            // ─── STEP 1: Request OTP ──────────────────────────────────────
            const email = emailInput.value.trim();
            if (!email) return;

            requestOtpBtn.disabled = true;
            requestOtpBtn.textContent = "VERIFYING INVITATION...";

            try {
                await requestOtp(email);
                
                // Transition to Step 2
                currentEmail = email;
                currentStep = 2;
                stepEmail.style.display = "none";
                stepOtp.style.display = "block";
                startResendCooldown();
                
                errorEl.textContent = "Access code sent to your email.";
                errorEl.style.color = "#4ade80"; // Green success text temporarily
                setTimeout(() => { if(errorEl.style.color === 'rgb(74, 222, 128)') errorEl.textContent = ""; }, 3000);
                
                otpInput.focus();
                
            } catch (error) {
                console.error("OTP Request Error:", error);
                errorEl.textContent = error.message;
                errorEl.style.color = "var(--strike-red)";
            } finally {
                requestOtpBtn.disabled = false;
                requestOtpBtn.textContent = "REQUEST ACCESS CODE";
            }

        } else if (currentStep === 2) {
            // ─── STEP 2: Verify OTP ───────────────────────────────────────
            const code = otpInput.value.trim();
            if (code.length !== 6) {
                errorEl.textContent = "Code must be 6 digits.";
                return;
            }

            verifyOtpBtn.disabled = true;
            verifyOtpBtn.textContent = "AUTHENTICATING...";

            try {
                const res = await fetch(`${API_BASE}/auth/verify-otp`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: currentEmail, code })
                });
                
                const data = await res.json();
                
                if (!res.ok) {
                    throw new Error(data.error?.message || 'Verification failed');
                }
                
                const customToken = data.data.customToken;
                
                // Use Firebase Auth client SDK to sign in with the custom token generated by the server
                const userCredential = await signInWithCustomToken(auth, customToken);
                await routeUser(userCredential.user);

            } catch (error) {
                console.error("OTP Verify Error:", error);
                errorEl.textContent = error.message;
                errorEl.style.color = "var(--strike-red)";
                otpInput.value = ""; // Clear input for retry
                verifyOtpBtn.disabled = false;
                verifyOtpBtn.textContent = "VERIFY CODE";
            }
        }
    });

    // Handle Resend
    resendOtpBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (resendOtpBtn.style.pointerEvents === "none") return;

        errorEl.textContent = "";
        resendOtpBtn.style.pointerEvents = "none";
        resendOtpBtn.style.opacity = "0.5";
        resendOtpBtn.textContent = "Sending...";

        try {
            await requestOtp(currentEmail);
            startResendCooldown();
            
            errorEl.textContent = "A new code has been sent.";
            errorEl.style.color = "#4ade80";
            setTimeout(() => { if(errorEl.style.color === 'rgb(74, 222, 128)') errorEl.textContent = ""; }, 3000);
        } catch (error) {
            console.error("OTP Resend Error:", error);
            errorEl.textContent = error.message;
            errorEl.style.color = "var(--strike-red)";
            // Enable resend again if it failed
            resendOtpBtn.textContent = "Resend Code";
            resendOtpBtn.style.pointerEvents = "auto";
            resendOtpBtn.style.opacity = "1";
        }
    });
});
