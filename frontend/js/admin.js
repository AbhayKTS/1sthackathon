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
        }

        // Initialize lists & streams
        precacheRounds().then(() => {
            initDashboardRealtime();
            initTeamsRealtime();
            initSubmissionsRealtime();
            initUserAccounts();
            initMentorSessions();
            initEvaluations();
            initMailQueue();
            initSheetsSyncQueue();
            initActivityLogs();
            initSystemSettings();
            initSystemHealth();
        });

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
        
        roundSelect.innerHTML = '<option value="">Select a round to activate...</option>';
        deadlineRoundSelect.innerHTML = '<option value="">Select round to set deadline...</option>';
        
        snap.docs.forEach(d => {
            const data = d.data();
            const optionText = `${data.title} (${data.status})`;
            
            const opt1 = document.createElement("option");
            opt1.value = d.id;
            opt1.textContent = optionText;
            roundSelect.appendChild(opt1);

            const opt2 = document.createElement("option");
            opt2.value = d.id;
            opt2.textContent = optionText;
            deadlineRoundSelect.appendChild(opt2);
        });

        if (activeRound) {
            const data = activeRound.data();
            const dl = data.deadline ? new Date(data.deadline.seconds * 1000).toLocaleString() : "No deadline set";
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
                        await deleteDoc(doc(db, "teams", teamId));
                        showToast("Team deleted successfully.");
                    } catch (err) {
                        showToast("Failed to delete team.", "error");
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
            method: "POST",
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
const activateRoundBtn = document.getElementById("activateRoundBtn");
if (activateRoundBtn) {
    activateRoundBtn.addEventListener("click", async () => {
        const roundId = document.getElementById("roundSelect").value;
        if (!roundId) return;

        activateRoundBtn.disabled = true;
        try {
            const response = await fetch(`${API_BASE}/admin/rounds/activate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({ roundId })
            });

            if (!response.ok) throw new Error("Activation failed.");
            showToast("Round activated successfully!");
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            activateRoundBtn.disabled = false;
        }
    });
}

const deactivateRoundBtn = document.getElementById("deactivateRoundBtn");
if (deactivateRoundBtn) {
    deactivateRoundBtn.addEventListener("click", async () => {
        deactivateRoundBtn.disabled = true;
        try {
            const response = await fetch(`${API_BASE}/admin/rounds/activate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({ deactivateAll: true })
            });

            if (!response.ok) throw new Error("Deactivation failed.");
            showToast("All rounds deactivated.");
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            deactivateRoundBtn.disabled = false;
        }
    });
}

const setDeadlineBtn = document.getElementById("setDeadlineBtn");
if (setDeadlineBtn) {
    setDeadlineBtn.addEventListener("click", async () => {
        const roundId = document.getElementById("deadlineRoundSelect").value;
        const deadlineStr = document.getElementById("deadlineInput").value;
        if (!roundId || !deadlineStr) return;

        setDeadlineBtn.disabled = true;
        try {
            const timeDate = new Date(deadlineStr);
            const response = await fetch(`${API_BASE}/admin/rounds`, {
                method: "PATCH",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({ roundId, deadline: timeDate.toISOString() })
            });

            if (!response.ok) throw new Error("Deadline set failed.");
            showToast("Deadline configured successfully!");
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            setDeadlineBtn.disabled = false;
        }
    });
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
async function initSheetsSyncQueue() {
    const tbody = document.getElementById("sheetsSyncTableBody");
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--muted-foreground);">Synced and locked.</td></tr>';
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
const announcementForm = document.getElementById("announcementForm");
if (announcementForm) {
    announcementForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const btn = document.getElementById("annSubmitBtn");
        btn.disabled = true;
        btn.textContent = "TRANSMITTING...";

        try {
            const response = await fetch(`${API_BASE}/admin/announcement`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${idToken}`
                },
                body: JSON.stringify({
                    title: document.getElementById("annTitle").value,
                    message: document.getElementById("annMessage").value
                })
            });

            if (!response.ok) throw new Error("Broadcast failed.");
            showToast("Broadcast stream transmitted!");
            announcementForm.reset();
        } catch (err) {
            showToast(err.message, "error");
        } finally {
            btn.disabled = false;
            btn.textContent = "Transmit Stream";
        }
    });
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
        } catch (e) {
            console.error("Metrics fetch failed:", e);
        }
    }

    fetchMetrics();
    const intervalId = setInterval(fetchMetrics, 10000);
    registerListener(() => clearInterval(intervalId));

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
