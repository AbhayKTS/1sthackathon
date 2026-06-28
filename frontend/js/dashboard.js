import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut } from "firebase/auth";
import { 
    getFirestore, 
    doc, 
    getDoc, 
    collection, 
    query, 
    where, 
    getDocs, 
    addDoc, 
    serverTimestamp,
    onSnapshot,
    orderBy,
    limit
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
const teamNameDisplay = document.getElementById("teamNameDisplay");
const teamIdDisplay = document.getElementById("teamIdDisplay");
const teamMembersList = document.getElementById("teamMembersList");

const noActiveRoundMsg = document.getElementById("noActiveRoundMsg");
const activeRoundFormContainer = document.getElementById("activeRoundFormContainer");
const activeRoundTitle = document.getElementById("activeRoundTitle");
const activeRoundDesc = document.getElementById("activeRoundDesc");
const teamStatusBadge = document.getElementById("teamStatusBadge");

const submissionForm = document.getElementById("submissionForm");
const submitMissionBtn = document.getElementById("submitMissionBtn");
const submissionStatus = document.getElementById("submissionStatus");
const announcementsFeed = document.getElementById("announcementsFeed");

let currentUserDoc = null;
let currentTeamId = null;
let activeRoundId = null;

// Enforce Auth
onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '/login.html';
        return;
    }
    
    userEmailDisplay.textContent = user.email;

    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            currentUserDoc = userSnap.data();
            currentTeamId = currentUserDoc.teamId;
            
            if (currentTeamId) {
                await loadTeamData(currentTeamId);
            } else {
                teamNameDisplay.textContent = "Unassigned Agent";
                teamIdDisplay.textContent = "N/A";
                teamMembersList.innerHTML = `<li><span style="color: var(--strike-red);">You are not assigned to a team yet. Contact admin.</span></li>`;
            }
        }
        
        // Load global dashboard data
        loadActiveRounds();
        listenToAnnouncements();

    } catch (error) {
        console.error("Error loading dashboard data:", error);
    }
});

// Logout
logoutBtn.addEventListener("click", () => {
    signOut(auth).then(() => {
        window.location.href = '/login.html';
    });
});

// Load Team Data
async function loadTeamData(teamId) {
    try {
        const teamRef = doc(db, "teams", teamId);
        const teamSnap = await getDoc(teamRef);
        
        if (teamSnap.exists()) {
            const team = teamSnap.data();
            teamNameDisplay.textContent = team.teamName || "Unknown Team";
            teamIdDisplay.textContent = teamId;
            
            if (team.members && team.members.length > 0) {
                teamMembersList.innerHTML = "";
                team.members.forEach(member => {
                    const li = document.createElement("li");
                    
                    const nameSpan = document.createElement("span");
                    nameSpan.textContent = member.name;
                    nameSpan.style.color = "var(--white)";
                    
                    const roleSpan = document.createElement("span");
                    roleSpan.className = "role-tag";
                    roleSpan.textContent = member.role || "MEMBER";
                    
                    // Highlight leader
                    if (member.role && member.role.toUpperCase() === "LEADER") {
                        roleSpan.style.background = "rgba(229, 9, 20, 0.3)";
                        roleSpan.style.color = "var(--strike-red)";
                        roleSpan.style.border = "1px solid var(--strike-red)";
                    }

                    li.appendChild(nameSpan);
                    li.appendChild(roleSpan);
                    teamMembersList.appendChild(li);
                });
            } else {
                teamMembersList.innerHTML = `<li><span style="color: rgba(255,255,255,0.5);">No members found.</span></li>`;
            }
        }
    } catch (error) {
        console.error("Error fetching team data:", error);
    }
}

// Load Active Rounds
async function loadActiveRounds() {
    try {
        const roundsRef = collection(db, "rounds");
        const q = query(roundsRef, where("isActive", "==", true), limit(1));
        const querySnapshot = await getDocs(q);
        
        if (!querySnapshot.empty) {
            const roundDoc = querySnapshot.docs[0];
            activeRoundId = roundDoc.id;
            const roundData = roundDoc.data();
            
            noActiveRoundMsg.style.display = "none";
            activeRoundFormContainer.style.display = "block";
            teamStatusBadge.style.display = "inline-block";
            
            activeRoundTitle.textContent = roundData.title || "Active Round";
            activeRoundDesc.textContent = roundData.description || "Submit your payload below.";
        } else {
            noActiveRoundMsg.style.display = "block";
            activeRoundFormContainer.style.display = "none";
            teamStatusBadge.style.display = "none";
        }
    } catch (error) {
        console.error("Error loading rounds:", error);
    }
}

// Listen to Announcements
function listenToAnnouncements() {
    const annRef = collection(db, "announcements");
    const q = query(annRef, orderBy("timestamp", "desc"), limit(5));
    
    onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            announcementsFeed.innerHTML = `<p style="color: rgba(255,255,255,0.5); font-size: 0.9rem;">No new communications.</p>`;
            return;
        }
        
        announcementsFeed.innerHTML = "";
        snapshot.forEach((doc) => {
            const data = doc.data();
            const date = data.timestamp ? data.timestamp.toDate().toLocaleString() : "Just now";
            
            const item = document.createElement("div");
            item.className = "announcement-item";
            
            item.innerHTML = `
                <div class="announcement-time">${date}</div>
                <div class="announcement-title">${data.title || 'Intel Update'}</div>
                <div class="announcement-body">${data.message || ''}</div>
            `;
            announcementsFeed.appendChild(item);
        });
    }, (error) => {
        console.error("Error listening to announcements:", error);
    });
}

// Handle Submissions
submissionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    if (!currentTeamId) {
        submissionStatus.textContent = "Error: You are not assigned to a team.";
        submissionStatus.style.color = "var(--strike-red)";
        return;
    }
    
    if (!activeRoundId) {
        submissionStatus.textContent = "Error: No active round found.";
        submissionStatus.style.color = "var(--strike-red)";
        return;
    }
    
    submitMissionBtn.disabled = true;
    submitMissionBtn.textContent = "TRANSMITTING...";
    submissionStatus.textContent = "";
    
    const githubLink = document.getElementById("githubLink").value;
    const demoLink = document.getElementById("demoLink").value;
    
    try {
        await addDoc(collection(db, "submissions"), {
            teamId: currentTeamId,
            roundId: activeRoundId,
            githubLink: githubLink,
            demoLink: demoLink,
            submittedBy: auth.currentUser.uid,
            submittedAt: serverTimestamp()
        });
        
        submissionStatus.textContent = "Transmission successful. Payload delivered.";
        submissionStatus.style.color = "#4ade80"; // green
        submissionForm.reset();
        
    } catch (error) {
        console.error("Submission error:", error);
        submissionStatus.textContent = "Transmission failed. Check permissions.";
        submissionStatus.style.color = "var(--strike-red)";
    } finally {
        submitMissionBtn.disabled = false;
        submitMissionBtn.textContent = "TRANSMIT CODE";
    }
});
