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

    // Navbar Scroll Effect
    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });

    // Smooth Scroll
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth'
                });
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

        hero.addEventListener('mousemove', (e) => {
            const cx = e.clientX / window.innerWidth - 0.5;
            const cy = e.clientY / window.innerHeight - 0.5;

            if (bgImage) {
                const tx = cx * 12; // small translation
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

        countdownEl.textContent = `Starts in: ${days}d ${String(hours).padStart(2,'0')}h ${String(minutes).padStart(2,'0')}m ${String(seconds).padStart(2,'0')}s`;
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
});
