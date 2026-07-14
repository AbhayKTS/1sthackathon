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

// Toast Notification Helper
function showToast(message, type = "success") {
    const toast = document.getElementById("toastNotification");
    if (!toast) return;
    toast.textContent = message.toUpperCase();
    toast.style.display = "block";
    if (type === "success") {
        toast.style.background = "rgba(16, 185, 129, 0.15)";
        toast.style.borderColor = "var(--success)";
        toast.style.color = "var(--success)";
    } else {
        toast.style.background = "rgba(229, 9, 20, 0.15)";
        toast.style.borderColor = "var(--primary)";
        toast.style.color = "var(--primary)";
    }
    setTimeout(() => {
        toast.style.display = "none";
    }, 4000);
}

function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// Global state variables
let idToken = null;
let currentAdminRole = null;
const roundCache = new Map();
let activeListeners = [];
let sheetsSyncListenersWired = false;
let systemHealthWorkersListenersWired = false;

function registerListener(unsub) {
    activeListeners.push(unsub);
    return unsub;
}

function cleanupListeners() {
    activeListeners.forEach(unsub => {
        try {
            unsub();
        } catch (e) {
            console.error("Error detaching listener:", e);
        }
    });
    activeListeners = [];
}

// Elements
const userEmailDisplay = document.getElementById("userEmailDisplay");
const roleBadgeDisplay = document.getElementById("roleBadgeDisplay");
const logoutBtn = document.getElementById("logoutBtn");

const tabTitles = {
    dashboard: ["DASHBOARD OVERVIEW", "Central Operational Metrics"],
    import: ["REGISTRATION IMPORT", "Manual Draft Entry & CSV/Excel Upload Shortlist"],
    teams: ["TEAMS LIFE-CYCLE", "Comprehensive Hackathon Team Management"],
    users: ["USER ACCOUNTS", "Registered Platform Participant Roles"],
    rounds: ["ROUND MANAGER", "Hackathon Round States & Deadlines Config"],
    mentor: ["MENTOR SESSIONS", "Mentor Booking Schedules & Meeting Links"],
    submissions: ["SUBMISSIONS LOG", "Live Participant Deliverable Links"],
    evaluations: ["ROUND EVALUATIONS", "Evaluate Submissions & Input Scores"],
    leaderboard: ["STANDINGS LEADERBOARD", "Live Rank Standing of Active Teams"],
    "email-queue": ["EMAIL QUEUE JOBS", "Monitor Mail Delivery Queue & Retry Jobs"],
    "sheets-sync": ["SHEETS SYNC", "Double-Write Google Sheets Queue Logs"],
    logs: ["ACTIVITY AUDIT LOGS", "Internal System Log Feeds & Events"],
    announcements: ["ANNOUNCEMENTS", "Broadcast Multi-channel Alerts & Broadcasts"],
    settings: ["SYSTEM SETTINGS", "Global Platform Property Configurations"],
    "system-health": ["SYSTEM HEALTH MONITOR", "Real-time Queue Statuses & Emergency Control Deck"],
    "admin-accounts": ["ADMIN & STAFF ACCOUNTS", "Manage Administrators, Judges, and Mentors Permissions"],
};

let tabControlsWired = false;

function switchTab(tabId, sourceElement) {
    if (tabId === "admin-accounts" && currentAdminRole !== "super_admin") {
        return;
    }

    document.querySelectorAll(".nav-item").forEach((item) => {
        item.classList.remove("active");
    });

    if (sourceElement?.classList?.contains("nav-item")) {
        sourceElement.classList.add("active");
    } else {
        document.querySelector(`.nav-item[data-tab="${tabId}"]`)?.classList.add("active");
    }

    document.querySelectorAll(".tab-panel").forEach((panel) => {
        panel.classList.remove("active");
    });

    const panel = document.getElementById(`panel-${tabId}`);
    if (panel) {
        panel.classList.add("active");
    }

    const title = tabTitles[tabId];
    if (title) {
        const pageTitleText = document.getElementById("pageTitleText");
        const pageSubtitleText = document.getElementById("pageSubtitleText");

        if (pageTitleText) pageTitleText.textContent = title[0];
        if (pageSubtitleText) pageSubtitleText.textContent = title[1];
    }
}

window.switchTab = switchTab;

function wireTabControls() {
    if (tabControlsWired) {
        return;
    }

    document.querySelectorAll("[data-tab]").forEach((element) => {
        element.addEventListener("click", () => {
            switchTab(element.dataset.tab, element);
        });

        element.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                switchTab(element.dataset.tab, element);
            }
        });
    });

    tabControlsWired = true;
}

function startStartupTask(label, task) {
    try {
        const result = task();
        if (result && typeof result.then === "function") {
            void result.catch((error) => {
                console.error(`Startup task failed (${label}):`, error);
            });
        }
    } catch (error) {
        console.error(`Startup task failed (${label}):`, error);
    }
}

// ─── AUTH & INITIALIZATION ───────────────────────────────────────────────────
onAuthStateChanged(auth, async (user) => {
    cleanupListeners();

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

        const data = userDocSnap.data();
        if (data.role !== "admin" && data.role !== "super_admin") {
            window.location.href = "/dashboard.html";
            return;
        }

        currentAdminRole = data.role;
        idToken = await user.getIdToken();
        
        userEmailDisplay.textContent = user.email;
        roleBadgeDisplay.textContent = currentAdminRole === "super_admin" ? "SUPER ADMIN" : "ADMINISTRATOR";
        if (currentAdminRole === "super_admin") {
            document.body.classList.add("is-superadmin");
            startStartupTask("admin accounts tab", initAdminAccounts);
        }

        wireTabControls();

        // Initialize lists & streams independently so one failure never blocks the rest.
        await precacheRounds();
        startStartupTask("dashboard realtime", initDashboardRealtime);
        startStartupTask("teams realtime", initTeamsRealtime);
        startStartupTask("submissions realtime", initSubmissionsRealtime);
        startStartupTask("user accounts", initUserAccounts);
        startStartupTask("rounds tab", initRoundsTab);
        startStartupTask("mentor sessions", initMentorSessions);
        startStartupTask("evaluations", initEvaluations);
        startStartupTask("mail queue", initMailQueue);
        startStartupTask("sheets sync", initSheetsSyncQueue);
        startStartupTask("activity logs", initActivityLogs);
        startStartupTask("system settings", initSystemSettings);
        startStartupTask("announcements tab", initAnnouncementsTab);
        startStartupTask("system health", initSystemHealth);

    } catch (err) {
        console.error("Auth validation failed:", err);
        signOut(auth);
    }
});

logoutBtn.addEventListener("click", () => {
    signOut(auth).then(() => {
        window.location.href = "/login.html";
    });
});

async function precacheRounds() {
    try {
        const snapshot = await getDocs(collection(db, "rounds"));
        snapshot.forEach(d => {
            roundCache.set(d.id, d.data().title || d.id);
        });
    } catch (e) {
        console.error("Error caching rounds:", e);
    }
}

// ─── TAB 1: DASHBOARD OVERVIEW ────────────────────────────────────────────────
function initDashboardRealtime() {
    // Stat counters
    registerListener(onSnapshot(collection(db, "invitedTeams"), (snap) => {
        document.getElementById("statInvited").textContent = snap.size;
    }));
    registerListener(onSnapshot(collection(db, "users"), (snap) => {
        document.getElementById("statUsers").textContent = snap.size;
    }));
    registerListener(onSnapshot(collection(db, "submissions"), (snap) => {
        document.getElementById("statSubmitted").textContent = snap.size;
    }));
    registerListener(onSnapshot(query(collection(db, "teams")), (snap) => {
        const approvedCount = snap.docs.filter(d => d.data().status === "Approved").length;
        document.getElementById("statApproved").textContent = approvedCount;
    }));

    // Active Round Widget
    registerListener(onSnapshot(collection(db, "rounds"), (snap) => {
        const activeRound = snap.docs.find(d => d.data().status === "Active");
        const statusBox = document.getElementById("activeRoundStatus");
        
        // Also populate select dropdowns
        const roundSelect = document.getElementById("roundSelect");
        const deadlineRoundSelect = document.getElementById("deadlineRoundSelect");
        
        if (roundSelect) roundSelect.innerHTML = '<option value="">Select a round to activate...</option>';
        if (deadlineRoundSelect) deadlineRoundSelect.innerHTML = '<option value="">Select round to set deadline...</option>';
        
        snap.docs.forEach(d => {
            const data = d.data();
            const optionText = `${data.title} (${data.status})`;
            
            if (roundSelect) {
                const opt1 = document.createElement("option");
                opt1.value = d.id;
                opt1.textContent = optionText;
                roundSelect.appendChild(opt1);
            }

            if (deadlineRoundSelect) {
                const opt2 = document.createElement("option");
                opt2.value = d.id;
                opt2.textContent = optionText;
                deadlineRoundSelect.appendChild(opt2);
            }
        });

        if (activeRound) {
            const data = activeRound.data();
            const deadlineObj = data.submissionDeadline || data.deadline;
            const dl = deadlineObj ? new Date(deadlineObj.seconds * 1000).toLocaleString() : "No deadline set";
            statusBox.innerHTML = `
                <div style="font-weight: 600; color: #fff; margin-bottom: 4px;">ACTIVE ROUND: ${sanitizeHTML(data.title)}</div>
                <div>Status: ${sanitizeHTML(data.status)}</div>
                <div>Deadline: ${sanitizeHTML(dl)}</div>
            `;
        } else {
            statusBox.innerHTML = "No active rounds currently.";
        }
    }));

    // Recent Submissions Feed
    registerListener(onSnapshot(query(collection(db, "submissions"), orderBy("submittedAt", "desc")), (snap) => {
        const recentSubmissionsBody = document.getElementById("recentSubmissionsBody");
        recentSubmissionsBody.innerHTML = "";
        
        if (snap.empty) {
            recentSubmissionsBody.innerHTML = '<tr><td colspan="3" style="text-align: center; color: var(--muted-foreground);">No submissions yet.</td></tr>';
            return;
        }

        snap.docs.slice(0, 5).forEach(d => {
            const data = d.data();
            const tr = document.createElement("tr");
            const time = data.submittedAt ? new Date(data.submittedAt.seconds * 1000).toLocaleTimeString() : "Just now";
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(data.teamId.slice(0, 10))}...</strong></td>
                <td>${sanitizeHTML(data.roundId)}</td>
                <td style="color: var(--muted-foreground);">${time}</td>
            `;
            recentSubmissionsBody.appendChild(tr);
        });
    }));

    // Announcements Feed
    registerListener(onSnapshot(query(collection(db, "announcements"), orderBy("timestamp", "desc")), (snap) => {
        const announcementFeedBody = document.getElementById("announcementFeedBody");
        announcementFeedBody.innerHTML = "";
        
        if (snap.empty) {
            announcementFeedBody.innerHTML = '<div style="font-size: 11px; color: var(--muted-foreground); text-align: center;">No announcements.</div>';
            return;
        }

        snap.docs.slice(0, 4).forEach(d => {
            const data = d.data();
            const time = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleDateString() : "";
            const div = document.createElement("div");
            div.style.cssText = "padding: 12px; border: 1px solid var(--border); border-radius: 4px; background: rgba(0,0,0,0.15);";
            div.innerHTML = `
                <div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 11px; color: #fff; margin-bottom: 4px;">
                    <span>${sanitizeHTML(data.title)}</span>
                    <span style="color: var(--muted-foreground); font-weight: normal; font-size: 9px;">${time}</span>
                </div>
                <p style="font-size: 11px; color: var(--muted-foreground); margin: 0; line-height: 1.4;">${sanitizeHTML(data.message)}</p>
            `;
            announcementFeedBody.appendChild(div);
        });
    }));
}

// ─── TAB 2: REGISTRATION IMPORT ──────────────────────────────────────────────
const quickAddTeamForm = document.getElementById("quickAddTeamForm");
if (quickAddTeamForm) {
    quickAddTeamForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("quickAddTeamBtn");
        btn.disabled = true;
        btn.textContent = "CREATING...";
        
        try {
            const response = await fetch(`${API_BASE}/admin/invite-team`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    teamName: document.getElementById("qaTeamName").value,
                    leaderName: document.getElementById("qaLeaderName").value,
                    leaderEmail: document.getElementById("qaLeaderEmail").value,
                    leaderPhone: document.getElementById("qaLeaderPhone").value,
                    college: document.getElementById("qaCollege").value
                })
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error?.message || "Creation failed.");

            showToast("Draft team created successfully!");
            quickAddTeamForm.reset();
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Create Draft";
        }
    });
}

const importCsvForm = document.getElementById("importCsvForm");
if (importCsvForm) {
    importCsvForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("importSubmitBtn");
        const fileInput = document.getElementById("csvFileInput");
        const file = fileInput.files[0];
        if (!file) return;

        btn.disabled = true;
        btn.textContent = "IMPORTING...";

        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch(`${API_BASE}/admin/import-teams`, {
                method: "POST",
                headers: { Authorization: `Bearer ${idToken}` },
                body: formData
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error?.message || "Import failed.");

            showToast(`Shortlist uploaded! Imported: ${result.data.stats.imported}, Skipped: ${result.data.stats.skipped}`);
            importCsvForm.reset();
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Import Shortlist";
        }
    });
}

// ─── TAB 3: TEAMS MANAGEMENT ─────────────────────────────────────────────────
function initTeamsRealtime() {
    // Teams List
    registerListener(onSnapshot(collection(db, "teams"), (snap) => {
        const tbody = document.getElementById("teamsTableBody");
        tbody.innerHTML = "";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-foreground);">No registered teams found.</td></tr>';
            return;
        }

        snap.docs.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            const members = data.members ? data.members.map(m => m.name).join(", ") : "None";
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>
                    <div style="font-weight: 600; color: #fff;">${sanitizeHTML(data.teamName)}</div>
                    <div style="font-size: 10px; color: var(--muted-foreground);">Track: ${sanitizeHTML(data.track || "Not selected")}</div>
                </td>
                <td>
                    <div><strong>${sanitizeHTML(data.leaderName)} (Leader)</strong></div>
                    <div style="font-size: 10px; color: var(--muted-foreground);">${sanitizeHTML(members)}</div>
                </td>
                <td>
                    <div>${sanitizeHTML(data.college)}</div>
                    <div style="font-size: 10px; color: var(--muted-foreground);">${sanitizeHTML(data.leaderPhone)}</div>
                </td>
                <td>
                    <span class="role-tag ${data.status === "Approved" ? "badge-verified" : "badge-amber"}">${sanitizeHTML(data.status)}</span>
                </td>
                <td>
                    <button class="btn-outline edit-team-btn" data-id="${sanitizeHTML(id)}" style="padding: 4px 8px; font-size: 9px; margin-right: 4px;">EDIT</button>
                    <button class="btn-outline delete-team-btn" data-id="${sanitizeHTML(id)}" style="padding: 4px 8px; font-size: 9px; border-color: #ef4444; color: #ef4444;">DEL</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Edit handlers
        document.querySelectorAll(".edit-team-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const teamId = e.target.getAttribute("data-id");
                openEditModal(teamId);
            });
        });

        // Delete handlers
        document.querySelectorAll(".delete-team-btn").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const teamId = e.target.getAttribute("data-id");
                if (confirm("Are you sure you want to permanently delete this team?")) {
                    try {
                        const response = await fetch(`${API_BASE}/admin/team/${teamId}`, {
                            method: "DELETE",
                            headers: {
                                Authorization: `Bearer ${idToken}`
                            }
                        });
                        if (!response.ok) throw new Error("Failed to delete team.");
                        showToast("Team deleted successfully.");
                    } catch (err) {
                        showToast(err.message, "error");
                    }
                }
            });
        });
    }));

    // Invited Drafts List
    registerListener(onSnapshot(collection(db, "invitedTeams"), (snap) => {
        const tbody = document.getElementById("invitedTeamsTableBody");
        tbody.innerHTML = "";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-foreground);">No invited draft teams.</td></tr>';
            return;
        }

        snap.docs.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            const tr = document.createElement("tr");
            const showInvite = data.status === "Draft" || !data.status;
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(data.teamName)}</strong></td>
                <td>
                    <div>${sanitizeHTML(data.leaderName)}</div>
                    <div style="font-size: 10px; color: var(--muted-foreground);">${sanitizeHTML(data.leaderEmail)}</div>
                </td>
                <td>${sanitizeHTML(data.college)}</td>
                <td><span class="role-tag">${sanitizeHTML(data.status || "Draft")}</span></td>
                <td>
                    ${showInvite ? `<button class="btn-outline invite-draft-btn" data-id="${sanitizeHTML(id)}" style="padding: 4px 8px; font-size: 9px; margin-right: 4px;">INVITE</button>` : ""}
                    <button class="btn-outline delete-draft-btn" data-id="${sanitizeHTML(id)}" style="padding: 4px 8px; font-size: 9px; border-color: #ef4444; color: #ef4444;">DEL</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Trigger Invite
        document.querySelectorAll(".invite-draft-btn").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const draftId = e.target.getAttribute("data-id");
                e.target.disabled = true;
                e.target.textContent = "SENDING...";

                try {
                    const response = await fetch(`${API_BASE}/admin/invited-teams/${draftId}/invite`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${idToken}` }
                    });
                    if (!response.ok) throw new Error("Invite failed.");
                    showToast("Invitation queued successfully.");
                } catch (err) {
                    showToast(err.message, "error");
                    e.target.disabled = false;
                    e.target.textContent = "INVITE";
                }
            });
        });

        // Delete Draft
        document.querySelectorAll(".delete-draft-btn").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const draftId = e.target.getAttribute("data-id");
                if (confirm("Delete this invited draft?")) {
                    try {
                        await deleteDoc(doc(db, "invitedTeams", draftId));
                        showToast("Draft deleted.");
                    } catch (err) {
                        showToast("Failed to delete draft.", "error");
                    }
                }
            });
        });
    }));
}

// Edit Modal helpers
const editTeamModal = document.getElementById("editTeamModal");
const editTeamForm = document.getElementById("editTeamForm");

async function openEditModal(teamId) {
    try {
        const snap = await getDoc(doc(db, "teams", teamId));
        if (snap.exists()) {
            const data = snap.data();
            document.getElementById("edit_team_id").value = teamId;
            document.getElementById("edit_team_name").value = data.teamName;
            document.getElementById("edit_team_college").value = data.college;
            document.getElementById("edit_team_status").value = data.status;
            editTeamModal.style.display = "flex";
        }
    } catch (err) {
        showToast("Error loading team data.", "error");
    }
}

document.getElementById("closeEditModalBtn").addEventListener("click", () => {
    editTeamModal.style.display = "none";
});

editTeamForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit_team_id").value;
    const name = document.getElementById("edit_team_name").value;
    const college = document.getElementById("edit_team_college").value;
    const status = document.getElementById("edit_team_status").value;

    try {
        const response = await fetch(`${API_BASE}/admin/edit-team`, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({ teamId: id, teamName: name, college, status })
        });
        
        if (!response.ok) throw new Error("Update failed.");
        showToast("Team updated successfully!");
        editTeamModal.style.display = "none";
    } catch (err) {
        showToast(err.message, "error");
    }
});

// ─── TAB 4: USERS ACCOUNTS ────────────────────────────────────────────────────
async function initUserAccounts() {
    try {
        const response = await fetch(`${API_BASE}/admin/permissions?limit=50`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        const result = await response.json();
        const tbody = document.getElementById("usersTableBody");
        tbody.innerHTML = "";

        const users = result.data?.users ?? [];
        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--muted-foreground);">No users accounts found.</td></tr>';
            return;
        }

        users.forEach(u => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(u.uid)}</strong></td>
                <td>${sanitizeHTML(u.email)}</td>
                <td><span class="role-tag">${sanitizeHTML(u.role)}</span></td>
                <td>${sanitizeHTML(u.teamId || "None")}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Error loading users:", err);
    }
}

// ─── TAB 5: ROUND MANAGER ────────────────────────────────────────────────────
async function fetchAndRenderRounds() {
    const container = document.getElementById("roundsCardsContainer");
    if (!container) return;

    try {
        const response = await fetch(`${API_BASE}/admin/rounds`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        if (!response.ok) throw new Error("Failed to fetch rounds.");
        const result = await response.json();
        const rounds = result.data?.rounds || [];

        container.innerHTML = "";
        if (rounds.length === 0) {
            container.innerHTML = '<div style="font-size: 11px; color: var(--muted-foreground); text-align: center; grid-column: 1/-1;">No rounds found.</div>';
            return;
        }

        rounds.forEach(r => {
            const card = document.createElement("div");
            card.className = "glass-card";
            card.style.display = "flex";
            card.style.flexDirection = "column";
            card.style.gap = "12px";
            card.style.padding = "20px";

            // Format deadline date for datetime-local value (YYYY-MM-DDTHH:MM)
            let deadlineVal = "";
            const deadlineField = r.submissionDeadline || r.deadline;
            if (deadlineField) {
                const date = new Date(typeof deadlineField.seconds === 'number' ? deadlineField.seconds * 1000 : deadlineField);
                // Adjust to local timezone
                const tzOffset = date.getTimezoneOffset() * 60000;
                const localISOTime = new Date(date.getTime() - tzOffset).toISOString().slice(0, 16);
                deadlineVal = localISOTime;
            }

            const statusClass = r.status === "Active" ? "badge-verified" : (r.status === "Locked" ? "badge-amber" : "badge-gray");

            card.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border); padding-bottom: 10px; margin-bottom: 8px;">
                    <div>
                        <h4 style="margin: 0; font-size: 1.1rem; color: #fff; font-family: 'Zen Dots', sans-serif;">${sanitizeHTML(r.title)}</h4>
                        <span style="font-size: 10px; color: var(--muted-foreground); font-family: var(--font-mono);">${sanitizeHTML(r.id)}</span>
                    </div>
                    <span class="role-tag ${statusClass}">${sanitizeHTML(r.status)}</span>
                </div>
                <div style="font-size: 12px; color: var(--muted-foreground); margin-bottom: 8px; flex: 1;">
                    ${sanitizeHTML(r.description || "No description provided.")}
                </div>
                <div class="form-group" style="margin-bottom: 12px;">
                    <label class="form-label" style="font-size: 10px;">SUBMISSION DEADLINE</label>
                    <input type="datetime-local" class="form-input deadline-picker" value="${deadlineVal}">
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn-outline btn-activate" style="flex: 1; border-color: var(--accent); color: var(--accent); font-size: 11px; padding: 6px 12px;" ${r.status === 'Active' ? 'disabled style="opacity: 0.5; cursor: not-allowed; border-color: var(--border); color: var(--muted-foreground);"' : ''}>Activate</button>
                    <button type="button" class="btn-outline btn-deactivate" style="flex: 1; border-color: #ef4444; color: #ef4444; font-size: 11px; padding: 6px 12px;" ${r.status !== 'Active' ? 'disabled style="opacity: 0.5; cursor: not-allowed; border-color: var(--border); color: var(--muted-foreground);"' : ''}>Deactivate</button>
                    <button type="button" class="btn-primary btn-save" style="flex: 1; font-size: 11px; padding: 6px 12px;">Save</button>
                </div>
            `;

            // Wire button events
            const actBtn = card.querySelector(".btn-activate");
            const deactBtn = card.querySelector(".btn-deactivate");
            const saveBtn = card.querySelector(".btn-save");
            const deadlineInput = card.querySelector(".deadline-picker");

            actBtn.addEventListener("click", async () => {
                actBtn.disabled = true;
                actBtn.textContent = "Activating...";
                try {
                    const response = await fetch(`${API_BASE}/admin/rounds/activate`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({
                            roundId: r.id,
                            roundTitle: r.title,
                            roundDesc: r.description || "Active Round"
                        })
                    });
                    if (!response.ok) throw new Error("Failed to activate round.");
                    showToast(`Round ${r.title} activated successfully!`);
                    await fetchAndRenderRounds();
                } catch (err) {
                    showToast(err.message, "error");
                } finally {
                    actBtn.disabled = false;
                    actBtn.textContent = "Activate";
                }
            });

            deactBtn.addEventListener("click", async () => {
                deactBtn.disabled = true;
                deactBtn.textContent = "Deactivating...";
                try {
                    const response = await fetch(`${API_BASE}/admin/rounds/${r.id}/transition`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({ to: "Locked" })
                    });
                    if (!response.ok) throw new Error("Failed to deactivate round.");
                    showToast(`Round ${r.title} deactivated (Locked).`);
                    await fetchAndRenderRounds();
                } catch (err) {
                    showToast(err.message, "error");
                } finally {
                    deactBtn.disabled = false;
                    deactBtn.textContent = "Deactivate";
                }
            });

            saveBtn.addEventListener("click", async () => {
                const deadlineStr = deadlineInput.value;
                if (!deadlineStr) {
                    showToast("Please select a valid deadline date and time.", "error");
                    return;
                }
                saveBtn.disabled = true;
                saveBtn.textContent = "Saving...";
                try {
                    const timeDate = new Date(deadlineStr);
                    const response = await fetch(`${API_BASE}/admin/rounds`, {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({ roundId: r.id, submissionDeadline: timeDate.toISOString() })
                    });
                    if (!response.ok) throw new Error("Failed to save deadline.");
                    showToast(`Deadline for ${r.title} saved successfully!`);
                    await fetchAndRenderRounds();
                } catch (err) {
                    showToast(err.message, "error");
                } finally {
                    saveBtn.disabled = false;
                    saveBtn.textContent = "Save";
                }
            });

            container.appendChild(card);
        });
    } catch (e) {
        console.error("Error loading rounds list:", e);
        container.innerHTML = `<div style="font-size: 11px; color: #ef4444; text-align: center; grid-column: 1/-1;">Error loading rounds: ${sanitizeHTML(e.message)}</div>`;
    }
}

async function initRoundsTab() {
    const btnRefresh = document.getElementById("btnRefreshRounds");
    if (btnRefresh) {
        btnRefresh.addEventListener("click", async () => {
            btnRefresh.disabled = true;
            await fetchAndRenderRounds();
            showToast("Rounds list refreshed.");
            btnRefresh.disabled = false;
        });
    }
    await fetchAndRenderRounds();
}

// ─── TAB 6: MENTOR SESSIONS ──────────────────────────────────────────────────
function initMentorSessions() {
    registerListener(onSnapshot(collection(db, "mentorSlots"), (snap) => {
        const tbody = document.getElementById("mentorSessionsTableBody");
        tbody.innerHTML = "";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-foreground);">No mentor slots scheduled.</td></tr>';
            return;
        }

        snap.docs.forEach(d => {
            const data = d.data();
            const tr = document.createElement("tr");
            const time = data.scheduledFor ? new Date(data.scheduledFor.seconds * 1000).toLocaleString() : "N/A";
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(data.mentorName)}</strong></td>
                <td>${sanitizeHTML(time)}</td>
                <td>${sanitizeHTML(String(data.durationMins || 20))} mins</td>
                <td>${sanitizeHTML(data.teamId || "Unassigned")}</td>
                <td><a href="${sanitizeHTML(data.meetLink || "#")}" target="_blank" style="color: var(--accent);">${data.meetLink ? "Meet Link ↗" : "None"}</a></td>
            `;
            tbody.appendChild(tr);
        });
    }));
}

// ─── TAB 7: SUBMISSIONS ──────────────────────────────────────────────────────
function initSubmissionsRealtime() {
    registerListener(onSnapshot(collection(db, "submissions"), (snap) => {
        const tbody = document.getElementById("submissionsTableBody");
        tbody.innerHTML = "";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-foreground);">No deliverables submitted.</td></tr>';
            return;
        }

        snap.docs.forEach(d => {
            const data = d.data();
            const tr = document.createElement("tr");
            const time = data.submittedAt ? new Date(data.submittedAt.seconds * 1000).toLocaleString() : "";
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(data.teamId.slice(0, 10))}...</strong></td>
                <td>${sanitizeHTML(data.roundId)}</td>
                <td><a href="${sanitizeHTML(data.githubLink || "#")}" target="_blank" style="color: var(--primary);">${data.githubLink ? "Repo ↗" : "None"}</a></td>
                <td><a href="${sanitizeHTML(data.demoLink || "#")}" target="_blank" style="color: var(--accent);">${data.demoLink ? "Demo ↗" : "None"}</a></td>
                <td style="color: var(--muted-foreground);">${time}</td>
            `;
            tbody.appendChild(tr);
        });
    }));
}

// ─── TAB 8: EVALUATIONS ──────────────────────────────────────────────────────
function initEvaluations() {
    registerListener(onSnapshot(collection(db, "teams"), (snap) => {
        const tbody = document.getElementById("scoresTableBody");
        tbody.innerHTML = "";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--muted-foreground);">No scores found.</td></tr>';
            return;
        }

        snap.docs.forEach(d => {
            const data = d.data();
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(data.teamName)}</strong></td>
                <td>${sanitizeHTML(String(data.scores?.round1 ?? "-"))}</td>
                <td>${sanitizeHTML(String(data.scores?.round2 ?? "-"))}</td>
                <td>${sanitizeHTML(String(data.scores?.round3 ?? "-"))}</td>
                <td><strong>${sanitizeHTML(String(data.scores?.total ?? 0))}</strong></td>
                <td><button class="btn-outline grade-btn" data-id="${sanitizeHTML(d.id)}" style="padding: 4px 8px; font-size: 9px;">GRADE</button></td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll(".grade-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                switchTab("evaluations");
                showToast("Use Evaluations tab dropdown to grade rounds.", "success");
            });
        });
    }));
}

// ─── TAB 10: EMAIL QUEUE ─────────────────────────────────────────────────────
async function initMailQueue() {
    try {
        const response = await fetch(`${API_BASE}/admin/mail-queue?limit=20`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        const result = await response.json();
        const tbody = document.getElementById("emailQueueTableBody");
        tbody.innerHTML = "";

        const jobs = result.data?.jobs ?? [];
        if (jobs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-foreground);">Email dispatch queue empty.</td></tr>';
            return;
        }

        jobs.forEach(job => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${sanitizeHTML(job.to)}</td>
                <td>${sanitizeHTML(job.template)}</td>
                <td><span class="role-tag ${job.status === "sent" ? "badge-verified" : "badge-amber"}">${sanitizeHTML(job.status)}</span></td>
                <td>${sanitizeHTML(String(job.attempts || 0))}</td>
                <td>
                    ${job.status === "failed" ? `<button class="btn-outline retry-mail-btn" data-id="${sanitizeHTML(job.id)}" style="padding: 4px 8px; font-size: 9px;">RETRY</button>` : "-"}
                </td>
            `;
            tbody.appendChild(tr);
        });

        document.querySelectorAll(".retry-mail-btn").forEach(btn => {
            btn.addEventListener("click", async (e) => {
                const jobId = e.target.getAttribute("data-id");
                try {
                    const res = await fetch(`${API_BASE}/admin/mail-queue/${jobId}/retry`, {
                        method: "POST",
                        headers: { Authorization: `Bearer ${idToken}` }
                    });
                    if (!res.ok) throw new Error("Retry trigger failed.");
                    showToast("Email job queued for retry!");
                    initMailQueue();
                } catch (err) {
                    showToast(err.message, "error");
                }
            });
        });
    } catch (e) {
        console.error("Mail queue logs failed:", e);
    }
}

// ─── TAB 11: GOOGLE SHEETS SYNC ──────────────────────────────────────────────
// ─── TAB 11: GOOGLE SHEETS SYNC ──────────────────────────────────────────────
async function runSyncProcess(force = false) {
    const btnSync = document.getElementById("btnSyncNow");
    const btnRetry = document.getElementById("btnRetryFailed");
    const btnRefresh = document.getElementById("btnRefreshQueue");
    const spinner = document.getElementById("syncSpinner");
    const statusEl = document.getElementById("sheetsSyncStatus");
    
    if (btnSync) btnSync.disabled = true;
    if (btnRetry) btnRetry.disabled = true;
    if (btnRefresh) btnRefresh.disabled = true;
    if (spinner) spinner.style.display = "inline-block";
    if (statusEl) {
        statusEl.textContent = "SYNCING";
        statusEl.style.color = "var(--warning)";
    }
    
    try {
        const response = await fetch(`${API_BASE}/admin/google-sheets/sync`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`
            },
            body: JSON.stringify({ force })
        });
        
        if (response.status === 409) {
            if (confirm("Synchronization already in progress. Would you like to force sync?")) {
                await runSyncProcess(true);
            }
            return;
        }
        
        if (!response.ok) throw new Error("Sync failed.");
        
        const result = await response.json();
        const syncData = result.data ?? {};
        
        let msg = "";
        if (syncData.synced > 0) {
            msg += `${syncData.synced} Jobs Synced Successfully. `;
        }
        if (syncData.failed > 0) {
            msg += `${syncData.failed} Failed. `;
        }
        if (syncData.processed === 0) {
            msg = "Queue is up to date.";
        }
        showToast(msg || "Sync complete!");
        
        await initSheetsSyncQueue();
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        if (btnSync) btnSync.disabled = false;
        if (btnRetry) btnRetry.disabled = false;
        if (btnRefresh) btnRefresh.disabled = false;
        if (spinner) spinner.style.display = "none";
    }
}

async function initSheetsSyncQueue() {
    try {
        // 1. Fetch Stats metrics
        const statsResponse = await fetch(`${API_BASE}/admin/google-sheets/stats`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        if (statsResponse.ok) {
            const statsResult = await statsResponse.json();
            const stats = statsResult.data ?? {};

            document.getElementById("sheetsStatPending").textContent = stats.pending ?? 0;
            document.getElementById("sheetsStatRetry").textContent = stats.retry ?? 0;
            document.getElementById("sheetsStatFailed").textContent = stats.failed ?? 0;
            document.getElementById("sheetsStatSynced").textContent = stats.synced ?? 0;

            const statusEl = document.getElementById("sheetsSyncStatus");
            if (statusEl) {
                statusEl.textContent = stats.status ?? "IDLE";
                if (stats.status === "SYNCING") {
                    statusEl.style.color = "var(--warning)";
                } else if (stats.status === "PAUSED") {
                    statusEl.style.color = "#ef4444";
                } else {
                    statusEl.style.color = "var(--success)";
                }
            }

            const timeEl = document.getElementById("sheetsLastSyncTime");
            if (timeEl) {
                timeEl.textContent = stats.lastSync ? new Date(stats.lastSync).toLocaleString() : "Never";
            }
        }

        // 2. Fetch Sync logs
        const response = await fetch(`${API_BASE}/admin/google-sheets/jobs?limit=30`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        const result = await response.json();
        const tbody = document.getElementById("sheetsSyncTableBody");
        tbody.innerHTML = "";

        const jobs = result.data?.jobs ?? [];
        if (jobs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-foreground);">Google Sheets sync queue empty.</td></tr>';
        } else {
            jobs.forEach(job => {
                const tr = document.createElement("tr");
                const dateObj = job.lastAttemptAt || job.createdAt;
                const time = dateObj ? new Date(dateObj.seconds * 1000).toLocaleString() : "";
                
                let badgeClass = "badge-amber";
                let customStyle = "";
                if (job.status === "synced") {
                    badgeClass = "badge-verified";
                } else if (job.status === "failed") {
                    badgeClass = "badge-amber";
                    customStyle = "border-color: #ef4444; color: #ef4444;";
                }

                tr.innerHTML = `
                    <td><code style="font-size: 10px;">${sanitizeHTML(job.id)}</code></td>
                    <td>${sanitizeHTML(job.sheetName || "Sheet1")}</td>
                    <td><span class="role-tag ${badgeClass}" style="${customStyle}">${sanitizeHTML(job.status)}</span></td>
                    <td>${sanitizeHTML(String(job.attempts || 0))}</td>
                    <td style="color: var(--muted-foreground);">${time}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        // 3. Wire up control button click listeners once
        if (!sheetsSyncListenersWired) {
            const btnRefresh = document.getElementById("btnRefreshQueue");
            if (btnRefresh) {
                btnRefresh.addEventListener("click", async () => {
                    await initSheetsSyncQueue();
                    showToast("Queue refreshed successfully.");
                });
            }

            const btnRetry = document.getElementById("btnRetryFailed");
            if (btnRetry) {
                btnRetry.addEventListener("click", async () => {
                    btnRetry.disabled = true;
                    try {
                        const res = await fetch(`${API_BASE}/admin/google-sheets/retry-failed`, {
                            method: "POST",
                            headers: { Authorization: `Bearer ${idToken}` }
                        });
                        if (!res.ok) throw new Error("Failed to retry failed jobs.");
                        const data = await res.json();
                        showToast(`${data.data?.updatedCount ?? 0} Failed Jobs Reset to Pending.`);
                        await initSheetsSyncQueue();
                    } catch (err) {
                        showToast(err.message, "error");
                    } finally {
                        btnRetry.disabled = false;
                    }
                });
            }

            const btnSync = document.getElementById("btnSyncNow");
            if (btnSync) {
                btnSync.addEventListener("click", async () => {
                    if (currentAdminRole !== "super_admin") {
                        showToast("Only Super Admins can manually trigger sync.", "error");
                        return;
                    }
                    await runSyncProcess(false);
                });
            }

            sheetsSyncListenersWired = true;
        }
    } catch (e) {
        console.error("Sheets sync queue load failed:", e);
    }
}

// ─── TAB 12: SYSTEM ACTIVITY AUDIT LOGS ──────────────────────────────────────
async function initActivityLogs() {
    try {
        const response = await fetch(`${API_BASE}/admin/logs?type=audit&limit=20`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        const result = await response.json();
        const tbody = document.getElementById("activityLogsTableBody");
        tbody.innerHTML = "";

        const logs = result.data?.logs ?? [];
        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-foreground);">No audit logs captured.</td></tr>';
            return;
        }

        logs.forEach(log => {
            const tr = document.createElement("tr");
            const time = log.timestamp ? new Date(log.timestamp.seconds * 1000).toLocaleString() : "";
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(log.actorUid || "SYSTEM")}</strong></td>
                <td>${sanitizeHTML(log.action)}</td>
                <td>${sanitizeHTML(log.targetId || "-")}</td>
                <td style="color: var(--muted-foreground);">${sanitizeHTML(JSON.stringify(log.metadata || {}))}</td>
                <td>${time}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Error logs fetch:", err);
    }
}

// ─── TAB 13: ANNOUNCEMENT BROADCAST ──────────────────────────────────────────
// ─── TAB 13: ANNOUNCEMENT BROADCAST ──────────────────────────────────────────
let currentEditingAnnouncement = null;

function startEditingAnnouncement(ann) {
    currentEditingAnnouncement = ann;
    
    const formTitle = document.getElementById("annFormTitle");
    const formId = document.getElementById("annFormId");
    const titleInput = document.getElementById("annTitle");
    const messageInput = document.getElementById("annMessage");
    const submitBtn = document.getElementById("annSubmitBtn");
    const cancelBtn = document.getElementById("btnCancelAnnEdit");

    if (formTitle) formTitle.textContent = `Edit Announcement`;
    if (formId) formId.value = ann.id;
    if (titleInput) titleInput.value = ann.title || "";
    if (messageInput) messageInput.value = ann.message || "";
    if (submitBtn) submitBtn.textContent = "Save Changes";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
}

function cancelEditingAnnouncement() {
    currentEditingAnnouncement = null;
    
    const formTitle = document.getElementById("annFormTitle");
    const formId = document.getElementById("annFormId");
    const titleInput = document.getElementById("annTitle");
    const messageInput = document.getElementById("annMessage");
    const submitBtn = document.getElementById("annSubmitBtn");
    const cancelBtn = document.getElementById("btnCancelAnnEdit");

    if (formTitle) formTitle.textContent = "Transmute System Broadcasts";
    if (formId) formId.value = "";
    if (titleInput) titleInput.value = "";
    if (messageInput) messageInput.value = "";
    if (submitBtn) submitBtn.textContent = "Transmit Stream";
    if (cancelBtn) cancelBtn.classList.add("hidden");
}

async function initAnnouncementsTab() {
    const form = document.getElementById("announcementForm");
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const btn = document.getElementById("annSubmitBtn");
            if (!btn) return;
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = "Processing...";

            const title = document.getElementById("annTitle").value;
            const message = document.getElementById("annMessage").value;

            try {
                if (currentEditingAnnouncement) {
                    const annId = document.getElementById("annFormId").value;
                    const response = await fetch(`${API_BASE}/admin/announcement/${annId}`, {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({ title, message })
                    });
                    if (!response.ok) throw new Error("Failed to edit announcement.");
                    showToast("Announcement updated successfully!");
                    cancelEditingAnnouncement();
                } else {
                    const response = await fetch(`${API_BASE}/admin/announcement`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({ title, message })
                    });
                    if (!response.ok) throw new Error("Broadcast failed.");
                    showToast("Broadcast stream transmitted!");
                    form.reset();
                }
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    }

    const btnCancel = document.getElementById("btnCancelAnnEdit");
    if (btnCancel) {
        btnCancel.addEventListener("click", () => {
            cancelEditingAnnouncement();
        });
    }

    const btnRefresh = document.getElementById("btnRefreshAnnouncements");
    if (btnRefresh) {
        btnRefresh.addEventListener("click", () => {
            showToast("Directory synced in real-time.");
        });
    }

    registerListener(onSnapshot(query(collection(db, "announcements"), orderBy("timestamp", "desc")), (snap) => {
        const tbody = document.getElementById("announcementsTableBody");
        if (!tbody) return;
        tbody.innerHTML = "";

        if (snap.empty) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--muted-foreground);">No announcements.</td></tr>';
            return;
        }

        snap.docs.forEach(docSnap => {
            const data = docSnap.data();
            const annId = docSnap.id;
            const isDeleted = data.isVisible === false;
            const statusText = isDeleted ? "Hidden (Deleted)" : "Visible";
            const statusClass = isDeleted ? "badge-gray" : "badge-verified";
            const date = data.timestamp ? new Date(data.timestamp.seconds * 1000).toLocaleDateString() : "Just now";

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${sanitizeHTML(date)}</td>
                <td><strong>${sanitizeHTML(data.title)}</strong></td>
                <td><span class="role-tag ${statusClass}">${sanitizeHTML(statusText)}</span></td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn-outline btn-edit-ann" style="padding: 4px 8px; font-size: 10px;">Edit</button>
                        ${!isDeleted ? `<button type="button" class="btn-outline btn-delete-ann" style="padding: 4px 8px; font-size: 10px; border-color: #ef4444; color: #ef4444;">Delete</button>` : ''}
                    </div>
                </td>
            `;

            tr.querySelector(".btn-edit-ann").addEventListener("click", () => {
                startEditingAnnouncement({ id: annId, ...data });
            });

            const delBtn = tr.querySelector(".btn-delete-ann");
            if (delBtn) {
                delBtn.addEventListener("click", async () => {
                    if (!confirm("Are you sure you want to delete/hide this announcement?")) return;
                    delBtn.disabled = true;
                    try {
                        const res = await fetch(`${API_BASE}/admin/announcement/${annId}`, {
                            method: "DELETE",
                            headers: { Authorization: `Bearer ${idToken}` }
                        });
                        if (!res.ok) throw new Error("Delete failed.");
                        showToast("Announcement soft-deleted.");
                    } catch (err) {
                        showToast(err.message, "error");
                        delBtn.disabled = false;
                    }
                });
            }

            tbody.appendChild(tr);
        });
    }));
}

// ─── TAB 14: PLATFORM SETTINGS ────────────────────────────────────────────────
async function initSystemSettings() {
    try {
        const response = await fetch(`${API_BASE}/admin/settings`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        const result = await response.json();
        const settings = result.data?.settings ?? result.settings ?? {};

        document.getElementById("settingOtpLimit").value = settings.otpMaxPerHour || 5;
        document.getElementById("settingPptSheetId").value = settings.googleSheetPptId || "";
        document.getElementById("settingProtoSheetId").value = settings.googleSheetProtoId || "";
    } catch (err) {
        console.error("Failed loading settings:", err);
    }
}

const systemSettingsForm = document.getElementById("systemSettingsForm");
if (systemSettingsForm) {
    systemSettingsForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("saveSettingsBtn");
        btn.disabled = true;
        btn.textContent = "SAVING...";

        try {
            const response = await fetch(`${API_BASE}/admin/settings`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    otpMaxPerHour: parseInt(document.getElementById("settingOtpLimit").value, 10),
                    googleSheetPptId: document.getElementById("settingPptSheetId").value,
                    googleSheetProtoId: document.getElementById("settingProtoSheetId").value
                })
            });

            if (!response.ok) throw new Error("Failed to save settings.");
            showToast("Platform configurations saved!");
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Save Platform Settings";
        }
    });
}

async function initSystemHealth() {
    // 1. Fetch current platform settings and bind to checkbox inputs
    try {
        const response = await fetch(`${API_BASE}/admin/settings`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        const result = await response.json();
        const settings = result.data?.settings ?? result.settings ?? {};

        document.getElementById("toggleEmergencyMode").checked = !!settings.emergencyMode;
        document.getElementById("toggleMaintenanceMode").checked = !!settings.maintenanceMode;
        document.getElementById("toggleRegistrationsPaused").checked = !!settings.registrationsPaused;
        document.getElementById("toggleSubmissionsPaused").checked = !!settings.submissionsPaused;
        document.getElementById("toggleEmailsPaused").checked = !!settings.emailsPaused;
        document.getElementById("toggleSheetsPaused").checked = !!settings.sheetsPaused;
        document.getElementById("toggleAnnouncementsPaused").checked = !!settings.announcementsPaused;
    } catch (e) {
        console.error("Failed loading settings for emergency check:", e);
    }

    // 2. Fetch live metrics periodically
    async function fetchMetrics() {
        try {
            const response = await fetch(`${API_BASE}/admin/health`, {
                headers: { Authorization: `Bearer ${idToken}` }
            });
            if (!response.ok) throw new Error("Health check status failed.");
            
            const result = await response.json();
            const data = result.data || {};

            // Render general metrics
            const firestoreLatency = document.getElementById("healthFirestoreLatency");
            const firestoreStatus = document.getElementById("healthFirestoreStatus");
            const activeUsers = document.getElementById("healthActiveUsers");

            if (firestoreLatency) firestoreLatency.textContent = `${data.firestore?.latencyMs ?? "--"} ms`;
            if (firestoreStatus) {
                firestoreStatus.textContent = data.firestore?.status?.toUpperCase() ?? "UNKNOWN";
                firestoreStatus.style.color = data.firestore?.status === "healthy" ? "#10b981" : "#ef4444";
            }
            if (activeUsers) activeUsers.textContent = data.activeUsers ?? "0";

            // Render integrations status
            const emailService = document.getElementById("healthEmailService");
            const discordWebhook = document.getElementById("healthDiscordWebhook");
            const whatsApp = document.getElementById("healthWhatsApp");

            if (emailService) {
                emailService.textContent = data.integrations?.emailService === "configured" ? "ACTIVE" : "MISSING";
                emailService.style.color = data.integrations?.emailService === "configured" ? "#10b981" : "#f59e0b";
            }
            if (discordWebhook) {
                discordWebhook.textContent = data.integrations?.discordWebhook === "configured" ? "ACTIVE" : "MISSING";
                discordWebhook.style.color = data.integrations?.discordWebhook === "configured" ? "#10b981" : "#f59e0b";
            }
            if (whatsApp) {
                whatsApp.textContent = data.integrations?.whatsApp === "configured" ? "ACTIVE" : "MISSING";
                whatsApp.style.color = data.integrations?.whatsApp === "configured" ? "#10b981" : "#f59e0b";
            }

            // Render email queue metrics
            const emailStatsBody = document.getElementById("emailQueueStatsBody");
            if (emailStatsBody && data.queues?.mail) {
                const mail = data.queues.mail;
                emailStatsBody.innerHTML = `
                    <div style="display: flex; justify-content: space-between;"><span>Queued / Pending</span><span class="role-tag">${mail.queued || 0}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>Sending / Processing</span><span class="role-tag" style="background: rgba(59,130,246,0.2); color: #3b82f6;">${mail.sending || 0}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>Sent Successfully</span><span class="role-tag badge-verified">${mail.sent || 0}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>Retrying</span><span class="role-tag" style="background: rgba(245,158,11,0.2); color: #f59e0b;">${mail.retry || 0}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>Failed (DLQ)</span><span class="role-tag" style="background: rgba(239,68,68,0.2); color: #ef4444;">${mail.failed || 0}</span></div>
                `;
            }

            // Render sheets queue metrics
            const sheetsStatsBody = document.getElementById("sheetsQueueStatsBody");
            if (sheetsStatsBody && data.queues?.sheets) {
                const sheets = data.queues.sheets;
                sheetsStatsBody.innerHTML = `
                    <div style="display: flex; justify-content: space-between;"><span>Pending</span><span class="role-tag">${sheets.pending || 0}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>Syncing</span><span class="role-tag" style="background: rgba(59,130,246,0.2); color: #3b82f6;">${sheets.syncing || 0}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>Synced</span><span class="role-tag badge-verified">${sheets.synced || 0}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>Retrying</span><span class="role-tag" style="background: rgba(245,158,11,0.2); color: #f59e0b;">${sheets.retry || 0}</span></div>
                    <div style="display: flex; justify-content: space-between;"><span>Failed (DLQ)</span><span class="role-tag" style="background: rgba(239,68,68,0.2); color: #ef4444;">${sheets.failed || 0}</span></div>
                `;
            }
            
            await fetchWorkerStats();
        } catch (e) {
            console.error("Metrics fetch failed:", e);
        }
    }

    async function fetchWorkerStats() {
        try {
            const response = await fetch(`${API_BASE}/admin/workers/stats`, {
                headers: { Authorization: `Bearer ${idToken}` }
            });
            if (!response.ok) throw new Error("Worker stats fetch failed.");
            
            const result = await response.json();
            const data = result.data || {};
            
            const renderWorker = (workerId, domId) => {
                const worker = data[workerId] || {};
                const statusEl = document.getElementById(`worker${domId}Status`);
                const lastRunEl = document.getElementById(`worker${domId}LastRun`);
                const processedEl = document.getElementById(`worker${domId}Processed`);
                const failedEl = document.getElementById(`worker${domId}Failed`);

                if (statusEl) {
                    statusEl.textContent = worker.status || "IDLE";
                    statusEl.className = `role-tag ${worker.status === "PROCESSING" ? "badge-amber" : worker.status === "PAUSED" ? "badge-amber" : "badge-verified"}`;
                }
                if (lastRunEl) {
                    lastRunEl.textContent = worker.lastRun ? new Date(typeof worker.lastRun.seconds === 'number' ? worker.lastRun.seconds * 1000 : worker.lastRun).toLocaleString() : "Never";
                }
                if (processedEl) processedEl.textContent = worker.processed || 0;
                if (failedEl) failedEl.textContent = worker.failed || 0;
            };

            renderWorker('mail', 'Mail');
            renderWorker('sheets', 'Sheets');
            renderWorker('scheduler', 'Scheduler');

            let latestSuccessfulTime = null;
            ['mail', 'sheets', 'scheduler'].forEach(wKey => {
                const w = data[wKey] || {};
                if (w.lastRun) {
                    const timeMs = typeof w.lastRun.seconds === 'number' ? w.lastRun.seconds * 1000 : new Date(w.lastRun).getTime();
                    if (!w.lastError && (!latestSuccessfulTime || timeMs > latestSuccessfulTime)) {
                        latestSuccessfulTime = timeMs;
                    }
                }
            });

            const lastCronEl = document.getElementById("lastSuccessfulWorkerRun");
            if (lastCronEl) {
                lastCronEl.textContent = latestSuccessfulTime ? new Date(latestSuccessfulTime).toLocaleString() : "Never";
            }
        } catch (e) {
            console.error("Worker stats fetch failed:", e);
        }
    }

    async function runWorker(workerId, runUrl, btnElement) {
        if (currentAdminRole !== "super_admin") {
            showToast("Only Super Admins can manually run workers.", "error");
            return;
        }
        
        btnElement.disabled = true;
        btnElement.textContent = "RUNNING...";
        
        try {
            const response = await fetch(`${API_BASE}${runUrl}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({ force: false })
            });
            
            if (workerId === 'sheets' && response.status === 409) {
                if (confirm("Synchronization already in progress. Would you like to force sync?")) {
                    btnElement.disabled = true;
                    btnElement.textContent = "FORCING...";
                    const forceResponse = await fetch(`${API_BASE}${runUrl}`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({ force: true })
                    });
                    if (!forceResponse.ok) throw new Error("Force run failed.");
                    showToast("Worker forced successfully!");
                }
                return;
            }
            
            if (!response.ok) throw new Error("Worker run failed.");
            
            const result = await response.json();
            const data = result.data || {};
            
            if (workerId === 'mail') {
                showToast(`Mail Worker ran successfully. Processed: ${data.processed || 0}, Sent: ${data.sent || 0}, Failed: ${data.failed || 0}`);
            } else if (workerId === 'scheduler') {
                showToast(`Scheduler Worker ran successfully. Processed: ${data.processed || 0}, Activated: ${data.activated || 0}, Locked: ${data.locked || 0}`);
            } else if (workerId === 'sheets') {
                showToast(`Sheets Worker ran successfully. Processed: ${data.processed || 0}, Synced: ${data.synced || 0}, Failed: ${data.failed || 0}`);
            } else {
                showToast("Worker completed successfully!");
            }
            
            await fetchWorkerStats();
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            btnElement.disabled = false;
            btnElement.textContent = "Run Now";
        }
    }

    fetchMetrics();
    const intervalId = setInterval(fetchMetrics, 10000);
    registerListener(() => clearInterval(intervalId));

    if (!systemHealthWorkersListenersWired) {
        const btnMail = document.getElementById("btnRunMailWorker");
        if (btnMail) btnMail.addEventListener("click", () => runWorker('mail', '/admin/workers/mail/run', btnMail));

        const btnSheets = document.getElementById("btnRunSheetsWorker");
        if (btnSheets) btnSheets.addEventListener("click", () => runWorker('sheets', '/admin/google-sheets/sync', btnSheets));

        const btnScheduler = document.getElementById("btnRunSchedulerWorker");
        if (btnScheduler) btnScheduler.addEventListener("click", () => runWorker('scheduler', '/admin/workers/scheduler/run', btnScheduler));

        const btnRefresh = document.getElementById("btnRefreshWorkers");
        if (btnRefresh) {
            btnRefresh.addEventListener("click", async () => {
                await fetchWorkerStats();
                showToast("Worker stats refreshed successfully.");
            });
        }
        
        systemHealthWorkersListenersWired = true;
    }

    // 3. Save Emergency Toggles
    const saveEmergencyBtn = document.getElementById("saveEmergencyControlsBtn");
    if (saveEmergencyBtn) {
        saveEmergencyBtn.addEventListener("click", async () => {
            saveEmergencyBtn.disabled = true;
            saveEmergencyBtn.textContent = "SAVING...";

            try {
                const response = await fetch(`${API_BASE}/admin/settings`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${idToken}`
                    },
                    body: JSON.stringify({
                        emergencyMode: document.getElementById("toggleEmergencyMode").checked,
                        maintenanceMode: document.getElementById("toggleMaintenanceMode").checked,
                        registrationsPaused: document.getElementById("toggleRegistrationsPaused").checked,
                        submissionsPaused: document.getElementById("toggleSubmissionsPaused").checked,
                        emailsPaused: document.getElementById("toggleEmailsPaused").checked,
                        sheetsPaused: document.getElementById("toggleSheetsPaused").checked,
                        announcementsPaused: document.getElementById("toggleAnnouncementsPaused").checked,
                    })
                });

                if (!response.ok) throw new Error("Failed to save emergency settings.");
                showToast("Global emergency controls updated successfully!", "success");
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                saveEmergencyBtn.disabled = false;
                saveEmergencyBtn.textContent = "Apply Global Controls";
            }
        });
    }

    // 4. Trigger database Backup
    const backupBtn = document.getElementById("triggerDbBackupBtn");
    const backupStatusText = document.getElementById("backupStatusText");
    if (backupBtn) {
        backupBtn.addEventListener("click", async () => {
            backupBtn.disabled = true;
            backupBtn.textContent = "BACKING UP...";
            if (backupStatusText) backupStatusText.textContent = "Running backup tasks...";

            try {
                const response = await fetch(`${API_BASE}/admin/backup`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${idToken}` }
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error?.message || "Backup failed.");

                showToast("Database backup successfully written!", "success");
                if (backupStatusText) {
                    backupStatusText.textContent = `Success: Users (${result.data.exportedCount?.users}), Teams (${result.data.exportedCount?.teams}), Submissions (${result.data.exportedCount?.submissions}).`;
                    backupStatusText.style.color = "#10b981";
                }
            } catch (err) {
                showToast(err.message, "error");
                if (backupStatusText) {
                    backupStatusText.textContent = `Error: ${err.message}`;
                    backupStatusText.style.color = "#ef4444";
                }
            } finally {
                backupBtn.disabled = false;
                backupBtn.textContent = "Trigger Database Backup";
            }
        });
    }

    // 5. Download Backup JSON Export
    const downloadBackupBtn = document.getElementById("downloadBackupJsonBtn");
    if (downloadBackupBtn) {
        downloadBackupBtn.addEventListener("click", async () => {
            downloadBackupBtn.disabled = true;
            downloadBackupBtn.textContent = "EXPORTING...";

            try {
                const response = await fetch(`${API_BASE}/admin/backup`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${idToken}` }
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error?.message || "Export failed.");

                const blob = new Blob([JSON.stringify(result.data.backup, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `revengershack_db_backup_${Date.now()}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showToast("JSON export downloaded successfully!");
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                downloadBackupBtn.disabled = false;
                downloadBackupBtn.textContent = "Download Full JSON Export";
            }
        });
    }
}

// ─── TAB: ADMIN ACCOUNTS ──────────────────────────────────────────────────────
const ROLE_DEFAULTS = {
    admin: {
        canEditScores: false,
        canPublishScores: false,
        canManageRounds: true,
        canManageTeams: true,
        canSendEmails: true,
        canViewLogs: true
    },
    judge: {
        canEditScores: true,
        canPublishScores: false,
        canManageRounds: false,
        canManageTeams: false,
        canSendEmails: false,
        canViewLogs: false
    },
    mentor: {
        canEditScores: false,
        canPublishScores: false,
        canManageRounds: false,
        canManageTeams: false,
        canSendEmails: false,
        canViewLogs: false
    },
    volunteer: {
        canEditScores: false,
        canPublishScores: false,
        canManageRounds: false,
        canManageTeams: false,
        canSendEmails: false,
        canViewLogs: false
    }
};

let currentEditingAdmin = null;

function applyRoleDefaults(role) {
    const defaults = ROLE_DEFAULTS[role];
    if (defaults) {
        const editScores = document.getElementById("permEditScores");
        const publishScores = document.getElementById("permPublishScores");
        const manageRounds = document.getElementById("permManageRounds");
        const manageTeams = document.getElementById("permManageTeams");
        const sendEmails = document.getElementById("permSendEmails");
        const viewLogs = document.getElementById("permViewLogs");

        if (editScores) editScores.checked = defaults.canEditScores;
        if (publishScores) publishScores.checked = defaults.canPublishScores;
        if (manageRounds) manageRounds.checked = defaults.canManageRounds;
        if (manageTeams) manageTeams.checked = defaults.canManageTeams;
        if (sendEmails) sendEmails.checked = defaults.canSendEmails;
        if (viewLogs) viewLogs.checked = defaults.canViewLogs;
    }
}

function startEditingAdmin(user) {
    currentEditingAdmin = user;
    
    const formTitle = document.getElementById("adminFormTitle");
    const formUserId = document.getElementById("adminFormUserId");
    const nameInput = document.getElementById("adminFormName");
    const emailInput = document.getElementById("adminFormEmail");
    const roleSelect = document.getElementById("adminFormRole");
    const submitBtn = document.getElementById("btnSubmitAdminForm");
    const cancelBtn = document.getElementById("btnCancelAdminEdit");

    if (formTitle) formTitle.textContent = `Edit Account: ${user.displayName || user.email}`;
    if (formUserId) formUserId.value = user.uid;
    
    if (nameInput) {
        nameInput.value = user.displayName || "";
        nameInput.disabled = true;
    }
    if (emailInput) {
        emailInput.value = user.email || "";
        emailInput.disabled = true;
    }
    if (roleSelect) {
        roleSelect.value = user.role;
    }
    
    const editScores = document.getElementById("permEditScores");
    const publishScores = document.getElementById("permPublishScores");
    const manageRounds = document.getElementById("permManageRounds");
    const manageTeams = document.getElementById("permManageTeams");
    const sendEmails = document.getElementById("permSendEmails");
    const viewLogs = document.getElementById("permViewLogs");

    if (editScores) editScores.checked = !!user.canEditScores;
    if (publishScores) publishScores.checked = !!user.canPublishScores;
    if (manageRounds) manageRounds.checked = !!user.canManageRounds;
    if (manageTeams) manageTeams.checked = !!user.canManageTeams;
    if (sendEmails) sendEmails.checked = !!user.canSendEmails;
    if (viewLogs) viewLogs.checked = !!user.canViewLogs;
    
    if (submitBtn) submitBtn.textContent = "Save Changes";
    if (cancelBtn) cancelBtn.classList.remove("hidden");
}

function cancelEditingAdmin() {
    currentEditingAdmin = null;
    
    const formTitle = document.getElementById("adminFormTitle");
    const formUserId = document.getElementById("adminFormUserId");
    const nameInput = document.getElementById("adminFormName");
    const emailInput = document.getElementById("adminFormEmail");
    const roleSelect = document.getElementById("adminFormRole");
    const submitBtn = document.getElementById("btnSubmitAdminForm");
    const cancelBtn = document.getElementById("btnCancelAdminEdit");

    if (formTitle) formTitle.textContent = "Create New Account";
    if (formUserId) formUserId.value = "";
    
    if (nameInput) {
        nameInput.value = "";
        nameInput.disabled = false;
    }
    if (emailInput) {
        emailInput.value = "";
        emailInput.disabled = false;
    }
    
    if (roleSelect) {
        roleSelect.selectedIndex = 0;
        applyRoleDefaults(roleSelect.value);
    }
    
    if (submitBtn) submitBtn.textContent = "Create & Invite";
    if (cancelBtn) cancelBtn.classList.add("hidden");
}

async function fetchAndRenderAdminAccounts() {
    const tbody = document.getElementById("adminAccountsTableBody");
    if (!tbody) return;

    try {
        const response = await fetch(`${API_BASE}/admin/permissions?limit=100`, {
            headers: { Authorization: `Bearer ${idToken}` }
        });
        if (!response.ok) throw new Error("Failed to fetch admin directory.");
        const result = await response.json();
        const users = result.data?.users ?? [];

        tbody.innerHTML = "";
        
        const adminRoles = ["super_admin", "admin", "judge", "mentor", "volunteer"];
        const adminUsers = users.filter(u => adminRoles.includes(u.role));

        if (adminUsers.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--muted-foreground);">No admin accounts found.</td></tr>';
            return;
        }

        adminUsers.forEach(u => {
            const tr = document.createElement("tr");
            const statusText = u.isActive !== false ? "Active" : "Disabled";
            const statusClass = u.isActive !== false ? "badge-verified" : "badge-gray";
            const roleClass = u.role === "super_admin" ? "badge-verified" : "badge-gray";

            tr.innerHTML = `
                <td><strong>${sanitizeHTML(u.displayName || "No Name")}</strong></td>
                <td>${sanitizeHTML(u.email)}</td>
                <td><span class="role-tag ${roleClass}">${sanitizeHTML(u.role)}</span></td>
                <td><span class="role-tag ${statusClass}">${statusText}</span></td>
                <td>
                    <div style="display: flex; gap: 8px;">
                        <button type="button" class="btn-outline btn-edit-perms" style="padding: 4px 8px; font-size: 10px;">Edit</button>
                        ${u.role !== 'super_admin' ? `<button type="button" class="btn-outline btn-delete-admin" style="padding: 4px 8px; font-size: 10px; border-color: #ef4444; color: #ef4444;">Delete</button>` : ''}
                    </div>
                </td>
            `;

            tr.querySelector(".btn-edit-perms").addEventListener("click", () => {
                startEditingAdmin(u);
            });

            const delBtn = tr.querySelector(".btn-delete-admin");
            if (delBtn) {
                delBtn.addEventListener("click", async () => {
                    if (!confirm(`Are you sure you want to remove admin access for ${u.displayName || u.email}?`)) return;
                    delBtn.disabled = true;
                    try {
                        const res = await fetch(`${API_BASE}/admin/admins`, {
                            method: "DELETE",
                            headers: {
                                "Content-Type": "application/json",
                                Authorization: `Bearer ${idToken}`
                            },
                            body: JSON.stringify({ uid: u.uid })
                        });
                        if (!res.ok) {
                            const errData = await res.json();
                            throw new Error(errData.message || "Failed to remove admin access.");
                        }
                        showToast(`Admin access for ${u.displayName || u.email} removed.`);
                        await fetchAndRenderAdminAccounts();
                    } catch (err) {
                        showToast(err.message, "error");
                        delBtn.disabled = false;
                    }
                });
            }

            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error("Error loading admin accounts:", err);
        tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444;">Error: ${sanitizeHTML(err.message)}</td></tr>`;
    }
}

async function initAdminAccounts() {
    const form = document.getElementById("adminAccountForm");
    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            const btn = document.getElementById("btnSubmitAdminForm");
            if (!btn) return;
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = "Processing...";

            try {
                if (currentEditingAdmin) {
                    const userId = document.getElementById("adminFormUserId").value;
                    const response = await fetch(`${API_BASE}/admin/permissions/${userId}`, {
                        method: "PATCH",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({
                            role: document.getElementById("adminFormRole").value,
                            canEditScores: document.getElementById("permEditScores").checked,
                            canPublishScores: document.getElementById("permPublishScores").checked,
                            canManageRounds: document.getElementById("permManageRounds").checked,
                            canManageTeams: document.getElementById("permManageTeams").checked,
                            canSendEmails: document.getElementById("permSendEmails").checked,
                            canViewLogs: document.getElementById("permViewLogs").checked
                        })
                    });
                    if (!response.ok) {
                        const errData = await response.json();
                        throw new Error(errData.message || "Failed to update permissions.");
                    }
                    showToast("Permissions updated successfully.");
                    cancelEditingAdmin();
                } else {
                    const displayName = document.getElementById("adminFormName").value;
                    const email = document.getElementById("adminFormEmail").value;
                    const role = document.getElementById("adminFormRole").value;

                    const response = await fetch(`${API_BASE}/admin/permissions`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({
                            displayName,
                            email,
                            role
                        })
                    });
                    if (!response.ok) {
                        const errData = await response.json();
                        throw new Error(errData.message || "Failed to create account.");
                    }

                    showToast(`Account created successfully and invite email queued.`);

                    const roleDefaults = ROLE_DEFAULTS[role];
                    const hasCustomPermissions = 
                        document.getElementById("permEditScores").checked !== roleDefaults.canEditScores ||
                        document.getElementById("permPublishScores").checked !== roleDefaults.canPublishScores ||
                        document.getElementById("permManageRounds").checked !== roleDefaults.canManageRounds ||
                        document.getElementById("permManageTeams").checked !== roleDefaults.canManageTeams ||
                        document.getElementById("permSendEmails").checked !== roleDefaults.canSendEmails ||
                        document.getElementById("permViewLogs").checked !== roleDefaults.canViewLogs;

                    if (hasCustomPermissions) {
                        btn.textContent = "Saving custom permissions...";
                        await new Promise(resolve => setTimeout(resolve, 1500));
                        const userQuery = query(collection(db, "users"), where("email", "==", email.toLowerCase().trim()));
                        const userSnap = await getDocs(userQuery);
                        if (!userSnap.empty) {
                            const newUid = userSnap.docs[0].id;
                            await fetch(`${API_BASE}/admin/permissions/${newUid}`, {
                                method: "PATCH",
                                headers: {
                                    "Content-Type": "application/json",
                                    Authorization: `Bearer ${idToken}`
                                },
                                body: JSON.stringify({
                                    canEditScores: document.getElementById("permEditScores").checked,
                                    canPublishScores: document.getElementById("permPublishScores").checked,
                                    canManageRounds: document.getElementById("permManageRounds").checked,
                                    canManageTeams: document.getElementById("permManageTeams").checked,
                                    canSendEmails: document.getElementById("permSendEmails").checked,
                                    canViewLogs: document.getElementById("permViewLogs").checked
                                })
                            });
                        }
                    }

                    cancelEditingAdmin();
                }
                await fetchAndRenderAdminAccounts();
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                btn.disabled = false;
                btn.textContent = originalText;
            }
        });
    }

    const btnCancel = document.getElementById("btnCancelAdminEdit");
    if (btnCancel) {
        btnCancel.addEventListener("click", () => {
            cancelEditingAdmin();
        });
    }

    const btnRefresh = document.getElementById("btnRefreshAdminAccounts");
    if (btnRefresh) {
        btnRefresh.addEventListener("click", async () => {
            btnRefresh.disabled = true;
            await fetchAndRenderAdminAccounts();
            showToast("Admin directory refreshed.");
            btnRefresh.disabled = false;
        });
    }

    const roleSelect = document.getElementById("adminFormRole");
    if (roleSelect) {
        roleSelect.addEventListener("change", (e) => {
            if (!currentEditingAdmin) {
                applyRoleDefaults(e.target.value);
            }
        });
        applyRoleDefaults(roleSelect.value);
    }

    await fetchAndRenderAdminAccounts();
}
