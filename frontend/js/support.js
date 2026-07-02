import {
    auth,
    db,
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    API_BASE
} from "./firebase-init.js";

// DOM Elements
const logoutBtn = document.getElementById("logoutBtn");
const createTicketForm = document.getElementById("createTicketForm");
const submitBtn = document.getElementById("submitBtn");
const createError = document.getElementById("createError");
const ticketsList = document.getElementById("ticketsList");
const ticketModal = document.getElementById("ticketModal");
const closeModalBtn = document.getElementById("closeModalBtn");
const modalMessages = document.getElementById("modalMessages");
const modalSubject = document.getElementById("modalSubject");
const modalStatus = document.getElementById("modalStatus");
const modalCategory = document.getElementById("modalCategory");

// Auth State
let currentUser = null;
let currentToken = null;
let ticketsUnsubscriber = null;
let activeTickets = [];

auth.onAuthStateChanged(async (user) => {
    if (!user) {
        window.location.href = "/login.html";
        return;
    }
    currentUser = user;
    currentToken = await user.getIdToken();
    
    listenToTickets();
});

if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
        auth.signOut();
    });
}

function listenToTickets() {
    if (ticketsUnsubscriber) ticketsUnsubscriber();

    const ticketsRef = collection(db, "tickets");
    const q = query(ticketsRef, where("userId", "==", currentUser.uid), orderBy("updatedAt", "desc"));

    ticketsUnsubscriber = onSnapshot(q, (snapshot) => {
        if (snapshot.empty) {
            ticketsList.innerHTML = `<div class="p-8 text-center text-muted-foreground font-mono text-xs tracking-widest border border-border border-dashed">No active communications.</div>`;
            activeTickets = [];
            return;
        }

        activeTickets = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        renderTickets();
    }, (error) => {
        console.error("Error listening to tickets:", error);
        ticketsList.innerHTML = `<div class="text-strike-red font-mono text-xs text-center p-4">Error loading communications. Check console.</div>`;
    });
}

function renderTickets() {
    ticketsList.innerHTML = "";
    activeTickets.forEach(ticket => {
        const item = document.createElement("div");
        item.className = "border border-border/50 bg-black/40 hover:bg-black/80 transition-colors p-4 cursor-pointer flex justify-between items-center group";
        
        let statusColor = "text-muted-foreground";
        if (ticket.status === 'Open') statusColor = "text-emerald-400";
        if (ticket.status === 'Pending') statusColor = "text-amber-400";

        item.innerHTML = `
            <div>
                <div class="font-impact text-lg tracking-widest group-hover:text-blood transition-colors" style="font-family: 'Bebas Neue', sans-serif;">
                    ${sanitizeHTML(ticket.subject)}
                </div>
                <div class="font-mono text-[10px] text-muted-foreground mt-1 flex gap-2 items-center" style="font-family: 'JetBrains Mono', monospace;">
                    <span class="${statusColor}">${ticket.status.toUpperCase()}</span>
                    <span>//</span>
                    <span class="text-blood">${ticket.category.toUpperCase()}</span>
                </div>
            </div>
            <div class="font-mono text-[9px] text-muted-foreground text-right" style="font-family: 'JetBrains Mono', monospace;">
                ${ticket.updatedAt ? ticket.updatedAt.toDate().toLocaleDateString() : ''} <br/>
                ${ticket.messages?.length || 0} MSGS
            </div>
        `;

        item.addEventListener("click", () => openTicketModal(ticket));
        ticketsList.appendChild(item);
    });
}

function openTicketModal(ticket) {
    modalSubject.textContent = ticket.subject;
    modalStatus.textContent = ticket.status.toUpperCase();
    modalCategory.textContent = ticket.category.toUpperCase();
    
    modalMessages.innerHTML = "";
    if (ticket.messages && ticket.messages.length > 0) {
        ticket.messages.forEach(msg => {
            const isUser = msg.sender === 'user';
            const msgEl = document.createElement("div");
            msgEl.className = `p-4 border ${isUser ? 'border-border/30 bg-white/5 mr-12' : 'border-blood/30 bg-blood/5 ml-12'} rounded-sm`;
            msgEl.innerHTML = `
                <div class="flex justify-between items-start mb-2 border-b ${isUser ? 'border-border/20' : 'border-blood/20'} pb-2">
                    <span class="font-bold ${isUser ? 'text-foreground' : 'text-blood'} text-xs uppercase tracking-widest">${isUser ? 'YOU' : 'CENTRAL COMMAND'}</span>
                    <span class="text-[9px] text-muted-foreground">${new Date(msg.timestamp).toLocaleString()}</span>
                </div>
                <div class="whitespace-pre-wrap text-muted-foreground leading-relaxed">${sanitizeHTML(msg.content)}</div>
            `;
            modalMessages.appendChild(msgEl);
        });
    }

    ticketModal.classList.remove("hidden");
}

if (closeModalBtn) {
    closeModalBtn.addEventListener("click", () => {
        ticketModal.classList.add("hidden");
    });
}
// Close modal on click outside
ticketModal.addEventListener("click", (e) => {
    if (e.target === ticketModal) {
        ticketModal.classList.add("hidden");
    }
});

// Create Ticket Submission
if (createTicketForm) {
    createTicketForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        createError.classList.add("hidden");
        
        if (!currentToken) return;

        const subject = document.getElementById("subject").value;
        const category = document.getElementById("category").value;
        const message = document.getElementById("message").value;

        submitBtn.disabled = true;
        submitBtn.textContent = "TRANSMITTING...";

        try {
            // Find teamId from user object (cached via auth claim or firestore? We'll let server handle it or rely on existing session)
            // Wait, we need to send teamId. If we don't have it on client, server can look it up.
            // But we actually only require userId. Let's send what we have.
            
            const res = await fetch(`${API_BASE}/tickets`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${currentToken}`
                },
                body: JSON.stringify({ subject, category, message })
            });

            const data = await res.json();
            
            if (!res.ok) {
                throw new Error(data.error?.message || "Failed to create ticket");
            }

            // Success
            createTicketForm.reset();
        } catch (error) {
            console.error(error);
            createError.textContent = error.message;
            createError.classList.remove("hidden");
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = "TRANSMIT SIGNAL";
        }
    });
}

function sanitizeHTML(str) {
    if (!str) return '';
    const temp = document.createElement('div');
    temp.textContent = str;
    return temp.innerHTML;
}
