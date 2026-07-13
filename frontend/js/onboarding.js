import { auth, API_BASE, onAuthStateChanged, db, doc, getDoc } from "./firebase-init.js";

// ─── Constants ────────────────────────────────────────────────────────────────
// The leader is now excluded from the members array in the UI.
// The roster displays only non-leader member slots.
const MAX_MEMBERS = 3; 
const MIN_MEMBERS = 1;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const form             = document.getElementById("onboardingForm");
const membersContainer = document.getElementById("membersContainer");
const addMemberBtn     = document.getElementById("addMemberBtn");
const errorEl          = document.getElementById("formError");
const submitBtn        = document.getElementById("submitBtn");
const trackSelect      = document.getElementById("trackSelect");

// ─── Track dropdown: populate from data/tracks.json ──────────────────────────
async function loadTracks() {
    try {
        const res = await fetch("/data/tracks.json");
        if (!res.ok) throw new Error("Failed to load tracks");
        const tracks = await res.json();
        tracks.forEach(track => {
            const opt = document.createElement("option");
            opt.value = track.id;
            opt.textContent = track.title;
            trackSelect.appendChild(opt);
        });
    } catch (e) {
        console.warn("Could not load tracks.json:", e);
    }
}
loadTracks();

// ─── Show rejection notes ─────────────────────────────────────────────────────
const notesJson = sessionStorage.getItem("rh_need_changes");
if (notesJson) {
    try {
        const history = JSON.parse(notesJson);
        if (history && history.length > 0) {
            const latestNote = history[history.length - 1].notes || history[history.length - 1].note;
            document.getElementById("rejectionNotesContainer").classList.remove("hidden");
            document.getElementById("rejectionNotesText").textContent = latestNote;
        }
    } catch (e) {
        console.error(e);
    }
}

// ─── Phone helpers ────────────────────────────────────────────────────────────
function attachPhoneGuard(input) {
    if (!input) return;
    input.addEventListener("input", () => {
        let val = input.value.replace(/\D/g, "");
        if (val.startsWith("91") && val.length > 10) val = val.slice(2);
        input.value = val.slice(0, 10);
    });
    input.addEventListener("paste", (e) => {
        e.preventDefault();
        let pasted = (e.clipboardData || window.clipboardData).getData("text");
        pasted = pasted.replace(/[\s\-\(\)\.]/g, "").replace(/^\+?91/, "").replace(/\D/g, "");
        input.value = pasted.slice(0, 10);
    });
    input.addEventListener("keydown", (e) => {
        const allowed = ["Backspace","Delete","ArrowLeft","ArrowRight","Tab","Home","End"];
        if (!allowed.includes(e.key) && !/^\d$/.test(e.key)) {
            e.preventDefault();
        }
    });
}

function validatePhone(digits, label) {
    if (!/^\d{10}$/.test(digits)) {
        return `${label}: must be exactly 10 digits (got "${digits}")`;
    }
    return null;
}

function sanitizeHTML(str) {
    if (!str) return "";
    return str.replace(/[&<>'"]/g, 
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

// ─── State ────────────────────────────────────────────────────────────────────
let currentUserRole = null;
let currentPrefillData = null;

// ─── Auth state ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "/login.html";
        return;
    }

    try {
        const userDocRef = doc(db, "users", user.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (!userDocSnap.exists()) {
            signOut(auth);
            window.location.href = "/login.html";
            return;
        }

        const userData = userDocSnap.data();
        currentUserRole = userData.role;

        if (currentUserRole === "participant_leader") {
            // Setup Leader view
            setupLeaderUI(user, userData);
        } else if (currentUserRole === "participant_member") {
            // Setup Member view
            setupMemberUI(user, userData);
        } else {
            // Admin role or invalid participant role
            signOut(auth);
            window.location.href = "/login.html";
        }
    } catch (err) {
        console.error("Auth validation failed:", err);
    }
});

// ─── Setup UI for Leader ──────────────────────────────────────────────────────
async function setupLeaderUI(user, userData) {
    attachPhoneGuard(document.getElementById("leaderPhone"));

    // Fetch prefill data
    try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/team/prefill`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            currentPrefillData = data?.data?.prefill;
            if (currentPrefillData) {
                // Prefill team inputs
                document.getElementById("teamName").value = currentPrefillData.teamName || "";
                document.getElementById("teamName").disabled = true;
                document.getElementById("teamName").style.opacity = "0.7";

                document.getElementById("college").value = currentPrefillData.college || "";
                document.getElementById("college").disabled = true;
                document.getElementById("college").style.opacity = "0.7";

                document.getElementById("leaderName").value = currentPrefillData.leaderName || userData.displayName || "";
                document.getElementById("leaderPhone").value = (currentPrefillData.leaderPhone || userData.phone || "").replace(/^\+91/, "");

                if (currentPrefillData.track && trackSelect) {
                    trackSelect.value = currentPrefillData.track;
                    trackSelect.disabled = true;
                    trackSelect.style.opacity = "0.7";
                }
                if (currentPrefillData.problemStatement) {
                    const psEl = document.getElementById("problemStatement");
                    if (psEl) {
                        psEl.value = currentPrefillData.problemStatement;
                        psEl.disabled = true;
                        psEl.style.opacity = "0.7";
                    }
                }
                if (currentPrefillData.isCustomPS !== undefined) {
                    const cb = document.getElementById("isCustomPS");
                    if (cb) {
                        cb.checked = !!currentPrefillData.isCustomPS;
                        cb.disabled = true;
                        cb.style.opacity = "0.7";
                    }
                }

                // Render pre-populated members list as read-only Roster
                const members = currentPrefillData.members || [];
                membersContainer.innerHTML = "";
                
                if (members.length === 0) {
                    membersContainer.innerHTML = `<div class="font-mono text-xs text-muted-foreground" style="font-family: 'JetBrains Mono', monospace; padding: 12px; text-align: center;">No additional members imported. Solo Registration.</div>`;
                } else {
                    members.forEach((m, idx) => {
                        const row = document.createElement("div");
                        row.className = "member-row bg-black/40 p-4 border border-border/50 relative mt-4";
                        
                        const badge = document.createElement("div");
                        badge.className = "absolute -top-2 -left-2 bg-card text-muted-foreground font-mono text-[10px] px-2 py-0.5 border border-border";
                        badge.style.fontFamily = "'JetBrains Mono', monospace";
                        badge.textContent = `MEMBER ${idx + 1}`;
                        row.appendChild(badge);
                        
                        const grid = document.createElement("div");
                        grid.className = "member-row-grid";
                        grid.innerHTML = `
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">NAME</label><input type="text" readonly value="${sanitizeHTML(m.name)}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">EMAIL</label><input type="email" readonly value="${sanitizeHTML(m.email)}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">PHONE</label><input type="text" readonly value="${sanitizeHTML(m.phone || 'Pending registration')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">ROLE</label><input type="text" readonly value="${sanitizeHTML(m.role || 'Member')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">COLLEGE</label><input type="text" readonly value="${sanitizeHTML(m.college)}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">GITHUB</label><input type="text" readonly value="${sanitizeHTML(m.github || 'N/A')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                        `;
                        row.appendChild(grid);
                        membersContainer.appendChild(row);
                    });
                }

                // Hide roster creation triggers (roster is locked/imported)
                if (addMemberBtn) addMemberBtn.style.display = "none";
            }
        }
    } catch (err) {
        console.warn("Could not fetch prefill data:", err);
    }
}

// ─── Setup UI for Member ──────────────────────────────────────────────────────
function setupMemberUI(user, userData) {
    // Hide sections that are Team/Leader level
    const hideSection = (selector) => {
        const sections = document.querySelectorAll(selector);
        sections.forEach(s => s.style.display = "none");
    };

    // Hide Track & Mission, Team Details, Roster
    hideSection("form > div:nth-of-type(1)"); // Track & Mission
    hideSection("form > div:nth-of-type(2)"); // Team Details
    hideSection("form > div:nth-of-type(4)"); // Roster (excluding you)

    // Re-purpose the Leader Profile section as "Member Profile"
    const leaderHeader = document.querySelector("form > div:nth-of-type(3) h2");
    if (leaderHeader) {
        leaderHeader.textContent = "COMPLETE YOUR PROFILE";
    }

    const leaderGrid = document.querySelector("form > div:nth-of-type(3) .grid");
    if (leaderGrid) {
        // Adjust Name input
        const nameInput = document.getElementById("leaderName");
        if (nameInput) {
            nameInput.placeholder = "YOUR FULL NAME *";
            nameInput.value = userData.displayName || "";
        }

        // Adjust Phone input
        const phoneInput = document.getElementById("leaderPhone");
        if (phoneInput) {
            phoneInput.placeholder = "YOUR 10-DIGIT PHONE *";
            phoneInput.value = (userData.phone || "").replace(/^\+91/, "");
            attachPhoneGuard(phoneInput);
        }

        // Adjust Github input
        const githubInput = document.getElementById("leaderGithub");
        if (githubInput) {
            githubInput.placeholder = "YOUR GITHUB USERNAME (optional)";
            githubInput.value = userData.github || "";
        }

        // Add Role input field (required for member completion payload)
        if (!document.getElementById("memberRole")) {
            const roleInput = document.createElement("input");
            roleInput.type = "text";
            roleInput.id = "memberRole";
            roleInput.placeholder = "YOUR ROLE (e.g. Developer, Designer) *";
            roleInput.required = true;
            roleInput.className = "bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full";
            roleInput.style.fontFamily = "'JetBrains Mono', monospace";
            roleInput.value = userData.roleInTeam || "";
            leaderGrid.appendChild(roleInput);
        }

        // Add College input field (required for member completion payload)
        if (!document.getElementById("memberCollege")) {
            const collegeInput = document.createElement("input");
            collegeInput.type = "text";
            collegeInput.id = "memberCollege";
            collegeInput.placeholder = "YOUR COLLEGE / UNIVERSITY *";
            collegeInput.required = true;
            collegeInput.className = "bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full";
            collegeInput.style.fontFamily = "'JetBrains Mono', monospace";
            collegeInput.value = userData.college || "";
            leaderGrid.appendChild(collegeInput);
        }

        // Hide unused LinkedIn field
        const linkedinInput = document.getElementById("leaderLinkedin");
        if (linkedinInput) linkedinInput.style.display = "none";
    }
}

// ─── Form Submit ──────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";

    const user = auth.currentUser;
    if (!user) {
        errorEl.textContent = "Not authenticated.";
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "TRANSMITTING...";

    try {
        const token = await user.getIdToken();
        let payload = {};

        if (currentUserRole === "participant_leader") {
            const leaderName      = document.getElementById("leaderName").value.trim();
            const leaderPhoneRaw  = document.getElementById("leaderPhone").value.trim();
            const leaderGithub    = document.getElementById("leaderGithub").value.trim() || null;
            const college         = currentPrefillData?.college || document.getElementById("college").value.trim();

            if (!leaderName) throw new Error("Leader full name is required.");
            const phoneErr = validatePhone(leaderPhoneRaw, "Leader phone");
            if (phoneErr) throw new Error(phoneErr);
            if (!college) throw new Error("College is required.");

            payload = {
                displayName: leaderName,
                role: "Leader",
                phone: leaderPhoneRaw,
                college: college,
                github: leaderGithub,
            };
        } else if (currentUserRole === "participant_member") {
            const name        = document.getElementById("leaderName").value.trim();
            const phoneRaw    = document.getElementById("leaderPhone").value.trim();
            const github      = document.getElementById("leaderGithub").value.trim() || null;
            const roleInTeam  = document.getElementById("memberRole").value.trim();
            const college     = document.getElementById("memberCollege").value.trim();

            if (!name) throw new Error("Full name is required.");
            const phoneErr = validatePhone(phoneRaw, "Phone number");
            if (phoneErr) throw new Error(phoneErr);
            if (!roleInTeam) throw new Error("Role in team is required.");
            if (!college) throw new Error("College is required.");

            payload = {
                displayName: name,
                role: roleInTeam,
                phone: phoneRaw,
                college: college,
                github: github,
            };
        }

        const res = await fetch(`${API_BASE}/onboarding/complete`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        const data = await res.json();
        if (!res.ok) {
            throw new Error(data.error?.message || "Failed to submit onboarding profile.");
        }

        // Successfully completed onboarding
        window.location.href = "/dashboard.html";
    } catch (error) {
        console.error("Submission error:", error);
        errorEl.textContent = error.message;
        submitBtn.disabled = false;
        submitBtn.textContent = "INITIATE TEAM PROFILE";
    }
});
