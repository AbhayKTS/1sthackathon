import { auth, API_BASE, onAuthStateChanged, signOut } from "./firebase-init.js";


document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("onboardingForm");
    const membersContainer = document.getElementById("membersContainer");
    const addMemberBtn = document.getElementById("addMemberBtn");
    const errorEl = document.getElementById("formError");
    const submitBtn = document.getElementById("submitBtn");

    // Check for rejection notes
    const notesJson = sessionStorage.getItem('rh_need_changes');
    if (notesJson) {
        try {
            const history = JSON.parse(notesJson);
            if (history && history.length > 0) {
                const latestNote = history[history.length - 1].notes;
                document.getElementById("rejectionNotesContainer").classList.remove("hidden");
                document.getElementById("rejectionNotesText").textContent = latestNote;
            }
        } catch(e) {
            console.error(e);
        }
    }

    let memberCount = 2;

    // Wait for auth state
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            window.location.href = '/login.html';
        } else {
            // Pre-fill leader email from Firebase auth
            const leaderEmailInput = document.querySelector('#membersContainer .member-row:first-child input[name="m_email"]');
            if (leaderEmailInput) {
                leaderEmailInput.value = user.email;
                leaderEmailInput.readOnly = true;
                leaderEmailInput.style.opacity = "0.7";
            }

            // Always lock the leader role to "Leader"
            const leaderRoleInput = document.querySelector('#membersContainer .member-row:first-child input[name="m_role"]');
            if (leaderRoleInput) {
                leaderRoleInput.value = "Leader";
                leaderRoleInput.readOnly = true;
                leaderRoleInput.style.opacity = "0.7";
                leaderRoleInput.style.cursor = "not-allowed";
            }

            // Fetch prefill data from backend (leader name, phone, team name, college)
            try {
                const token = await user.getIdToken();
                const res = await fetch(`${API_BASE}/team/prefill`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                if (res.ok) {
                    const data = await res.json();
                    const prefill = data?.data?.prefill;

                    if (prefill) {
                        // Auto-fill team name
                        const teamNameInput = document.getElementById("teamName");
                        if (teamNameInput && !teamNameInput.value && prefill.teamName) {
                            teamNameInput.value = prefill.teamName;
                        }

                        // Auto-fill college
                        const collegeInput = document.getElementById("college");
                        if (collegeInput && !collegeInput.value && prefill.college) {
                            collegeInput.value = prefill.college;
                        }

                        // Auto-fill leader name
                        const leaderNameInput = document.querySelector('#membersContainer .member-row:first-child input[name="m_name"]');
                        if (leaderNameInput && !leaderNameInput.value && prefill.leaderName) {
                            leaderNameInput.value = prefill.leaderName;
                        }

                        // Auto-fill leader phone
                        const leaderPhoneInput = document.querySelector('#membersContainer .member-row:first-child input[name="m_phone"]');
                        if (leaderPhoneInput && !leaderPhoneInput.value && prefill.leaderPhone) {
                            leaderPhoneInput.value = prefill.leaderPhone;
                        }
                    }
                }
            } catch (err) {
                console.warn("Could not fetch prefill data:", err);
            }
        }
    });

    addMemberBtn.addEventListener("click", () => {
        if (memberCount >= 4) {
            alert("Maximum 4 members allowed.");
            return;
        }

        memberCount++;
        
        const row = document.createElement("div");
        row.className = "member-row grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 bg-black/40 p-6 border border-border/50 relative mt-4";
        
        // Remove button
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "absolute -top-3 -right-3 bg-strike-red text-white font-mono text-xs px-3 py-1 cursor-pointer font-bold";
        removeBtn.style.fontFamily = "'JetBrains Mono', monospace";
        removeBtn.style.backgroundColor = "var(--strike-red)";
        removeBtn.textContent = "X";
        removeBtn.onclick = () => {
            row.remove();
            memberCount--;
        };
        
        row.innerHTML = `
            <input type="text" name="m_name" placeholder="FULL NAME" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full">
            <input type="email" name="m_email" placeholder="EMAIL" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full">
            <input type="text" name="m_phone" placeholder="MOBILE NUMBER" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full">
            <input type="text" name="m_role" placeholder="ROLE (e.g. Developer)" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full">
            <input type="url" name="m_github" placeholder="GITHUB PROFILE URL" class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full md:col-span-2 lg:col-span-4">
        `;
        
        row.appendChild(removeBtn);
        membersContainer.appendChild(row);
    });

    form.addEventListener("submit", async (e) => {
        e.preventDefault();
        errorEl.textContent = "";
        
        const teamName = document.getElementById("teamName").value.trim();
        const college = document.getElementById("college").value.trim();
        
        const memberRows = document.querySelectorAll(".member-row");
        const members = [];
        
        memberRows.forEach(row => {
            members.push({
                name: row.querySelector('input[name="m_name"]').value.trim(),
                email: row.querySelector('input[name="m_email"]').value.trim(),
                phone: row.querySelector('input[name="m_phone"]').value.trim(),
                role: row.querySelector('input[name="m_role"]').value.trim(),
                github: row.querySelector('input[name="m_github"]')?.value.trim() || "",
            });
        });

        if (members.length < 2 || members.length > 4) {
            errorEl.textContent = "You must have between 2 and 4 members.";
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "TRANSMITTING...";

        try {
            const user = auth.currentUser;
            if (!user) throw new Error("Not authenticated");
            
            const token = await user.getIdToken();
            
            const res = await fetch(`${API_BASE}/team/submit`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ teamName, college, members })
            });
            
            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error?.message || "Failed to submit profile");
            }
            
            // Redirect to dashboard now that profile is submitted
            window.location.href = '/dashboard.html';
            
        } catch (error) {
            console.error("Submission error:", error);
            errorEl.textContent = error.message;
            submitBtn.disabled = false;
            submitBtn.textContent = "INITIATE TEAM PROFILE";
        }
    });
});
