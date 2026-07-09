import { auth, API_BASE, onAuthStateChanged } from "./firebase-init.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const MAX_MEMBERS = 4; // leader + 3 others = 4 total
const MIN_MEMBERS = 2;

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

/**
 * Enforce that a phone input only accepts digits and stays ≤10 chars.
 * The +91 prefix is displayed in the sibling .phone-prefix span — never in the input.
 */
function attachPhoneGuard(input) {
    input.addEventListener("input", () => {
        // Strip any non-digit characters the user may have typed
        let val = input.value.replace(/\D/g, "");
        // Also strip +91 / 91 prefix if accidentally pasted
        if (val.startsWith("91") && val.length > 10) val = val.slice(2);
        input.value = val.slice(0, 10);
    });
    input.addEventListener("paste", (e) => {
        e.preventDefault();
        let pasted = (e.clipboardData || window.clipboardData).getData("text");
        // Strip spaces, dashes, country code prefix
        pasted = pasted.replace(/[\s\-\(\)\.]/g, "").replace(/^\+?91/, "").replace(/\D/g, "");
        input.value = pasted.slice(0, 10);
    });
    input.addEventListener("keydown", (e) => {
        // Allow: backspace, delete, arrows, tab
        const allowed = ["Backspace","Delete","ArrowLeft","ArrowRight","Tab","Home","End"];
        if (!allowed.includes(e.key) && !/^\d$/.test(e.key)) {
            e.preventDefault();
        }
    });
}

/** Validate that a phone field contains exactly 10 digits */
function validatePhone(digits, label) {
    if (!/^\d{10}$/.test(digits)) {
        return `${label}: must be exactly 10 digits (got "${digits}")`;
    }
    return null;
}

// ─── Member count state ───────────────────────────────────────────────────────
let memberCount = 2; // starts with leader + 1 required member

// ─── Auth state ───────────────────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "/login.html";
        return;
    }

    // Pre-fill leader email (read-only)
    const leaderEmailInput = document.querySelector(
        "#membersContainer .member-row:first-child input[name='m_email']"
    );
    if (leaderEmailInput) {
        leaderEmailInput.value = user.email;
        leaderEmailInput.readOnly = true;
        leaderEmailInput.style.opacity = "0.7";
    }

    // Set leader role locked
    const leaderRoleInput = document.querySelector(
        "#membersContainer .member-row:first-child input[name='m_role']"
    );
    if (leaderRoleInput) {
        leaderRoleInput.value = "Leader";
        leaderRoleInput.readOnly = true;
        leaderRoleInput.style.opacity = "0.7";
        leaderRoleInput.style.cursor = "not-allowed";
    }

    // Attach phone guards to existing rows
    document.querySelectorAll("input[name='m_phone']").forEach(attachPhoneGuard);
    attachPhoneGuard(document.getElementById("leaderPhone"));

    // Fetch prefill data
    try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/team/prefill`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
            const data = await res.json();
            const prefill = data?.data?.prefill;
            if (prefill) {
                const set = (id, val) => {
                    const el = document.getElementById(id);
                    if (el && !el.value && val) el.value = val;
                };
                const setInput = (selector, val) => {
                    const el = document.querySelector(selector);
                    if (el && !el.value && val) el.value = val;
                };
                set("teamName", prefill.teamName);
                set("college", prefill.college);
                set("leaderName", prefill.leaderName);
                set("leaderPhone", prefill.leaderPhone?.replace(/^\+91/, ""));
                setInput("#membersContainer .member-row:first-child input[name='m_name']", prefill.leaderName);
                // Pre-select phone digits for leader member row too
                const leaderPhoneRow = document.querySelector(
                    "#membersContainer .member-row:first-child input[name='m_phone']"
                );
                if (leaderPhoneRow && !leaderPhoneRow.value && prefill.leaderPhone) {
                    leaderPhoneRow.value = prefill.leaderPhone.replace(/^\+91/, "").slice(0, 10);
                }
                // Pre-fill existing team data if re-editing
                if (prefill.track && trackSelect) {
                    trackSelect.value = prefill.track;
                }
                if (prefill.problemStatement) {
                    const psEl = document.getElementById("problemStatement");
                    if (psEl && !psEl.value) psEl.value = prefill.problemStatement;
                }
                if (prefill.isCustomPS !== undefined) {
                    const cb = document.getElementById("isCustomPS");
                    if (cb) cb.checked = !!prefill.isCustomPS;
                }
            }
        }
    } catch (err) {
        console.warn("Could not fetch prefill data:", err);
    }
});

// ─── Add Member ───────────────────────────────────────────────────────────────
addMemberBtn.addEventListener("click", () => {
    if (memberCount >= MAX_MEMBERS) {
        errorEl.textContent = `Maximum ${MAX_MEMBERS} members allowed (including you as leader).`;
        return;
    }
    memberCount++;
    errorEl.textContent = "";

    const row = document.createElement("div");
    row.className = "member-row bg-black/40 p-4 border border-border/50 relative mt-4";

    const badge = document.createElement("div");
    badge.className = "absolute -top-2 -left-2 bg-card text-muted-foreground font-mono text-[10px] px-2 py-0.5 border border-border";
    badge.style.fontFamily = "'JetBrains Mono', monospace";
    badge.textContent = `MEMBER ${memberCount}`;
    row.appendChild(badge);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "absolute -top-2 -right-2 text-white font-mono text-[10px] px-2 py-0.5 cursor-pointer";
    removeBtn.style.cssText = "font-family:'JetBrains Mono',monospace;background:var(--strike-red,#dc2626);";
    removeBtn.textContent = "×";
    removeBtn.onclick = () => {
        row.remove();
        memberCount--;
        // Re-number badges
        document.querySelectorAll(".member-row:not(:first-child) .absolute.-top-2.-left-2").forEach((b, i) => {
            if (!b.textContent.includes("LEADER")) b.textContent = `MEMBER ${i + 2}`;
        });
    };
    row.appendChild(removeBtn);

    const grid = document.createElement("div");
    grid.className = "member-row-grid";
    grid.innerHTML = `
        <input type="text" name="m_name" placeholder="FULL NAME *" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full" style="font-family:'JetBrains Mono',monospace;">
        <input type="email" name="m_email" placeholder="EMAIL *" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full" style="font-family:'JetBrains Mono',monospace;">
        <div class="phone-wrapper">
            <span class="phone-prefix" style="font-size:10px;">+91</span>
            <input type="text" name="m_phone" placeholder="10-DIGIT PHONE *" required maxlength="10" pattern="\\d{10}" class="bg-input border border-border px-2 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full" style="font-family:'JetBrains Mono',monospace;">
        </div>
        <input type="text" name="m_role" placeholder="ROLE (e.g. Developer) *" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full" style="font-family:'JetBrains Mono',monospace;">
        <input type="text" name="m_college" placeholder="COLLEGE *" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full" style="font-family:'JetBrains Mono',monospace;">
        <input type="text" name="m_github" placeholder="GITHUB (optional)" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full" style="font-family:'JetBrains Mono',monospace;">
    `;
    row.appendChild(grid);
    membersContainer.appendChild(row);

    // Attach phone guard to newly created phone input
    attachPhoneGuard(row.querySelector("input[name='m_phone']"));
});

// ─── Form Submit ──────────────────────────────────────────────────────────────
form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorEl.textContent = "";

    // ── Gather field values ──
    const teamName        = document.getElementById("teamName").value.trim();
    const college         = document.getElementById("college").value.trim();
    const department      = document.getElementById("department").value.trim();
    const year            = document.getElementById("year").value.trim();
    const state           = document.getElementById("state").value.trim();
    const city            = document.getElementById("city").value.trim();
    const leaderName      = document.getElementById("leaderName").value.trim();
    const leaderPhoneRaw  = document.getElementById("leaderPhone").value.trim();
    const leaderGithub    = document.getElementById("leaderGithub").value.trim() || null;
    const leaderLinkedin  = document.getElementById("leaderLinkedin").value.trim() || null;
    const track           = document.getElementById("trackSelect").value;
    const problemStatement= document.getElementById("problemStatement").value.trim();
    const isCustomPS      = document.getElementById("isCustomPS").checked;

    // ── Client-side validation ──
    if (!track) { errorEl.textContent = "Please select a track."; return; }
    if (!problemStatement || problemStatement.length < 10) {
        errorEl.textContent = "Please enter a problem statement (minimum 10 characters).";
        return;
    }

    const leaderPhoneErr = validatePhone(leaderPhoneRaw, "Leader phone");
    if (leaderPhoneErr) { errorEl.textContent = leaderPhoneErr; return; }

    // ── Gather members ──
    const memberRows = document.querySelectorAll(".member-row");
    if (memberRows.length < MIN_MEMBERS || memberRows.length > MAX_MEMBERS) {
        errorEl.textContent = `You must have between ${MIN_MEMBERS} and ${MAX_MEMBERS} members (including yourself).`;
        return;
    }

    const members = [];
    const emailsSeen = new Set();
    const phonesSeen = new Set();
    let validationError = null;

    memberRows.forEach((row, i) => {
        if (validationError) return;

        const name    = row.querySelector('input[name="m_name"]').value.trim();
        const email   = row.querySelector('input[name="m_email"]').value.trim().toLowerCase();
        const phone   = row.querySelector('input[name="m_phone"]').value.trim();
        const role    = row.querySelector('input[name="m_role"]').value.trim();
        const memberCollege = row.querySelector('input[name="m_college"]').value.trim();
        const github  = row.querySelector('input[name="m_github"]')?.value.trim() || null;

        const label = i === 0 ? "Leader phone" : `Member ${i + 1} phone`;
        const phoneErr = validatePhone(phone, label);
        if (phoneErr) { validationError = phoneErr; return; }

        if (emailsSeen.has(email)) {
            validationError = `Duplicate email: "${email}" — each member must have a unique email.`;
            return;
        }
        emailsSeen.add(email);

        if (phonesSeen.has(phone)) {
            validationError = `Duplicate phone detected — each member must have a unique phone number.`;
            return;
        }
        phonesSeen.add(phone);

        if (!name || !email || !memberCollege) {
            validationError = `Please fill in all required fields for ${i === 0 ? "the leader" : `member ${i + 1}`}.`;
            return;
        }

        members.push({ name, email, phone, role, college: memberCollege, github });
    });

    if (validationError) { errorEl.textContent = validationError; return; }

    // ── Submit ──
    submitBtn.disabled = true;
    submitBtn.textContent = "TRANSMITTING...";

    try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");

        const token = await user.getIdToken();

        const payload = {
            teamName,
            college,
            department,
            year,
            state,
            city,
            leaderName,
            leaderPhone: leaderPhoneRaw,  // server normalises to +91
            leaderGithub,
            leaderLinkedin,
            track,
            problemStatement,
            isCustomPS,
            members,
        };

        const res = await fetch(`${API_BASE}/team/submit`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error?.message || "Failed to submit profile");
        }

        window.location.href = "/dashboard.html";
    } catch (error) {
        console.error("Submission error:", error);
        errorEl.textContent = error.message;
        submitBtn.disabled = false;
        submitBtn.textContent = "INITIATE TEAM PROFILE";
    }
});
