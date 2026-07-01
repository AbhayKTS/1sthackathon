import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { 
    getFirestore, 
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
    updateDoc
} from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBA9iXHl8WQdmoJ7QUiABxu7AXfizeRzfk",
    authDomain: "sthack-88def.firebaseapp.com",
    projectId: "sthack-88def",
    storageBucket: "sthack-88def.firebasestorage.app",
    messagingSenderId: "676755311648",
    appId: "1:676755311648:web:77041fc026d8a7b5910045"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

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

const statTotalTeams = document.getElementById("statTotalTeams");
const statTotalSubmissions = document.getElementById("statTotalSubmissions");

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
            if (data.role !== "admin") {
                // Not an admin, kick to dashboard
                window.location.href = '/dashboard.html';
                return;
            }
            currentAdminDoc = data;
            userEmailDisplay.textContent = `ADMIN: ${user.email}`;
            
            // Precache rounds and load admin data
            await precacheRounds();
            loadTeams();
            loadSubmissions();
            
        } else {
            // No user doc found, redirect to login
            window.location.href = '/login';
        }
    } catch (error) {
        console.error("Error verifying admin:", error);
    }
});

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
        statTotalTeams.textContent = snapshot.size;
        
        if (snapshot.empty) {
            teamsTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: rgba(255,255,255,0.5);">No teams found.</td></tr>`;
            return;
        }
        
        teamsTableBody.innerHTML = "";
        snapshot.forEach((doc) => {
            const team = doc.data();
            
            // Populate persistent teamCache
            teamCache.set(doc.id, team.teamName || 'Unnamed');

            const tr = document.createElement("tr");
            
            const membersList = team.members ? team.members.map(m => sanitizeHTML(m.name)).join(", ") : "None";
            
            tr.innerHTML = `
                <td><strong>${sanitizeHTML(team.teamName || 'Unnamed')}</strong></td>
                <td>${membersList}</td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: rgba(255,255,255,0.5);">${sanitizeHTML(doc.id)}</span></td>
            `;
            teamsTableBody.appendChild(tr);
        });
    }, (error) => {
        console.error("Error loading teams:", error);
    });
}

// Load Submissions
function loadSubmissions() {
    if (submissionsUnsubscriber) submissionsUnsubscriber();

    const submissionsRef = collection(db, "submissions");
    const q = query(submissionsRef, orderBy("submittedAt", "desc"));
    
    submissionsUnsubscriber = onSnapshot(q, (snapshot) => {
        statTotalSubmissions.textContent = snapshot.size;
        
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

// Activate Round — SECURED: No hardcoded password, relies on Firebase Auth admin role check
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

    // Confirm action instead of using a hardcoded password
    const confirmed = confirm(`Are you sure you want to activate "${selectedRoundTitle}"? This will deactivate all other rounds.`);
    if (!confirmed) return;

    try {
        // Map dropdown values to fixed doc IDs and metadata
        const roundMap = {
            "Round 1": { id: "round-1", title: "Round 1", desc: "Show Us What You Got" },
            "Round 2": { id: "round-2", title: "Round 2", desc: "We Ride At Midnight" },
            "Round 3": { id: "round-3", title: "Round 3", desc: "Seek The Way In Or Out" }
        };
        
        const chosen = roundMap[selectedRoundTitle];
        if (!chosen) { alert("Invalid round selected."); return; }
        
        // Deactivate all 3 fixed rounds, then activate chosen
        const allRoundIds = ["round-1", "round-2", "round-3"];
        
        const deactivatePromises = allRoundIds.map(rid =>
            setDoc(doc(db, "rounds", rid), {
                title: roundMap[Object.keys(roundMap).find(k => roundMap[k].id === rid)].title,
                desc: roundMap[Object.keys(roundMap).find(k => roundMap[k].id === rid)].desc,
                isActive: rid === chosen.id,
                updatedAt: serverTimestamp()
            })
        );
        
        await Promise.all(deactivatePromises);
        alert("Round successfully activated!");
    } catch (error) {
        console.error("Error activating round:", error);
        alert("Error activating round: " + error.message);
    }
});


// Broadcast Announcement Form
announcementForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    annSubmitBtn.disabled = true;
    annSubmitBtn.textContent = "TRANSMITTING...";
    annStatus.textContent = "";
    
    try {
        await addDoc(collection(db, "announcements"), {
            title: sanitizeHTML(annTitle.value),
            message: sanitizeHTML(annMessage.value),
            timestamp: serverTimestamp(),
            createdBy: auth.currentUser.uid
        });
        
        annStatus.textContent = "Broadcast transmitted to all dashboards.";
        annStatus.style.color = "#4ade80";
        announcementForm.reset();
        
        setTimeout(() => { annStatus.textContent = ""; }, 4000);
    } catch (error) {
        console.error("Error sending broadcast:", error);
        annStatus.textContent = "Transmission failed.";
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

            // Using local dev API url for now; in prod this should hit the production domain
            const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
                ? 'http://localhost:3001/api' 
                : '/api';

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
