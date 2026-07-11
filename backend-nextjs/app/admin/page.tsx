"use client";

import { useState, useEffect } from "react";
import { getClientAuth, getClientDb } from "@/lib/firebase-client";
import { onAuthStateChanged } from "firebase/auth";
import { collection, onSnapshot, query, orderBy, limit as limitQuery } from "firebase/firestore";

type TabName = "funnel" | "teams" | "drafts" | "submissions" | "evaluations" | "rounds" | "announcements" | "queues";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabName>("funnel");
  const [idToken, setIdToken] = useState<string | null>(null);
  
  // Real-time Firestore state
  const [rounds, setRounds] = useState<any[]>([]);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [invitedTeams, setInvitedTeams] = useState<any[]>([]);
  const [submissions, setSubmissions] = useState<any[]>([]);
  
  // Custom API states
  const [analytics, setAnalytics] = useState<any>({
    invited: 0,
    verified: 0,
    submitted: 0,
    approved: 0,
    leads: 0
  });

  // Mail & Sync Queue log states
  const [mailQueue, setMailQueue] = useState<any[]>([]);
  const [syncQueue, setSyncQueue] = useState<any[]>([]);
  const [mailTotal, setMailTotal] = useState(0);
  const [processingQueues, setProcessingQueues] = useState(false);

  // Forms states
  const [quickAdd, setQuickAdd] = useState({ teamName: "", leaderName: "", leaderEmail: "", leaderPhone: "", college: "", domain: "", problemStatement: "" });
  const [newRound, setNewRound] = useState({ roundId: "", title: "", description: "", type: "general", submissionType: "github_link" });
  const [broadcast, setBroadcast] = useState({ title: "", message: "", portal: true, email: false, discord: false, whatsapp: false });
  const [evaluation, setEvaluation] = useState<Record<string, { draftScore: string; feedback: string }>>({});
  
  // Filter states
  const [selectedRoundId, setSelectedRoundId] = useState("");
  const [teamsSearch, setTeamsSearch] = useState("");
  const [draftsSearch, setDraftsSearch] = useState("");
  
  // Toast notification
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const auth = getClientAuth();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const token = await user.getIdToken();
        setIdToken(token);
      } else {
        setIdToken(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Set up real-time onSnapshot listeners
  useEffect(() => {
    const db = getClientDb();
    
    // Rounds
    const qRounds = query(collection(db, "rounds"), orderBy("roundId"));
    const unsubRounds = onSnapshot(qRounds, (snap) => {
      setRounds(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Announcements
    const qAnn = query(collection(db, "announcements"), orderBy("timestamp", "desc"), limitQuery(10));
    const unsubAnn = onSnapshot(qAnn, (snap) => {
      setAnnouncements(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Teams
    const qTeams = query(collection(db, "teams"), orderBy("updatedAt", "desc"));
    const unsubTeams = onSnapshot(qTeams, (snap) => {
      setTeams(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Invited Drafts
    const qInvited = query(collection(db, "invitedTeams"), orderBy("importedAt", "desc"));
    const unsubInvited = onSnapshot(qInvited, (snap) => {
      setInvitedTeams(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Submissions
    const qSub = query(collection(db, "submissions"), orderBy("submittedAt", "desc"));
    const unsubSub = onSnapshot(qSub, (snap) => {
      setSubmissions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubRounds();
      unsubAnn();
      unsubTeams();
      unsubInvited();
      unsubSub();
    };
  }, []);

  // Fetch Analytics & Queues on Tab Switches
  useEffect(() => {
    if (!idToken) return;

    const fetchAnalytics = async () => {
      try {
        const res = await fetch("/api/admin/analytics", {
          headers: { Authorization: `Bearer ${idToken}` }
        });
        if (res.ok) {
          const result = await res.json();
          setAnalytics(result.data?.stats ?? result.data);
        }
      } catch (err) {
        console.error("Error fetching analytics:", err);
      }
    };

    const fetchQueues = async () => {
      try {
        const [mailRes, syncRes] = await Promise.all([
          fetch("/api/admin/mail-queue?limit=50", { headers: { Authorization: `Bearer ${idToken}` } }),
          fetch("/api/admin/settings", { headers: { Authorization: `Bearer ${idToken}` } }) // placeholders
        ]);
        
        if (mailRes.ok) {
          const mailResult = await mailRes.json();
          setMailQueue(mailResult.data?.jobs ?? []);
          setMailTotal(mailResult.data?.total ?? 0);
        }
      } catch (err) {
        console.error("Error fetching queue logs:", err);
      }
    };

    fetchAnalytics();
    if (activeTab === "queues") {
      fetchQueues();
    }
  }, [idToken, activeTab]);

  // Operations Handlers
  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken) return;

    try {
      const res = await fetch("/api/admin/invite-team", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          teamName: quickAdd.teamName,
          leaderName: quickAdd.leaderName,
          leaderEmail: quickAdd.leaderEmail,
          leaderPhone: quickAdd.leaderPhone,
          college: quickAdd.college,
          domain: quickAdd.domain,
          problemStatement: quickAdd.problemStatement
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Failed to create team invite.");
      
      showToast("Draft team created successfully!");
      setQuickAdd({ teamName: "", leaderName: "", leaderEmail: "", leaderPhone: "", college: "", domain: "", problemStatement: "" });
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleFileUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!idToken) return;

    const fileInput = e.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/admin/import-teams", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Import failed.");

      showToast(`Shortlist uploaded! Imported: ${result.data.stats.imported}, Skipped: ${result.data.stats.skipped}`);
      e.currentTarget.reset();
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleSendInvite = async (id: string) => {
    if (!idToken) return;

    try {
      const res = await fetch(`/api/admin/invited-teams/${id}/invite`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` }
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Failed to send invitation.");

      showToast("Leader invitation email queued!");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleTransitionRound = async (roundId: string, status: string) => {
    if (!idToken) return;

    try {
      const res = await fetch(`/api/admin/rounds/${roundId}/transition`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ to: status })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Transition failed.");

      showToast(`Round transitioned to ${status}!`);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleCreateRound = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken) return;

    try {
      const res = await fetch("/api/admin/rounds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify(newRound)
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Failed to create round.");

      showToast("Draft round created successfully!");
      setNewRound({ roundId: "", title: "", description: "", type: "general", submissionType: "github_link" });
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!idToken) return;

    try {
      const res = await fetch("/api/admin/announcement", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          title: broadcast.title,
          message: broadcast.message,
          channels: {
            portal: broadcast.portal,
            email: broadcast.email,
            discord: broadcast.discord,
            whatsapp: broadcast.whatsapp
          }
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Failed to broadcast announcement.");

      showToast("Announcement broadcast complete!");
      setBroadcast({ title: "", message: "", portal: true, email: false, discord: false, whatsapp: false });
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleSaveEvaluation = async (teamId: string, roundId: string) => {
    if (!idToken) return;

    const data = evaluation[teamId];
    if (!data || !data.draftScore) {
      showToast("Please enter a valid draft score first.", "error");
      return;
    }

    try {
      const res = await fetch("/api/admin/evaluations", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({
          teamId,
          roundId,
          draftScore: parseFloat(data.draftScore),
          feedback: data.feedback || ""
        })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Failed to save score.");

      showToast("Draft score saved!");
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handlePublishScores = async (roundId: string) => {
    if (!idToken) return;
    if (!confirm("Are you sure you want to PUBLISH all scores for this round? This is irreversible for teams.")) return;

    try {
      const res = await fetch("/api/admin/evaluations/publish", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ roundId })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Failed to publish scores.");

      showToast(`Published ${result.data.publishedCount} scores successfully!`);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleToggleTimeLeap = async (teamId: string, eligible: boolean) => {
    if (!idToken) return;

    try {
      const res = await fetch("/api/admin/timeleap/select", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`
        },
        body: JSON.stringify({ teamIds: [teamId], eligible })
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || "Update failed.");

      showToast(`Time Leap eligibility updated!`);
    } catch (err: any) {
      showToast(err.message, "error");
    }
  };

  const handleProcessWorkers = async () => {
    if (!idToken) return;
    setProcessingQueues(true);
    try {
      const [mailRes, sheetsRes] = await Promise.all([
        fetch("/api/internal/mail-worker", { method: "POST", headers: { Authorization: `Bearer ${idToken}` } }),
        fetch("/api/internal/sheets-worker", { method: "POST", headers: { Authorization: `Bearer ${idToken}` } })
      ]);
      showToast("Background workers completed processing queue.");
    } catch (err) {
      console.error("Queue workers failed:", err);
      showToast("Workers failed to execute.", "error");
    } finally {
      setProcessingQueues(false);
    }
  };

  return (
    <div className="flex-1 p-6 md:p-10 space-y-8 relative">
      {/* Toast Notification */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 py-3.5 px-6 rounded-lg shadow-2xl border font-mono text-xs flex items-center gap-3 transition-all duration-300 transform translate-y-0 ${
          toast.type === "success" 
            ? "bg-zinc-900 border-emerald-500/30 text-emerald-400" 
            : "bg-zinc-900 border-red-500/30 text-red-400"
        }`}>
          <span className="w-2 h-2 rounded-full animate-pulse bg-current"></span>
          {toast.message}
        </div>
      )}

      {/* Header & Worker Actions */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-[var(--card-border)] pb-6">
        <div>
          <h1 className="text-2xl font-bold font-display text-white tracking-wide">MISSION CONTROL</h1>
          <p className="text-xs font-mono text-[#88888b] mt-1 tracking-wider uppercase">Central Tactical Command Grid</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleProcessWorkers}
            disabled={processingQueues}
            className={`font-mono text-[10px] tracking-widest font-bold py-2.5 px-4 rounded border transition-all duration-200 uppercase ${
              processingQueues 
                ? "bg-zinc-950 border-zinc-800 text-zinc-600 cursor-not-allowed"
                : "bg-zinc-900 hover:bg-zinc-850 border-zinc-700 text-white cursor-pointer hover:border-zinc-500"
            }`}
          >
            {processingQueues ? "Processing..." : "Process Queue Workers"}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap border-b border-[var(--card-border)] gap-1">
        {(["funnel", "teams", "drafts", "submissions", "evaluations", "rounds", "announcements", "queues"] as TabName[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`py-3 px-5 font-mono text-[11px] font-bold tracking-widest uppercase transition-all duration-200 border-b-2 -mb-[2px] ${
              activeTab === tab 
                ? "border-[#e50914] text-white bg-red-950/10" 
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Panels */}
      <div className="space-y-6">
        {/* Panel 1: Conversion Funnel & Metrics */}
        {activeTab === "funnel" && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="stat-box glass-card border border-[var(--card-border)] rounded p-6 text-center">
                <h3 className="font-mono text-[10px] text-zinc-500 tracking-widest uppercase mb-2">Invited Drafts</h3>
                <h2 className="text-3xl font-bold font-display text-[#00b4d8]">{analytics.invited || invitedTeams.length}</h2>
              </div>
              <div className="stat-box glass-card border border-[var(--card-border)] rounded p-6 text-center">
                <h3 className="font-mono text-[10px] text-zinc-500 tracking-widest uppercase mb-2">Verified Teams</h3>
                <h2 className="text-3xl font-bold font-display text-[#e50914]">{analytics.verified || teams.filter(t => t.status === "Verified").length}</h2>
              </div>
              <div className="stat-box glass-card border border-[var(--card-border)] rounded p-6 text-center">
                <h3 className="font-mono text-[10px] text-zinc-500 tracking-widest uppercase mb-2">Payload Submits</h3>
                <h2 className="text-3xl font-bold font-display text-white">{analytics.submitted || submissions.length}</h2>
              </div>
              <div className="stat-box glass-card border border-[var(--card-border)] rounded p-6 text-center">
                <h3 className="font-mono text-[10px] text-zinc-500 tracking-widest uppercase mb-2">Approved Teams</h3>
                <h2 className="text-3xl font-bold font-display text-[#10b981]">{analytics.approved || teams.filter(t => t.status === "Approved").length}</h2>
              </div>
              <div className="stat-box glass-card border border-[var(--card-border)] rounded p-6 text-center">
                <h3 className="font-mono text-[10px] text-zinc-500 tracking-widest uppercase mb-2">Active Rounds</h3>
                <h2 className="text-3xl font-bold font-display text-[#f59e0b]">{rounds.filter(r => r.status === "Active").length}</h2>
              </div>
            </div>

            {/* List Overview */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="glass-card p-6 border border-[var(--card-border)]">
                <h3 className="text-sm font-bold font-display text-white mb-4 uppercase tracking-wider">Recent Submissions</h3>
                <div className="overflow-x-auto max-h-96 custom-scrollbar">
                  <table className="w-full text-left text-xs font-mono border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500">
                        <th className="py-2.5">Team</th>
                        <th className="py-2.5">Round</th>
                        <th className="py-2.5">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 text-zinc-300">
                      {submissions.slice(0, 8).map((sub) => (
                        <tr key={sub.id} className="hover:bg-zinc-900/30">
                          <td className="py-2.5 font-semibold text-white">{sub.teamId.slice(0, 8)}...</td>
                          <td className="py-2.5 text-zinc-400">{sub.roundId}</td>
                          <td className="py-2.5 text-zinc-500">{sub.submittedAt?.toMillis ? new Date(sub.submittedAt.toMillis()).toLocaleString() : "Just now"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="glass-card p-6 border border-[var(--card-border)]">
                <h3 className="text-sm font-bold font-display text-white mb-4 uppercase tracking-wider">Announcements Stream</h3>
                <div className="space-y-4 max-h-96 overflow-y-auto custom-scrollbar pr-2">
                  {announcements.map((ann) => (
                    <div key={ann.id} className="p-4 border border-zinc-800 bg-zinc-950/20 rounded">
                      <div className="flex justify-between items-start mb-2">
                        <h4 className="text-xs font-semibold text-white tracking-wide">{ann.title}</h4>
                        <span className="text-[9px] font-mono text-zinc-500">
                          {ann.timestamp?.toMillis ? new Date(ann.timestamp.toMillis()).toLocaleDateString() : ""}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 font-mono leading-relaxed line-clamp-2">{ann.message}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Panel 2: Teams Management */}
        {activeTab === "teams" && (
          <div className="glass-card p-6 border border-[var(--card-border)]">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
              <h3 className="text-sm font-bold font-display text-white uppercase tracking-wider">All Verified Teams</h3>
              <input 
                type="text" 
                placeholder="Search teams by name..." 
                value={teamsSearch}
                onChange={(e) => setTeamsSearch(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 text-zinc-300 font-mono text-xs px-4 py-2 rounded focus:outline-none focus:border-[#e50914] w-full md:w-80"
              />
            </div>
            
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-widest text-[10px]">
                    <th className="py-3 px-4">Team Details</th>
                    <th className="py-3 px-4">Problem Statement</th>
                    <th className="py-3 px-4">Domain</th>
                    <th className="py-3 px-4">Time Leap</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-300">
                  {teams
                    .filter(t => t.teamName.toLowerCase().includes(teamsSearch.toLowerCase()))
                    .map((team) => (
                      <tr key={team.id} className="hover:bg-zinc-900/20">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white text-sm">{team.teamName}</div>
                          <div className="text-[10px] text-zinc-500 mt-1">Leader: {team.leaderName} ({team.leaderEmail})</div>
                        </td>
                        <td className="py-3 px-4 text-zinc-400 max-w-xs truncate">{team.problemStatement || "N/A"}</td>
                        <td className="py-3 px-4 text-zinc-400">{team.domain || "N/A"}</td>
                        <td className="py-3 px-4">
                          <button
                            onClick={() => handleToggleTimeLeap(team.id, !team.isTimeLeapEligible)}
                            className={`px-3 py-1 text-[9px] tracking-wider rounded font-bold border transition-colors ${
                              team.isTimeLeapEligible 
                                ? "bg-red-950/40 border-red-500/50 text-[#e50914]" 
                                : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                            }`}
                          >
                            {team.isTimeLeapEligible ? "ELIGIBLE" : "INELIGIBLE"}
                          </button>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            team.status === "Verified" 
                              ? "bg-emerald-950/40 border border-emerald-500/30 text-emerald-400" 
                              : "bg-amber-950/40 border border-amber-500/30 text-amber-400"
                          }`}>
                            {team.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Panel 3: Invited Drafts */}
        {activeTab === "drafts" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Forms Panel */}
            <div className="space-y-6 lg:col-span-1">
              {/* Manual Quick Add */}
              <div className="glass-card p-6 border border-[var(--card-border)]">
                <h3 className="text-xs font-mono font-bold text-[#00b4d8] tracking-widest uppercase mb-4">Manual Entry Draft</h3>
                <form onSubmit={handleQuickAdd} className="space-y-4 text-xs font-mono">
                  <div>
                    <label className="text-zinc-500 block mb-1">TEAM NAME</label>
                    <input 
                      type="text" 
                      required 
                      value={quickAdd.teamName}
                      onChange={e => setQuickAdd({...quickAdd, teamName: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none focus:border-[#00b4d8]" 
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-zinc-500 block mb-1">LEADER NAME</label>
                      <input 
                        type="text" 
                        required 
                        value={quickAdd.leaderName}
                        onChange={e => setQuickAdd({...quickAdd, leaderName: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none" 
                      />
                    </div>
                    <div>
                      <label className="text-zinc-500 block mb-1">LEADER EMAIL</label>
                      <input 
                        type="email" 
                        required 
                        value={quickAdd.leaderEmail}
                        onChange={e => setQuickAdd({...quickAdd, leaderEmail: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none" 
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-zinc-500 block mb-1">LEADER PHONE</label>
                      <input 
                        type="tel" 
                        required 
                        value={quickAdd.leaderPhone}
                        onChange={e => setQuickAdd({...quickAdd, leaderPhone: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none" 
                      />
                    </div>
                    <div>
                      <label className="text-zinc-500 block mb-1">COLLEGE</label>
                      <input 
                        type="text" 
                        required 
                        value={quickAdd.college}
                        onChange={e => setQuickAdd({...quickAdd, college: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none" 
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-zinc-500 block mb-1">ASSIGNED DOMAIN</label>
                    <input 
                      type="text" 
                      value={quickAdd.domain}
                      onChange={e => setQuickAdd({...quickAdd, domain: e.target.value})}
                      placeholder="e.g. Fintech, Web3"
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none" 
                    />
                  </div>
                  <div>
                    <label className="text-zinc-500 block mb-1">PROBLEM STATEMENT</label>
                    <textarea 
                      value={quickAdd.problemStatement}
                      onChange={e => setQuickAdd({...quickAdd, problemStatement: e.target.value})}
                      rows={2}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none resize-none" 
                    />
                  </div>
                  <button type="submit" className="w-full py-2.5 rounded bg-zinc-900 border border-[#00b4d8] text-[#00b4d8] font-bold hover:bg-[#00b4d8]/10 transition-colors uppercase tracking-widest">
                    Create Draft
                  </button>
                </form>
              </div>

              {/* CSV Upload */}
              <div className="glass-card p-6 border border-[var(--card-border)]">
                <h3 className="text-xs font-mono font-bold text-[#e50914] tracking-widest uppercase mb-2">Upload Shortlist</h3>
                <p className="text-[10px] text-zinc-500 mb-4 font-mono leading-relaxed">
                  Upload .csv or .xlsx file containing shortlisted candidates.
                </p>
                <form onSubmit={handleFileUpload} className="space-y-4 text-xs font-mono">
                  <input 
                    type="file" 
                    name="file"
                    accept=".csv, .xlsx, .xls"
                    required
                    className="w-full bg-zinc-950 border border-zinc-850 p-2 rounded text-zinc-400 file:mr-4 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-zinc-800 file:text-white file:text-xs file:font-mono file:cursor-pointer hover:file:bg-zinc-700" 
                  />
                  <button type="submit" className="w-full py-2.5 rounded bg-[#e50914] hover:bg-[#b90710] text-white font-bold transition-all uppercase tracking-widest">
                    Upload Teams
                  </button>
                </form>
              </div>
            </div>

            {/* Invited Drafts Table */}
            <div className="lg:col-span-2 glass-card p-6 border border-[var(--card-border)]">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
                <h3 className="text-sm font-bold font-display text-white uppercase tracking-wider">Invited Teams Overview</h3>
                <input 
                  type="text" 
                  placeholder="Search drafts by team name..." 
                  value={draftsSearch}
                  onChange={(e) => setDraftsSearch(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 text-zinc-300 font-mono text-xs px-4 py-2 rounded focus:outline-none focus:border-[#e50914] w-full md:w-80"
                />
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-widest text-[10px]">
                      <th className="py-3 px-4">Team</th>
                      <th className="py-3 px-4">Leader info</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900 text-zinc-300">
                    {invitedTeams
                      .filter(t => t.teamName.toLowerCase().includes(draftsSearch.toLowerCase()))
                      .map((draft) => (
                        <tr key={draft.id} className="hover:bg-zinc-900/20">
                          <td className="py-3 px-4">
                            <div className="font-semibold text-white text-sm">{draft.teamName}</div>
                            <div className="text-[10px] text-zinc-500 mt-1">{draft.college}</div>
                          </td>
                          <td className="py-3 px-4 text-zinc-400">
                            <div>{draft.leaderName}</div>
                            <div className="text-[10px] text-zinc-500 mt-0.5">{draft.leaderEmail}</div>
                          </td>
                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-zinc-900 border border-zinc-800 text-zinc-400">
                              {draft.status || "Draft"}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {(draft.status === "Draft" || !draft.status) && (
                              <button
                                onClick={() => handleSendInvite(draft.id)}
                                className="px-3 py-1 bg-zinc-900 hover:bg-zinc-850 border border-[#00b4d8] text-[#00b4d8] text-[9px] font-bold tracking-wider rounded transition-colors uppercase"
                              >
                                Send Invite
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Panel 4: Submissions */}
        {activeTab === "submissions" && (
          <div className="glass-card p-6 border border-[var(--card-border)]">
            <h3 className="text-sm font-bold font-display text-white uppercase tracking-wider mb-6">Live Payload Transmission Stream</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-widest text-[10px]">
                    <th className="py-3 px-4">Team ID</th>
                    <th className="py-3 px-4">Round</th>
                    <th className="py-3 px-4">Submission Links</th>
                    <th className="py-3 px-4">Submitted At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-900 text-zinc-300">
                  {submissions.map((sub) => (
                    <tr key={sub.id} className="hover:bg-zinc-900/20">
                      <td className="py-3 px-4 font-semibold text-white text-sm">{sub.teamId}</td>
                      <td className="py-3 px-4 text-zinc-400">{sub.roundId}</td>
                      <td className="py-3 px-4 space-y-1">
                        {sub.pptLink && (
                          <div>
                            <a href={sub.pptLink} target="_blank" rel="noreferrer" className="text-[#00b4d8] hover:underline">
                              PPT Link ↗
                            </a>
                          </div>
                        )}
                        {sub.prototypeLink && (
                          <div>
                            <a href={sub.prototypeLink} target="_blank" rel="noreferrer" className="text-[#00b4d8] hover:underline">
                              Prototype ↗
                            </a>
                          </div>
                        )}
                        {sub.githubLink && (
                          <div>
                            <a href={sub.githubLink} target="_blank" rel="noreferrer" className="text-[#e50914] hover:underline">
                              GitHub Repo ↗
                            </a>
                          </div>
                        )}
                        {sub.demoLink && (
                          <div>
                            <a href={sub.demoLink} target="_blank" rel="noreferrer" className="text-zinc-500 hover:underline">
                              Demo URL ↗
                            </a>
                          </div>
                        )}
                        {sub.hasNoPrototype && <span className="text-zinc-600 italic">No Prototype Submitted</span>}
                      </td>
                      <td className="py-3 px-4 text-zinc-500">
                        {sub.submittedAt?.toMillis ? new Date(sub.submittedAt.toMillis()).toLocaleString() : "Just now"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Panel 5: Scoring & Evaluations */}
        {activeTab === "evaluations" && (
          <div className="glass-card p-6 border border-[var(--card-border)] space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h3 className="text-sm font-bold font-display text-white uppercase tracking-wider">Candidate Score Evaluator</h3>
                <p className="text-[10px] font-mono text-zinc-500 mt-1">Input scores. atomic publishing handles leaderboard generation.</p>
              </div>
              <select
                value={selectedRoundId}
                onChange={(e) => setSelectedRoundId(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 text-zinc-300 font-mono text-xs px-4 py-2 rounded focus:outline-none"
              >
                <option value="">Select Evaluation Round...</option>
                {rounds.map(r => (
                  <option key={r.id} value={r.roundId}>{r.title} ({r.status})</option>
                ))}
              </select>
            </div>

            {selectedRoundId ? (
              <div className="space-y-6">
                {/* Publish Bar */}
                <div className="p-4 bg-zinc-950/40 border border-zinc-800 rounded flex justify-between items-center">
                  <span className="text-xs font-mono text-zinc-400">
                    Leaderboards are locked for participants until atomic score publishing is complete.
                  </span>
                  <button
                    onClick={() => handlePublishScores(selectedRoundId)}
                    className="px-4 py-2 bg-zinc-900 hover:bg-[#e50914] border border-[#e50914] text-[#e50914] hover:text-white font-mono text-xs font-bold rounded tracking-wider uppercase transition-colors"
                  >
                    Publish All Scores
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-widest text-[10px]">
                        <th className="py-3 px-4">Team</th>
                        <th className="py-3 px-4 w-40">Score (0-100)</th>
                        <th className="py-3 px-4">Feedback / Notes</th>
                        <th className="py-3 px-4">Save</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900 text-zinc-300">
                      {teams.map((team) => (
                        <tr key={team.id} className="hover:bg-zinc-900/20">
                          <td className="py-3 px-4 font-semibold text-white">{team.teamName}</td>
                          <td className="py-3 px-4">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              placeholder="0"
                              value={evaluation[team.id]?.draftScore ?? ""}
                              onChange={(e) => setEvaluation({
                                ...evaluation,
                                [team.id]: {
                                  draftScore: e.target.value,
                                  feedback: evaluation[team.id]?.feedback ?? ""
                                }
                              })}
                              className="w-24 bg-zinc-950 border border-zinc-850 text-white text-center p-1.5 rounded focus:outline-none focus:border-amber-500"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <input
                              type="text"
                              placeholder="Enter feedback notes..."
                              value={evaluation[team.id]?.feedback ?? ""}
                              onChange={(e) => setEvaluation({
                                ...evaluation,
                                [team.id]: {
                                  draftScore: evaluation[team.id]?.draftScore ?? "",
                                  feedback: e.target.value
                                }
                              })}
                              className="w-full bg-zinc-950 border border-zinc-850 text-zinc-300 p-1.5 rounded focus:outline-none"
                            />
                          </td>
                          <td className="py-3 px-4">
                            <button
                              onClick={() => handleSaveEvaluation(team.id, selectedRoundId)}
                              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-700 text-zinc-300 hover:text-white rounded transition-all text-[9px] font-bold uppercase tracking-wider"
                            >
                              Save Draft
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 border border-dashed border-zinc-800 text-zinc-500 rounded text-xs font-mono">
                Select an active round to start score evaluations.
              </div>
            )}
          </div>
        )}

        {/* Panel 6: Round Control */}
        {activeTab === "rounds" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 glass-card p-6 border border-[var(--card-border)]">
              <h3 className="text-xs font-mono font-bold text-[#f59e0b] tracking-widest uppercase mb-4">Create New Round</h3>
              <form onSubmit={handleCreateRound} className="space-y-4 text-xs font-mono">
                <div>
                  <label className="text-zinc-500 block mb-1">ROUND ID (URL-SAFE)</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="e.g. round-1"
                    value={newRound.roundId}
                    onChange={e => setNewRound({...newRound, roundId: e.target.value})}
                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none" 
                  />
                </div>
                <div>
                  <label className="text-zinc-500 block mb-1">TITLE</label>
                  <input 
                    type="text" 
                    required 
                    placeholder="Ideation Phase"
                    value={newRound.title}
                    onChange={e => setNewRound({...newRound, title: e.target.value})}
                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none" 
                  />
                </div>
                <div>
                  <label className="text-zinc-500 block mb-1">DESCRIPTION</label>
                  <textarea 
                    value={newRound.description}
                    onChange={e => setNewRound({...newRound, description: e.target.value})}
                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none resize-none" 
                    rows={3}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-zinc-500 block mb-1">TYPE</label>
                    <select
                      value={newRound.type}
                      onChange={e => setNewRound({...newRound, type: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none"
                    >
                      <option value="general">General</option>
                      <option value="ppt">PPT Slide</option>
                      <option value="mentor_session">Mentor Slot</option>
                      <option value="prototype">Prototype</option>
                      <option value="timeleap">Time Leap</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-zinc-500 block mb-1">SUBMIT TYPE</label>
                    <select
                      value={newRound.submissionType}
                      onChange={e => setNewRound({...newRound, submissionType: e.target.value})}
                      className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2 rounded focus:outline-none"
                    >
                      <option value="github_link">GitHub Link</option>
                      <option value="ppt_link">PPT Viewer Link</option>
                      <option value="prototype_link">Prototype Link</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="w-full py-2.5 rounded bg-zinc-900 border border-[#f59e0b] text-[#f59e0b] font-bold hover:bg-[#f59e0b]/10 transition-colors uppercase tracking-widest">
                  Create Round
                </button>
              </form>
            </div>

            <div className="lg:col-span-2 glass-card p-6 border border-[var(--card-border)]">
              <h3 className="text-sm font-bold font-display text-white uppercase tracking-wider mb-6">Round States & Lifecycle</h3>
              <div className="space-y-4">
                {rounds.map((round) => (
                  <div key={round.id} className="p-4 border border-zinc-800 bg-zinc-950/20 rounded flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h4 className="text-sm font-bold text-white tracking-wide">{round.title}</h4>
                        <span className="font-mono text-[9px] text-zinc-500">ID: {round.roundId}</span>
                      </div>
                      <p className="text-xs text-zinc-400 font-mono mt-1">{round.description}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-zinc-900 border border-zinc-800 text-amber-500">
                        {round.status}
                      </span>
                      
                      {/* State transitions buttons */}
                      {round.status === "Draft" && (
                        <button
                          onClick={() => handleTransitionRound(round.roundId, "Published")}
                          className="px-2.5 py-1 bg-zinc-900 border border-zinc-850 hover:border-zinc-700 text-zinc-300 text-[10px] font-bold tracking-wider rounded font-mono uppercase"
                        >
                          Publish
                        </button>
                      )}
                      {round.status === "Published" && (
                        <button
                          onClick={() => handleTransitionRound(round.roundId, "Active")}
                          className="px-2.5 py-1 bg-zinc-900 border border-emerald-500/30 text-emerald-400 text-[10px] font-bold tracking-wider rounded font-mono uppercase"
                        >
                          Activate
                        </button>
                      )}
                      {round.status === "Active" && (
                        <button
                          onClick={() => handleTransitionRound(round.roundId, "Locked")}
                          className="px-2.5 py-1 bg-zinc-900 border border-red-500/30 text-red-400 text-[10px] font-bold tracking-wider rounded font-mono uppercase"
                        >
                          Lock Submissions
                        </button>
                      )}
                      {round.status === "Locked" && (
                        <button
                          onClick={() => handleTransitionRound(round.roundId, "Evaluation")}
                          className="px-2.5 py-1 bg-zinc-900 border border-amber-500/30 text-amber-400 text-[10px] font-bold tracking-wider rounded font-mono uppercase"
                        >
                          Evaluate
                        </button>
                      )}
                      {round.status === "Evaluation" && (
                        <button
                          onClick={() => handleTransitionRound(round.roundId, "Completed")}
                          className="px-2.5 py-1 bg-zinc-900 border border-zinc-800 text-zinc-500 text-[10px] font-bold tracking-wider rounded font-mono uppercase"
                        >
                          Complete
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Panel 7: Announcements */}
        {activeTab === "announcements" && (
          <div className="glass-card p-6 border border-[var(--card-border)] max-w-2xl">
            <h3 className="text-sm font-bold font-display text-white uppercase tracking-wider mb-6">Broadcast Intel</h3>
            <form onSubmit={handleBroadcast} className="space-y-4 text-xs font-mono">
              <div>
                <label className="text-zinc-500 block mb-1">INTEL TITLE</label>
                <input 
                  type="text" 
                  required 
                  placeholder="ALERT"
                  value={broadcast.title}
                  onChange={e => setBroadcast({...broadcast, title: e.target.value})}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2.5 rounded focus:outline-none focus:border-[#e50914]" 
                />
              </div>
              <div>
                <label className="text-zinc-500 block mb-1">BROADCAST MESSAGE</label>
                <textarea 
                  required 
                  placeholder="Type broadcast message details..."
                  value={broadcast.message}
                  onChange={e => setBroadcast({...broadcast, message: e.target.value})}
                  rows={4}
                  className="w-full bg-zinc-950 border border-zinc-800 text-zinc-300 p-2.5 rounded focus:outline-none resize-none" 
                />
              </div>
              
              <div className="space-y-2 py-2">
                <label className="text-zinc-500 block">BROADCAST CHANNELS</label>
                <div className="grid grid-cols-2 gap-4">
                  <label className="flex items-center gap-3 p-2 bg-zinc-950 border border-zinc-900 rounded cursor-pointer hover:border-zinc-800">
                    <input 
                      type="checkbox" 
                      checked={broadcast.portal} 
                      onChange={e => setBroadcast({...broadcast, portal: e.target.checked})}
                      className="accent-[#e50914]"
                    />
                    <span>In-App Portal stream</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 bg-zinc-950 border border-zinc-900 rounded cursor-pointer hover:border-zinc-800">
                    <input 
                      type="checkbox" 
                      checked={broadcast.email} 
                      onChange={e => setBroadcast({...broadcast, email: e.target.checked})}
                      className="accent-[#e50914]"
                    />
                    <span>Mail Queue (All Leaders)</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 bg-zinc-950 border border-zinc-900 rounded cursor-pointer hover:border-zinc-800">
                    <input 
                      type="checkbox" 
                      checked={broadcast.discord} 
                      onChange={e => setBroadcast({...broadcast, discord: e.target.checked})}
                      className="accent-[#e50914]"
                    />
                    <span>Discord Webhook</span>
                  </label>
                  <label className="flex items-center gap-3 p-2 bg-zinc-950 border border-zinc-900 rounded cursor-pointer hover:border-zinc-800">
                    <input 
                      type="checkbox" 
                      checked={broadcast.whatsapp} 
                      onChange={e => setBroadcast({...broadcast, whatsapp: e.target.checked})}
                      className="accent-[#e50914]"
                    />
                    <span>WhatsApp Templates</span>
                  </label>
                </div>
              </div>

              <button type="submit" className="py-3 px-6 rounded bg-[#e50914] hover:bg-[#b90710] text-white font-bold transition-all uppercase tracking-widest text-xs">
                Transmit Broadcast
              </button>
            </form>
          </div>
        )}

        {/* Panel 8: Queue Logs & Workers */}
        {activeTab === "queues" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Mail Queue */}
            <div className="glass-card p-6 border border-[var(--card-border)]">
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-sm font-bold font-display text-white uppercase tracking-wider">Mail Queue Jobs ({mailTotal})</h3>
              </div>
              
              <div className="overflow-x-auto max-h-96 custom-scrollbar">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-widest text-[10px]">
                      <th className="py-2.5">To</th>
                      <th className="py-2.5">Template</th>
                      <th className="py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900 text-zinc-300">
                    {mailQueue.map((job) => (
                      <tr key={job.id} className="hover:bg-zinc-900/20">
                        <td className="py-2.5 text-white truncate max-w-xs">{job.to}</td>
                        <td className="py-2.5 text-zinc-400">{job.template}</td>
                        <td className="py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            job.status === "sent" 
                              ? "bg-emerald-950/40 border border-emerald-500/30 text-emerald-400" 
                              : job.status === "failed"
                              ? "bg-red-950/40 border border-red-500/30 text-red-400"
                              : "bg-zinc-900 border border-zinc-800 text-zinc-400"
                          }`}>
                            {job.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Google Sheets Sync jobs */}
            <div className="glass-card p-6 border border-[var(--card-border)]">
              <h3 className="text-sm font-bold font-display text-white uppercase tracking-wider mb-6">Sheets sync logs</h3>
              <div className="overflow-x-auto max-h-96 custom-scrollbar">
                <table className="w-full text-left text-xs font-mono border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-widest text-[10px]">
                      <th className="py-2.5">Team</th>
                      <th className="py-2.5">Round</th>
                      <th className="py-2.5">Sync Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900 text-zinc-300">
                    {teams.slice(0, 10).map((team) => (
                      <tr key={team.id} className="hover:bg-zinc-900/20">
                        <td className="py-2.5 text-white font-semibold">{team.teamName}</td>
                        <td className="py-2.5 text-zinc-400">{selectedRoundId || "round-1"}</td>
                        <td className="py-2.5">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/40 border border-emerald-500/30 text-emerald-400">
                            synced
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
