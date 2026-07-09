import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import SplitType from 'split-type';

gsap.registerPlugin(ScrollTrigger);

document.addEventListener('DOMContentLoaded', () => {
    const scrollWrapper = document.querySelector('.scroll-wrapper');
    const scrollContainer = document.querySelector('.scroll-container');

    if (scrollWrapper && scrollContainer) {
        window.addEventListener('scroll', () => {
            const containerOffsetTop = scrollContainer.offsetTop;
            const containerHeight = scrollContainer.offsetHeight;
            const viewportHeight = window.innerHeight;

            let scrollTop = window.scrollY - containerOffsetTop;
            if (scrollTop < 0) scrollTop = 0;
            if (scrollTop > containerHeight - viewportHeight) scrollTop = containerHeight - viewportHeight;

            const scrollPercentage = scrollTop / (containerHeight - viewportHeight);
            const totalMove = scrollWrapper.offsetWidth - window.innerWidth;
            scrollWrapper.style.transform = `translateX(-${scrollPercentage * totalMove}px)`;
        });
    }

    const navbar = document.getElementById('navbar');

    // Navbar Scroll Effect — optimized with state check and passive flag
    let isScrolled = false;
    if (navbar) {
        window.addEventListener('scroll', () => {
            const scrolled = window.scrollY > 50;
            if (scrolled !== isScrolled) {
                isScrolled = scrolled;
                navbar.classList.toggle('scrolled', isScrolled);
            }
        }, { passive: true });
    }

    // Smooth Scroll
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#') return;
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

    // Intersection Observer for Navbar Active State
    const navLinks = document.querySelectorAll('.nav-links a');
    const sections = document.querySelectorAll('section[id], header[id]');
    
    if (navLinks.length > 0 && sections.length > 0) {
        const navObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    navLinks.forEach(link => {
                        link.classList.remove('active');
                        if (link.getAttribute('href') === `#${entry.target.id}`) {
                            link.classList.add('active');
                        }
                    });
                }
            });
        }, { rootMargin: '-50% 0px -50% 0px' });
        
        sections.forEach(sec => navObserver.observe(sec));
    }

    // Intersection Observer for Reveal Animations
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal');
            }
        });
    }, { threshold: 0.1 });

    document.querySelectorAll('section, .hero-content').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        observer.observe(el);
    });

    const style = document.createElement('style');
    style.innerHTML = `.reveal { opacity: 1 !important; transform: translateY(0) !important; }`;
    document.head.appendChild(style);

    // Image Slider for Abhay Section
    const sliderImages = document.querySelectorAll('.slider-img');
    if (sliderImages.length > 0) {
        let currentSlide = 0;
        setInterval(() => {
            sliderImages[currentSlide].classList.remove('active');
            currentSlide = (currentSlide + 1) % sliderImages.length;
            sliderImages[currentSlide].classList.add('active');
        }, 5000);
    }

    // Rain Generator — reduced to 40 drops, batched with DocumentFragment
    const rainContainer = document.querySelector('.rain-container');
    if (rainContainer) {
        const fragment = document.createDocumentFragment();
        for (let i = 0; i < 40; i++) {
            const drop = document.createElement('div');
            drop.className = 'rain-drop';
            drop.style.left = Math.random() * 100 + '%';
            drop.style.animationDuration = (Math.random() * 0.5 + 0.5) + 's';
            drop.style.animationDelay = Math.random() * 2 + 's';
            drop.style.opacity = Math.random() * 0.5 + 0.2;
            fragment.appendChild(drop);
        }
        rainContainer.appendChild(fragment);
    }

    // Bubble particle generator — reduced to 20, batched with DocumentFragment
    const particlesContainer = document.querySelector('.particles');
    if (particlesContainer) {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < 20; i++) {
            const p = document.createElement('span');
            p.className = 'particle';
            const left = Math.random() * 100;
            const dx = (Math.random() - 0.5) * 80;
            const dur = 18 + Math.random() * 26;
            const delay = Math.random() * -20;
            const size = 6 + Math.random() * 18;
            const o = 0.18 + Math.random() * 0.5;
            const blur = 0.2 + Math.random() * 2.8;
            const scale = 0.8 + Math.random() * 0.7;
            p.style.left = left + '%';
            p.style.setProperty('--dx', dx + 'px');
            p.style.setProperty('--dur', dur + 's');
            p.style.setProperty('--delay', delay + 's');
            p.style.setProperty('--size', size + 'px');
            p.style.setProperty('--o', o);
            p.style.setProperty('--blur', blur + 'px');
            p.style.setProperty('--scale', scale);
            frag.appendChild(p);
        }
        particlesContainer.appendChild(frag);
    }

    // Lazy-play mission video only when visible
    const missionVideo = document.querySelector('[data-autoplay-on-visible]');
    if (missionVideo) {
        const videoObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.play().catch(() => {});
                } else {
                    entry.target.pause();
                }
            });
        }, { threshold: 0.1 });
        videoObserver.observe(missionVideo);
    }

    // Background Parallax / Tilt
    const hero = document.getElementById('hero');
    if (hero) {
        const bgImage = hero.querySelector('.live-bg-image');
        const smokeContainer = hero.querySelector('.smoke-container');
        const fog = hero.querySelector('.fog-container');
        const titleGroup = hero.querySelector('.hero-title-group');

        let ticking = false;
        let mouseEvent = null;

        function updateParallax() {
            if (!mouseEvent) { ticking = false; return; }
            const cx = mouseEvent.clientX / window.innerWidth - 0.5;
            const cy = mouseEvent.clientY / window.innerHeight - 0.5;

            if (bgImage) bgImage.style.transform = `scale(1.08) translate(${cx * 12}px, ${cy * 8}px)`;
            if (smokeContainer) smokeContainer.style.transform = `translate(${cx * 20}px, ${cy * -10}px)`;
            if (fog) fog.style.transform = `translate(${cx * 8}px, 0)`;
            if (titleGroup) titleGroup.style.transform = `perspective(900px) rotateX(${6 + cy * 4}deg) translateY(${8 + cy * -6}px) translateX(${cx * 8}px)`;

            ticking = false;
        }

        hero.addEventListener('mousemove', (e) => {
            mouseEvent = e;
            if (!ticking) {
                requestAnimationFrame(updateParallax);
                ticking = true;
            }
        });
    }

    // Live time for navbar
    const liveTimeEl = document.getElementById('live-time');
    function updateLiveTime() {
        if (!liveTimeEl) return;
        liveTimeEl.textContent = new Date().toLocaleTimeString();
    }
    updateLiveTime();
    setInterval(updateLiveTime, 1000);

    // Countdown — hardcoded target date Aug 22 2026
    const countdownEl = document.getElementById('countdown');
    const countdownTarget = new Date('2026-08-22T00:00:00+05:30');

    function updateCountdown() {
        if (!countdownEl) return;
        const now = new Date();
        let diff = Math.max(0, countdownTarget - now);
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        diff -= days * (1000 * 60 * 60 * 24);
        const hours = Math.floor(diff / (1000 * 60 * 60));
        diff -= hours * (1000 * 60 * 60);
        const minutes = Math.floor(diff / (1000 * 60));
        diff -= minutes * (1000 * 60);
        const seconds = Math.floor(diff / 1000);
        countdownEl.textContent = `Starts in: ${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }
    updateCountdown();
    setInterval(updateCountdown, 1000);

    // --- Track Problem Statement Modal Logic ---
    const psModal = document.getElementById('ps-modal');
    const psModalClose = document.getElementById('ps-modal-close');
    const trackCards = document.querySelectorAll('.track-card');

    if (psModal && psModalClose) {
        trackCards.forEach(card => {
            card.addEventListener('click', () => {
                const trackMap = {
                    'track-web3': 'content-web3',
                    'track-aiml': 'content-aiml',
                    'track-cloud': 'content-cloud',
                    'track-cyber': 'content-cyber',
                    'track-openinnovation': 'content-openinnovation',
                };
                const themeMap = {
                    'track-web3': 'theme-blockchain',
                    'track-aiml': 'theme-aiml',
                    'track-cloud': 'theme-cloud',
                    'track-cyber': 'theme-cyber',
                    'track-openinnovation': 'theme-openinnovation',
                };

                document.querySelectorAll('.ps-track-content').forEach(c => c.style.display = 'none');
                psModal.classList.remove('theme-blockchain', 'theme-aiml', 'theme-cloud', 'theme-cyber', 'theme-openinnovation');

                for (const [cls, contentId] of Object.entries(trackMap)) {
                    if (card.classList.contains(cls)) {
                        document.getElementById(contentId).style.display = 'block';
                        psModal.classList.add(themeMap[cls]);
                        break;
                    }
                }

                psModal.classList.add('active');
                document.body.style.overflow = 'hidden';
            });
        });

        psModalClose.addEventListener('click', () => {
            psModal.classList.remove('active');
            document.body.style.overflow = '';
        });

        psModal.addEventListener('click', (e) => {
            if (!e.target.closest('.ps-container')) {
                psModal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && psModal.classList.contains('active')) {
                psModal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });
    }
});

// Preloader Animation Logic
document.addEventListener("DOMContentLoaded", () => {
    const animationSection = document.getElementById('animationSection');

    const hideLoaderFailsafe = () => {
        if (animationSection) {
            animationSection.style.display = 'none';
            document.body.style.overflow = '';
        }
    };

    try {
        if (animationSection) {
            document.body.style.overflow = 'hidden';
            window.scrollTo(0, 0);

            const text = new SplitType('#loader-text', { types: 'chars' });
            const chars = text.chars;

            const tl = gsap.timeline({ onComplete: hideLoaderFailsafe, delay: 0.2 });
            gsap.set('#loader-text', { opacity: 1 });

            tl.fromTo(chars,
                { opacity: 0, y: 100 },
                { opacity: 1, y: 0, stagger: 0.07, ease: 'power2.out', duration: 0.8 }
            );
            tl.to('#loader-text', { scale: 1.2, duration: 0.8, delay: 0.6, ease: 'power1.inOut' });
            tl.to('#loader-text', { scale: 0, duration: 0.5, ease: 'back.in(1.5)' });
            tl.to('#animationSection', { yPercent: -100, duration: 1, ease: 'power3.inOut' });
        } else {
            hideLoaderFailsafe();
        }
    } catch (error) {
        console.error("Error in preloader animation:", error);
        hideLoaderFailsafe();
    }
});

// Scroll Animations
document.addEventListener("DOMContentLoaded", () => {
    // 1. Mission Section: Slide from left
    const missionContent = document.querySelector('.mission-content');
    if (missionContent) {
        gsap.fromTo(missionContent, { xPercent: -100, scale: 0.2, opacity: 0 }, {
            scrollTrigger: { trigger: '#mission', start: "top 80%", end: "top 30%", scrub: 1 },
            xPercent: 0, scale: 1, opacity: 1, ease: "power2.out"
        });
    }

    // 2. Track Cards
    const tracks = document.querySelectorAll('.track-card');
    if (tracks.length > 0) {
        gsap.fromTo(tracks, { scale: 0.2, opacity: 0 }, {
            scrollTrigger: { trigger: "#tracks", start: "top 80%", end: "top 20%", scrub: 1 },
            scale: 1, opacity: 1, stagger: 0.1, ease: "power2.out"
        });
    }

    // 3. Treasury Cards
    const treasuryCards = document.querySelectorAll('.treasury-card');
    if (treasuryCards.length > 0) {
        gsap.fromTo(treasuryCards, { scale: 0.2, opacity: 0 }, {
            scrollTrigger: { trigger: "#treasury", start: "top 80%", end: "top 30%", scrub: 1 },
            scale: 1, opacity: 1, stagger: 0.1, ease: "power2.out"
        });
    }

    // 4. Sponsor Tiers
    const sponsorTiers = document.querySelectorAll('.sponsor-tier');
    if (sponsorTiers.length > 0) {
        gsap.fromTo(sponsorTiers, { scale: 0.2, opacity: 0 }, {
            scrollTrigger: { trigger: "#sponsors", start: "top 80%", end: "top 30%", scrub: 1 },
            scale: 1, opacity: 1, stagger: 0.1, ease: "power2.out"
        });
    }
});
