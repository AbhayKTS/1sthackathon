import {
    auth,
    db,
    API_BASE,
    doc,
    getDoc,
    collection,
    query,
    onSnapshot,
    where,
    onAuthStateChanged,
    signOut
} from "./firebase-init.js";

let idToken = "";
let currentUid = null;

function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.style.padding = "12px 20px";
    toast.style.borderRadius = "4px";
    toast.style.fontFamily = "var(--font-mono)";
    toast.style.fontSize = "12px";
    toast.style.color = "#fff";
    toast.style.boxShadow = "0 4px 12px rgba(0,0,0,0.5)";
    toast.style.border = "1px solid";
    toast.style.backdropFilter = "blur(8px)";
    toast.textContent = message.toUpperCase();

    if (type === "success") {
        toast.style.background = "rgba(16, 185, 129, 0.15)";
        toast.style.borderColor = "var(--success)";
    } else {
        toast.style.background = "rgba(239, 68, 68, 0.15)";
        toast.style.borderColor = "var(--primary)";
    }

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transition = "opacity 0.5s ease";
        setTimeout(() => toast.remove(), 500);
    }, 3000);
}

document.getElementById("logoutBtn")?.addEventListener("click", () => {
    signOut(auth).then(() => {
        window.location.href = "/login.html";
    });
});

onAuthStateChanged(auth, async (user) => {
    if (user && !user.isAnonymous) {
        currentUid = user.uid;
        idToken = await user.getIdToken();
        const tokenResult = await user.getIdTokenResult();
        
        let role = tokenResult.claims.role;
        if (!role) {
            const userDoc = await getDoc(doc(db, "users", user.uid));
            if (userDoc.exists()) {
                role = userDoc.data().role;
            }
        }
        
        if (role !== "mentor") {
            window.location.href = "/login.html";
            return;
        }

        document.getElementById("userEmailDisplay").textContent = user.email || "Unknown Email";
        initMentorPortal();
    } else {
        window.location.href = "/login.html";
    }
});

function initMentorPortal() {
    const sessionsQuery = query(
        collection(db, "sessions"),
        where("hostUid", "==", currentUid),
        where("type", "==", "mentoring")
    );

    onSnapshot(sessionsQuery, (snap) => {
        const loadingState = document.getElementById("loadingState");
        const noSessionsState = document.getElementById("noSessionsState");
        const sessionsContainer = document.getElementById("sessionsContainer");

        loadingState.style.display = "none";

        if (snap.empty) {
            noSessionsState.style.display = "block";
            sessionsContainer.style.display = "none";
            return;
        }

        noSessionsState.style.display = "none";
        sessionsContainer.style.display = "flex";
        
        renderSessions(snap.docs);
    });
}

function sanitizeHTML(str) {
    if (!str) return "";
    const temp = document.createElement("div");
    temp.textContent = str;
    return temp.innerHTML;
}

function formatTime(timestamp) {
    if (!timestamp) return "N/A";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleString();
}

function renderSessions(docs) {
    const container = document.getElementById("sessionsContainer");
    container.innerHTML = "";

    docs.forEach(docSnap => {
        const data = docSnap.data();
        const id = docSnap.id;
        
        const card = document.createElement("div");
        card.className = "glass-card";
        
        const formId = `form_${id}`;
        const teamName = data.teamName || `Team (ID: ${data.teamId})`;
        const meetLink = data.meetLink;
        const scheduledTime = formatTime(data.scheduledFor);
        const notes = data.notes || "";

        card.innerHTML = `
            <div class="card-title-section">
                <div>
                    <h3 class="card-title">${sanitizeHTML(teamName)}</h3>
                    <div style="font-size: 10px; color: var(--muted-foreground); margin-top: 4px; font-family: var(--font-mono);">
                        Scheduled Time: ${sanitizeHTML(scheduledTime)}
                    </div>
                </div>
                <span class="role-tag badge-verified">Active Session</span>
            </div>
            
            <div style="margin-bottom: 20px;">
                <div style="font-family: var(--font-mono); font-size: 10px; color: var(--muted-foreground); margin-bottom: 6px;">MEETING LINK</div>
                ${meetLink 
                    ? `<a href="${sanitizeHTML(meetLink)}" target="_blank" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; text-decoration: none;">🔗 ${sanitizeHTML(meetLink)}</a>` 
                    : `<span style="color: var(--warning); font-size: 12px; font-family: var(--font-mono);">No meeting link set.</span>`
                }
            </div>
            
            <form id="${formId}" class="dash-form">
                <div class="form-group">
                    <label class="form-label">Session Notes</label>
                    <textarea name="notes" rows="4" class="form-textarea" placeholder="Enter session notes, technical feedback, action items...">${sanitizeHTML(notes)}</textarea>
                </div>
                <div style="margin-top: 12px; text-align: right;">
                    <button type="submit" class="btn-primary">SAVE NOTES</button>
                </div>
            </form>
        `;

        container.appendChild(card);

        document.getElementById(formId).addEventListener("submit", async (e) => {
            e.preventDefault();
            const btn = e.target.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.textContent = "SAVING...";

            const notesVal = e.target.notes.value;

            try {
                const res = await fetch(`${API_BASE}/mentor/sessions/${id}/notes`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${idToken}`
                    },
                    body: JSON.stringify({ notes: notesVal })
                });

                const result = await res.json();
                if (result.success) {
                    showToast("Notes saved successfully!");
                } else {
                    showToast(result.error?.message || "Failed to save notes", "error");
                }
            } catch (err) {
                showToast("An error occurred.", "error");
            } finally {
                btn.disabled = false;
                btn.textContent = "SAVE NOTES";
            }
        });
    });
}
