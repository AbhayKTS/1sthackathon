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

// Enforce Auth and Admin Role
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
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
            
            // Load admin data
            loadTeams();
            loadSubmissions();
            
        } else {
            // No user doc found, redirect to login
            window.location.href = '/login.html';
        }
    } catch (error) {
        console.error("Error verifying admin:", error);
    }
});

// Logout
logoutBtn.addEventListener("click", () => {
    signOut(auth).then(() => {
        window.location.href = '/login.html';
    });
});

// Load Teams
function loadTeams() {
    const teamsRef = collection(db, "teams");
    onSnapshot(teamsRef, (snapshot) => {
        statTotalTeams.textContent = snapshot.size;
        
        if (snapshot.empty) {
            teamsTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: rgba(255,255,255,0.5);">No teams found.</td></tr>`;
            return;
        }
        
        teamsTableBody.innerHTML = "";
        snapshot.forEach((doc) => {
            const team = doc.data();
            const tr = document.createElement("tr");
            
            const membersList = team.members ? team.members.map(m => m.name).join(", ") : "None";
            
            tr.innerHTML = `
                <td><strong>${team.teamName || 'Unnamed'}</strong></td>
                <td>${membersList}</td>
                <td><span style="font-family: var(--font-mono); font-size: 0.8rem; color: rgba(255,255,255,0.5);">${doc.id}</span></td>
            `;
            teamsTableBody.appendChild(tr);
        });
    }, (error) => {
        console.error("Error loading teams:", error);
    });
}

// Load Submissions
function loadSubmissions() {
    const submissionsRef = collection(db, "submissions");
    const q = query(submissionsRef, orderBy("submittedAt", "desc"));
    
    onSnapshot(q, async (snapshot) => {
        statTotalSubmissions.textContent = snapshot.size;
        
        if (snapshot.empty) {
            submissionsTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: rgba(255,255,255,0.5);">No submissions found.</td></tr>`;
            return;
        }
        
        // Cache team and round names to avoid excessive reads
        const teamNames = {};
        const roundNames = {};
        
        submissionsTableBody.innerHTML = "";
        
        for (let sDoc of snapshot.docs) {
            const sub = sDoc.data();
            
            // Resolve Team Name
            if (!teamNames[sub.teamId]) {
                try {
                    const teamSnap = await getDoc(doc(db, "teams", sub.teamId));
                    teamNames[sub.teamId] = teamSnap.exists() ? teamSnap.data().teamName : sub.teamId;
                } catch(e) {
                    teamNames[sub.teamId] = sub.teamId;
                }
            }
            
            // Resolve Round Name
            if (!roundNames[sub.roundId]) {
                try {
                    const roundSnap = await getDoc(doc(db, "rounds", sub.roundId));
                    roundNames[sub.roundId] = roundSnap.exists() ? roundSnap.data().title : sub.roundId;
                } catch(e) {
                    roundNames[sub.roundId] = sub.roundId;
                }
            }
            
            const date = sub.submittedAt ? sub.submittedAt.toDate().toLocaleString() : "Unknown";
            
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td><strong>${teamNames[sub.teamId]}</strong></td>
                <td>${roundNames[sub.roundId]}</td>
                <td><a href="${sub.githubLink}" target="_blank">Repo ↗</a></td>
                <td><a href="${sub.demoLink}" target="_blank">Demo ↗</a></td>
                <td style="font-size: 0.8rem; color: rgba(255,255,255,0.5);">${date}</td>
            `;
            submissionsTableBody.appendChild(tr);
        }
    }, (error) => {
        console.error("Error loading submissions:", error);
    });
}

// Activate Round with Password
activateRoundBtn.addEventListener("click", async () => {
    const selectedRoundTitle = roundSelect.value;
    if (!selectedRoundTitle) {
        alert("Please select a round first.");
        return;
    }
    
    const password = prompt("Enter password to activate this round:");
    if (password === "switchkrde") {
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
    } else if (password !== null) {
        alert("Incorrect password!");
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
            title: annTitle.value,
            message: annMessage.value,
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
