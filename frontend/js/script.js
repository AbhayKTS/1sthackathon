document.addEventListener('DOMContentLoaded', () => {
    const scrollWrapper = document.querySelector('.scroll-wrapper');
    const scrollContainer = document.querySelector('.scroll-container');

    if (scrollWrapper && scrollContainer) {
        window.addEventListener('scroll', () => {
            const containerOffsetTop = scrollContainer.offsetTop;
            const containerHeight = scrollContainer.offsetHeight;
            const viewportHeight = window.innerHeight;

            // Calculate how much has been scrolled within the container
            let scrollTop = window.scrollY - containerOffsetTop;

            // Clamp value
            if (scrollTop < 0) scrollTop = 0;
            if (scrollTop > containerHeight - viewportHeight) scrollTop = containerHeight - viewportHeight;

            // Percentage of scroll within the container
            const scrollPercentage = scrollTop / (containerHeight - viewportHeight);

            // Calculate transform (moving left by the extra width)
            const xTransform = scrollPercentage * (scrollWrapper.offsetWidth - viewportHeight * (scrollWrapper.offsetWidth / viewportHeight / (scrollWrapper.childElementCount)));
            // Simpler: we want to move total width - 100vw
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
                if (isScrolled) {
                    navbar.classList.add('scrolled');
                } else {
                    navbar.classList.remove('scrolled');
                }
            }
        }, { passive: true });
    }

    // Smooth Scroll
    // Guard: skip anchors where href is exactly "#" — querySelector("#") is an invalid
    // CSS selector and throws a SyntaxError, breaking any click handler on the page.
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            // Only intercept when there is a real target ID (not a bare "#")
            if (!href || href === '#') return;
            e.preventDefault();
            const target = document.querySelector(href);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth' });
            }
        });
    });

    // Intersection Observer for Reveal Animations
    const observerOptions = {
        threshold: 0.1
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('reveal');
            }
        });
    }, observerOptions);

    // Add reveal class to sections
    document.querySelectorAll('section, .hero-content').forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(30px)';
        el.style.transition = 'all 0.8s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
        observer.observe(el);
    });

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

    // Rain Generator
    const rainContainer = document.querySelector('.rain-container');
    if (rainContainer) {
        const dropCount = 100;
        for (let i = 0; i < dropCount; i++) {
            const drop = document.createElement('div');
            drop.className = 'rain-drop';
            drop.style.left = Math.random() * 100 + '%';
            drop.style.animationDuration = (Math.random() * 0.5 + 0.5) + 's';
            drop.style.animationDelay = Math.random() * 2 + 's';
            drop.style.opacity = Math.random() * 0.5 + 0.2;
            rainContainer.appendChild(drop);
        }
    }

    // Bubble particle generator (white-grey bubbles drifting up)
    const particlesContainer = document.querySelector('.particles');
    if (particlesContainer) {
        const count = 45; // fewer, larger bubbles
        for (let i = 0; i < count; i++) {
            const p = document.createElement('span');
            p.className = 'particle';
            const left = Math.random() * 100;
            // smaller horizontal drift so bubbles go mostly upward
            const dx = (Math.random() - 0.5) * 80;
            const dur = 18 + Math.random() * 26; // slower rise
            const delay = Math.random() * -20; // start at random progress
            const size = 6 + Math.random() * 18; // bigger sizes
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
            particlesContainer.appendChild(p);
        }
    }

    // Background Parallax / Tilt
    const hero = document.getElementById('hero');
    if (hero) {
        // enhance mousemove parallax (background, smoke, fog, title)
        const bgImage = hero.querySelector('.live-bg-image');
        const smokeContainer = hero.querySelector('.smoke-container');
        const fog = hero.querySelector('.fog-container');
        const titleGroup = hero.querySelector('.hero-title-group');

        let ticking = false;
        let mouseEvent = null;

        function updateParallax() {
            if (!mouseEvent) {
                ticking = false;
                return;
            }
            const cx = mouseEvent.clientX / window.innerWidth - 0.5;
            const cy = mouseEvent.clientY / window.innerHeight - 0.5;

            if (bgImage) {
                const tx = cx * 12;
                const ty = cy * 8;
                bgImage.style.transform = `scale(1.08) translate(${tx}px, ${ty}px)`;
            }

            if (smokeContainer) {
                smokeContainer.style.transform = `translate(${cx * 20}px, ${cy * -10}px)`;
            }

            if (fog) {
                fog.style.transform = `translate(${cx * 8}px, 0)`;
            }

            if (titleGroup) {
                titleGroup.style.transform = `perspective(900px) rotateX(${6 + cy * 4}deg) translateY(${8 + cy * -6}px) translateX(${cx * 8}px)`;
            }

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

    // Live time and countdown
    const liveTimeEl = document.getElementById('live-time');
    function updateLiveTime() {
        if (!liveTimeEl) return;
        const now = new Date();
        // show hours:minutes with timezone short
        liveTimeEl.textContent = now.toLocaleString();
    }

    // Countdown 1.5 months (approx 45 days) from now
    const countdownEl = document.getElementById('countdown');
    const now = new Date();
    const target = new Date(now.getTime());
    target.setDate(target.getDate() + 45);

    function updateCountdown() {
        if (!countdownEl) return;
        const now = new Date();
        let diff = Math.max(0, target - now);
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        diff -= days * (1000 * 60 * 60 * 24);
        const hours = Math.floor(diff / (1000 * 60 * 60));
        diff -= hours * (1000 * 60 * 60);
        const minutes = Math.floor(diff / (1000 * 60));
        diff -= minutes * (1000 * 60);
        const seconds = Math.floor(diff / 1000);

        countdownEl.textContent = `Starts in: ${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }

    updateLiveTime();
    updateCountdown();
    setInterval(updateLiveTime, 1000);
    setInterval(updateCountdown, 1000);

    // Handle intersection by adding simple style
    const style = document.createElement('style');
    style.innerHTML = `
        .reveal {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }
    `;
    document.head.appendChild(style);

    // --- Track Problem Statement Modal Logic ---
    const psModal = document.getElementById('ps-modal');
    const psModalClose = document.getElementById('ps-modal-close');
    const trackCards = document.querySelectorAll('.track-card');

    if (psModal && psModalClose) {
        // Open modal when a track card is clicked
        trackCards.forEach(card => {
            card.addEventListener('click', () => {
                const isBlockchain = card.classList.contains('track-web3');
                const isAiml = card.classList.contains('track-aiml');
                const isCloud = card.classList.contains('track-cloud');
                const isCyber = card.classList.contains('track-cyber');
                const isOpenInnovation = card.classList.contains('track-openinnovation');

                // Reset content and themes
                const allContent = document.querySelectorAll('.ps-track-content');
                allContent.forEach(content => content.style.display = 'none');
                psModal.classList.remove('theme-blockchain', 'theme-aiml', 'theme-cloud', 'theme-cyber', 'theme-openinnovation');

                if (isBlockchain) {
                    document.getElementById('content-web3').style.display = 'block';
                    psModal.classList.add('theme-blockchain');
                } else if (isAiml) {
                    document.getElementById('content-aiml').style.display = 'block';
                    psModal.classList.add('theme-aiml');
                } else if (isCloud) {
                    document.getElementById('content-cloud').style.display = 'block';
                    psModal.classList.add('theme-cloud');
                } else if (isCyber) {
                    document.getElementById('content-cyber').style.display = 'block';
                    psModal.classList.add('theme-cyber');
                } else if (isOpenInnovation) {
                    document.getElementById('content-openinnovation').style.display = 'block';
                    psModal.classList.add('theme-openinnovation');
                }

                psModal.classList.add('active');
                document.body.style.overflow = 'hidden'; // Prevent scrolling
            });
        });

        // Close modal when close button is clicked
        psModalClose.addEventListener('click', () => {
            psModal.classList.remove('active');
            document.body.style.overflow = ''; // Restore scrolling
        });

        // Close modal when clicking outside the container
        psModal.addEventListener('click', (e) => {
            if (!e.target.closest('.ps-container')) {
                psModal.classList.remove('active');
                document.body.style.overflow = '';
            }
        });

        // Close modal with Escape key
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
    
    // Check if GSAP, SplitType are loaded and the animation section exists
    if (typeof gsap !== 'undefined' && typeof SplitType !== 'undefined' && animationSection) {
        
        // Lock scrolling during animation
        document.body.style.overflow = 'hidden';
        window.scrollTo(0, 0);

        // Split the text into characters
        const text = new SplitType('#loader-text', { types: 'chars' });
        const chars = text.chars;

        // Create the GSAP timeline
        const tl = gsap.timeline({
            onComplete: () => {
                document.body.style.overflow = ''; // Unlock scrolling
                animationSection.style.display = 'none'; // Hide the loader completely
            },
            delay: 0.2 // Small delay before starting
        });

        // Make loader text container visible now that we are ready to animate characters
        gsap.set('#loader-text', { opacity: 1 });

        // 1. Animate characters popping up one by one
        tl.fromTo(chars, 
            { opacity: 0, y: 100 }, 
            { opacity: 1, y: 0, stagger: 0.07, ease: 'power2.out', duration: 0.8 }
        );
        
        // 2. Enlarge the text slightly
        tl.to('#loader-text', { scale: 1.2, duration: 0.8, delay: 0.6, ease: 'power1.inOut' });
        
        // 3. Shrink the text down to 0
        tl.to('#loader-text', { scale: 0, duration: 0.5, ease: 'back.in(1.5)' });
        
        // 4. Slide the entire loader background up to reveal the website
        tl.to('#animationSection', { yPercent: -100, duration: 1, ease: 'power3.inOut' });
    }
});

// Scroll Animations
document.addEventListener("DOMContentLoaded", () => {
    if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
        gsap.registerPlugin(ScrollTrigger);

        // 1. Mission Section: Slide from left (only the content box)
        const missionContent = document.querySelector('.mission-content');
        if (missionContent) {
            gsap.fromTo(missionContent, {
                xPercent: -100,
                scale: 0.2,
                opacity: 0,
            }, {
                scrollTrigger: {
                    trigger: '#mission',
                    start: "top 80%", // Starts when top of mission section hits 80% down the viewport
                    end: "top 30%",   // Ends when it reaches 30% from the top
                    scrub: 1          // Ties animation progress directly to scrollbar
                },
                xPercent: 0,
                scale: 1,
                opacity: 1,
                ease: "power2.out"
            });
        }

        // 2. Track Cards: Pop up sequentially
        const tracks = document.querySelectorAll('.track-card');
        if (tracks.length > 0) {
            gsap.fromTo(tracks, {
                scale: 0.2,
                opacity: 0,
            }, {
                scrollTrigger: {
                    trigger: "#tracks",
                    start: "top 80%",
                    end: "top 20%",
                    scrub: 1
                },
                scale: 1,
                opacity: 1,
                stagger: 0.1,
                ease: "power2.out"
            });
        }

        // 3. Treasury Cards: Pop up sequentially
        const treasuryCards = document.querySelectorAll('.treasury-card');
        if (treasuryCards.length > 0) {
            gsap.fromTo(treasuryCards, {
                scale: 0.2,
                opacity: 0,
            }, {
                scrollTrigger: {
                    trigger: "#treasury",
                    start: "top 80%",
                    end: "top 30%",
                    scrub: 1
                },
                scale: 1,
                opacity: 1,
                stagger: 0.1,
                ease: "power2.out"
            });
        }

        // 4. Sponsor Tiers: Pop up sequentially
        const sponsorTiers = document.querySelectorAll('.sponsor-tier');
        if (sponsorTiers.length > 0) {
            gsap.fromTo(sponsorTiers, {
                scale: 0.2,
                opacity: 0,
            }, {
                scrollTrigger: {
                    trigger: "#sponsors",
                    start: "top 80%",
                    end: "top 30%",
                    scrub: 1
                },
                scale: 1,
                opacity: 1,
                stagger: 0.1,
                ease: "power2.out"
            });
        }
    }
});
