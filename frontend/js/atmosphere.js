/**
 * atmosphere.js — RevengersHack Immersion Engine
 * Canvas particles, Web Audio cyberpunk ambience, sponsor spotlight, footer terminal.
 * Never autoplays audio. Respects prefers-reduced-motion.
 */

/* ============================================================
   1. REDUCED MOTION GUARD
   ============================================================ */
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
   2. GLOBAL CANVAS PARTICLE SYSTEM (dust + embers)
   ============================================================ */
(function initParticles() {
    if (prefersReducedMotion) return;

    const canvas = document.createElement('canvas');
    canvas.id = 'rh-particles';
    canvas.style.cssText = `
        position: fixed;
        top: 0; left: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: 2;
        opacity: 0.55;
    `;
    document.body.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    let W = canvas.width = window.innerWidth;
    let H = canvas.height = window.innerHeight;

    window.addEventListener('resize', () => {
        W = canvas.width = window.innerWidth;
        H = canvas.height = window.innerHeight;
    }, { passive: true });

    const PARTICLE_COUNT = 60;
    const particles = [];

    function randomBetween(a, b) { return a + Math.random() * (b - a); }

    class Particle {
        constructor() { this.reset(true); }
        reset(initial = false) {
            this.x = randomBetween(0, W);
            this.y = initial ? randomBetween(0, H) : H + 10;
            this.size = randomBetween(0.5, 2.5);
            this.speedY = randomBetween(0.12, 0.55);
            this.speedX = randomBetween(-0.18, 0.18);
            this.opacity = randomBetween(0.08, 0.38);
            this.opacityDelta = randomBetween(0.001, 0.003) * (Math.random() > 0.5 ? 1 : -1);
            // type: 0=dust, 1=ember
            this.type = Math.random() > 0.85 ? 1 : 0;
            if (this.type === 1) {
                this.size = randomBetween(1, 3);
                this.speedY = randomBetween(0.3, 0.9);
            }
        }
        update() {
            this.y -= this.speedY;
            this.x += this.speedX + Math.sin(this.y * 0.01) * 0.1;
            this.opacity += this.opacityDelta;
            if (this.opacity > 0.4 || this.opacity < 0.04) this.opacityDelta *= -1;
            if (this.y < -10) this.reset();
        }
        draw() {
            ctx.save();
            ctx.globalAlpha = this.opacity;
            if (this.type === 1) {
                // ember — small glowing red dot
                const grad = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 2);
                grad.addColorStop(0, 'rgba(255,80,50,0.9)');
                grad.addColorStop(0.5, 'rgba(180,30,10,0.4)');
                grad.addColorStop(1, 'transparent');
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size * 2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                // dust — tiny white/grey speck
                ctx.fillStyle = `rgba(220,210,200,${this.opacity})`;
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }

    for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle());

    let animId;
    function loop() {
        ctx.clearRect(0, 0, W, H);
        particles.forEach(p => { p.update(); p.draw(); });
        animId = requestAnimationFrame(loop);
    }

    // Pause when tab hidden for performance
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) cancelAnimationFrame(animId);
        else loop();
    });

    loop();
})();

/* ============================================================
   3. AMBIENT RED GLOW PULSE (CSS-driven via class toggle)
   ============================================================ */
(function initGlowPulse() {
    if (prefersReducedMotion) return;
    const el = document.createElement('div');
    el.id = 'rh-glow-pulse';
    el.style.cssText = `
        position: fixed;
        bottom: -30vh;
        left: 50%;
        transform: translateX(-50%);
        width: 80vw;
        height: 60vh;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(178,34,34,0.07) 0%, transparent 70%);
        pointer-events: none;
        z-index: 1;
        animation: rhGlowPulse 6s ease-in-out infinite;
        will-change: opacity, transform;
    `;
    document.body.appendChild(el);
})();

/* ============================================================
   4. LIGHT STREAK EFFECT
   ============================================================ */
(function initLightStreaks() {
    if (prefersReducedMotion) return;
    for (let i = 0; i < 3; i++) {
        const streak = document.createElement('div');
        streak.className = 'rh-light-streak';
        streak.style.cssText = `
            position: fixed;
            top: 0;
            left: ${20 + i * 30}%;
            width: 1px;
            height: 30vh;
            background: linear-gradient(to bottom, transparent 0%, rgba(255,255,255,0.06) 50%, transparent 100%);
            pointer-events: none;
            z-index: 1;
            animation: rhLightStreak ${8 + i * 3}s linear ${i * 2.5}s infinite;
            will-change: transform, opacity;
        `;
        document.body.appendChild(streak);
    }
})();

/* ============================================================
   5. SPONSOR SPOTLIGHT (mouse-tracking radial glow)
   ============================================================ */
(function initSponsorSpotlight() {
    const boxes = document.querySelectorAll('.sponsor-box');
    boxes.forEach(box => {
        box.addEventListener('mousemove', (e) => {
            const rect = box.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            box.style.setProperty('--spot-x', `${x}%`);
            box.style.setProperty('--spot-y', `${y}%`);
        });
        box.addEventListener('mouseleave', () => {
            box.style.setProperty('--spot-x', '50%');
            box.style.setProperty('--spot-y', '50%');
        });
    });
})();

/* ============================================================
   6. WEB AUDIO ENGINE — Synthetic Cyberpunk Ambience
   ============================================================ */
const AudioEngine = (() => {
    let ctx = null;
    let masterGain = null;
    let ambientNodes = [];
    let enabled = false;
    const STORAGE_KEY = 'rh_audio_enabled';

    function getCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.setValueAtTime(0, ctx.currentTime);
            masterGain.connect(ctx.destination);
        }
        return ctx;
    }

    function buildAmbientDrone() {
        const ac = getCtx();
        const nodes = [];

        // Sub bass drone
        const osc1 = ac.createOscillator();
        const g1 = ac.createGain();
        osc1.type = 'sine';
        osc1.frequency.value = 42;
        g1.gain.value = 0.18;
        osc1.connect(g1);
        g1.connect(masterGain);
        osc1.start();
        nodes.push(osc1, g1);

        // Mid hum (slightly detuned for warmth)
        const osc2 = ac.createOscillator();
        const g2 = ac.createGain();
        osc2.type = 'triangle';
        osc2.frequency.value = 84.2;
        g2.gain.value = 0.06;
        osc2.connect(g2);
        g2.connect(masterGain);
        osc2.start();
        nodes.push(osc2, g2);

        // High synth pad shimmer
        const osc3 = ac.createOscillator();
        const g3 = ac.createGain();
        const filter3 = ac.createBiquadFilter();
        osc3.type = 'sawtooth';
        osc3.frequency.value = 210;
        filter3.type = 'lowpass';
        filter3.frequency.value = 600;
        filter3.Q.value = 2;
        g3.gain.value = 0.012;
        osc3.connect(filter3);
        filter3.connect(g3);
        g3.connect(masterGain);
        osc3.start();
        nodes.push(osc3, g3, filter3);

        // LFO for slow modulation
        const lfo = ac.createOscillator();
        const lfoGain = ac.createGain();
        lfo.frequency.value = 0.08;
        lfoGain.gain.value = 8;
        lfo.connect(lfoGain);
        lfoGain.connect(osc3.frequency);
        lfo.start();
        nodes.push(lfo, lfoGain);

        // White noise layer (soft city static)
        const bufSize = ac.sampleRate * 2;
        const noiseBuffer = ac.createBuffer(1, bufSize, ac.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1) * 0.012;
        const noiseSource = ac.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        const noiseFilter = ac.createBiquadFilter();
        noiseFilter.type = 'bandpass';
        noiseFilter.frequency.value = 400;
        noiseFilter.Q.value = 0.5;
        const noiseGain = ac.createGain();
        noiseGain.gain.value = 0.4;
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(masterGain);
        noiseSource.start();
        nodes.push(noiseSource, noiseFilter, noiseGain);

        return nodes;
    }

    function playClickSound() {
        if (!enabled || !ctx) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 800;
        g.gain.setValueAtTime(0.04, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
        osc.connect(g);
        g.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
    }

    function playHoverSound() {
        if (!enabled || !ctx) return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.04);
        g.gain.setValueAtTime(0.025, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
        osc.connect(g);
        g.connect(masterGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
    }

    function enable() {
        const ac = getCtx();
        if (ac.state === 'suspended') ac.resume();
        if (ambientNodes.length === 0) ambientNodes = buildAmbientDrone();
        masterGain.gain.cancelScheduledValues(ac.currentTime);
        masterGain.gain.setValueAtTime(masterGain.gain.value, ac.currentTime);
        masterGain.gain.linearRampToValueAtTime(1, ac.currentTime + 2.5);
        enabled = true;
        localStorage.setItem(STORAGE_KEY, '1');
    }

    function disable() {
        if (!ctx) return;
        masterGain.gain.cancelScheduledValues(ctx.currentTime);
        masterGain.gain.setValueAtTime(masterGain.gain.value, ctx.currentTime);
        masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
        enabled = false;
        localStorage.setItem(STORAGE_KEY, '0');
    }

    function isEnabled() { return enabled; }

    function initFromStorage() {
        // Only auto-enable if user explicitly turned it on before
        if (localStorage.getItem(STORAGE_KEY) === '1') {
            // Slight delay so user interaction has happened (page load click)
            // We cannot auto-start audio — wait for toggle button
        }
    }

    return { enable, disable, isEnabled, playClickSound, playHoverSound, initFromStorage };
})();

/* ============================================================
   7. SOUND TOGGLE BUTTON LOGIC
   ============================================================ */
(function initSoundToggle() {
    const btn = document.getElementById('sound-toggle');
    if (!btn) return;

    function updateUI(on) {
        btn.classList.toggle('sound-active', on);
        const label = btn.querySelector('.sound-label');
        if (label) label.textContent = on ? 'CHANNEL ACTIVE' : 'CHANNEL OFF';
    }

    btn.addEventListener('click', () => {
        if (AudioEngine.isEnabled()) {
            AudioEngine.disable();
            updateUI(false);
        } else {
            AudioEngine.enable();
            updateUI(true);
        }
    });

    // Hover sounds on interactive elements
    document.querySelectorAll('.nav-links a, .btn-tactical, .btn-outline, .checkpoint, .sponsor-box').forEach(el => {
        el.addEventListener('mouseenter', () => AudioEngine.playHoverSound());
    });

    document.querySelectorAll('.btn-tactical, .btn-outline, .ps-btn').forEach(el => {
        el.addEventListener('click', () => AudioEngine.playClickSound());
    });

    // Restore state
    AudioEngine.initFromStorage();
    updateUI(false);
})();

/* ============================================================
   8. FOOTER TERMINAL — LIVE CLOCK + COPY EMAIL
   ============================================================ */
(function initFooterTerminal() {
    // Live clock
    const clockEl = document.getElementById('rh-terminal-clock');
    if (clockEl) {
        function tick() {
            const now = new Date();
            const hh = String(now.getHours()).padStart(2, '0');
            const mm = String(now.getMinutes()).padStart(2, '0');
            const ss = String(now.getSeconds()).padStart(2, '0');
            clockEl.textContent = `${hh}:${mm}:${ss}`;
        }
        tick();
        setInterval(tick, 1000);
    }

    // Copy email functionality
    document.querySelectorAll('[data-copy-email]').forEach(btn => {
        btn.addEventListener('click', () => {
            const email = btn.getAttribute('data-copy-email');
            navigator.clipboard.writeText(email).then(() => {
                const orig = btn.textContent;
                btn.textContent = 'COPIED!';
                btn.classList.add('copied');
                setTimeout(() => {
                    btn.textContent = orig;
                    btn.classList.remove('copied');
                }, 2000);
            }).catch(() => {
                // Fallback
                const ta = document.createElement('textarea');
                ta.value = email;
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            });
        });
    });
})();

/* ============================================================
   9. AUTO-PLAY SECTION VIDEO ON SCROLL (lazy playback)
   ============================================================ */
(function initLazyVideo() {
    const videos = document.querySelectorAll('video[data-autoplay-on-visible]');
    if (!videos.length) return;
    const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.play().catch(() => {});
            else entry.target.pause();
        });
    }, { threshold: 0.2 });
    videos.forEach(v => obs.observe(v));
})();
