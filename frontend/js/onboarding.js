import { auth, API_BASE, onAuthStateChanged, db, doc, getDoc } from "./firebase-init.js";

// ─── Constants ────────────────────────────────────────────────────────────────
// The leader is now excluded from the members array in the UI.
// The roster displays only non-leader member slots.
const MAX_MEMBERS = 3; 
const MIN_MEMBERS = 1;

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const form             = document.getElementById("onboardingForm");
const membersContainer = document.getElementById("membersContainer");
const errorEl          = document.getElementById("formError");
const submitBtn        = document.getElementById("submitBtn");
const trackSelect      = document.getElementById("trackSelect");

const leaderName       = document.getElementById("leaderName");
const leaderPhone      = document.getElementById("leaderPhone");
const leaderWhatsapp   = document.getElementById("leaderWhatsapp");
const leaderCourse     = document.getElementById("leaderCourse");
const leaderGradYear   = document.getElementById("leaderGradYear");
const leaderGithub     = document.getElementById("leaderGithub");
const leaderLinkedin   = document.getElementById("leaderLinkedin");
const leaderRole       = document.getElementById("leaderRole");
const memberCollege    = document.getElementById("memberCollege");

// ─── Graduation Year populator ────────────────────────────────────────────────
function populateGradYears(selectEl) {
    if (!selectEl) return;
    const currentYear = new Date().getFullYear();
    // Clear any options besides the first placeholder
    while (selectEl.options.length > 1) {
        selectEl.remove(1);
    }
    for (let y = currentYear; y <= currentYear + 4; y++) {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        selectEl.appendChild(opt);
    }
}

// Populate Leader Graduation Year dropdown
populateGradYears(leaderGradYear);

// ─── Track dropdown: populate from data/tracks.json ──────────────────────────
async function loadTracks() {
    try {
        const res = await fetch("/data/tracks.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const tracks = await res.json();
        if (!Array.isArray(tracks) || tracks.length === 0) throw new Error("Empty tracks list");
        tracks.forEach(track => {
            const opt = document.createElement("option");
            opt.value = track.id;
            opt.textContent = track.title;
            trackSelect.appendChild(opt);
        });
    } catch (e) {
        console.error("Could not load tracks.json:", e);
        // Add a fallback "General" option so the form remains submittable
        const fallback = document.createElement("option");
        fallback.value = "general";
        fallback.textContent = "General Track";
        trackSelect.appendChild(fallback);
        // Show a visible notice below the dropdown
        const notice = document.createElement("p");
        notice.className = "field-note";
        notice.style.color = "#f59e0b";
        notice.textContent = "⚠ Track list could not be loaded. 'General Track' selected by default. Contact support if this persists.";
        trackSelect.parentNode.appendChild(notice);
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
    attachPhoneGuard(leaderPhone);
    attachPhoneGuard(leaderWhatsapp);

    // Leader role is locked to Team Lead
    if (leaderRole) {
        leaderRole.value = "Team Lead";
        leaderRole.disabled = true;
        leaderRole.style.opacity = "0.7";
    }

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

                // Pre-fill and lock the memberCollege field (leaders get it from invitedTeam)
                if (memberCollege) {
                    memberCollege.value = currentPrefillData.college || "";
                    memberCollege.disabled = true;
                    memberCollege.style.opacity = "0.7";
                }

                leaderName.value = currentPrefillData.leaderName || userData.displayName || "";
                leaderPhone.value = (currentPrefillData.leaderPhone || userData.phone || "").replace(/^\+91/, "");
                leaderWhatsapp.value = (currentPrefillData.leaderWhatsapp || userData.whatsapp || "").replace(/^\+91/, "");
                leaderCourse.value = currentPrefillData.leaderCourse || userData.course || "";
                if (currentPrefillData.leaderGradYear || userData.gradYear) {
                    leaderGradYear.value = currentPrefillData.leaderGradYear || userData.gradYear;
                }
                leaderGithub.value = userData.github || "";
                leaderLinkedin.value = currentPrefillData.leaderLinkedin || userData.linkedin || "";

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
                    membersContainer.innerHTML = `<div class="font-mono text-xs text-blood" style="font-family: 'JetBrains Mono', monospace; padding: 12px; text-align: center;">Critical Error: Invalid Roster! Minimum team size is 2 (Leader + 1 Member). Please contact support.</div>`;
                    submitBtn.disabled = true;
                    submitBtn.style.opacity = "0.5";
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
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">PHONE</label><input type="text" readonly value="${sanitizeHTML(m.phone || 'Pending')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">WHATSAPP</label><input type="text" readonly value="${sanitizeHTML(m.whatsapp || 'Pending')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">COURSE</label><input type="text" readonly value="${sanitizeHTML(m.course || 'Pending')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">GRAD YEAR</label><input type="text" readonly value="${sanitizeHTML(m.gradYear || 'Pending')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">ROLE</label><input type="text" readonly value="${sanitizeHTML(m.role || 'Member')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">COLLEGE</label><input type="text" readonly value="${sanitizeHTML(m.college)}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">GITHUB</label><input type="text" readonly value="${sanitizeHTML(m.github || 'N/A')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                            <div class="space-y-1"><label class="text-[9px] text-muted-foreground font-mono">LINKEDIN</label><input type="text" readonly value="${sanitizeHTML(m.linkedin || 'N/A')}" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none w-full opacity-70 cursor-not-allowed"></div>
                        `;
                        row.appendChild(grid);
                        membersContainer.appendChild(row);
                    });
                }
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
        sections.forEach(s => {
            s.style.display = "none";
            // Remove 'required' from hidden inputs to prevent HTML5 validation errors on submit
            const inputs = s.querySelectorAll('[required]');
            inputs.forEach(input => input.removeAttribute('required'));
        });
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

    // Configure role select dropdown for member
    if (leaderRole) {
        leaderRole.disabled = false;
        leaderRole.style.opacity = "1";
        // Hide "Team Lead" option for members
        const teamLeadOpt = leaderRole.querySelector('option[value="Team Lead"]');
        if (teamLeadOpt) teamLeadOpt.style.display = "none";
        
        if (userData.roleInTeam || userData.role) {
            leaderRole.value = userData.roleInTeam || userData.role;
        }
    }

    // Setup input values and listeners
    leaderName.placeholder = "YOUR FULL NAME *";
    leaderName.value = userData.displayName || "";

    leaderPhone.placeholder = "YOUR 10-DIGIT PHONE *";
    leaderPhone.value = (userData.phone || "").replace(/^\+91/, "");
    attachPhoneGuard(leaderPhone);

    leaderWhatsapp.placeholder = "YOUR 10-DIGIT WHATSAPP *";
    leaderWhatsapp.value = (userData.whatsapp || "").replace(/^\+91/, "");
    attachPhoneGuard(leaderWhatsapp);

    leaderCourse.placeholder = "YOUR COURSE / BRANCH *";
    leaderCourse.value = userData.course || "";

    if (userData.gradYear) {
        leaderGradYear.value = userData.gradYear;
    }

    leaderGithub.placeholder = "YOUR GITHUB USERNAME (optional)";
    leaderGithub.value = userData.github || "";

    leaderLinkedin.placeholder = "YOUR LINKEDIN URL (optional)";
    leaderLinkedin.value = userData.linkedin || "";
    leaderLinkedin.style.display = "block"; // Members have LinkedIn too now

    // Show and configure college input for members
    // Members must enter their own college — it is not pre-filled from invitedTeam
    if (memberCollege) {
        memberCollege.placeholder = "YOUR COLLEGE / UNIVERSITY *";
        memberCollege.value = userData.college || "";
        memberCollege.disabled = false;
        memberCollege.required = true;
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

        const nameVal       = leaderName.value.trim();
        const phoneVal      = leaderPhone.value.trim();
        const whatsappVal   = leaderWhatsapp.value.trim();
        const courseVal     = leaderCourse.value.trim();
        const gradYearVal   = leaderGradYear.value;
        const githubVal     = leaderGithub.value.trim() || null;
        const linkedinVal   = leaderLinkedin.value.trim() || null;

        if (!nameVal) throw new Error("Full name is required.");
        
        const phoneErr = validatePhone(phoneVal, "Mobile number");
        if (phoneErr) throw new Error(phoneErr);

        const whatsappErr = validatePhone(whatsappVal, "WhatsApp number");
        if (whatsappErr) throw new Error(whatsappErr);

        if (!courseVal) throw new Error("Course/Branch is required.");
        if (!gradYearVal) throw new Error("Graduation Year is required.");

        if (currentUserRole === "participant_leader") {
            const college = (memberCollege && memberCollege.value.trim()) ||
                currentPrefillData?.college ||
                document.getElementById("college")?.value?.trim();
            if (!college) throw new Error("College is required.");

            payload = {
                displayName: nameVal,
                role: "Team Lead",
                phone: phoneVal,
                whatsapp: whatsappVal,
                course: courseVal,
                gradYear: Number(gradYearVal),
                github: githubVal,
                linkedin: linkedinVal,
                college: college,
                trackId: document.getElementById("trackSelect")?.value || undefined,
                problemStatement: document.getElementById("problemStatement")?.value || undefined,
            };
        } else if (currentUserRole === "participant_member") {
            // Fetch member's role from role select
            const roleVal = leaderRole.value;
            if (!roleVal) throw new Error("Role in team is required.");

            // Read college from the memberCollege input field (member fills it in)
            const college = memberCollege ? memberCollege.value.trim() : "";
            if (!college) throw new Error("College / University is required.");

            payload = {
                displayName: nameVal,
                role: roleVal,
                phone: phoneVal,
                whatsapp: whatsappVal,
                course: courseVal,
                gradYear: Number(gradYearVal),
                github: githubVal,
                linkedin: linkedinVal,
                college: college,
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
