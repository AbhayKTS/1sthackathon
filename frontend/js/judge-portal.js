import {
    auth,
    db,
    API_BASE,
    doc,
    getDoc,
    collection,
    query,
    getDocs,
    onSnapshot,
    where,
    onAuthStateChanged,
    signOut
} from "./firebase-init.js";

let idToken = "";
let currentUid = null;
let activeRound = null;
let unsubTeams = null;
let teamsCache = [];

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
        
        if (role !== "judge") {
            window.location.href = "/login.html";
            return;
        }

        document.getElementById("userEmailDisplay").textContent = user.email || "Unknown Email";
        initJudgePortal();
    } else {
        window.location.href = "/login.html";
    }
});

function initJudgePortal() {
    onSnapshot(collection(db, "rounds"), (snap) => {
        let active = null;
        let published = null;

        snap.docs.forEach(d => {
            const data = d.data();
            if (data.status === "Active" || data.status === "Evaluation") {
                active = { id: d.id, ...data };
            } else if (data.status === "Published") {
                published = { id: d.id, ...data };
            }
        });

        activeRound = active || published;

        const loadingState = document.getElementById("loadingState");
        const noRoundState = document.getElementById("noRoundState");
        const teamsContainer = document.getElementById("teamsContainer");
        const activeRoundSubtitle = document.getElementById("activeRoundSubtitle");

        loadingState.style.display = "none";

        if (!activeRound) {
            noRoundState.style.display = "block";
            teamsContainer.style.display = "none";
            activeRoundSubtitle.textContent = "No active round found.";
            if (unsubTeams) { unsubTeams(); unsubTeams = null; }
            return;
        }

        noRoundState.style.display = "none";
        teamsContainer.style.display = "flex";
        activeRoundSubtitle.textContent = `Round: ${activeRound.title} (${activeRound.status})`;

        if (!unsubTeams) {
            listenToAssignedTeams();
        } else {
            renderTeams();
        }
    });
}

function listenToAssignedTeams() {
    const teamsQuery = query(collection(db, "teams"), where("assignedJudgeUids", "array-contains", currentUid));
    unsubTeams = onSnapshot(teamsQuery, async (snap) => {
        teamsCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        await renderTeams();
    });
}

function sanitizeHTML(str) {
    if (!str) return "";
    const temp = document.createElement("div");
    temp.textContent = str;
    return temp.innerHTML;
}

async function renderTeams() {
    const container = document.getElementById("teamsContainer");
    if (!container || !activeRound) return;
    
    container.innerHTML = "";
    
    if (teamsCache.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: var(--muted-foreground);">You have not been assigned to any teams yet.</div>`;
        return;
    }
    
    const isLocked = activeRound.status === "Published";
    const maxScore = activeRound.maxScore || 100;
    
    for (const team of teamsCache) {
        let submissionUrl = null;
        let submissionType = "None";
        const qSub = query(
            collection(db, "submissions"), 
            where("teamId", "==", team.id),
            where("roundId", "==", activeRound.id)
        );
        const subSnap = await getDocs(qSub);
        if (!subSnap.empty) {
            const subData = subSnap.docs[0].data();
            submissionType = activeRound.submissionType || 'Unknown';
            if (submissionType === 'PPT') submissionUrl = subData.pptLink;
            else if (submissionType === 'Github') submissionUrl = subData.githubLink;
            else if (submissionType === 'Demo') submissionUrl = subData.demoLink;
            else if (submissionType === 'Prototype') submissionUrl = subData.prototypeLink;
            else if (submissionType === 'Custom') submissionUrl = subData.customLink;
        }

        let draftScore = "";
        let feedback = "";
        const evalRef = doc(db, "evaluations", `${team.id}_${activeRound.id}`);
        const evalSnap = await getDoc(evalRef);
        if (evalSnap.exists()) {
            const evData = evalSnap.data();
            draftScore = evData.draftScore ?? "";
            feedback = evData.feedback ?? "";
        }
        
        const card = document.createElement("div");
        card.className = "glass-card";
        
        const formId = `form_${team.id}`;
        
        card.innerHTML = `
            <div class="card-title-section">
                <div>
                    <h3 class="card-title">${sanitizeHTML(team.teamName)}</h3>
                    <div style="font-size: 10px; color: var(--muted-foreground); margin-top: 4px; font-family: var(--font-mono);">
                        Track: ${sanitizeHTML(team.track || 'None')} | Leader: ${sanitizeHTML(team.leaderName)}
                    </div>
                </div>
                ${isLocked ? `<span class="role-tag badge-amber">Published &mdash; Locked</span>` : `<span class="role-tag badge-verified">Ready for Scoring</span>`}
            </div>
            
            <div style="margin-bottom: 20px;">
                <div style="font-family: var(--font-mono); font-size: 10px; color: var(--muted-foreground); margin-bottom: 6px;">SUBMISSION (${sanitizeHTML(submissionType)})</div>
                ${submissionUrl 
                    ? `<a href="${sanitizeHTML(submissionUrl)}" target="_blank" style="color: var(--accent); font-family: var(--font-mono); font-size: 12px; text-decoration: none;">🔗 ${sanitizeHTML(submissionUrl)}</a>` 
                    : `<span style="color: var(--warning); font-size: 12px; font-family: var(--font-mono);">No submission found or required.</span>`
                }
            </div>
            
            <form id="${formId}" class="dash-form">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label">Draft Score (Max ${maxScore})</label>
                        <input type="number" name="score" min="0" max="${maxScore}" step="0.1" value="${draftScore}" required class="form-input" ${isLocked ? 'disabled' : ''} />
                    </div>
                    <div class="form-group">
                        <label class="form-label">Remarks / Feedback</label>
                        <textarea name="feedback" rows="2" class="form-textarea" ${isLocked ? 'disabled' : ''} placeholder="Optional feedback...">${sanitizeHTML(feedback)}</textarea>
                    </div>
                </div>
                ${!isLocked ? `
                <div style="margin-top: 12px; text-align: right;">
                    <button type="submit" class="btn-primary">SAVE SCORE</button>
                </div>
                ` : ''}
            </form>
        `;
        
        container.appendChild(card);
        
        if (!isLocked) {
            document.getElementById(formId).addEventListener("submit", async (e) => {
                e.preventDefault();
                const btn = e.target.querySelector('button[type="submit"]');
                btn.disabled = true;
                btn.textContent = "SAVING...";
                
                const scoreVal = e.target.score.value;
                const feedbackVal = e.target.feedback.value;
                
                try {
                    const res = await fetch(`${API_BASE}/judge/evaluations`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${idToken}`
                        },
                        body: JSON.stringify({
                            teamId: team.id,
                            roundId: activeRound.id,
                            draftScore: scoreVal,
                            feedback: feedbackVal
                        })
                    });
                    
                    const result = await res.json();
                    if (result.success) {
                        showToast("Score saved successfully!");
                    } else {
                        showToast(result.error?.message || "Failed to save score", "error");
                    }
                } catch (err) {
                    showToast("An error occurred.", "error");
                } finally {
                    btn.disabled = false;
                    btn.textContent = "SAVE SCORE";
                }
            });
        }
    }
}
