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

// ─── SECURITY: Session Inactivity Timeout ───────────────────────
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
let inactivityTimer = null;

function resetInactivityTimer() {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        signOut(auth).then(() => {
            sessionStorage.clear();
            alert('Session expired due to inactivity. Please log in again.');
            window.location.href = '/login.html';
        });
    }, SESSION_TIMEOUT_MS);
}

['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(event => {
    document.addEventListener(event, resetInactivityTimer, { passive: true });
});
resetInactivityTimer();

// DOM Elements — all reads guarded because some elements only exist when a round is active
const userEmailDisplay = document.getElementById("userEmailDisplay");
const logoutBtn = document.getElementById("logoutBtn");
const teamNameDisplay = document.getElementById("teamNameDisplay");
const teamIdDisplay = document.getElementById("teamIdDisplay");
const teamMembersList = document.getElementById("teamMembersList");

const noActiveRoundMsg = document.getElementById("noActiveRoundMsg");       // may not exist
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

// Firebase real-time listener unsubscribers to prevent memory leaks and duplicate queries
let roundsUnsubscribers = [];
let announcementsUnsubscriber = null;
let leaderboardUnsubscriber = null;
let countdownInterval = null;

function cleanupListeners() {
    roundsUnsubscribers.forEach(unsub => unsub());
    roundsUnsubscribers = [];
    if (announcementsUnsubscriber) {
        announcementsUnsubscriber();
        announcementsUnsubscriber = null;
    }
    if (leaderboardUnsubscriber) {
        leaderboardUnsubscriber();
        leaderboardUnsubscriber = null;
    }
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }
}

// Input Sanitization Helper
function sanitizeHTML(str) {
    if (typeof str !== 'string') return '';
    return str.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

// Enforce Auth
onAuthStateChanged(auth, async (user) => {
    // Cleanup any existing real-time listeners first to avoid leaks
    cleanupListeners();

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
        loadLeaderboard();

    } catch (error) {
        console.error("Error loading dashboard data:", error);
    }
});

// Logout — clear all session data
logoutBtn.addEventListener("click", () => {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    cleanupListeners();
    signOut(auth).then(() => {
        sessionStorage.clear();
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

const heroRoundBadge = document.getElementById("heroRoundBadge");
const heroRoundTitle = document.getElementById("heroRoundTitle");
const heroImageBg = document.getElementById("heroImageBg");
const heroRoundDesc = document.getElementById("heroRoundDesc");
const heroRequirementsTitle = document.getElementById("heroRequirementsTitle");
const heroRequirementsList = document.getElementById("heroRequirementsList");
const heroVerticalText = document.getElementById("heroVerticalText");
const heroExtraBox = document.getElementById("heroExtraBox");
const heroFooterText = document.getElementById("heroFooterText");

// Load Active Rounds - listen to fixed doc IDs
function loadActiveRounds() {
    const roundIds = ["round-1", "round-2", "round-3"];
    
    // Clear any previous active rounds listeners
    roundsUnsubscribers.forEach(unsub => unsub());
    roundsUnsubscribers = [];

    // Listen to all 3 round docs simultaneously
    roundIds.forEach(rid => {
        const roundRef = doc(db, "rounds", rid);
        const unsub = onSnapshot(roundRef, (roundDoc) => {
            if (roundDoc.exists() && roundDoc.data().isActive) {
                activeRoundId = roundDoc.id;
                const roundData = roundDoc.data();
                
                if (noActiveRoundMsg) noActiveRoundMsg.style.display = "none";
                if (activeRoundFormContainer) activeRoundFormContainer.style.display = "block";
                if (teamStatusBadge) teamStatusBadge.style.display = "inline-block";
                
                activeRoundTitle.textContent = roundData.title || "Active Round";
                activeRoundDesc.textContent = roundData.description || "Submit your payload below.";
                
                let roundNum = "XX";
                let topText = "AWAITING";
                let bottomText = "NEXT ROUND";
                
                let t = (roundData.title || "").toLowerCase();
                
                if (t.includes("1") || t.includes("one")) {
                    roundNum = "01";
                    topText = "SHOW US";
                    bottomText = "WHAT YOU GOT";
                    if (heroImageBg) heroImageBg.src = "assets/images/round1img.png";
                    if (heroRoundBadge) heroRoundBadge.textContent = `LIVE // ROUND 01`;
                    if (heroRoundDesc) {
                        heroRoundDesc.innerHTML = `This is your first move.<br />Submit your problem statements and<br />presentation decks that define your vision,<br />your approach, and your edge.`;
                    }
                    if (heroRequirementsTitle) heroRequirementsTitle.textContent = "WHAT TO SUBMIT";
                    if (heroRequirementsList) {
                        heroRequirementsList.innerHTML = `
                            <div class="flex items-center gap-3">
                                <div class="h-6 w-6 border border-blood flex items-center justify-center text-blood">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                                </div>
                                PROBLEM STATEMENT
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="h-6 w-6 border border-blood flex items-center justify-center text-blood">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x1="12" y2="21"></line></svg>
                                </div>
                                PRESENTATION DECK (PPT)
                            </div>
                        `;
                    }
                    if (heroVerticalText) heroVerticalText.textContent = "- FOCUS - PLAN - EXECUTE - DOMINATE -";
                    if (heroFooterText) heroFooterText.textContent = "[ SUBMISSION DEADLINE WILL BE ANNOUNCED SOON ]";
                    if (heroExtraBox) heroExtraBox.innerHTML = "";
                } else if (t.includes("2") || t.includes("two")) {
                    roundNum = "02";
                    topText = "WE RIDE";
                    bottomText = "AT MIDNIGHT";
                    if (heroImageBg) heroImageBg.src = "assets/images/hero-biker.jpg";
                    if (heroRoundBadge) heroRoundBadge.textContent = `LIVE // ROUND 02`;
                    if (heroRoundDesc) heroRoundDesc.innerHTML = `The underground waits for no one. Lock in your code, defend your turf, and take the throne.`;
                    if (heroRequirementsTitle) heroRequirementsTitle.textContent = "WHAT TO SUBMIT";
                    if (heroRequirementsList) {
                        heroRequirementsList.innerHTML = `
                            <div class="flex items-center gap-3">
                                <div class="h-6 w-6 border border-blood flex items-center justify-center text-blood">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                                </div>
                                GITHUB REPOSITORY
                            </div>
                        `;
                    }
                    if (heroVerticalText) heroVerticalText.textContent = "- CODE - DEPLOY - DEFEND - CONQUER -";
                    if (heroFooterText) heroFooterText.textContent = "[ TICK TOCK. TIME IS RUNNING OUT. ]";
                    if (heroExtraBox) heroExtraBox.innerHTML = "";
                } else if (t.includes("3") || t.includes("three")) {
                    roundNum = "03";
                    topText = "SEEK THE";
                    bottomText = "WAY IN OR OUT";
                    if (heroImageBg) heroImageBg.src = "assets/images/round3img.png";
                    if (heroRoundBadge) heroRoundBadge.textContent = `LIVE // ROUND 03 - FINALE`;
                    if (heroRoundDesc) {
                        heroRoundDesc.innerHTML = `This is it. The final showdown.<br />Every idea. Every line of code. Every late night.<br />Now it decides.<br /><br /><span class="text-blood">Only one will rise.</span><br /><span class="text-blood">Only one will win.</span>`;
                    }
                    if (heroRequirementsTitle) heroRequirementsTitle.textContent = "WHAT DECIDES THE WINNER?";
                    if (heroRequirementsList) {
                        heroRequirementsList.innerHTML = `
                            <div class="flex items-center gap-3">
                                <div class="h-6 w-6 border border-blood flex items-center justify-center text-blood">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>
                                </div>
                                PROBLEM SOLVING
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="h-6 w-6 border border-blood flex items-center justify-center text-blood">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                                </div>
                                INNOVATION
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="h-6 w-6 border border-blood flex items-center justify-center text-blood">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>
                                </div>
                                IMPACT &amp; FEASIBILITY
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="h-6 w-6 border border-blood flex items-center justify-center text-blood">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                                </div>
                                PRESENTATION EXCELLENCE
                            </div>
                        `;
                    }
                    if (heroVerticalText) heroVerticalText.textContent = "- FOCUS - PLAN - IMPACT - INSPIRE - WIN -";
                    if (heroFooterText) heroFooterText.textContent = "[ ONE HACKATHON. ONE WINNER. LEGENDS REMEMBERED. ]";
                    if (heroExtraBox) {
                        heroExtraBox.innerHTML = `
                            <div class="border border-blood bg-black/80 p-4 font-mono text-xs tracking-[0.2em] flex flex-col gap-3" style="font-family: 'JetBrains Mono', monospace;">
                                <div class="text-white">THE THRONE<br/>AWAITS.</div>
                                <div class="border border-blood text-blood px-3 py-1 text-[10px] text-center">WHO WILL CLAIM IT?</div>
                            </div>
                        `;
                    }
                }
 
                if(heroRoundTitle) heroRoundTitle.innerHTML = `${topText}<br /><span class="text-blood" style="animation: flicker 4s infinite">${bottomText}</span>`;
                
                // Initialize countdown target (24 hours from updatedAt, or 24h from now as fallback)
                let targetTime = Date.now() + 24 * 60 * 60 * 1000;
                if (roundData.updatedAt) {
                    const updatedMs = roundData.updatedAt.toMillis ? roundData.updatedAt.toMillis() : roundData.updatedAt.seconds ? roundData.updatedAt.seconds * 1000 : Date.now();
                    targetTime = updatedMs + 24 * 60 * 60 * 1000;
                }
                startCountdown(targetTime);
            }
        }, (error) => {
            console.error(`Error listening to ${rid}:`, error);
        });
        roundsUnsubscribers.push(unsub);
    });
}

// Start Countdown Timer
function startCountdown(targetTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    
    const displayEl = document.getElementById("countdownDisplay");
    const progressEl = document.getElementById("countdownProgress");
    if (!displayEl) return;
    
    function tick() {
        const now = Date.now();
        const diff = Math.max(0, targetTime - now);
        
        if (diff === 0) {
            displayEl.innerHTML = `00<span class="text-blood">:</span>00<span class="text-blood">:</span>00`;
            if (progressEl) progressEl.style.width = "0%";
            clearInterval(countdownInterval);
            return;
        }
        
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        
        displayEl.innerHTML = `${String(hours).padStart(2, '0')}<span class="text-blood">:</span>${String(minutes).padStart(2, '0')}<span class="text-blood">:</span>${String(seconds).padStart(2, '0')}`;
        
        if (progressEl) {
            // progress is percentage of 24 hours
            const percent = (diff / (24 * 60 * 60 * 1000)) * 100;
            progressEl.style.width = `${percent}%`;
        }
    }
    
    tick(); // run once immediately
    countdownInterval = setInterval(tick, 1000);
}

// Listen to Announcements
function listenToAnnouncements() {
    if (announcementsUnsubscriber) announcementsUnsubscriber();

    const annRef = collection(db, "announcements");
    const q = query(annRef, orderBy("timestamp", "desc"), limit(5));
    
    announcementsUnsubscriber = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            announcementsFeed.innerHTML = `<p style="color: rgba(255,255,255,0.5); font-size: 0.9rem; padding: 20px; text-align: center;">No new communications.</p>`;
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

// Load Leaderboard from teams collection
function loadLeaderboard() {
    if (leaderboardUnsubscriber) leaderboardUnsubscriber();
    
    const teamsRef = collection(db, "teams");
    const q = query(teamsRef, limit(10));
    
    leaderboardUnsubscriber = onSnapshot(q, (snapshot) => {
        const leaderboardTableBody = document.getElementById("leaderboardTableBody");
        if (!leaderboardTableBody) return;
        
        if (snapshot.empty) {
            leaderboardTableBody.innerHTML = `<tr><td colspan="3" style="text-align: center; color: rgba(255,255,255,0.5); padding: 20px;">No teams registered yet.</td></tr>`;
            return;
        }
        
        const teams = [];
        snapshot.forEach((doc) => {
            const team = doc.data();
            teams.push({
                name: team.teamName || "Unnamed Team",
                score: team.score || 0
            });
        });
        
        // Sort teams by score desc
        teams.sort((a, b) => b.score - a.score);
        
        leaderboardTableBody.innerHTML = "";
        teams.forEach((team, index) => {
            const tr = document.createElement("tr");
            tr.className = "hover:bg-white/5 transition-colors";
            
            const rankStr = String(index + 1).padStart(2, '0');
            let rankClass = "text-muted-foreground";
            if (index === 0) rankClass = "text-gold";
            else if (index === 1) rankClass = "text-slate-300";
            else if (index === 2) rankClass = "text-amber-600";
            
            tr.innerHTML = `
                <td class="py-4 px-6 ${rankClass}">${rankStr}</td>
                <td class="py-4 px-6 text-foreground font-impact tracking-widest text-lg" style="font-family: 'Bebas Neue', sans-serif;">${sanitizeHTML(team.name)}</td>
                <td class="py-4 px-6 text-blood text-right font-mono">${team.score}</td>
            `;
            leaderboardTableBody.appendChild(tr);
        });
    }, (error) => {
        console.error("Error listening to leaderboard:", error);
    });
}

// Handle Submissions — guard: submissionForm only exists in the DOM when a round is active
if (submissionForm) {
  submissionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    if (!currentTeamId) {
        if (submissionStatus) {
            submissionStatus.textContent = "Error: You are not assigned to a team.";
            submissionStatus.style.color = "var(--strike-red)";
        }
        return;
    }
    
    if (!activeRoundId) {
        if (submissionStatus) {
            submissionStatus.textContent = "Error: No active round found.";
            submissionStatus.style.color = "var(--strike-red)";
        }
        return;
    }
    
    if (submitMissionBtn) { submitMissionBtn.disabled = true; submitMissionBtn.textContent = "TRANSMITTING..."; }
    if (submissionStatus) submissionStatus.textContent = "";
    
    const githubLink = document.getElementById("githubLink")?.value || "";
    const demoLink = document.getElementById("demoLink")?.value || "";
    
    try {
        await addDoc(collection(db, "submissions"), {
            teamId: currentTeamId,
            roundId: activeRoundId,
            githubLink,
            demoLink,
            submittedBy: auth.currentUser.uid,
            submittedAt: serverTimestamp()
        });
        
        if (submissionStatus) {
            submissionStatus.textContent = "Transmission successful. Payload delivered.";
            submissionStatus.style.color = "#4ade80";
        }
        submissionForm.reset();
        
    } catch (error) {
        console.error("Submission error:", error);
        if (submissionStatus) {
            submissionStatus.textContent = "Transmission failed. Check permissions.";
            submissionStatus.style.color = "var(--strike-red)";
        }
    } finally {
        if (submitMissionBtn) { submitMissionBtn.disabled = false; submitMissionBtn.textContent = "TRANSMIT CODE"; }
    }
  });
}
