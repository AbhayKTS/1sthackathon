import { auth, API_BASE, onAuthStateChanged, db, doc, getDoc, signOut } from "./firebase-init.js";

// ─── DOM Refs ─────────────────────────────────────────────────────────────────
const form             = document.getElementById("onboardingForm");
const membersContainer = document.getElementById("membersContainer");
const errorEl          = document.getElementById("formError");
const submitBtn        = document.getElementById("submitBtn");
const trackSelect      = document.getElementById("trackSelect");
const formContainer    = document.getElementById("formContainer");
const successContainer = document.getElementById("successContainer");

const leaderName       = document.getElementById("leaderName");
const leaderPhone      = document.getElementById("leaderPhone");
const leaderWhatsapp   = document.getElementById("leaderWhatsapp");
const leaderSameAsPhone = document.getElementById("leaderSameAsPhone");
const leaderCourse     = document.getElementById("leaderCourse");
const leaderGradYear   = document.getElementById("leaderGradYear");
const leaderGithub     = document.getElementById("leaderGithub");
const leaderLinkedin   = document.getElementById("leaderLinkedin");
const leaderRole       = document.getElementById("leaderRole");
const memberCollege    = document.getElementById("memberCollege");
const teamSizeSelect   = document.getElementById("teamSize");
const memberDetailsSection = document.getElementById("memberDetailsSection");

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
    if (!trackSelect) return;
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
        const fallback = document.createElement("option");
        fallback.value = "general";
        fallback.textContent = "General Track";
        trackSelect.appendChild(fallback);
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
            const container = document.getElementById("rejectionNotesContainer");
            const textEl = document.getElementById("rejectionNotesText");
            if (container && textEl) {
                container.classList.remove("hidden");
                textEl.textContent = latestNote;
            }
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
            // Setup Leader onboarding flow
            setupLeaderUI(user, userData);
        } else if (currentUserRole === "participant_member") {
            // Member is already onboarded by the leader
            window.location.href = "/dashboard.html";
        } else {
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

    // leaderSameAsPhone behavior
    leaderPhone.addEventListener("input", () => {
        if (leaderSameAsPhone.checked) {
            leaderWhatsapp.value = leaderPhone.value;
        }
    });
    leaderSameAsPhone.addEventListener("change", () => {
        if (leaderSameAsPhone.checked) {
            leaderWhatsapp.value = leaderPhone.value;
            leaderWhatsapp.disabled = true;
            leaderWhatsapp.classList.remove("border-error");
        } else {
            leaderWhatsapp.disabled = false;
        }
    });

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
                // Prefill team details section
                document.getElementById("teamName").value = currentPrefillData.teamName || "";
                document.getElementById("teamName").disabled = true;
                document.getElementById("teamName").style.opacity = "0.7";

                // Prefill leader profile fields
                leaderName.value = currentPrefillData.leaderName || userData.displayName || "";
                leaderPhone.value = (currentPrefillData.leaderPhone || userData.phone || "").replace(/^\+91/, "");
                leaderWhatsapp.value = (currentPrefillData.leaderWhatsapp || userData.whatsapp || "").replace(/^\+91/, "");
                leaderCourse.value = currentPrefillData.leaderCourse || userData.course || "";
                memberCollege.value = currentPrefillData.college || userData.college || "";
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

                // If prefilled members exist, auto-select team size
                if (currentPrefillData.members && currentPrefillData.members.length > 0) {
                    const totalSize = currentPrefillData.members.length + 1; // leader + members
                    teamSizeSelect.value = totalSize;
                    // Trigger change to generate forms
                    teamSizeSelect.dispatchEvent(new Event("change"));
                }
            }
        }
    } catch (err) {
        console.warn("Could not fetch prefill data:", err);
    }
}

// ─── Team Size Select Listener ────────────────────────────────────────────────
teamSizeSelect.addEventListener("change", () => {
    const size = parseInt(teamSizeSelect.value);
    if (!size || size < 2) {
        memberDetailsSection.classList.add("hidden");
        membersContainer.innerHTML = "";
        return;
    }

    memberDetailsSection.classList.remove("hidden");
    membersContainer.innerHTML = "";

    const numMembers = size - 1; // Excluding leader
    for (let idx = 0; idx < numMembers; idx++) {
        const memberDiv = document.createElement("div");
        memberDiv.className = "member-form bg-black/40 p-6 border border-border/50 relative space-y-4";
        
        const badge = document.createElement("div");
        badge.className = "absolute -top-2.5 -left-2.5 bg-card text-muted-foreground font-mono text-[10px] px-2 py-0.5 border border-border";
        badge.style.fontFamily = "'JetBrains Mono', monospace";
        badge.textContent = `MEMBER ${idx + 1}`;
        memberDiv.appendChild(badge);

        // Get prefill data if exists
        const prefill = currentPrefillData?.members?.[idx] || {};

        memberDiv.innerHTML += `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <input type="text" id="member_${idx}_name" placeholder="MEMBER ${idx + 1} FULL NAME *" required value="${sanitizeHTML(prefill.name || '')}" class="bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                <input type="email" id="member_${idx}_email" placeholder="MEMBER ${idx + 1} EMAIL *" required value="${sanitizeHTML(prefill.email || '')}" class="bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                
                <div class="phone-wrapper">
                    <span class="phone-prefix">+91</span>
                    <input type="text" id="member_${idx}_phone" placeholder="MEMBER ${idx + 1} PHONE *" required maxlength="10" pattern="\\d{10}" class="bg-input border border-border px-3 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                </div>
                
                <div class="space-y-1">
                    <div class="phone-wrapper">
                        <span class="phone-prefix">+91</span>
                        <input type="text" id="member_${idx}_whatsapp" placeholder="MEMBER ${idx + 1} WHATSAPP *" required maxlength="10" pattern="\\d{10}" class="bg-input border border-border px-3 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                    </div>
                    <label class="field-note flex items-center gap-1 cursor-pointer" style="margin-top: 4px; user-select: none;">
                        <input type="checkbox" id="member_${idx}_sameAsPhone"> Same as Phone Number
                    </label>
                </div>
                
                <input type="text" id="member_${idx}_college" placeholder="COLLEGE / UNIVERSITY *" required value="${sanitizeHTML(prefill.college || currentPrefillData?.college || '')}" class="bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                <input type="text" id="member_${idx}_course" placeholder="COURSE / BRANCH *" required class="bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                
                <select id="member_${idx}_gradYear" required class="bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                    <option value="" disabled selected>GRADUATION YEAR *</option>
                </select>
                
                <select id="member_${idx}_role" required class="bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                    <option value="" disabled selected>ROLE IN TEAM *</option>
                    <option value="Backend Developer">Backend Developer</option>
                    <option value="Frontend Developer">Frontend Developer</option>
                    <option value="Full Stack Developer">Full Stack Developer</option>
                    <option value="AI/ML Developer">AI/ML Developer</option>
                    <option value="UI/UX Designer">UI/UX Designer</option>
                    <option value="Cloud Developer">Cloud Developer</option>
                    <option value="DevOps Engineer">DevOps Engineer</option>
                    <option value="Researcher">Researcher</option>
                    <option value="Presenter">Presenter</option>
                    <option value="Other">Other</option>
                </select>
                
                <input type="text" id="member_${idx}_github" placeholder="GITHUB USERNAME (optional)" class="bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
                <input type="text" id="member_${idx}_linkedin" placeholder="LINKEDIN URL (optional)" class="bg-input border border-border px-4 py-3 font-mono text-sm focus:outline-none focus:border-blood w-full" style="font-family: 'JetBrains Mono', monospace;">
            </div>
        `;
        membersContainer.appendChild(memberDiv);

        // Populate graduation year options
        const mGradYearSelect = document.getElementById(`member_${idx}_gradYear`);
        populateGradYears(mGradYearSelect);

        // Prefill role if matches options
        const mRoleSelect = document.getElementById(`member_${idx}_role`);
        if (prefill.role && mRoleSelect) {
            mRoleSelect.value = prefill.role;
        }

        // Wire inputs and sameAsPhone checkbox
        const mPhoneInput = document.getElementById(`member_${idx}_phone`);
        const mWhatsappInput = document.getElementById(`member_${idx}_whatsapp`);
        const mSameAsPhoneCheck = document.getElementById(`member_${idx}_sameAsPhone`);

        attachPhoneGuard(mPhoneInput);
        attachPhoneGuard(mWhatsappInput);

        mPhoneInput.addEventListener("input", () => {
            if (mSameAsPhoneCheck.checked) {
                mWhatsappInput.value = mPhoneInput.value;
            }
        });

        mSameAsPhoneCheck.addEventListener("change", () => {
            if (mSameAsPhoneCheck.checked) {
                mWhatsappInput.value = mPhoneInput.value;
                mWhatsappInput.disabled = true;
                mWhatsappInput.classList.remove("border-error");
            } else {
                mWhatsappInput.disabled = false;
            }
        });
    }
});

// ─── Form Submit ──────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";

    const user = auth.currentUser;
    if (!user) {
        errorEl.textContent = "Not authenticated.";
        return;
    }

    // Reset validation border highlights
    document.querySelectorAll(".border-error").forEach(el => el.classList.remove("border-error"));

    let firstInvalidEl = null;
    const errors = [];

    const invalidateField = (el, msg) => {
        el.classList.add("border-error");
        if (!firstInvalidEl) firstInvalidEl = el;
        errors.push(msg);
    };

    // 1. Validate Leader Fields
    const lName = leaderName.value.trim();
    const lPhone = leaderPhone.value.trim();
    const lWhatsapp = leaderWhatsapp.value.trim();
    const lCourse = leaderCourse.value.trim();
    const lCollege = memberCollege.value.trim();
    const lGradYear = leaderGradYear.value;
    const lGithub = leaderGithub.value.trim() || null;
    const lLinkedin = leaderLinkedin.value.trim() || null;

    if (!lName) invalidateField(leaderName, "Leader Full Name is required");
    if (!/^\d{10}$/.test(lPhone)) invalidateField(leaderPhone, "Leader Phone must be exactly 10 digits");
    if (!/^\d{10}$/.test(lWhatsapp)) invalidateField(leaderWhatsapp, "Leader Whatsapp must be exactly 10 digits");
    if (!lCourse) invalidateField(leaderCourse, "Leader Course/Branch is required");
    if (!lCollege) invalidateField(memberCollege, "Leader College/University is required");
    if (!lGradYear) invalidateField(leaderGradYear, "Leader Graduation Year is required");

    // 2. Validate Team Size
    const size = parseInt(teamSizeSelect.value);
    if (!size || size < 2 || size > 4) {
        invalidateField(teamSizeSelect, "Please select a valid Team Size (2 to 4 members)");
    }

    // 3. Validate Member Fields
    const members = [];
    const numMembers = size - 1;

    for (let idx = 0; idx < numMembers; idx++) {
        const mNameInput = document.getElementById(`member_${idx}_name`);
        const mEmailInput = document.getElementById(`member_${idx}_email`);
        const mPhoneInput = document.getElementById(`member_${idx}_phone`);
        const mWhatsappInput = document.getElementById(`member_${idx}_whatsapp`);
        const mCollegeInput = document.getElementById(`member_${idx}_college`);
        const mCourseInput = document.getElementById(`member_${idx}_course`);
        const mGradYearSelect = document.getElementById(`member_${idx}_gradYear`);
        const mRoleSelect = document.getElementById(`member_${idx}_role`);
        const mGithubInput = document.getElementById(`member_${idx}_github`);
        const mLinkedinInput = document.getElementById(`member_${idx}_linkedin`);

        const mName = mNameInput.value.trim();
        const mEmail = mEmailInput.value.trim();
        const mPhone = mPhoneInput.value.trim();
        const mWhatsapp = mWhatsappInput.value.trim();
        const mCollege = mCollegeInput.value.trim();
        const mCourse = mCourseInput.value.trim();
        const mGradYear = mGradYearSelect.value;
        const mRole = mRoleSelect.value;
        const mGithub = mGithubInput.value.trim() || null;
        const mLinkedin = mLinkedinInput.value.trim() || null;

        if (!mName) invalidateField(mNameInput, `Member ${idx + 1} Name is required`);
        if (!mEmail || !mEmail.includes("@")) invalidateField(mEmailInput, `Member ${idx + 1} Email must be a valid email`);
        if (!/^\d{10}$/.test(mPhone)) invalidateField(mPhoneInput, `Member ${idx + 1} Phone must be exactly 10 digits`);
        if (!/^\d{10}$/.test(mWhatsapp)) invalidateField(mWhatsappInput, `Member ${idx + 1} Whatsapp must be exactly 10 digits`);
        if (!mCollege) invalidateField(mCollegeInput, `Member ${idx + 1} College/University is required`);
        if (!mCourse) invalidateField(mCourseInput, `Member ${idx + 1} Course/Branch is required`);
        if (!mGradYear) invalidateField(mGradYearSelect, `Member ${idx + 1} Graduation Year is required`);
        if (!mRole) invalidateField(mRoleSelect, `Member ${idx + 1} Role is required`);

        members.push({
            name: mName,
            email: mEmail,
            phone: mPhone,
            whatsapp: mWhatsapp,
            college: mCollege,
            course: mCourse,
            gradYear: Number(mGradYear),
            role: mRole,
            github: mGithub,
            linkedin: mLinkedin
        });
    }

    // Scroll to first invalid field and show errors
    if (firstInvalidEl) {
        firstInvalidEl.focus();
        firstInvalidEl.scrollIntoView({ behavior: "smooth", block: "center" });
        errorEl.textContent = errors.join(" | ");
        return;
    }

    // Submit payload
    submitBtn.disabled = true;
    submitBtn.textContent = "TRANSMITTING...";

    try {
        const token = await user.getIdToken();
        const payload = {
            displayName: lName,
            role: "Team Lead",
            phone: lPhone,
            whatsapp: lWhatsapp,
            college: lCollege,
            course: lCourse,
            gradYear: Number(lGradYear),
            github: lGithub,
            linkedin: lLinkedin,
            trackId: document.getElementById("trackSelect")?.value || undefined,
            problemStatement: document.getElementById("problemStatement")?.value || undefined,
            members: members
        };

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
            throw new Error(data.error?.message || "Failed to complete team registration.");
        }

        // Successfully completed onboarding
        formContainer.classList.add("hidden");
        successContainer.classList.remove("hidden");
        window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
        console.error("Submission error:", error);
        errorEl.textContent = error.message;
        submitBtn.disabled = false;
        submitBtn.textContent = "COMPLETE TEAM REGISTRATION";
    }
});
