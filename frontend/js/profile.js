import {
    auth,
    db,
    doc,
    getDoc,
    API_BASE
} from "./firebase-init.js";

const logoutBtn = document.getElementById("logoutBtn");
const profileForm = document.getElementById("profileForm");
const loading = document.getElementById("loading");
const statusBanner = document.getElementById("statusBanner");
const teamNameInput = document.getElementById("teamName");
const collegeInput = document.getElementById("college");
const membersContainer = document.getElementById("membersContainer");
const addMemberBtn = document.getElementById("addMemberBtn");
const saveBtn = document.getElementById("saveBtn");
const formError = document.getElementById("formError");
const formSuccess = document.getElementById("formSuccess");
const userDisplayName = document.getElementById("userDisplayName");

let currentUser = null;
let currentToken = null;
let teamData = null;
let membersList = [];

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = "/login.html";
        return;
    }
    currentUser = user;
    currentToken = await user.getIdToken();
    
    // Set user menu name
    userDisplayName.textContent = user.displayName || user.email?.split('@')[0].toUpperCase() || "HACKER";

    loadProfile();
});

if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        auth.signOut();
    });
}

async function loadProfile() {
    try {
        const userDoc = await getDoc(doc(db, "users", currentUser.uid));
        if (!userDoc.exists()) throw new Error("User record not found");

        const userData = userDoc.data();
        
        if (!userData.teamId) {
            // Not in a team yet, redirect to onboarding or show message
            loading.textContent = "NO TEAM ASSIGNED YET. RETURN TO DASHBOARD.";
            return;
        }

        const teamDoc = await getDoc(doc(db, "teams", userData.teamId));
        if (!teamDoc.exists()) throw new Error("Team record not found");

        teamData = teamDoc.data();
        
        // Hide loading, show form
        loading.classList.add("hidden");
        profileForm.classList.remove("hidden");

        // Populate fields
        teamNameInput.value = teamData.teamName || "";
        collegeInput.value = teamData.college || "";
        membersList = teamData.members || [];

        renderMembers();

        // Check lock status
        const isLocked = ['Submitted', 'Approved', 'Rejected'].includes(teamData.status);
        
        statusBanner.classList.remove("hidden");
        if (isLocked) {
            statusBanner.className = "mb-6 p-4 border border-amber-500/50 bg-amber-500/10 text-amber-500 font-mono text-xs tracking-widest";
            statusBanner.innerHTML = `PROFILE LOCKED // STATUS: ${teamData.status.toUpperCase()} // MODIFICATIONS DISABLED`;
            
            // Disable form
            const inputs = profileForm.querySelectorAll('input, button');
            inputs.forEach(input => input.disabled = true);
            saveBtn.classList.add("hidden");
            addMemberBtn.classList.add("hidden");
        } else {
            statusBanner.className = "mb-6 p-4 border border-emerald-500/50 bg-emerald-500/10 text-emerald-500 font-mono text-xs tracking-widest";
            statusBanner.innerHTML = `PROFILE UNLOCKED // STATUS: ${teamData.status.toUpperCase()} // MODIFICATIONS PERMITTED`;
        }

    } catch (error) {
        console.error(error);
        loading.textContent = "ERROR FETCHING INTELLIGENCE: " + error.message;
        loading.classList.add("text-strike-red");
    }
}

function renderMembers() {
    membersContainer.innerHTML = "";
    membersList.forEach((member, index) => {
        const div = document.createElement("div");
        div.className = "p-4 border border-border/40 bg-black/20 relative";
        
        // Leader (index 0) cannot be removed easily in this UI
        const isLeader = index === 0;
        
        div.innerHTML = `
            ${isLeader ? '<div class="absolute -top-2 left-4 bg-blood text-primary-foreground px-2 py-0.5 text-[9px] font-bold">LEADER</div>' : ''}
            ${!isLeader && !isLocked() ? `<button type="button" class="absolute top-2 right-2 text-muted-foreground hover:text-strike-red cursor-pointer" onclick="removeMember(${index})">✕</button>` : ''}
            
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                <div>
                    <label class="block text-muted-foreground mb-1 text-[10px] tracking-widest">NAME</label>
                    <input type="text" value="${member.name || ''}" onchange="updateMember(${index}, 'name', this.value)" required ${isLocked() ? 'disabled' : ''} class="bg-input border border-border px-3 py-1.5 w-full text-foreground focus:border-blood focus:outline-none disabled:opacity-50">
                </div>
                <div>
                    <label class="block text-muted-foreground mb-1 text-[10px] tracking-widest">EMAIL</label>
                    <input type="email" value="${member.email || ''}" onchange="updateMember(${index}, 'email', this.value)" required ${isLocked() || isLeader ? 'disabled' : ''} class="bg-input border border-border px-3 py-1.5 w-full text-foreground focus:border-blood focus:outline-none disabled:opacity-50">
                </div>
                <div>
                    <label class="block text-muted-foreground mb-1 text-[10px] tracking-widest">PHONE (OPTIONAL)</label>
                    <input type="text" value="${member.phone || ''}" onchange="updateMember(${index}, 'phone', this.value)" ${isLocked() ? 'disabled' : ''} class="bg-input border border-border px-3 py-1.5 w-full text-foreground focus:border-blood focus:outline-none disabled:opacity-50">
                </div>
                <div>
                    <label class="block text-muted-foreground mb-1 text-[10px] tracking-widest">ROLE</label>
                    <input type="text" value="${member.role || ''}" onchange="updateMember(${index}, 'role', this.value)" required ${isLocked() ? 'disabled' : ''} class="bg-input border border-border px-3 py-1.5 w-full text-foreground focus:border-blood focus:outline-none disabled:opacity-50">
                </div>
            </div>
        `;
        membersContainer.appendChild(div);
    });

    if (addMemberBtn) {
        addMemberBtn.disabled = membersList.length >= 5 || isLocked();
        if (membersList.length >= 5) {
            addMemberBtn.classList.add("opacity-50", "cursor-not-allowed");
        } else {
            addMemberBtn.classList.remove("opacity-50", "cursor-not-allowed");
        }
    }
}

window.updateMember = function(index, field, value) {
    membersList[index][field] = value;
}

window.removeMember = function(index) {
    if (isLocked() || index === 0) return;
    membersList.splice(index, 1);
    renderMembers();
}

function isLocked() {
    return teamData && ['Submitted', 'Approved', 'Rejected'].includes(teamData.status);
}

if (addMemberBtn) {
    addMemberBtn.addEventListener("click", () => {
        if (membersList.length < 5 && !isLocked()) {
            membersList.push({ name: '', email: '', phone: '', role: '' });
            renderMembers();
        }
    });
}

if (profileForm) {
    profileForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        formError.classList.add("hidden");
        formSuccess.classList.add("hidden");

        if (membersList.length < 2 || membersList.length > 5) {
            formError.textContent = "You must have between 2 and 5 operatives.";
            formError.classList.remove("hidden");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = "TRANSMITTING...";

        try {
            const payload = {
                teamName: teamNameInput.value,
                college: collegeInput.value,
                members: membersList
            };

            const res = await fetch(`${API_BASE}/team/update`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${currentToken}`
                },
                body: JSON.stringify(payload)
            });

            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error?.message || "Update failed");
            }

            formSuccess.textContent = "PROTOCOL UPDATED SUCCESSFULLY. REFRESHING...";
            formSuccess.classList.remove("hidden");
            
            setTimeout(() => {
                window.location.reload();
            }, 1500);

        } catch (error) {
            console.error(error);
            formError.textContent = error.message;
            formError.classList.remove("hidden");
            saveBtn.disabled = false;
            saveBtn.textContent = "SAVE PROTOCOL";
        }
    });
}
