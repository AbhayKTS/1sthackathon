/**
 * Mission Timeline — Scroll Driver
 * One card per viewport. Smooth enter/exit. Left rail updates.
 */
document.addEventListener("DOMContentLoaded", () => {
  const section = document.getElementById("schedule");
  if (!section) return;

  const cards    = Array.from(document.querySelectorAll(".tl-card"));
  const dots     = Array.from(document.querySelectorAll(".tl-dot"));
  const counter  = document.getElementById("tl-counter");

  const TOTAL = cards.length;
  if (!TOTAL) return;

  // Section height = TOTAL viewports (CSS sets 700vh for 7 cards)
  let raf = 0;
  let lastIndex = -1;

  function tick() {
    raf = 0;

    const rect   = section.getBoundingClientRect();
    const total  = section.offsetHeight - window.innerHeight;
    const scrolled = Math.min(Math.max(-rect.top, 0), total);
    const p = total > 0 ? scrolled / total : 0;  // 0 → 1

    // Which card is "current" — evenly split
    // We need (TOTAL - 1) transitions to bring up all cards after the first one
    const transitions = Math.max(1, TOTAL - 1);
    const slice  = 1 / transitions;
    // Use floor with a tiny bias so card 0 shows at p=0
    const activeIndex = Math.min(TOTAL - 1, Math.floor(p * transitions + 0.0001));

    // ---- Update cards (backward loop for correct stack pushing) ----
    const H = window.innerHeight;
    const positions = new Array(TOTAL);
    let prevTy = Infinity;
    let prevHeight = 0;

    for (let i = TOTAL - 1; i >= 0; i--) {
      const card = cards[i];
      const inner = card.querySelector('.tl-card__inner');
      const cardHeight = inner ? inner.offsetHeight : H;
      
      const local = (p - i * slice) / slice;
      const incomingTy = Math.max(0, -local * H); // 0 if active/past, >0 if incoming
      
      let ty = incomingTy;
      if (i < TOTAL - 1) {
        // Calculate dynamic gap based on actual content heights
        const gap = (cardHeight + prevHeight) / 2 + 30; // 30px visual margin
        ty = Math.min(incomingTy, prevTy - gap);
      }
      
      positions[i] = { ty, local, card, i };
      prevTy = ty;
      prevHeight = cardHeight;
    }

    // Now apply the transforms
    positions.forEach(({ ty, local, card, i }) => {
      let opacity = 1;
      let scale = 1;

      if (ty < 0) {
        // Pushed up above center -> fade out and fly over
        opacity = Math.max(0, 1 - Math.abs(ty) / 400);
        scale = 1 + Math.abs(ty) / 1000;
      } else if (ty > 0) {
        // Incoming from below
        const t = Math.min(1, Math.abs(ty) / H); // 1 when at bottom, 0 when at center
        scale = 1 - t * 0.05; 
        opacity = Math.max(0, 1 - t * 1.5); 
      }

      const inner = card.querySelector(".tl-card__inner");
      if (inner) {
        inner.style.transform = `translate3d(0, ${ty}px, 0) scale(${scale})`;
        inner.style.opacity   = opacity;
      }
      card.style.zIndex    = 100 - i; // Reversed z-index so top cards fly over bottom ones

      // Animate progress bar when card is active
      const bar = card.querySelector(".tl-progress-bar");
      if (bar) {
        const progVal = card.dataset.progress || "0";
        bar.style.width = (i === activeIndex) ? `${progVal}%` : "0%";
      }
    });

    // ---- Update dots ----
    dots.forEach((dot, i) => {
      dot.classList.remove("is-past", "is-active");
      if (i < activeIndex) {
        dot.classList.add("is-past");
      } else if (i === activeIndex) {
        dot.classList.add("is-active");
      }
    });

    // ---- Update bottom counter ----
    if (counter) {
      const n = String(activeIndex + 1).padStart(2, "0");
      const t = String(TOTAL).padStart(2, "0");
      counter.textContent = `${n} / ${t}`;
    }
  }

  // Initial paint
  tick();

  window.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(tick);
  }, { passive: true });

  window.addEventListener("resize", tick);
});
