const fs = require('fs');

const customCSS = `
    <style type="text/tailwindcss">
        @theme inline {
          --radius-sm: calc(var(--radius) - 4px);
          --radius-md: calc(var(--radius) - 2px);
          --radius-lg: var(--radius);
          --radius-xl: calc(var(--radius) + 4px);
          --color-background: var(--background);
          --color-foreground: var(--foreground);
          --color-card: var(--card);
          --color-card-foreground: var(--card-foreground);
          --color-popover: var(--popover);
          --color-popover-foreground: var(--popover-foreground);
          --color-primary: var(--primary);
          --color-primary-foreground: var(--primary-foreground);
          --color-secondary: var(--secondary);
          --color-secondary-foreground: var(--secondary-foreground);
          --color-muted: var(--muted);
          --color-muted-foreground: var(--muted-foreground);
          --color-accent: var(--accent);
          --color-accent-foreground: var(--accent-foreground);
          --color-destructive: var(--destructive);
          --color-destructive-foreground: var(--destructive-foreground);
          --color-border: var(--border);
          --color-input: var(--input);
          --color-ring: var(--ring);
          --color-blood: var(--blood);
          --color-gold: var(--gold);
          --color-ink: var(--ink);
          --color-paper: var(--paper);
          --font-display: "Zen Dots", sans-serif;
          --font-impact: "Bebas Neue", sans-serif;
          --font-jp: "Noto Sans JP", sans-serif;
          --font-mono: "JetBrains Mono", monospace;
        }

        :root {
          --radius: 0.25rem;
          --background: oklch(0.12 0.02 25);
          --foreground: oklch(0.96 0.01 60);
          --card: oklch(0.16 0.025 25);
          --card-foreground: oklch(0.96 0.01 60);
          --popover: oklch(0.14 0.02 25);
          --popover-foreground: oklch(0.96 0.01 60);
          --primary: oklch(0.55 0.24 25);
          --primary-foreground: oklch(0.98 0.01 60);
          --secondary: oklch(0.22 0.03 25);
          --secondary-foreground: oklch(0.96 0.01 60);
          --muted: oklch(0.2 0.02 25);
          --muted-foreground: oklch(0.65 0.03 40);
          --accent: oklch(0.55 0.24 25);
          --accent-foreground: oklch(0.98 0.01 60);
          --destructive: oklch(0.55 0.24 25);
          --destructive-foreground: oklch(0.98 0.01 60);
          --border: oklch(0.28 0.05 25);
          --input: oklch(0.22 0.03 25);
          --ring: oklch(0.55 0.24 25);
          --blood: oklch(0.5 0.27 22);
          --gold: oklch(0.82 0.16 85);
          --ink: oklch(0.08 0.01 25);
          --paper: oklch(0.94 0.02 80);
          --gradient-blood: linear-gradient(135deg, oklch(0.5 0.27 22), oklch(0.35 0.2 18));
          --gradient-shadow: radial-gradient(ellipse at top, oklch(0.18 0.04 25 / 0.8), oklch(0.08 0.01 25));
          --shadow-blood: 0 0 40px oklch(0.5 0.27 22 / 0.5), 0 0 80px oklch(0.5 0.27 22 / 0.2);
          --shadow-brutal: 6px 6px 0 oklch(0.5 0.27 22);
        }

        @layer base {
          * { border-color: var(--color-border); }
          body {
            background-color: var(--color-background);
            color: var(--color-foreground);
            font-family: var(--font-jp);
          }
        }

        @utility text-stroke-blood {
          -webkit-text-stroke: 2px oklch(0.5 0.27 22);
          color: transparent;
        }

        @utility glitch-text {
          text-shadow: 2px 0 oklch(0.5 0.27 22), -2px 0 oklch(0.6 0.2 200);
        }

        @utility scanlines {
          background-image: repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            oklch(0 0 0 / 0.15) 2px,
            oklch(0 0 0 / 0.15) 4px
          );
        }

        @utility grain {
          background-image: radial-gradient(oklch(1 0 0 / 0.03) 1px, transparent 1px);
          background-size: 3px 3px;
        }

        @keyframes blood-drip {
          0%, 100% { transform: translateY(0); opacity: 0.8; }
          50% { transform: translateY(4px); opacity: 1; }
        }

        @keyframes flicker {
          0%, 100% { opacity: 1; }
          41.99% { opacity: 1; }
          42% { opacity: 0; }
          43% { opacity: 0; }
          43.01% { opacity: 1; }
          47.99% { opacity: 1; }
          48% { opacity: 0; }
          49% { opacity: 0; }
          49.01% { opacity: 1; }
        }

        @keyframes slide-in {
          from { transform: translateX(-20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }

        @keyframes pulse-blood {
          0%, 100% { box-shadow: 0 0 20px oklch(0.5 0.27 22 / 0.4); }
          50% { box-shadow: 0 0 40px oklch(0.5 0.27 22 / 0.8); }
        }

        @keyframes marquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
    </style>
`;

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="RevengersHack participant dashboard — track rounds, submit your build, and view the leaderboard.">
    <title>Dashboard | RevengersHack</title>

    <link rel="stylesheet" href="css/dashboard.css">
    
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;700&family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body class="min-h-screen bg-background text-foreground">

    <!-- Navbar -->
    <header class="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur">
      <div class="mx-auto flex h-16 max-w-[1400px] items-center gap-8 px-6">
        <a href="/" class="flex items-center gap-3">
          <span class="grid h-8 w-8 place-items-center rounded-sm bg-primary font-mono text-sm font-bold text-primary-foreground">
            R
          </span>
          <span class="font-display text-sm font-bold tracking-[0.18em] text-foreground">
            REVENGERS<span class="text-muted-foreground">/</span>HACK
          </span>
        </a>

        <nav class="hidden flex-1 items-center gap-1 md:flex">
          <a href="/dashboard.html" class="relative px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors text-foreground">
            Dashboard
            <span class="pointer-events-none absolute inset-x-3 -bottom-[1px] h-[2px] bg-primary"></span>
          </a>
          <a href="/leaderboard.html" class="relative px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors text-muted-foreground hover:text-foreground">
            Leaderboard
          </a>

          <a href="/discord.html" class="relative px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-[0.14em] transition-colors text-muted-foreground hover:text-foreground">
            Discord
          </a>
        </nav>

        <div class="ml-auto flex items-center gap-4 relative">
          <!-- Notification Bell -->
          <div class="relative">
              <button id="notifBtn" aria-label="Notifications" class="grid h-9 w-9 place-items-center rounded-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
                <span id="notifBadge" class="hidden absolute top-2 right-2 h-2 w-2 rounded-full bg-primary pulse-dot"></span>
              </button>
              <!-- Notifications Dropdown -->
              <div id="notifDropdown" class="hidden absolute right-0 top-full mt-2 w-80 bg-surface border border-border shadow-2xl z-50 rounded-sm">
                  <div class="p-3 border-b border-border font-mono text-xs tracking-widest text-muted-foreground">
                      SYSTEM ALERTS
                  </div>
                  <div id="notifList" class="max-h-96 overflow-y-auto overflow-x-hidden">
                      <div class="p-4 text-center font-mono text-xs text-muted-foreground">Loading...</div>
                  </div>
              </div>
          </div>
          
          <div class="hidden text-right leading-tight md:block">
            <div class="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Agent
            </div>
            <div id="userEmailDisplay" class="font-mono text-xs text-foreground">Loading...</div>
          </div>
          <a href="/profile.html" class="rounded-sm border border-border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-foreground transition-colors hover:border-border-strong hover:bg-surface-2 cursor-pointer inline-block">
            Profile
          </a>
          <button id="logoutBtn" class="rounded-sm bg-primary px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-primary-foreground transition-colors hover:brightness-110 cursor-pointer">
            Logout
          </button>
        </div>
      </div>
    </header>

    <!-- Ticker -->
    <div class="overflow-hidden border-b border-border bg-surface-2">
      <div class="flex whitespace-nowrap ticker-track py-2">
        <span class="px-8 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          // CRITICAL ALERT: ROUND 01 SUBMISSIONS OPEN
        </span>
        <span class="px-8 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
          [ SUBMIT OR PERISH ]
        </span>
        <span class="px-8 font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          // CRITICAL ALERT: ROUND 01 SUBMISSIONS OPEN
        </span>
        <span class="px-8 font-mono text-[10px] uppercase tracking-[0.2em] text-primary">
          [ SUBMIT OR PERISH ]
        </span>
      </div>
    </div>

    <!-- Main Content -->
    <main class="mx-auto max-w-[1400px] px-6 py-8">
      <div class="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <!-- Hero -->
        <div class="rounded-sm border border-border bg-surface text-foreground relative overflow-hidden p-0">
          <div class="relative min-h-[440px]">
            <img
              src="assets/images/round1img.png"
              alt=""
              class="absolute inset-0 h-full w-full object-cover opacity-70"
            />
            <div
              class="absolute inset-0"
              style="background: linear-gradient(180deg, rgba(10,10,10,0.55) 0%, rgba(10,10,10,0.85) 70%, #0a0a0a 100%)"
            ></div>
            <div class="relative flex h-full flex-col justify-between gap-10 p-8">
              <div class="flex items-center justify-between">
                <span class="inline-flex items-center gap-2 rounded-sm bg-primary px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary-foreground">
                  <span class="pulse-dot h-1.5 w-1.5 rounded-full bg-white"></span>
                  <span id="heroRoundBadge">LIVE / ROUND 01</span>
                </span>
                <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Status: <span class="text-accent">Active</span>
                </span>
              </div>

              <div>
                <div class="mb-2 font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                  Round 01
                </div>
                <h1 id="heroRoundTitle" class="font-display text-5xl font-bold leading-[0.95] tracking-tight md:text-6xl">
                  <span class="block text-foreground">SHOW US</span>
                  <span class="block text-primary">WHAT YOU GOT</span>
                </h1>
                <p id="heroRoundDesc" class="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">
                  This is your first move. Submit your problem statement and
                  presentation deck that define your vision, your approach, and
                  your edge.
                </p>

                <div class="mt-6">
                  <div class="mb-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground" id="heroRequirementsTitle">
                    What to submit
                  </div>
                  <div class="flex flex-wrap gap-3" id="heroRequirementsList">
                    <span class="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2/70 px-3 py-1.5">
                      <span class="text-accent"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/></svg></span>
                      <span class="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground">Problem Statement</span>
                    </span>
                    <span class="inline-flex items-center gap-2 rounded-sm border border-border bg-surface-2/70 px-3 py-1.5">
                      <span class="text-accent"><svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg></span>
                      <span class="font-mono text-[11px] uppercase tracking-[0.16em] text-foreground">Presentation Deck (PPT)</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Right column -->
        <div class="flex flex-col gap-4">
          <!-- Timer -->
          <div class="rounded-sm border border-border bg-surface text-foreground p-6">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5 text-accent"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/></svg>
              <span class="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Time Remaining
              </span>
            </div>
            <div class="mt-6">
                <!-- Original structure mapped to new typography for script compatibility -->
                <div id="countdownDisplay" class="font-display text-5xl font-bold tracking-tighter tabular-nums" style="text-shadow: 0 0 20px rgba(0, 180, 216, 0.3)">
                    24<span class="text-accent">:</span>00<span class="text-accent">:</span>00
                </div>
                <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div id="countdownProgress" class="h-full bg-accent transition-all duration-1000 ease-linear pulse-dot" style="width: 100%"></div>
                </div>
            </div>
            <div class="mt-5 h-px bg-border"></div>
            <div class="mt-3 grid grid-cols-3 gap-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <span>Hours</span>
              <span class="text-center">Minutes</span>
              <span class="text-right">Seconds</span>
            </div>
          </div>

          <!-- Squad -->
          <div class="rounded-sm border border-border bg-surface text-foreground p-6">
            <div class="mb-5 flex items-center justify-between">
                <h3 class="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
                    The Squad
                </h3>
            </div>
            <div class="grid grid-cols-2 gap-3" id="teamMembersList">
              <!-- Rendered by JS -->
              <div class="col-span-2 p-4 text-center font-mono text-xs text-muted-foreground">Loading members...</div>
            </div>
          </div>
        </div>
      </div>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <!-- Information -->
        <div class="rounded-sm border border-border bg-surface text-foreground p-6">
            <div class="mb-5 flex items-center justify-between">
                <h3 class="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
                    Information
                </h3>
                <span class="flex items-center gap-2">
                    <span class="relative flex h-1.5 w-1.5">
                        <span class="absolute inset-0 animate-ping rounded-full bg-[color:var(--color-success)] opacity-75"></span>
                        <span class="relative h-1.5 w-1.5 rounded-full bg-[color:var(--color-success)]"></span>
                    </span>
                    <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-success)]">
                        Updates
                    </span>
                    <span id="unreadBadge" class="hidden ml-1 text-primary text-[9px] font-mono">NEW</span>
                </span>
            </div>
          <ul class="space-y-3 h-[250px] overflow-y-auto" id="announcementsFeed">
              <!-- Rendered by JS -->
              <li class="p-4 flex items-center justify-center h-full">
                  <span class="font-mono text-sm text-muted-foreground">No recent updates.</span>
              </li>
          </ul>
        </div>

        <!-- Mission Submission -->
        <div class="rounded-sm border border-border bg-surface text-foreground p-6">
            <div class="mb-5 flex items-center justify-between">
                <h3 class="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-foreground">
                    Mission Submission
                </h3>
                <span class="flex items-center gap-2">
                    <span class="relative flex h-1.5 w-1.5">
                        <span class="absolute inset-0 animate-ping rounded-full bg-[color:var(--color-success)] opacity-75"></span>
                        <span class="relative h-1.5 w-1.5 rounded-full bg-[color:var(--color-success)]"></span>
                    </span>
                    <span class="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--color-success)]">
                        Active
                    </span>
                </span>
            </div>

            <!-- Handled by dashboard.js conditionally -->
            <div id="activeRoundFormContainer" style="display: none;">
                <h3 class="font-display text-xl text-foreground font-bold tracking-wider mb-1" id="activeRoundTitle">Loading...</h3>
                <p class="font-sans text-sm text-muted-foreground mb-4" id="activeRoundDesc">Loading...</p>

                <div class="space-y-4">
                    <form id="submissionForm" class="flex flex-col gap-3">
                        <input type="url" id="githubLink" placeholder="GITHUB REPO URL" required class="w-full rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono">
                        <input type="url" id="demoLink" placeholder="LIVE DEMO URL (OPTIONAL)" class="w-full rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary font-mono">
                        <button type="submit" id="submitMissionBtn" class="mt-2 w-max inline-flex items-center gap-2 rounded-sm bg-primary px-5 py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.18em] text-primary-foreground transition-transform hover:brightness-110 active:scale-[0.98] cursor-pointer">
                            Submit Build <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                        </button>
                    </form>
                    <div id="submissionStatus" class="font-mono text-xs mt-3"></div>
                </div>
            </div>

            <!-- Shown when no active round -->
            <div id="noActiveRoundMsg" class="mt-8 font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                [NO ACTIVE MISSIONS AWAITING SUBMISSION]
            </div>

        </div>
      </div>
    </main>

    <footer class="mx-auto max-w-[1400px] px-6 pb-10">
      <div
        class="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-6 font-mono text-[10px] uppercase tracking-[0.18em]"
        style="color: #444"
      >
        <span>REVENGERSHACK © 2026 // BUILT IN THE UNDERGROUND</span>
        <span>Supreme above heaven and earth.</span>
      </div>
    </footer>

    <!-- Firebase SDKs -->
    <script type="module" src="js/dashboard.js"></script>
</body>
</html>
`;

fs.writeFileSync('t:/1sthackathon/frontend/dashboard.html', htmlContent);
console.log('Successfully written dashboard.html');



