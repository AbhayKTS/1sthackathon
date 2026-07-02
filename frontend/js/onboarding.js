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
    onAuthStateChanged(auth, (user) => {
        if (!user) {
            window.location.href = '/login.html';
        } else {
            // Pre-fill leader email
            const leaderEmailInput = document.querySelector('input[name="m_email"]');
            if (leaderEmailInput && !leaderEmailInput.value) {
                leaderEmailInput.value = user.email;
                leaderEmailInput.readOnly = true;
                leaderEmailInput.style.opacity = "0.7";
            }
        }
    });

    addMemberBtn.addEventListener("click", () => {
        if (memberCount >= 5) {
            alert("Maximum 5 members allowed.");
            return;
        }

        memberCount++;
        
        const row = document.createElement("div");
        row.className = "member-row grid grid-cols-1 md:grid-cols-4 gap-2 bg-black/40 p-4 border border-border/50 relative mt-4";
        
        // Remove button
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "absolute -top-2 -right-2 bg-strike-red text-white font-mono text-[10px] px-2 py-0.5 cursor-pointer";
        removeBtn.style.fontFamily = "'JetBrains Mono', monospace";
        removeBtn.style.backgroundColor = "var(--strike-red)";
        removeBtn.textContent = "X";
        removeBtn.onclick = () => {
            row.remove();
            memberCount--;
        };
        
        row.innerHTML = `
            <input type="text" name="m_name" placeholder="FULL NAME" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full col-span-1 md:col-span-1" style="font-family: 'JetBrains Mono', monospace;">
            <input type="email" name="m_email" placeholder="EMAIL" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full col-span-1 md:col-span-1" style="font-family: 'JetBrains Mono', monospace;">
            <input type="text" name="m_phone" placeholder="PHONE" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full col-span-1 md:col-span-1" style="font-family: 'JetBrains Mono', monospace;">
            <input type="text" name="m_role" placeholder="ROLE (e.g. Developer)" required class="bg-input border border-border px-3 py-2 font-mono text-xs focus:outline-none focus:border-blood w-full col-span-1 md:col-span-1" style="font-family: 'JetBrains Mono', monospace;">
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
            });
        });

        if (members.length < 2 || members.length > 5) {
            errorEl.textContent = "You must have between 2 and 5 members.";
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
