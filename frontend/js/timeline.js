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
    const slice  = 1 / TOTAL;
    // Use floor with a tiny bias so card 0 shows at p=0
    const activeIndex = Math.min(TOTAL - 1, Math.floor(p * TOTAL + 0.0001));

    // ---- Update cards ----
    cards.forEach((card, i) => {
      // local progress within this card's slot (-1 → 0 → 1)
      const local = (p - i * slice) / slice;

      let ty = 0;
      let opacity = 1;
      let scale = 1;

      if (local < 0) {
        // Card is below viewport — slide in from below
        const t = Math.min(1, -local);
        ty      = t * 100;           // 100vh below
        opacity = Math.max(0, 1 - t * 1.5);
        scale   = 0.97 + (1 - t) * 0.03;
      } else if (local <= 1) {
        // Card is active viewport
        ty      = 0;
        opacity = 1;
        scale   = 1;
      } else {
        // Card is above viewport — exit upward fast
        const t = Math.min(1, local - 1);
        ty      = -t * 18;           // subtle upward nudge, then fade
        opacity = Math.max(0, 1 - t * 5);
        scale   = 1 - t * 0.02;
      }

      card.style.transform = `translate3d(0, ${ty}vh, 0) scale(${scale})`;
      card.style.opacity   = opacity;
      card.style.zIndex    = 10 + i;

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
