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
    deleteDoc,
    Timestamp,
    onAuthStateChanged,
    signOut
} from "./firebase-init.js";

// ─── SECURITY: Session Inactivity Timeout ───────────────────────
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
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

const statBoxInvited = document.getElementById("statBoxInvited");
const statBoxUsers = document.getElementById("statBoxUsers");
const statBoxSubmitted = document.getElementById("statBoxSubmitted");
const statBoxApproved = document.getElementById("statBoxApproved");

const teamsTableBody = document.getElementById("teamsTableBody");
const invitedTeamsTableBody = document.getElementById("invitedTeamsTableBody");
const submissionsTableBody = document.getElementById("submissionsTableBody");

const teamManagementCard = document.getElementById("teamManagementCard");
const invitedTeamsCard = document.getElementById("invitedTeamsCard");
const teamManagementHeader = teamManagementCard ? teamManagementCard.querySelector('.card-header') : null;

// Tab toggling and filter logic
let currentTeamFilter = 'All';

if (statBoxInvited) {
    statBoxInvited.addEventListener("click", () => {
        if (teamManagementCard) teamManagementCard.style.display = "none";
        if (invitedTeamsCard) invitedTeamsCard.style.display = "block";
    });
}

const showTeamManagement = (filter = 'All') => {
    currentTeamFilter = filter;
    if (teamManagementCard) teamManagementCard.style.display = "block";
    if (invitedTeamsCard) invitedTeamsCard.style.display = "none";
    if (teamManagementHeader) {
        teamManagementHeader.textContent = filter === 'Approved' ? 'Team Management (Approved)' : 'Team Management (All)';
    }
    if (typeof renderTeamsTable === 'function') renderTeamsTable();
};

if (statBoxUsers) statBoxUsers.addEventListener("click", () => showTeamManagement('All'));
if (statBoxSubmitted) statBoxSubmitted.addEventListener("click", () => showTeamManagement('All'));
if (statBoxApproved) statBoxApproved.addEventListener("click", () => showTeamManagement('Approved'));


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
let invitedTeamsUnsubscriber = null;
let submissionsUnsubscriber = null;

const teamCache = new Map();
const roundCache = new Map();

function cleanupListeners() {
    if (teamsUnsubscriber) {
        teamsUnsubscriber();
        teamsUnsubscriber = null;
    }
    if (invitedTeamsUnsubscriber) {
        invitedTeamsUnsubscriber();
        invitedTeamsUnsubscriber = null;
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
                loadAdmins(user);
            }
            
            // Precache rounds and load admin data
            await precacheRounds();
            loadTeams();
            loadInvitedTeams();
            loadSubmissions();
            fetchAnalytics(user);
            listenToActiveRoundStatus(); // Live round status in admin panel
            
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

let currentTeamsDocs = [];

function renderTeamsTable() {
    teamsTableBody.innerHTML = "";
    
    let docsToRender = currentTeamsDocs;
    if (currentTeamFilter === 'Approved') {
        docsToRender = currentTeamsDocs.filter(doc => doc.data().status === 'Approved');
    }

    if (docsToRender.length === 0) {
        teamsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.5);">No teams found for this view.</td></tr>`;
        return;
    }

    docsToRender.forEach((doc) => {
        const team = doc.data();
        const teamId = doc.id;
        
        // Populate persistent teamCache
        teamCache.set(teamId, team.teamName || 'Unnamed');

        const tr = document.createElement("tr");
        
        const membersList = team.members && team.members.length > 0 ? team.members.map(m => sanitizeHTML(m.name)).join(", ") : "None";
        const leaderInfo = team.leaderName ? `<strong>${sanitizeHTML(team.leaderName)}</strong> (Leader)<br/><span style="font-size: 0.8em; color: rgba(255,255,255,0.7);">${membersList}</span>` : membersList;
        
        const contactInfo = `
            <span style="color: rgba(255,255,255,0.9);">${team.college ? sanitizeHTML(team.college) : 'No College'}</span><br/>
            <span style="font-size: 0.8em; color: rgba(255,255,255,0.6);">${team.leaderEmail ? sanitizeHTML(team.leaderEmail) : 'No Email'}</span><br/>
            <span style="font-size: 0.8em; color: rgba(255,255,255,0.6);">${team.leaderPhone ? sanitizeHTML(team.leaderPhone) : 'No Phone'}</span>
        `;

        let statusColor = "rgba(255,255,255,0.5)";
        let statusText = team.status || "Unknown";
        if (statusText === 'Approved') statusColor = "#4ade80";
        if (statusText === 'Rejected') statusColor = "var(--strike-red)";
        if (statusText === 'Submitted') statusColor = "#fbbf24";
        if (statusText === 'Incomplete') statusColor = "#f97316";

        let actionHtml = `<div style="display: flex; gap: 5px; align-items: center; flex-wrap: wrap;">`;
        const updatedMs = team.updatedAt?.toMillis ? team.updatedAt.toMillis() : Date.now();
        
        if (statusText !== 'Approved' && statusText !== 'Rejected') {
            actionHtml += `
                <button class="btn-outline review-btn" data-action="approve" data-id="${sanitizeHTML(teamId)}" data-updated="${updatedMs}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #4ade80; color: #4ade80;">APPROVE</button>
                <button class="btn-outline review-btn" data-action="reject" data-id="${sanitizeHTML(teamId)}" data-updated="${updatedMs}" style="padding: 4px 8px; font-size: 0.7rem; border-color: var(--strike-red); color: var(--strike-red);">REJECT</button>
                <button class="btn-outline review-btn" data-action="needChanges" data-id="${sanitizeHTML(teamId)}" data-updated="${updatedMs}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #f97316; color: #f97316;">CHANGES</button>
            `;
            if (statusText === 'Incomplete' && team.needChangesHistory && team.needChangesHistory.length > 0) {
                const latestNote = team.needChangesHistory[team.needChangesHistory.length - 1].notes;
                actionHtml += `<span style="font-size: 0.6rem; color: rgba(255,255,255,0.5); font-style: italic; width: 100%;">Note: ${sanitizeHTML(latestNote.substring(0, 20))}...</span>`;
            }
        } else {
            actionHtml += `<span style="font-size: 0.7rem; color: rgba(255,255,255,0.3);">NO ACTION</span>`;
        }
        
        actionHtml += `<button class="btn-outline delete-team-btn" data-id="${sanitizeHTML(teamId)}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #ef4444; color: #ef4444; margin-left: auto;">DEL</button>`;
        actionHtml += `</div>`;

        tr.innerHTML = `
            <td><strong>${sanitizeHTML(team.teamName || 'Unnamed')}</strong></td>
            <td>${leaderInfo}</td>
            <td>${contactInfo}</td>
            <td><span style="font-family: var(--font-mono); font-size: 0.8rem; font-weight: bold; color: ${statusColor};">${sanitizeHTML(statusText)}</span></td>
            <td>${actionHtml}</td>
        `;
        teamsTableBody.appendChild(tr);
    });

    // Attach event listeners
    document.querySelectorAll('.review-btn').forEach(btn => {
        btn.addEventListener('click', handleReviewAction);
    });
    document.querySelectorAll('.delete-team-btn').forEach(btn => {
        btn.addEventListener('click', handleDeleteTeam);
    });
}

// Load Teams
function loadTeams() {
    if (teamsUnsubscriber) teamsUnsubscriber();

    const teamsRef = collection(db, "teams");
    teamsUnsubscriber = onSnapshot(teamsRef, (snapshot) => {
        currentTeamsDocs = snapshot.docs;
        renderTeamsTable();
        renderScoresTable();
    }, (error) => {
        console.error("Error loading teams:", error);
    });
}

function renderScoresTable() {
    const scoresTableBody = document.getElementById("scoresTableBody");
    if (!scoresTableBody) return;
    
    // Only show Approved teams in the scores table
    const approvedDocs = currentTeamsDocs.filter(doc => doc.data().status === 'Approved');

    if (approvedDocs.length === 0) {
        scoresTableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: rgba(255,255,255,0.5);">No approved teams found.</td></tr>`;
        return;
    }

    // Sort by total score descending
    approvedDocs.sort((a, b) => (b.data().score || 0) - (a.data().score || 0));

    scoresTableBody.innerHTML = "";
    approvedDocs.forEach((docSnap, index) => {
        const teamId = docSnap.id;
        const team = docSnap.data();
        const scores = team.scores || { r1: 0, r2: 0, r3: 0 };
        const total = team.score || 0;
        const teamName = team.teamName || 'Unnamed';
        
        const rank = index + 1;
        let rankColor = "var(--muted-foreground)";
        if (rank === 1) rankColor = "var(--gold, #FFD700)";
        else if (rank === 2) rankColor = "var(--silver, #C0C0C0)";
        else if (rank === 3) rankColor = "var(--bronze, #CD7F32)";

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>
                <span style="color:${rankColor}; font-weight:bold; font-family:var(--font-mono); margin-right:8px;">#${rank}</span>
                <strong>${sanitizeHTML(teamName)}</strong>
            </td>
            <td><input type="number" class="score-input r1-score" data-id="${sanitizeHTML(teamId)}" value="${scores.r1 || 0}" style="width:60px; background:var(--surface-2); border:1px solid var(--border); color:var(--foreground); padding:4px;"></td>
            <td><input type="number" class="score-input r2-score" data-id="${sanitizeHTML(teamId)}" value="${scores.r2 || 0}" style="width:60px; background:var(--surface-2); border:1px solid var(--border); color:var(--foreground); padding:4px;"></td>
            <td><input type="number" class="score-input r3-score" data-id="${sanitizeHTML(teamId)}" value="${scores.r3 || 0}" style="width:60px; background:var(--surface-2); border:1px solid var(--border); color:var(--foreground); padding:4px;"></td>
            <td style="font-family:var(--font-mono); font-weight:bold; color:var(--accent);">${total}</td>
            <td>
                <button class="btn-outline save-score-btn" data-id="${sanitizeHTML(teamId)}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #4ade80; color: #4ade80;">SAVE</button>
            </td>
        `;
        scoresTableBody.appendChild(tr);
    });

    // Attach listeners
    document.querySelectorAll('.save-score-btn').forEach(btn => {
        btn.addEventListener('click', handleSaveScore);
    });
}

async function handleSaveScore(e) {
    const btn = e.target;
    const teamId = btn.getAttribute('data-id');
    const tr = btn.closest('tr');
    
    const r1 = parseInt(tr.querySelector('.r1-score').value) || 0;
    const r2 = parseInt(tr.querySelector('.r2-score').value) || 0;
    const r3 = parseInt(tr.querySelector('.r3-score').value) || 0;
    const totalScore = r1 + r2 + r3;

    btn.disabled = true;
    btn.textContent = "SAVING...";

    try {
        await updateDoc(doc(db, "teams", teamId), {
            scores: { r1, r2, r3 },
            score: totalScore,
            updatedAt: serverTimestamp()
        });
        // The onSnapshot listener will immediately trigger and re-render with the new score.
    } catch (err) {
        console.error("Error saving score:", err);
        alert("Failed to save score.");
        btn.disabled = false;
        btn.textContent = "SAVE";
    }
}

async function handleDeleteTeam(e) {
    const teamId = e.target.getAttribute('data-id');
    if (!confirm("Are you sure you want to permanently DELETE this team and all its data?")) return;
    try {
        await deleteDoc(doc(db, "teams", teamId));
    } catch (err) {
        console.error("Error deleting team:", err);
        alert("Failed to delete team.");
    }
}

// Load Invited Teams
function loadInvitedTeams() {
    if (invitedTeamsUnsubscriber) invitedTeamsUnsubscriber();

    const invitedTeamsRef = collection(db, "invitedTeams");
    invitedTeamsUnsubscriber = onSnapshot(invitedTeamsRef, (snapshot) => {
        if (snapshot.empty) {
            invitedTeamsTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: rgba(255,255,255,0.5);">No invited teams found.</td></tr>`;
            return;
        }

        invitedTeamsTableBody.innerHTML = "";
         snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const inviteId = docSnap.id;

            const tr = document.createElement("tr");
            const showInvite = data.status === 'Draft' || !data.status;
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(data.teamName || 'Unnamed')}</strong></td>
                <td>${sanitizeHTML(data.leaderName || 'N/A')}</td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: rgba(255,255,255,0.8);">${sanitizeHTML(data.college || 'N/A')}</span></td>
                <td><span class="role-tag" style="background: rgba(0, 180, 216, 0.1); border-color: var(--accent); color: var(--accent); font-weight: 500; font-size: 0.75rem;">${sanitizeHTML(data.status || 'Draft')}</span></td>
                <td>
                    ${showInvite ? `<button class="btn-outline invite-btn" data-id="${sanitizeHTML(inviteId)}" style="padding: 4px 8px; font-size: 0.7rem; border-color: var(--accent); color: var(--accent); margin-right: 4px;">INVITE</button>` : ''}
                    <button class="btn-outline delete-invite-btn" data-id="${sanitizeHTML(inviteId)}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #ef4444; color: #ef4444;">DEL</button>
                </td>
            `;
            invitedTeamsTableBody.appendChild(tr);
        });

        // Invite handlers for invited teams
        document.querySelectorAll('.invite-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                e.target.disabled = true;
                e.target.textContent = "SENDING...";
                try {
                    const idToken = await auth.currentUser.getIdToken(true);
                    const response = await fetch(`${API_BASE}/admin/invited-teams/${id}/invite`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${idToken}`,
                            'Content-Type': 'application/json'
                        }
                    });
                    if (!response.ok) {
                        const result = await response.json();
                        throw new Error(result.error?.message || 'Failed to send invitation');
                    }
                    alert("Invitation queued successfully.");
                } catch (err) {
                    console.error("Error sending invitation:", err);
                    alert("Error: " + err.message);
                    e.target.disabled = false;
                    e.target.textContent = "INVITE";
                }
            });
        });

        // Delete handlers for invited teams
        document.querySelectorAll('.delete-invite-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = e.target.getAttribute('data-id');
                if (!confirm("Are you sure you want to delete this invite?")) return;
                try {
                    await deleteDoc(doc(db, "invitedTeams", id));
                } catch (err) {
                    console.error("Error deleting invited team:", err);
                    alert("Failed to delete invited team.");
                }
            });
        });

    }, (error) => {
        console.error("Error loading invited teams:", error);
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
                <td style="font-size: 0.8rem; color: rgba(255,255,255,0.5); display: flex; align-items: center; justify-content: space-between;">
                    ${date}
                    <button class="btn-outline delete-sub-btn" data-id="${sanitizeHTML(subId)}" style="padding: 2px 6px; font-size: 0.6rem; border-color: #ef4444; color: #ef4444;">DEL</button>
                </td>
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

        document.querySelectorAll('.delete-sub-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const subId = e.target.getAttribute('data-id');
                if (!confirm("Are you sure you want to DELETE this submission?")) return;
                try {
                    await deleteDoc(doc(db, "submissions", subId));
                } catch (err) {
                    console.error("Error deleting submission:", err);
                    alert("Failed to delete submission.");
                }
            });
        });
    }, (error) => {
        console.error("Error loading submissions:", error);
    });
}

// Activate Round — SECURED via Next.js API
let allRoundsData = []; // Cached from onSnapshot

activateRoundBtn.addEventListener("click", async () => {
    const selectedRoundId = roundSelect.value;
    if (!selectedRoundId) {
        alert("Please select a round first.");
        return;
    }
    
    // Verify admin is still authenticated
    if (!auth.currentUser) {
        alert("Session expired. Please log in again.");
        window.location.href = '/login';
        return;
    }

    const chosen = allRoundsData.find(r => r.roundId === selectedRoundId);
    if (!chosen) {
        alert("Selected round data not found.");
        return;
    }

    // Confirm action
    const confirmed = confirm(`Are you sure you want to activate "${chosen.title}"? This will deactivate all other rounds.`);
    if (!confirmed) return;

    activateRoundBtn.disabled = true;
    activateRoundBtn.textContent = "ACTIVATING...";

    const roundActionStatus = document.getElementById("roundActionStatus");

    try {
        const idToken = await auth.currentUser.getIdToken(true);

        const payload = {
            roundId: chosen.roundId,
            roundTitle: chosen.title,
            roundDesc: chosen.description || 'Round active'
        };

        const response = await fetch(`${API_BASE}/admin/rounds/activate`, {
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

        if (roundActionStatus) {
            roundActionStatus.textContent = `✅ "${chosen.title}" activated successfully.`;
            roundActionStatus.style.color = '#4ade80';
            setTimeout(() => { roundActionStatus.textContent = ''; }, 4000);
        }
    } catch (error) {
        console.error("Error activating round:", error);
        if (roundActionStatus) {
            roundActionStatus.textContent = `❌ Error: ${error.message}`;
            roundActionStatus.style.color = 'var(--strike-red)';
        }
    } finally {
        activateRoundBtn.disabled = false;
        activateRoundBtn.textContent = "ACTIVATE ROUND";
    }
});

// Deactivate All Rounds
const deactivateRoundBtn = document.getElementById("deactivateRoundBtn");
if (deactivateRoundBtn) {
    deactivateRoundBtn.addEventListener("click", async () => {
        if (!auth.currentUser) { window.location.href = '/login'; return; }
        if (!confirm("Are you sure you want to DEACTIVATE all rounds? Participants will see no active round.")) return;

        deactivateRoundBtn.disabled = true;
        deactivateRoundBtn.textContent = "DEACTIVATING...";

        const roundActionStatus = document.getElementById("roundActionStatus");

        try {
            const idToken = await auth.currentUser.getIdToken(true);
            const response = await fetch(`${API_BASE}/admin/rounds/activate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify({ deactivateAll: true })
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error?.message || 'Failed to deactivate rounds');

            if (roundActionStatus) {
                roundActionStatus.textContent = '✅ All rounds deactivated.';
                roundActionStatus.style.color = '#4ade80';
                setTimeout(() => { roundActionStatus.textContent = ''; }, 4000);
            }
        } catch (error) {
            console.error("Error deactivating rounds:", error);
            if (roundActionStatus) {
                roundActionStatus.textContent = `❌ Error: ${error.message}`;
                roundActionStatus.style.color = 'var(--strike-red)';
            }
        } finally {
            deactivateRoundBtn.disabled = false;
            deactivateRoundBtn.textContent = "DEACTIVATE ALL";
        }
    });
}

// Set Deadline — writes Firestore Timestamp directly without API round-trip
const setDeadlineBtn = document.getElementById("setDeadlineBtn");
const deadlineRoundSelect = document.getElementById("deadlineRoundSelect");
const deadlineInput = document.getElementById("deadlineInput");
const deadlineStatus = document.getElementById("deadlineStatus");

if (setDeadlineBtn) {
    setDeadlineBtn.addEventListener("click", async () => {
        const roundId = deadlineRoundSelect?.value;
        const dateValue = deadlineInput?.value;

        if (!roundId) { alert("Please select a round."); return; }
        if (!dateValue) { alert("Please set a deadline date/time."); return; }

        setDeadlineBtn.disabled = true;
        setDeadlineBtn.textContent = "SAVING...";
        if (deadlineStatus) { deadlineStatus.textContent = ''; }

        try {
            const deadlineMs = new Date(dateValue).getTime();
            if (isNaN(deadlineMs)) throw new Error("Invalid date/time selected.");

            const idToken = await auth.currentUser.getIdToken(true);
            
            const payload = {
                roundId,
                submissionDeadline: new Date(deadlineMs).toISOString()
            };

            const response = await fetch(`${API_BASE}/admin/rounds`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error?.message || 'Failed to set deadline');
            }

            if (deadlineStatus) {
                deadlineStatus.textContent = `✅ Deadline set: ${new Date(deadlineMs).toLocaleString()}`;
                deadlineStatus.style.color = '#4ade80';
                setTimeout(() => { deadlineStatus.textContent = ''; }, 5000);
            }
        } catch (error) {
            console.error("Error setting deadline:", error);
            if (deadlineStatus) {
                deadlineStatus.textContent = `❌ Error: ${error.message}`;
                deadlineStatus.style.color = 'var(--strike-red)';
            }
        } finally {
            setDeadlineBtn.disabled = false;
            setDeadlineBtn.textContent = "SET DEADLINE";
        }
    });
}

// Live Active Round Status + Select population — listens to rounds collection

function listenToActiveRoundStatus() {
    const statusEl = document.getElementById("activeRoundStatus");
    if (!statusEl) return;

    const roundsQuery = query(collection(db, "rounds"), orderBy("__name__"));
    
    onSnapshot(roundsQuery, (snap) => {
        const rounds = [];
        snap.forEach(docSnap => {
            const data = docSnap.data();
            rounds.push({
                roundId: docSnap.id,
                title: data.title || docSnap.id,
                description: data.description || '',
                isActive: data.isActive || false,
                deadline: data.submissionDeadline ? (data.submissionDeadline.toMillis ? data.submissionDeadline.toMillis() : data.submissionDeadline.seconds * 1000) : null
            });
        });
        
        allRoundsData = rounds; // Cache for button handlers

        // Populate dropdowns if they exist
        if (roundSelect) {
            const currentVal = roundSelect.value;
            roundSelect.innerHTML = '<option value="">Select a round to activate...</option>';
            rounds.forEach(r => {
                const opt = document.createElement("option");
                opt.value = r.roundId;
                opt.textContent = `${r.roundId}: ${r.title}`;
                roundSelect.appendChild(opt);
            });
            if (rounds.find(r => r.roundId === currentVal)) roundSelect.value = currentVal;
        }

        if (deadlineRoundSelect) {
            const currentVal = deadlineRoundSelect.value;
            deadlineRoundSelect.innerHTML = '<option value="">Select round to set deadline...</option>';
            rounds.forEach(r => {
                const opt = document.createElement("option");
                opt.value = r.roundId;
                opt.textContent = `${r.roundId}: ${r.title}`;
                deadlineRoundSelect.appendChild(opt);
            });
            if (rounds.find(r => r.roundId === currentVal)) deadlineRoundSelect.value = currentVal;
        }

        // Render live status
        const activeRound = rounds.find(r => r.isActive);
        if (activeRound) {
            const deadlineStr = activeRound.deadline ? `— Deadline: ${new Date(activeRound.deadline).toLocaleString()}` : '— No deadline set';
            statusEl.innerHTML = `<span style="color: #4ade80;">● ACTIVE: ${activeRound.title}</span> <span style="color: var(--muted-foreground); font-size: 10px;">${deadlineStr}</span>`;
        } else {
            statusEl.innerHTML = `<span style="color: #ef4444;">● NO ACTIVE ROUND</span>`;
        }
    }, (error) => {
        console.error("Error listening to rounds:", error);
    });
}


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

// Quick Add Team (Manual)
const quickAddTeamForm = document.getElementById("quickAddTeamForm");
const qaTeamName = document.getElementById("qaTeamName");
const qaLeaderName = document.getElementById("qaLeaderName");
const qaLeaderEmail = document.getElementById("qaLeaderEmail");
const qaLeaderPhone = document.getElementById("qaLeaderPhone");
const qaCollege = document.getElementById("qaCollege");
const quickAddTeamBtn = document.getElementById("quickAddTeamBtn");
const quickAddStatus = document.getElementById("quickAddStatus");

if (quickAddTeamForm) {
    quickAddTeamForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const teamName = qaTeamName.value.trim();
        const leaderName = qaLeaderName ? qaLeaderName.value.trim() : "";
        const leaderEmail = qaLeaderEmail ? qaLeaderEmail.value.trim() : "";
        const leaderPhone = qaLeaderPhone ? qaLeaderPhone.value.trim() : "";
        const college = qaCollege ? qaCollege.value.trim() : "";
        
        if (!teamName || !leaderEmail) return;

        quickAddTeamBtn.disabled = true;
        quickAddTeamBtn.textContent = "ADDING...";
        quickAddStatus.textContent = "";

        try {
            const idToken = await auth.currentUser.getIdToken(true);
            const payload = {
                teamName,
                leaderName,
                leaderEmail,
                leaderPhone,
                college
            };

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
                throw new Error(result.error?.message || 'Failed to add team manually');
            }

            quickAddStatus.textContent = "✅ Team invited and email sent.";
            quickAddStatus.style.color = "#4ade80";
            quickAddTeamForm.reset();
        } catch (error) {
            console.error("Error adding team:", error);
            quickAddStatus.textContent = `❌ ${error.message}`;
            quickAddStatus.style.color = "var(--strike-red)";
        } finally {
            quickAddTeamBtn.disabled = false;
            quickAddTeamBtn.textContent = "ADD TEAM";
            setTimeout(() => { quickAddStatus.textContent = ""; }, 4000);
        }
    });
}

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

            const response = await fetch(`${API_BASE}/admin/import-teams`, {
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
            loadAdmins(auth.currentUser);
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

async function loadAdmins(user) {
    if (!user) return;
    const adminsTableBody = document.getElementById('adminsTableBody');
    if (!adminsTableBody) return;

    try {
        const idToken = await user.getIdToken(true);
        const res = await fetch(`${API_BASE}/admin/admins`, {
            headers: { 'Authorization': `Bearer ${idToken}` }
        });
        const result = await res.json();
        
        if (!res.ok) throw new Error(result.error?.message || 'Failed to fetch admins');
        
        adminsTableBody.innerHTML = '';
        const admins = result.data.admins;
        
        if (admins.length === 0) {
            adminsTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--muted-foreground);">No admins found</td></tr>`;
            return;
        }

        admins.forEach(admin => {
            const tr = document.createElement('tr');
            let actions = `<span style="font-size:0.7rem; color:rgba(255,255,255,0.3);">NONE</span>`;
            
            if (admin.role !== 'super_admin') {
                actions = `<button class="btn-outline remove-admin-btn" data-uid="${sanitizeHTML(admin.uid)}" style="padding: 4px 8px; font-size: 0.7rem; border-color: #ef4444; color: #ef4444;">REVOKE</button>`;
            }

            tr.innerHTML = `
                <td><span style="font-family: var(--font-mono); font-size: 11px;">${sanitizeHTML(admin.email)}</span></td>
                <td><span class="role-tag">${sanitizeHTML(admin.role)}</span></td>
                <td>${actions}</td>
            `;
            adminsTableBody.appendChild(tr);
        });

        // Attach event listeners for revoke buttons
        document.querySelectorAll('.remove-admin-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const uid = e.target.getAttribute('data-uid');
                if (!confirm('Are you sure you want to revoke admin access?')) return;
                
                e.target.disabled = true;
                e.target.textContent = 'REVOKING...';
                
                try {
                    const idToken = await auth.currentUser.getIdToken(true);
                    const response = await fetch(`${API_BASE}/admin/admins`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${idToken}`
                        },
                        body: JSON.stringify({ uid })
                    });
                    const deleteResult = await response.json();
                    
                    if (!response.ok) throw new Error(deleteResult.error?.message || 'Failed to revoke access');
                    
                    loadAdmins(auth.currentUser);
                } catch (err) {
                    console.error('Revoke admin error:', err);
                    alert(`Error: ${err.message}`);
                    e.target.disabled = false;
                    e.target.textContent = 'REVOKE';
                }
            });
        });

    } catch (err) {
        console.error('Error loading admins:', err);
        adminsTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: var(--strike-red);">Failed to load admins: ${err.message}</td></tr>`;
    }
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
