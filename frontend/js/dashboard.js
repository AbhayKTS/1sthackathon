import {
    auth,
    db,
    API_BASE,
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
    limit,
    setDoc,
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
        signOut(auth).then(() => {
            sessionStorage.clear();
            alert('Session expired due to inactivity. Please log in again.');
            window.location.href = '/login';
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
let notificationsUnsubscriber = null;
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
    if (notificationsUnsubscriber) {
        notificationsUnsubscriber();
        notificationsUnsubscriber = null;
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
    
    // Auth successful, reveal body
    document.body.style.visibility = '';
    
    userEmailDisplay.textContent = user.email;

    try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        
        if (userSnap.exists()) {
            currentUserDoc = userSnap.data();
            currentTeamId = currentUserDoc.teamId;
            if (!currentTeamId) {
                // Not assigned to a team -> redirect to Team Completion Wizard
                window.location.href = '/onboarding.html';
                return;
            }
            
            await loadTeamData(currentTeamId);
        }
        
        // Load global dashboard data
        loadActiveRounds();
        listenToAnnouncements();
        loadLeaderboard();
        listenToNotifications();

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
        window.location.href = '/login';
    });
});

// Load Team Data
async function loadTeamData(teamId) {
    try {
        const teamRef = doc(db, "teams", teamId);
        const teamSnap = await getDoc(teamRef);
        
        if (teamSnap.exists()) {
            const team = teamSnap.data();

            // Block access if not Approved
            if (team.status === 'Incomplete') {
                sessionStorage.setItem('rh_need_changes', JSON.stringify(team.needChangesHistory || []));
                window.location.href = '/onboarding.html';
                return;
            }
            if (team.status === 'Rejected') {
                document.body.innerHTML = `
                    <div style="text-align:center; margin-top:20%; color: var(--strike-red); font-family: 'Zen Dots', sans-serif;">
                        <h1>ACCESS DENIED</h1>
                        <p style="font-family: 'JetBrains Mono', monospace; font-size: 1rem; color: rgba(255,255,255,0.6); margin-top: 20px;">Your team's application has been rejected by central command.</p>
                    </div>
                `;
                return;
            }
            if (team.status === 'Submitted') {
                document.body.innerHTML = `
                    <div style="text-align:center; margin-top:20%; color: white; font-family: 'JetBrains Mono', monospace;">
                        <h2 style="font-family: 'Zen Dots', sans-serif; font-size: 2rem; margin-bottom: 20px;">TRANSMISSION RECEIVED</h2>
                        <p style="color: rgba(255,255,255,0.6); margin-bottom: 30px;">Awaiting administrator clearance. Check back later.</p>
                        <button onclick="sessionStorage.clear(); window.location.href='/login'" style="padding:10px 20px; background:var(--strike-red); border:none; color:white; cursor:pointer; font-family: 'Bebas Neue', sans-serif; letter-spacing: 2px;">LOGOUT</button>
                    </div>
                `;
                return;
            }

            teamNameDisplay.textContent = team.teamName || "Unknown Team";
            teamIdDisplay.textContent = teamId;
            
            if (team.members && team.members.length > 0) {
                teamMembersList.innerHTML = "";
                team.members.forEach(member => {
                    const div = document.createElement("div");
                    div.className = "group flex items-center gap-3 rounded-sm border border-border bg-surface-2 p-3 transition-colors hover:border-primary";
                    
                    const initials = member.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
                    
                    const avatarDiv = document.createElement("div");
                    avatarDiv.className = "grid h-9 w-9 place-items-center rounded-sm bg-background font-mono text-[11px] font-bold text-foreground";
                    avatarDiv.textContent = initials;
                    
                    const infoDiv = document.createElement("div");
                    infoDiv.className = "min-w-0";
                    
                    const nameDiv = document.createElement("div");
                    nameDiv.className = "truncate text-sm font-medium text-foreground";
                    nameDiv.textContent = member.name;
                    
                    const roleDiv = document.createElement("div");
                    roleDiv.className = "truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground";
                    roleDiv.textContent = member.role || "MEMBER";
                    
                    if (member.role && member.role.toUpperCase() === "LEADER") {
                        roleDiv.style.color = "var(--primary)";
                        avatarDiv.style.color = "var(--primary)";
                    }

                    infoDiv.appendChild(nameDiv);
                    infoDiv.appendChild(roleDiv);
                    div.appendChild(avatarDiv);
                    div.appendChild(infoDiv);
                    
                    teamMembersList.appendChild(div);
                });
            } else {
                teamMembersList.innerHTML = `<div class="col-span-2 p-4 text-center font-mono text-xs text-muted-foreground">No members found.</div>`;
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
                            <span class="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2/70 px-3 py-1.5">
                              <span class="text-accent"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg></span>
                              <span class="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground">Problem Statement</span>
                            </span>
                            <span class="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2/70 px-3 py-1.5">
                              <span class="text-accent"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>
                              <span class="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground">Presentation Deck (PPT)</span>
                            </span>
                        `;
                    }
                    if (heroVerticalText) heroVerticalText.textContent = "- FOCUS - PLAN - EXECUTE - DOMINATE -";
                    if (heroFooterText) heroFooterText.textContent = "[ SUBMISSION DEADLINE WILL BE ANNOUNCED SOON ]";
                    if (heroExtraBox) heroExtraBox.innerHTML = "";
                } else if (t.includes("2") || t.includes("two")) {
                    roundNum = "02";
                    topText = "WE RIDE";
                    bottomText = "AT MIDNIGHT";
                    if (heroImageBg) heroImageBg.src = "assets/images/round2img.png";
                    if (heroRoundBadge) heroRoundBadge.textContent = `LIVE // ROUND 02`;
                    if (heroRoundDesc) heroRoundDesc.innerHTML = `The underground waits for no one. Lock in your code, defend your turf, and take the throne.`;
                    if (heroRequirementsTitle) heroRequirementsTitle.textContent = "WHAT TO SUBMIT";
                    if (heroRequirementsList) {
                        heroRequirementsList.innerHTML = `
                            <span class="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2/70 px-3 py-1.5">
                              <span class="text-accent"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg></span>
                              <span class="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground">Source Code (GitHub)</span>
                            </span>
                            <span class="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2/70 px-3 py-1.5">
                              <span class="text-accent"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg></span>
                              <span class="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground">Live Demo Link</span>
                            </span>
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
                
                // Initialize countdown target
                let targetTime = null;
                
                if (roundData.submissionDeadline) {
                    const deadlineMs = roundData.submissionDeadline.toMillis ? roundData.submissionDeadline.toMillis() : roundData.submissionDeadline.seconds ? roundData.submissionDeadline.seconds * 1000 : null;
                    if (deadlineMs) targetTime = deadlineMs;
                } else if (roundData.updatedAt) {
                    // Fallback to 24h after activation if no deadline is set
                    const updatedMs = roundData.updatedAt.toMillis ? roundData.updatedAt.toMillis() : roundData.updatedAt.seconds ? roundData.updatedAt.seconds * 1000 : Date.now();
                    targetTime = updatedMs + 24 * 60 * 60 * 1000;
                }
                
                if (targetTime) {
                    startCountdown(targetTime);
                } else {
                    const displayEl = document.getElementById("countdownDisplay");
                    if (displayEl) displayEl.innerHTML = `<span class="text-blood text-3xl">TBA</span>`;
                    const progressEl = document.getElementById("countdownProgress");
                    if (progressEl) progressEl.style.width = "0%";
                }
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
    const q = query(annRef, orderBy("timestamp", "desc"), limit(20));
    
    announcementsUnsubscriber = onSnapshot(q, async (snapshot) => {
        // filter out soft-deleted announcements
        const visibleDocs = snapshot.docs.filter(docSnap => docSnap.data().isVisible !== false);

        if (visibleDocs.length === 0) {
            announcementsFeed.innerHTML = `<p style="color: rgba(255,255,255,0.5); font-size: 0.9rem; padding: 20px; text-align: center;">No new communications.</p>`;
            updateUnreadBadge(0);
            return;
        }
        
        announcementsFeed.innerHTML = "";
        let newUnreadCount = 0;

        for (const docSnap of visibleDocs) {
            const data = docSnap.data();
            const annId = docSnap.id;
            const annVersion = data.version || 1;
            const date = data.timestamp ? data.timestamp.toDate().toLocaleString() : "Just now";
            
            // Check read state
            let isUnread = true;
            try {
                const readStateRef = doc(db, "announcements", annId, "ReadState", auth.currentUser.uid);
                const readSnap = await getDoc(readStateRef);
                if (readSnap.exists()) {
                    const readData = readSnap.data();
                    if (readData.version >= annVersion) {
                        isUnread = false;
                    }
                }
            } catch (err) {
                console.error("Error fetching read state:", err);
            }

            if (isUnread) newUnreadCount++;

            const item = document.createElement("li");
            item.className = "flex flex-col gap-2 border-b border-border pb-3 last:border-b-0 last:pb-0 cursor-pointer hover:bg-white/5 transition-colors p-2 rounded-sm";
            if (isUnread) {
                item.style.borderLeft = "2px solid var(--primary)";
                item.style.backgroundColor = "rgba(230, 57, 70, 0.05)";
            }
            
            item.innerHTML = `
                <div class="flex items-start justify-between gap-4">
                    <span class="text-sm text-foreground flex items-center gap-2">
                        ${sanitizeHTML(data.title) || 'Intel Update'}
                        ${isUnread ? '<span class="text-primary text-[9px] border border-primary px-1 rounded-sm pulse-dot font-mono">NEW</span>' : ''}
                    </span>
                    <span class="whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                        ${date}
                    </span>
                </div>
                ${data.message ? `<div class="text-xs text-muted-foreground mt-1">${sanitizeHTML(data.message)}</div>` : ''}
            `;
            
            // Click to mark as read
            item.addEventListener("click", async () => {
                if (isUnread) {
                    try {
                        const readStateRef = doc(db, "announcements", annId, "ReadState", auth.currentUser.uid);
                        await setDoc(readStateRef, {
                            readAt: serverTimestamp(),
                            version: annVersion
                        }, { merge: true });
                        
                        // Optimistic UI update
                        item.style.borderLeft = "none";
                        item.style.backgroundColor = "transparent";
                        const badgeEl = item.querySelector('.text-blood');
                        if (badgeEl) badgeEl.remove();
                        isUnread = false;
                        newUnreadCount = Math.max(0, newUnreadCount - 1);
                        updateUnreadBadge(newUnreadCount);
                    } catch (e) {
                        console.error("Error marking as read", e);
                    }
                }
            });

            announcementsFeed.appendChild(item);
        }
        updateUnreadBadge(newUnreadCount);
    }, (error) => {
        console.error("Error listening to announcements:", error);
    });
}

function updateUnreadBadge(count) {
    const badge = document.getElementById("unreadBadge");
    if (!badge) return;
    if (count > 0) {
        badge.textContent = `${count} NEW`;
        badge.classList.remove("hidden");
    } else {
        badge.classList.add("hidden");
    }
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
            leaderboardTableBody.innerHTML = `<li class="p-6 text-center text-sm text-muted-foreground">No teams registered yet.</li>`;
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
            const li = document.createElement("li");
            const rank = index + 1;
            
            let rankColor = "text-muted-foreground";
            let borderColor = "border-l-transparent";
            
            if (rank === 1) {
                rankColor = "text-[color:var(--color-gold)]";
                borderColor = "border-l-[color:var(--color-gold)]";
            } else if (rank === 2) {
                rankColor = "text-[color:var(--color-silver)]";
                borderColor = "border-l-[color:var(--color-silver)]";
            } else if (rank === 3) {
                rankColor = "text-[color:var(--color-bronze)]";
                borderColor = "border-l-[color:var(--color-bronze)]";
            }
            
            li.className = `grid grid-cols-[80px_1fr_120px] items-center gap-4 border-b border-border border-l-2 ${borderColor} px-6 py-4 transition-colors last:border-b-0 hover:bg-surface-2`;
            
            const rankStr = String(rank).padStart(2, '0');
            
            li.innerHTML = `
                <span class="font-mono text-sm font-bold tabular-nums ${rankColor}">${rankStr}</span>
                <span class="text-sm font-semibold text-foreground truncate">${sanitizeHTML(team.name)}</span>
                <span class="text-right font-mono text-sm font-semibold text-accent tabular-nums">${team.score.toLocaleString()}</span>
            `;
            leaderboardTableBody.appendChild(li);
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
        const idToken = await auth.currentUser.getIdToken(true);

        const payload = {
            teamId: currentTeamId,
            roundId: activeRoundId,
            githubLink,
            demoLink
        };

        const response = await fetch(`${API_BASE}/submission/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify(payload)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error?.message || 'Failed to submit payload');
        }
        
        if (submissionStatus) {
            submissionStatus.textContent = "Transmission successful. Payload delivered.";
            submissionStatus.style.color = "#4ade80";
        }
        submissionForm.reset();
        
    } catch (error) {
        console.error("Submission error:", error);
        if (submissionStatus) {
            submissionStatus.textContent = error.message || "Transmission failed. Check permissions.";
            submissionStatus.style.color = "var(--strike-red)";
        }
    } finally {
        if (submitMissionBtn) { submitMissionBtn.disabled = false; submitMissionBtn.textContent = "TRANSMIT CODE"; }
    }
  });
}

// Notifications Logic
const notifBtn = document.getElementById("notifBtn");
const notifDropdown = document.getElementById("notifDropdown");
const notifList = document.getElementById("notifList");
const notifBadge = document.getElementById("notifBadge");

if (notifBtn && notifDropdown) {
    notifBtn.addEventListener("click", () => {
        notifDropdown.classList.toggle("hidden");
    });
    
    // Close when clicking outside
    document.addEventListener("click", (e) => {
        if (!notifBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
            notifDropdown.classList.add("hidden");
        }
    });
}

function listenToNotifications() {
    if (notificationsUnsubscriber) notificationsUnsubscriber();

    const notifRef = collection(db, "notifications");
    const q = query(notifRef, where("userId", "==", auth.currentUser.uid), orderBy("createdAt", "desc"), limit(10));
    
    notificationsUnsubscriber = onSnapshot(q, (snapshot) => {
        if (!notifList) return;
        
        if (snapshot.empty) {
            notifList.innerHTML = `<div class="p-4 text-center font-mono text-xs text-muted-foreground">No alerts.</div>`;
            if (notifBadge) notifBadge.classList.add("hidden");
            return;
        }
        
        let unreadCount = 0;
        notifList.innerHTML = "";
        
        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const id = docSnap.id;
            
            if (!data.isRead) unreadCount++;
            
            const item = document.createElement("div");
            item.className = `p-4 border-b border-border/30 transition-colors ${data.isRead ? 'opacity-70' : 'bg-white/5 hover:bg-white/10'}`;
            item.style.cursor = data.isRead ? 'default' : 'pointer';
            
            let iconColor = 'var(--muted-foreground)';
            if (data.type === 'team_approved') iconColor = '#4ade80';
            if (data.type === 'team_rejected') iconColor = 'var(--strike-red)';
            if (data.type === 'team_need_changes') iconColor = '#f59e0b';
            if (data.type === 'submission_received') iconColor = '#3b82f6';
            
            item.innerHTML = `
                <div class="flex gap-3">
                    <div class="mt-1 h-2 w-2 rounded-full shrink-0" style="background-color: ${data.isRead ? 'transparent' : iconColor}; border: 1px solid ${iconColor}"></div>
                    <div>
                        <div class="font-impact text-sm tracking-widest text-foreground" style="font-family: 'Bebas Neue', sans-serif;">${sanitizeHTML(data.title)}</div>
                        <div class="font-jp text-xs text-muted-foreground mt-1" style="font-family: 'Noto Sans JP', sans-serif;">${sanitizeHTML(data.message)}</div>
                        <div class="font-mono text-[9px] text-muted-foreground mt-2" style="font-family: 'JetBrains Mono', monospace;">${data.createdAt ? data.createdAt.toDate().toLocaleString() : 'Just now'}</div>
                    </div>
                </div>
            `;
            
            if (!data.isRead) {
                item.addEventListener("click", async () => {
                    try {
                        const idToken = await auth.currentUser.getIdToken();
                            
                        await fetch(`${API_BASE}/notifications/${id}`, {
                            method: 'PATCH',
                            headers: { 'Authorization': `Bearer ${idToken}` }
                        });
                    } catch (e) {
                        console.error("Failed to mark as read", e);
                    }
                });
            }
            
            notifList.appendChild(item);
        });
        
        if (notifBadge) {
            if (unreadCount > 0) {
                notifBadge.classList.remove("hidden");
            } else {
                notifBadge.classList.add("hidden");
            }
        }
    }, (error) => {
        console.error("Error listening to notifications:", error);
    });
}

