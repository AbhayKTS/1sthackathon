let allFaqs = [];

document.addEventListener('DOMContentLoaded', async () => {
    const list = document.getElementById('faqsList');
    const searchInput = document.getElementById('searchInput');
    const noResults = document.getElementById('noResults');
    
    try {
        const res = await fetch('/data/faqs.json');
        if (!res.ok) throw new Error('Failed to load FAQs');
        
        allFaqs = await res.json();
        renderFaqs(allFaqs);
        
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                renderFaqs(allFaqs);
                return;
            }
            
            const filtered = allFaqs.filter(faq => 
                faq.question.toLowerCase().includes(query) || 
                faq.answer.toLowerCase().includes(query)
            );
            
            renderFaqs(filtered);
        });
        
    } catch (err) {
        console.error(err);
        list.innerHTML = `<div class="p-6 text-center text-blood font-mono text-sm">Failed to load FAQs data.</div>`;
    }
    
    function renderFaqs(faqs) {
        list.innerHTML = '';
        
        if (faqs.length === 0) {
            noResults.classList.remove('hidden');
            return;
        }
        
        noResults.classList.add('hidden');
        
        faqs.forEach((faq, index) => {
            const item = document.createElement('div');
            item.className = 'faq-item border border-border/50 bg-black/40 backdrop-blur-md overflow-hidden';
            
            const questionDiv = document.createElement('div');
            questionDiv.className = 'p-4 sm:p-5 flex items-center justify-between cursor-pointer hover:bg-white/5 transition-colors select-none';
            questionDiv.innerHTML = `
                <h3 class="font-impact text-lg sm:text-xl tracking-wider text-foreground" style="font-family: 'Bebas Neue', sans-serif;">${faq.question}</h3>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="faq-icon text-muted-foreground shrink-0 ml-4"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
            `;
            
            const answerDiv = document.createElement('div');
            answerDiv.className = 'faq-answer bg-black/20 border-t border-border/30';
            answerDiv.innerHTML = `
                <p class="font-jp text-sm text-muted-foreground p-4 sm:p-5 leading-relaxed" style="font-family: 'Noto Sans JP', sans-serif;">
                    ${faq.answer}
                </p>
            `;
            
            questionDiv.addEventListener('click', () => {
                const isActive = item.classList.contains('active');
                
                // Close all others (optional accordion style)
                document.querySelectorAll('.faq-item').forEach(el => el.classList.remove('active'));
                
                if (!isActive) {
                    item.classList.add('active');
                }
            });
            
            item.appendChild(questionDiv);
            item.appendChild(answerDiv);
            list.appendChild(item);
        });
    }
});
