import {
    auth,
    db,
    API_BASE,
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    getDocs,
    addDoc,
    serverTimestamp,
    onSnapshot,
    orderBy,
    updateDoc,
    onAuthStateChanged,
    signOut
} from "./firebase-init.js";

// ─── SECURITY: Session Inactivity Timeout ───────────────────────
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
let inactivityTimer = null;

function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        // Auto-logout on inactivity
        signOut(auth).then(() => {
            sessionStorage.clear();
            localStorage.removeItem('rh_login_attempts');
            alert('Session expired due to inactivity. Please log in again.');
            window.location.href = '/login';
        });
    }, SESSION_TIMEOUT_MS);
}

// Track user activity
['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(event => {
    document.addEventListener(event, resetInactivityTimer, { passive: true });
});
resetInactivityTimer(); // Start timer on load

// ─── SECURITY: Input Sanitization Helper ────────────────────────
function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// DOM Elements
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");

const statInvited = document.getElementById("statInvited");
const statUsers = document.getElementById("statUsers");
const statSubmitted = document.getElementById("statSubmitted");
const statApproved = document.getElementById("statApproved");

const teamsTableBody = document.getElementById("teamsTableBody");
const submissionsTableBody = document.getElementById("submissionsTableBody");


const roundSelect = document.getElementById("roundSelect");
const activateRoundBtn = document.getElementById("activateRoundBtn");

const announcementForm = document.getElementById("announcementForm");
const annTitle = document.getElementById("annTitle");
const annMessage = document.getElementById("annMessage");
const annStatus = document.getElementById("annStatus");
const annSubmitBtn = document.getElementById("annSubmitBtn");

let currentAdminDoc = null;

// Firebase listener unsubscribers and memory cache
let teamsUnsubscriber = null;
let submissionsUnsubscriber = null;

const teamCache = new Map();
const roundCache = new Map();

function cleanupListeners() {
    if (teamsUnsubscriber) {
        teamsUnsubscriber();
        teamsUnsubscriber = null;
    }
    if (submissionsUnsubscriber) {
        submissionsUnsubscriber();
        submissionsUnsubscriber = null;
    }
}

async function precacheRounds() {
    try {
        const roundsRef = collection(db, "rounds");
        const snapshot = await getDocs(roundsRef);
        snapshot.forEach(d => {
            roundCache.set(d.id, d.data().title || d.id);
        });
    } catch (e) {
        console.error("Error pre-caching rounds:", e);
    }
}

// Enforce Auth and Admin Role
onAuthStateChanged(auth, async (user) => {
    cleanupListeners();

    if (!user) {
        window.location.href = '/login';
        return;
    }
    
    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            const data = userSnap.data();
            if (data.role !== "admin" && data.role !== "super_admin") {
                // Not an admin, kick to dashboard
                window.location.href = '/dashboard.html';
                return;
            }
            currentAdminDoc = data;
            const isSuperAdmin = data.role === 'super_admin';
            userEmailDisplay.textContent = isSuperAdmin ? `SUPER ADMIN: ${user.email}` : `ADMIN: ${user.email}`;
            
            // Unlock super_admin-only UI
            if (isSuperAdmin) {
                document.body.classList.add('is-superadmin');
                // Also show superadmin-only inline elements (overrides display:none)
                document.querySelectorAll('.superadmin-only').forEach(el => {
                    el.style.removeProperty('display');
                });
            }
            
            // Precache rounds and load admin data
            await precacheRounds();
            loadTeams();
            loadSubmissions();
            fetchAnalytics(user);
            
        } else {
            // No user doc found, redirect to login
            window.location.href = '/login';
        }
    } catch (error) {
        console.error("Error verifying admin:", error);
    }
});

async function fetchAnalytics(user) {
    try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_BASE}/admin/analytics`, {
            headers: {
                "Authorization": `Bearer ${token}`
            }
        });

        if (res.ok) {
            const data = await res.json();
            if (data.success && data.data) {
                const metrics = data.data;
                if (statInvited) statInvited.textContent = metrics.totalInvited;
                if (statUsers) statUsers.textContent = metrics.totalUsers;
                if (statSubmitted) statSubmitted.textContent = metrics.totalTeamsSubmitted;
                if (statApproved) statApproved.textContent = metrics.totalTeamsApproved;
                const statLeads = document.getElementById('statLeads');
                if (statLeads && metrics.totalLeads != null) statLeads.textContent = metrics.totalLeads;
            }
        } else {
            console.error("Failed to fetch analytics", await res.text());
        }
    } catch (e) {
        console.error("Error fetching analytics", e);
    }
}

// Logout — clear all session data
logoutBtn.addEventListener("click", () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    cleanupListeners();
    signOut(auth).then(() => {
        sessionStorage.clear();
        localStorage.removeItem('rh_login_attempts');
        window.location.href = '/login';
    });
});

// Load Teams
function loadTeams() {
    if (teamsUnsubscriber) teamsUnsubscriber();

    const teamsRef = collection(db, "teams");
    teamsUnsubscriber = onSnapshot(teamsRef, (snapshot) => {
        
        if (snapshot.empty) {
            teamsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.5);">No teams found.</td></tr>`;
            return;
        }
        
        teamsTableBody.innerHTML = "";
        snapshot.forEach((doc) => {
            const team = doc.data();
            const teamId = doc.id;
            
            // Populate persistent teamCache
            teamCache.set(teamId, team.teamName || 'Unnamed');

            const tr = document.createElement("tr");
            
            const membersList = team.members ? team.members.map(m => sanitizeHTML(m.name)).join(", ") : "None";
            
            let statusColor = "rgba(255,255,255,0.5)";
            let statusText = team.status || "Unknown";
            if (statusText === 'Approved') statusColor = "#4ade80";
            if (statusText === 'Rejected') statusColor = "var(--strike-red)";
            if (statusText === 'Submitted') statusColor = "#fbbf24";
            if (statusText === 'Incomplete') statusColor = "#f97316";

            let actionHtml = '';
            if (statusText === 'Submitted') {
                const updatedMs = team.updatedAt?.toMillis ? team.updatedAt.toMillis() : Date.now();
                actionHtml = `
                    <button class="btn-outline review-btn" data-action="approve" data-id="${sanitizeHTML(teamId)}" data-updated="${updatedMs}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #4ade80; color: #4ade80; margin-right: 5px;">APPROVE</button>
                    <button class="btn-outline review-btn" data-action="reject" data-id="${sanitizeHTML(teamId)}" data-updated="${updatedMs}" style="padding: 4px 8px; font-size: 0.7rem; border-color: var(--strike-red); color: var(--strike-red); margin-right: 5px;">REJECT</button>
                    <button class="btn-outline review-btn" data-action="needChanges" data-id="${sanitizeHTML(teamId)}" data-updated="${updatedMs}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #f97316; color: #f97316;">CHANGES</button>
                `;
            } else if (statusText === 'Incomplete' && team.needChangesHistory && team.needChangesHistory.length > 0) {
                // Show latest note snippet
                const latestNote = team.needChangesHistory[team.needChangesHistory.length - 1].notes;
                actionHtml = `<span style="font-size: 0.7rem; color: rgba(255,255,255,0.5); font-style: italic;">Note: ${sanitizeHTML(latestNote.substring(0, 20))}...</span>`;
            } else {
                actionHtml = `<span style="font-size: 0.7rem; color: rgba(255,255,255,0.3);">NO ACTION</span>`;
            }

            if (currentAdminDoc?.role === 'super_admin') {
                actionHtml += `
                    <button class="btn-outline edit-team-btn" data-id="${sanitizeHTML(teamId)}" data-name="${sanitizeHTML(team.teamName || '')}" data-college="${sanitizeHTML(team.college || '')}" data-status="${sanitizeHTML(statusText)}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #3b82f6; color: #3b82f6; margin-left: 5px;">EDIT</button>
                `;
            }

            tr.innerHTML = `
                <td><strong>${sanitizeHTML(team.teamName || 'Unnamed')}</strong></td>
                <td>${membersList}</td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: bold; color: ${statusColor};">${sanitizeHTML(statusText)}</span></td>
                <td>${actionHtml}</td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: rgba(255,255,255,0.5);">${sanitizeHTML(teamId)}</span></td>
            `;
            teamsTableBody.appendChild(tr);
        });

        // Attach event listeners to newly rendered buttons
        document.querySelectorAll('.review-btn').forEach(btn => {
            btn.addEventListener('click', handleReviewAction);
        });
        
        document.querySelectorAll('.edit-team-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const b = e.target;
                openEditTeamModal(b.dataset.id, b.dataset.name, b.dataset.college, b.dataset.status);
            });
        });

    }, (error) => {
        console.error("Error loading teams:", error);
    });
}

// Handle Admin Review Actions
async function handleReviewAction(e) {
    const btn = e.target;
    const action = btn.getAttribute('data-action');
    const teamId = btn.getAttribute('data-id');
    const lastUpdatedAt = parseInt(btn.getAttribute('data-updated'), 10);

    let notes = '';
    if (action === 'needChanges') {
        notes = prompt("Enter the required changes (will be shown to the team):");
        if (notes === null || notes.trim() === '') return; // User cancelled or left empty
    } else if (action === 'reject') {
        const confirmReject = confirm("Are you sure you want to REJECT this team? They will be locked out.");
        if (!confirmReject) return;
    }

    btn.disabled = true;
    btn.textContent = "WAIT...";

    try {
        const idToken = await auth.currentUser.getIdToken(true);

        const payload = {
            teamId,
            action,
            lastUpdatedAt,
            ...(notes ? { notes: notes.trim() } : {})
        };

        const response = await fetch(`${API_BASE}/admin/review-team`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Review action failed');
        }

        // We don't need to manually update the UI; the onSnapshot listener will re-render automatically.
    } catch (error) {
        console.error("Review action error:", error);
        alert(`Error: ${error.message}`);
        btn.disabled = false;
        btn.textContent = action.toUpperCase();
    }
}

// Load Submissions
function loadSubmissions() {
    if (submissionsUnsubscriber) submissionsUnsubscriber();

    const submissionsRef = collection(db, "submissions");
    const q = query(submissionsRef, orderBy("submittedAt", "desc"));
    
    submissionsUnsubscriber = onSnapshot(q, (snapshot) => {
        
        if (snapshot.empty) {
            submissionsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.5);">No submissions found.</td></tr>`;
            return;
        }
        
        submissionsTableBody.innerHTML = "";
        
        snapshot.forEach((sDoc) => {
            const sub = sDoc.data();
            const subId = sDoc.id;
            const teamId = sub.teamId;
            const roundId = sub.roundId;
            
            const teamName = teamCache.get(teamId) || teamId;
            const roundName = roundCache.get(roundId) || roundId;
            
            const date = sub.submittedAt ? sub.submittedAt.toDate().toLocaleString() : "Unknown";
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong id="sub-team-${subId}">${sanitizeHTML(teamName)}</strong></td>
                <td><span id="sub-round-${subId}">${sanitizeHTML(roundName)}</span></td>
                <td><a href="${sanitizeHTML(sub.githubLink)}" target="_blank" rel="noopener noreferrer">Repo ↗</a></td>
                <td><a href="${sanitizeHTML(sub.demoLink)}" target="_blank" rel="noopener noreferrer">Demo ↗</a></td>
                <td style="font-size: 0.8rem; color: rgba(255,255,255,0.5);">${date}</td>
            `;
            submissionsTableBody.appendChild(tr);
            
            // Resolve Team Name in background if missing from cache
            if (!teamCache.has(teamId)) {
                getDoc(doc(db, "teams", teamId)).then(teamSnap => {
                    if (teamSnap.exists()) {
                        const name = teamSnap.data().teamName || teamId;
                        teamCache.set(teamId, name);
                        const cell = document.getElementById(`sub-team-${subId}`);
                        if (cell) cell.textContent = name;
                    }
                }).catch(err => console.error("Error fetching team in background:", err));
            }
            
            // Resolve Round Name in background if missing from cache
            if (!roundCache.has(roundId)) {
                getDoc(doc(db, "rounds", roundId)).then(roundSnap => {
                    if (roundSnap.exists()) {
                        const title = roundSnap.data().title || roundId;
                        roundCache.set(roundId, title);
                        const cell = document.getElementById(`sub-round-${subId}`);
                        if (cell) cell.textContent = title;
                    }
                }).catch(err => console.error("Error fetching round in background:", err));
            }
        });
    }, (error) => {
        console.error("Error loading submissions:", error);
    });
}

// Activate Round — SECURED via Next.js API
activateRoundBtn.addEventListener("click", async () => {
    const selectedRoundTitle = roundSelect.value;
    if (!selectedRoundTitle) {
        alert("Please select a round first.");
        return;
    }
    
    // Verify admin is still authenticated
    if (!auth.currentUser) {
        alert("Session expired. Please log in again.");
        window.location.href = '/login';
        return;
    }

    // Confirm action
    const confirmed = confirm(`Are you sure you want to activate "${selectedRoundTitle}"? This will deactivate all other rounds.`);
    if (!confirmed) return;

    activateRoundBtn.disabled = true;
    activateRoundBtn.textContent = "ACTIVATING...";

    try {
        const roundMap = {
            "Round 1": { id: "round-1", title: "Round 1", desc: "Show Us What You Got" },
            "Round 2": { id: "round-2", title: "Round 2", desc: "We Ride At Midnight" },
            "Round 3": { id: "round-3", title: "Round 3", desc: "Seek The Way In Or Out" }
        };
        
        const chosen = roundMap[selectedRoundTitle];
        if (!chosen) { alert("Invalid round selected."); return; }
        
        const idToken = await auth.currentUser.getIdToken(true);

        const payload = {
            roundId: chosen.id,
            roundTitle: chosen.title,
            roundDesc: chosen.desc
        };

        const response = await fetch(`${API_BASE}/admin/activate-round`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to activate round');
        }

        alert("Round successfully activated!");
    } catch (error) {
        console.error("Error activating round:", error);
        alert("Error activating round: " + error.message);
    } finally {
        activateRoundBtn.disabled = false;
        activateRoundBtn.textContent = "ACTIVATE CHOSEN ROUND";
    }
});


// Broadcast Announcement Form via API
announcementForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    annSubmitBtn.disabled = true;
    annSubmitBtn.textContent = "TRANSMITTING...";
    annStatus.textContent = "";
    
    try {
        const idToken = await auth.currentUser.getIdToken(true);

        const payload = {
            title: sanitizeHTML(annTitle.value),
            message: sanitizeHTML(annMessage.value)
        };

        const response = await fetch(`${API_BASE}/admin/announcement`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to broadcast announcement');
        }
        
        annStatus.textContent = "Broadcast transmitted to all dashboards.";
        annStatus.style.color = "#4ade80";
        announcementForm.reset();
        
        setTimeout(() => { annStatus.textContent = ""; }, 4000);
    } catch (error) {
        console.error("Error sending broadcast:", error);
        annStatus.textContent = `Transmission failed: ${error.message}`;
        annStatus.style.color = "var(--strike-red)";
    } finally {
        annSubmitBtn.disabled = false;
        annSubmitBtn.textContent = "TRANSMIT";
    }
});

// CSV Import
const importCsvForm = document.getElementById("importCsvForm");
const csvFileInput = document.getElementById("csvFileInput");
const importSubmitBtn = document.getElementById("importSubmitBtn");
const importStatus = document.getElementById("importStatus");

if (importCsvForm) {
    importCsvForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const file = csvFileInput.files[0];
        if (!file) return;

        importSubmitBtn.disabled = true;
        importSubmitBtn.textContent = "UPLOADING...";
        importStatus.textContent = "";

        try {
            // Get fresh Firebase ID token
            const idToken = await auth.currentUser.getIdToken(true);
            
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${API_BASE}/admin/import-csv`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${idToken}`
                },
                body: formData
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error?.message || 'Import failed');
            }

            importStatus.innerHTML = `✅ <strong>Success!</strong><br>
                Imported: ${result.data.stats.imported}<br>
                Skipped (duplicates): ${result.data.stats.skipped}<br>
                Failed: ${result.data.stats.failed}`;
            importStatus.style.color = "#4ade80";
            importCsvForm.reset();
            
        } catch (error) {
            console.error("CSV Import Error:", error);
            importStatus.textContent = `❌ Error: ${error.message}`;
            importStatus.style.color = "var(--strike-red)";
        } finally {
            importSubmitBtn.disabled = false;
            importSubmitBtn.textContent = "UPLOAD TEAMS";
        }
    });
}

// Manual Invite
const manualInviteForm = document.getElementById("manualInviteForm");
const manualInviteBtn = document.getElementById("manualInviteBtn");

if (manualInviteForm) {
    manualInviteForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        manualInviteBtn.disabled = true;
        manualInviteBtn.textContent = "ADDING...";

        const payload = {
            teamName: document.getElementById("mi_team").value.trim(),
            leaderName: document.getElementById("mi_leader").value.trim(),
            leaderEmail: document.getElementById("mi_email").value.trim(),
            leaderPhone: document.getElementById("mi_phone").value.trim(),
            college: document.getElementById("mi_college").value.trim()
        };

        try {
            const idToken = await auth.currentUser.getIdToken(true);
            const response = await fetch(`${API_BASE}/admin/invite-team`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error?.message || 'Manual invite failed');
            }

            alert("Team successfully invited!");
            manualInviteForm.reset();
        } catch (error) {
            console.error("Manual Invite Error:", error);
            alert("Error: " + error.message);
        } finally {
            manualInviteBtn.disabled = false;
            manualInviteBtn.textContent = "ADD TEAM";
        }
    });
}

// Create Admin (super_admin only)
const createAdminForm = document.getElementById('createAdminForm');
const adminEmailInput = document.getElementById('adminEmailInput');
const createAdminBtn = document.getElementById('createAdminBtn');
const createAdminStatus = document.getElementById('createAdminStatus');

if (createAdminForm) {
    createAdminForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = adminEmailInput.value.trim();
        if (!email) return;

        createAdminBtn.disabled = true;
        createAdminBtn.textContent = 'GRANTING ACCESS...';
        createAdminStatus.textContent = '';
        createAdminStatus.style.color = 'rgba(255,255,255,0.6)';

        try {
            const idToken = await auth.currentUser.getIdToken(true);
            const response = await fetch(`${API_BASE}/admin/create-admin`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ email })
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error?.message || 'Failed to grant access');
            }

            createAdminStatus.textContent = `✅ ${result.data.message}`;
            createAdminStatus.style.color = '#4ade80';
            createAdminForm.reset();
        } catch (error) {
            console.error('Create admin error:', error);
            createAdminStatus.textContent = `❌ ${error.message}`;
            createAdminStatus.style.color = 'var(--strike-red)';
        } finally {
            createAdminBtn.disabled = false;
            createAdminBtn.textContent = 'GRANT ADMIN ACCESS';
        }
    });
}

// Edit Team Modal Logic
const editTeamModal = document.getElementById('editTeamModal');
const editTeamForm = document.getElementById('editTeamForm');
const closeEditModalBtn = document.getElementById('closeEditModalBtn');

function openEditTeamModal(id, name, college, status) {
    document.getElementById('edit_team_id').value = id;
    document.getElementById('edit_team_name').value = name;
    document.getElementById('edit_team_college').value = college;
    
    const statusSelect = document.getElementById('edit_team_status');
    for (let i = 0; i < statusSelect.options.length; i++) {
        if (statusSelect.options[i].value === status) {
            statusSelect.selectedIndex = i;
            break;
        }
    }
    
    editTeamModal.style.display = 'flex';
}

if (closeEditModalBtn) {
    closeEditModalBtn.addEventListener('click', () => {
        editTeamModal.style.display = 'none';
    });
}

if (editTeamForm) {
    editTeamForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const saveBtn = document.getElementById('saveEditModalBtn');
        saveBtn.disabled = true;
        saveBtn.textContent = 'SAVING...';
        
        const payload = {
            teamId: document.getElementById('edit_team_id').value,
            teamName: document.getElementById('edit_team_name').value.trim(),
            college: document.getElementById('edit_team_college').value.trim(),
            status: document.getElementById('edit_team_status').value
        };

        try {
            const idToken = await auth.currentUser.getIdToken(true);
            const response = await fetch(`${API_BASE}/admin/edit-team`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error?.message || 'Failed to edit team');
            }

            editTeamModal.style.display = 'none';
        } catch (error) {
            console.error('Edit Team Error:', error);
            alert('Error: ' + error.message);
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'SAVE CHANGES';
        }
    });
}
