"use client";

import { useEffect, useState } from "react";
import { getClientAuth, getClientDb } from "@/lib/firebase-client";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Link from "next/link";
import { useRouter } from "next/navigation";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    const auth = getClientAuth();
    const db = getClientDb();

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setRole(null);
        setLoading(false);
        return;
      }

      setUser(currentUser);

      try {
        const userDocRef = doc(db, "users", currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          const userData = userDocSnap.data();
          if (userData.role === "admin" || userData.role === "super_admin") {
            setRole(userData.role);
          } else {
            setRole("unauthorized");
          }
        } else {
          setRole("unauthorized");
        }
      } catch (err) {
        console.error("Error verifying admin role:", err);
        setRole("unauthorized");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(getClientAuth());
      router.push("/");
    } catch (err) {
      console.error("Error signing out:", err);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#060606] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-t-2 border-r-2 border-[#e50914] animate-spin"></div>
          <p className="text-sm font-mono text-gray-500 tracking-widest uppercase">Initializing Command Center...</p>
        </div>
      </div>
    );
  }

  if (!user || role === "unauthorized") {
    return (
      <div className="min-h-screen bg-[#060606] flex items-center justify-center px-4">
        <div className="glass-card max-w-md w-full p-8 border border-red-900/30 text-center">
          <div className="w-16 h-16 bg-red-950/40 border border-red-500/50 rounded-full flex items-center justify-center mx-auto mb-6 text-red-500" style={{ width: "64px", height: "64px" }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8" style={{ width: "32px", height: "32px" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v-6.75a2.25 2.25 0 0 0 2.25-2.25z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold tracking-wider mb-2 font-display text-white">ACCESS DENIED</h2>
          <p className="text-sm text-gray-400 mb-6 leading-relaxed">
            This sector is restricted. Admin credentials are required to establish connection with Mission Control.
          </p>
          <div className="flex flex-col gap-3">
            <a
              href="https://revengershack.tech/login"
              className="py-3 px-4 rounded bg-[#e50914] hover:bg-[#b90710] text-white font-semibold text-xs tracking-wider uppercase transition-colors"
            >
              Log In as Admin
            </a>
            <Link
              href="/"
              className="py-3 px-4 rounded border border-gray-800 hover:border-gray-700 text-gray-400 hover:text-white font-medium text-xs tracking-wider uppercase transition-all"
            >
              Return Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#060606]">
      {/* Sidebar Nav */}
      <aside className="w-full md:w-64 bg-[#0a0a0a] border-b md:border-b-0 md:border-r border-[var(--card-border)] flex flex-col z-20">
        <div className="h-16 px-6 border-b border-[var(--card-border)] flex items-center justify-between">
          <Link href="/cmd-center" className="flex items-center gap-3">
            <span className="w-8 h-8 rounded bg-[#e50914] text-white font-bold flex items-center justify-center font-mono">R</span>
            <span className="font-display font-bold tracking-widest text-sm text-white">
              REVENGERS<span className="text-gray-500 font-normal">/</span>ADMIN
            </span>
          </Link>
        </div>
        
        {/* User Info Bar */}
        <div className="px-6 py-4 border-b border-[var(--card-border)] bg-zinc-950/20">
          <p className="text-[10px] font-mono text-gray-500 tracking-wider uppercase mb-1">Clearance Level</p>
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase text-[#e50914] font-mono tracking-wider">
              {role === "super_admin" ? "Super Admin" : "Administrator"}
            </span>
            <span className="text-[10px] text-zinc-600 bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded font-mono">
              Live
            </span>
          </div>
          <p className="text-[10px] font-mono text-zinc-400 mt-2 truncate">{user.email}</p>
        </div>

        {/* Sidebar Slots/Links */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto custom-scrollbar">
          <div className="text-[9px] font-mono text-zinc-600 tracking-widest uppercase px-3 mb-2">Systems</div>
          <Link 
            href="/cmd-center" 
            className="flex items-center gap-3 px-3 py-2 text-zinc-300 hover:text-white rounded hover:bg-zinc-900/60 border border-transparent hover:border-zinc-800/50 text-xs font-medium tracking-wide transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-[#e50914]" style={{ width: "16px", height: "16px" }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 8.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z" />
            </svg>
            Command Dashboard
          </Link>

          <a 
            href="https://revengershack.tech/cmd-center.html" 
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-3 px-3 py-2 text-zinc-400 hover:text-white rounded hover:bg-zinc-900/60 border border-transparent hover:border-zinc-800/50 text-xs font-medium tracking-wide transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-[#00b4d8]">
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
            Legacy Admin HTML ↗
          </a>
        </nav>

        {/* Footer actions */}
        <div className="p-4 border-t border-[var(--card-border)] bg-zinc-950/20">
          <button 
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded border border-zinc-800 hover:border-red-900/30 hover:bg-red-950/20 text-zinc-400 hover:text-[#e50914] text-xs font-semibold tracking-wider uppercase transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main content body */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto custom-scrollbar">
        {children}
      </main>
    </div>
  );
}
