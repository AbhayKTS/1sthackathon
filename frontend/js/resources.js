document.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('resourcesList');
    const countEl = document.getElementById('resourceCount');
    
    try {
        const res = await fetch('/data/resources.json');
        if (!res.ok) throw new Error('Failed to load resources');
        
        const resources = await res.json();
        list.innerHTML = '';
        countEl.textContent = `${resources.length} FILES`;
        
        resources.forEach(item => {
            const li = document.createElement('li');
            li.className = 'hover:bg-white/5 transition-colors group';
            
            // Generate color based on type
            let badgeColor = 'var(--muted)';
            if (item.type === 'PDF') badgeColor = '#ef4444'; // Red
            if (item.type === 'PPTX') badgeColor = '#f59e0b'; // Orange
            if (item.type === 'LINK') badgeColor = '#3b82f6'; // Blue
            if (item.type === 'ZIP') badgeColor = '#10b981'; // Green

            li.innerHTML = `
                <a href="${item.url}" target="_blank" class="flex flex-col sm:flex-row sm:items-center gap-4 p-4 sm:p-6 cursor-pointer outline-none">
                    <div class="h-12 w-12 shrink-0 border border-border bg-black/50 flex items-center justify-center text-muted-foreground group-hover:text-blood group-hover:border-blood/50 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                            <polyline points="14 2 14 8 20 8"></polyline>
                            <line x1="12" y1="18" x2="12" y2="12"></line>
                            <polyline points="9 15 12 18 15 15"></polyline>
                        </svg>
                    </div>
                    <div class="flex-grow min-w-0">
                        <div class="flex items-center gap-3 mb-1">
                            <h3 class="font-impact text-xl tracking-widest text-foreground group-hover:text-blood transition-colors" style="font-family: 'Bebas Neue', sans-serif;">${item.title}</h3>
                            <span class="font-mono text-[9px] px-1.5 py-0.5 tracking-wider border rounded-[2px]" style="font-family: 'JetBrains Mono', monospace; border-color: ${badgeColor}; color: ${badgeColor}">${item.type}</span>
                        </div>
                        <p class="font-jp text-xs text-muted-foreground" style="font-family: 'Noto Sans JP', sans-serif;">${item.description}</p>
                    </div>
                    <div class="shrink-0 sm:ml-auto">
                        <span class="font-mono text-[10px] tracking-widest text-muted-foreground group-hover:text-foreground transition-colors inline-flex items-center gap-2" style="font-family: 'JetBrains Mono', monospace;">
                            ACCESS <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover:translate-x-1 transition-transform"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                        </span>
                    </div>
                </a>
            `;
            list.appendChild(li);
        });
    } catch (err) {
        console.error(err);
        list.innerHTML = `<li class="p-6 text-center text-blood font-mono text-sm">Failed to load resources data.</li>`;
    }
});
