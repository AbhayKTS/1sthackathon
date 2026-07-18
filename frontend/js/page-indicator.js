/**
 * Page Section Scroll Indicator
 * Fixed right-side vertical rail with dots for each section.
 * Current section dot glows red + shows label.
 */
(function () {
  "use strict";

  const SECTIONS = [
    { id: "hero",      label: "HOME"      },
    { id: "mission",   label: "MISSION"   },
    { id: "tracks",    label: "TRACKS"    },
    { id: "schedule",  label: "TIMELINE"  },
    { id: "treasury",  label: "TREASURY"  },
    { id: "sponsors",  label: "SPONSORS"  },
    { id: "about",     label: "ABOUT"     },
  ];

  /* Build the indicator DOM */
  const rail = document.createElement("div");
  rail.id = "pg-indicator";
  rail.setAttribute("aria-hidden", "true");
  rail.innerHTML = `
    <div class="pg-line"></div>
    ${SECTIONS.map((s, i) => `
      <div class="pg-dot-wrap" data-index="${i}" data-target="${s.id}">
        <span class="pg-dot"></span>
        <span class="pg-label">${s.label}</span>
      </div>`).join("")}
  `;
  document.body.appendChild(rail);

  const dotWraps = Array.from(rail.querySelectorAll(".pg-dot-wrap"));

  /* Dot click → scroll to section */
  dotWraps.forEach(wrap => {
    wrap.addEventListener("click", () => {
      const el = document.getElementById(wrap.dataset.target);
      if (el) el.scrollIntoView({ behavior: "smooth" });
    });
  });

  /* Active section detection */
  let activeIdx = 0;
  let raf = 0;

  function update() {
    raf = 0;
    const scrollMid = window.scrollY + window.innerHeight * 0.4;

    // Find the last section whose top is above scrollMid
    let best = 0;
    SECTIONS.forEach((s, i) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      if (el.getBoundingClientRect().top + window.scrollY <= scrollMid) best = i;
    });

    if (best !== activeIdx) {
      activeIdx = best;
      dotWraps.forEach((wrap, i) => {
        wrap.classList.toggle("is-active", i === activeIdx);
        wrap.classList.toggle("is-past",   i < activeIdx);
      });
    }
  }

  window.addEventListener("scroll", () => {
    if (raf) return;
    raf = requestAnimationFrame(update);
  }, { passive: true });

  update();

})();
