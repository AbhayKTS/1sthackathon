document.addEventListener('DOMContentLoaded', async () => {
    const container = document.getElementById('tracksContainer');
    
    try {
        const res = await fetch('/data/tracks.json');
        if (!res.ok) throw new Error('Failed to load tracks');
        
        const tracks = await res.json();
        container.innerHTML = '';
        
        tracks.forEach(track => {
            const card = document.createElement('div');
            card.className = 'border border-border/50 bg-black/40 backdrop-blur-md p-6 hover:border-blood/50 transition-all group relative overflow-hidden flex flex-col h-full';
            
            // Icon handling (just rendering basic SVG shapes or text for now based on icon string)
            card.innerHTML = `
                <div class="absolute inset-0 bg-gradient-to-br from-transparent to-[var(--color)] opacity-0 group-hover:opacity-10 transition-opacity pointer-events-none" style="--color: ${track.color}"></div>
                <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-30 transition-opacity">
                    <!-- Icon placeholder -->
                    <div class="h-16 w-16 text-white font-display text-4xl flex items-center justify-center opacity-50" style="font-family: 'Zen Dots', sans-serif;">${track.title.charAt(0)}</div>
                </div>
                
                <div class="mb-4 inline-flex items-center gap-2 border px-2 py-1 bg-black/50" style="border-color: ${track.color}">
                    <span class="h-1.5 w-1.5" style="background-color: ${track.color}; box-shadow: 0 0 5px ${track.color}"></span>
                    <span class="font-mono text-[9px] tracking-[0.2em]" style="font-family: 'JetBrains Mono', monospace; color: ${track.color}">${track.id.toUpperCase()}</span>
                </div>
                
                <h3 class="font-impact text-2xl tracking-widest mb-3 relative z-10" style="font-family: 'Bebas Neue', sans-serif;">${track.title}</h3>
                
                <p class="font-jp text-sm text-muted-foreground leading-relaxed flex-grow relative z-10" style="font-family: 'Noto Sans JP', sans-serif;">
                    ${track.description}
                </p>
                
                <div class="mt-6 pt-4 border-t border-border/50 flex justify-between items-center relative z-10">
                    <span class="font-mono text-[10px] tracking-widest text-muted-foreground" style="font-family: 'JetBrains Mono', monospace;">STATUS: OPEN</span>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${track.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="group-hover:translate-x-1 transition-transform"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
                </div>
            `;
            container.appendChild(card);
        });
    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="col-span-full p-6 text-center text-blood border border-blood font-mono text-sm bg-blood/10">Failed to load problem statements. Ensure data/tracks.json exists.</div>`;
    }
});
