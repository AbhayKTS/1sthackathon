document.addEventListener("DOMContentLoaded", () => {
    const canvas = document.getElementById("rh-net-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    let width, height;
    let particles = [];
    const NUM_PARTICLES = 350; // Increased for extra free petals
    
    function resize() {
        width = window.innerWidth;
        height = window.innerHeight;
        canvas.width = width;
        canvas.height = height;
    }
    window.addEventListener("resize", resize);
    resize();

    class Particle {
        constructor() {
            this.x = Math.random() * width;
            this.y = Math.random() * height;
            this.vx = (Math.random() - 0.5) * 1.5;
            this.vy = (Math.random() - 0.5) * 1.5;
            this.angle = Math.random() * Math.PI * 2;
            this.rotSpeed = (Math.random() - 0.5) * 0.02;
            this.size = Math.random() * 2 + 1; 

            // 30% of petals are purely background decorators that NEVER connect to the network
            this.noConnect = Math.random() < 0.3;
            // 40% of the remaining petals are free roamers that don't form shapes but DO connect
            this.isFree = this.noConnect || Math.random() < 0.4;
            
            // Default targets to center of screen to avoid off-screen grouping
            this.targetX = window.innerWidth / 2 || 500;
            this.targetY = window.innerHeight / 2 || 500;
        }

        update(force, scrollDelta) {
            const effectiveForce = this.isFree ? 0 : force;

            if (effectiveForce > 0) {
                // Accelerate towards target
                const dx = this.targetX - this.x;
                const dy = this.targetY - this.y;
                
                // Safe, slow attraction
                this.vx += dx * 0.002 * effectiveForce;
                this.vy += dy * 0.002 * effectiveForce;
                
                // Damping to prevent exploding orbits
                this.vx *= 0.90;
                this.vy *= 0.90;
            } else {
                // Revert to normal wander speed slowly
                const speed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
                if (speed > 1) {
                    this.vx *= 0.95;
                    this.vy *= 0.95;
                } else {
                    this.vx += (Math.random() - 0.5) * 0.05;
                    this.vy += (Math.random() - 0.5) * 0.05;
                    if (speed > 0.5) {
                        this.vx *= 0.95;
                        this.vy *= 0.95;
                    }
                }
            }

            this.x += this.vx;
            this.y += this.vy;
            this.angle += this.rotSpeed;

            // Wrap around edges to keep them on screen
            if (this.x < -100) this.x = width + 100;
            if (this.x > width + 100) this.x = -100;
            if (this.y < -100) this.y = height + 100;
            if (this.y > height + 100) this.y = -100;
        }

        draw(ctx) {
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.angle);
            ctx.fillStyle = "rgba(225, 29, 72, 0.8)";
            ctx.shadowColor = "rgba(225, 29, 72, 1)";
            ctx.shadowBlur = 8;
            ctx.beginPath();
            // Draw a petal shape (elongated ellipse)
            ctx.ellipse(0, 0, this.size * 2.5, this.size, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    // Initialize particles
    for (let i = 0; i < NUM_PARTICLES; i++) {
        particles.push(new Particle());
    }

    let currentShapeType = 0;

    // Text shape removed as requested

    function getHourglassPoint(t) {
        const angle = t * Math.PI * 2;
        const scale = 1.8; 
        const nx = (scale * Math.cos(angle)) / (1 + Math.sin(angle) * Math.sin(angle));
        const ny = (scale * Math.cos(angle) * Math.sin(angle)) / (1 + Math.sin(angle) * Math.sin(angle));
        // Rotated Lemniscate (Figure 8 / Hourglass)
        return { x: ny * 0.9, y: nx * 0.5 };
    }

    function getBlackHolePoint(t) {
        // Event horizon empty space (r=0.2), accretion disk fades out to r=1.0
        const r = 0.2 + Math.pow(t, 2) * 0.8;
        const angle = t * Math.PI * 15 + r * 5; 
        return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    }

    function getEyePoint(t) {
        if (t < 0.4) {
            // Top arc
            const pt = t / 0.4;
            return { x: -1 + pt * 2, y: -Math.sin(pt * Math.PI) * 0.5 };
        } else if (t < 0.8) {
            // Bottom arc
            const pt = (t - 0.4) / 0.4;
            return { x: -1 + pt * 2, y: Math.sin(pt * Math.PI) * 0.5 };
        } else {
            // Pupil
            const pt = (t - 0.8) / 0.2;
            const angle = pt * Math.PI * 6; 
            const r = pt * 0.2;
            return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
        }
    }

    function generateShapeTargets(shapeType) {
        const cx = width / 2;
        const cy = height / 2;

        particles.forEach((p, i) => {
            const t = i / particles.length;

            if (shapeType === 1) {
                // HOURGLASS
                const pt = getHourglassPoint(t);
                const scale = Math.min(width, height) * 0.35; // reduced scale to zoom out
                p.targetX = cx + pt.x * scale;
                p.targetY = cy + pt.y * scale;
            } else if (shapeType === 2) {
                // EYE
                const pt = getEyePoint(t);
                const scale = Math.min(width, height) * 0.45;
                p.targetX = cx + pt.x * scale;
                p.targetY = cy + pt.y * scale;
            } else if (shapeType === 3) {
                // BLACK HOLE
                const pt = getBlackHolePoint(t);
                const scale = Math.min(width, height) * 0.4;
                p.targetX = cx + pt.x * scale;
                p.targetY = cy + pt.y * scale;
            }
        });
    }

    const startSection = document.getElementById("mission");
    const aboutSection = document.getElementById("about");

    let lastScrollY = window.scrollY;

    function render() {
        if (!startSection || !aboutSection) {
            requestAnimationFrame(render);
            return;
        }

        const scrollY = window.scrollY;
        const scrollDelta = Math.min(Math.abs(scrollY - lastScrollY), 10); // cap delta
        lastScrollY = scrollY;

        // Start animation from the very top (Mission section)
        const startY = 0; 
        // Progress normalized 0 to 1 across the active scrolling area
        const endY = aboutSection.offsetTop + aboutSection.offsetHeight || 10000;
        const totalDist = Math.max(1, endY - startY);
        const progress = Math.max(0, Math.min(1, (scrollY - startY) / totalDist));
        
        canvas.style.opacity = "1";

        // 1. SINE WAVE ZOOMING WITH SCROLL
        // Starts at 0.6x (zoomed out base), peaks at 2.0x in the middle, ends at 0.6x
        const scale = 0.6 + Math.sin(progress * Math.PI) * 1.4; 

        // 2. TIME-BASED SHAPE FORMATION & DISCONNECT BUFFER
        const now = Date.now();
        const cycleTime = 4000; // 4 seconds total cycle 
        const cycleProgress = (now % cycleTime) / cycleTime;
        
        // Update shape every 12 seconds (3 shapes * 4 seconds)
        const overallShape = 1 + Math.floor(now / 12000) % 3;
        
        let force = 0;
        let connectAlpha = 0; // Opacity modifier for connections

        if (cycleProgress < 0.4) {
            // Form shape tightly
            force = 1.0;
            connectAlpha = 1.0;
            activeShape = overallShape;
        } else if (cycleProgress < 0.5) {
            // Begin disconnecting/scattering
            force = 1.0 - (cycleProgress - 0.4) * 10;
            connectAlpha = force;
        } else if (cycleProgress < 0.9) {
            // Fully scattered buffer (no connections drawn for shape petals)
            force = 0;
            connectAlpha = 0.0;
        } else {
            // Reconnect phase
            force = (cycleProgress - 0.9) * 10;
            connectAlpha = force;
            activeShape = 1 + Math.floor((now + cycleTime * 0.1) / 12000) % 3; // Start pulling to NEXT shape
        }
        
        force = Math.max(0, force);
        activeShape = (force > 0) ? activeShape : 0;

        if (activeShape !== currentShapeType && activeShape > 0) {
            currentShapeType = activeShape;
            generateShapeTargets(activeShape);
        }

        // Draw Frame
        ctx.clearRect(0, 0, width, height);

        ctx.save();
        // Apply camera zoom centered on screen
        ctx.translate(width / 2, height / 2);
        ctx.scale(scale, scale);
        ctx.translate(-width / 2, -height / 2);

        // Update particles
        for (let i = 0; i < particles.length; i++) {
            particles[i].update(force);
        }

        // Draw connections
        ctx.lineWidth = 1.2;
        const maxDistance = 140;

        for (let i = 0; i < particles.length; i++) {
            if (particles[i].noConnect) continue; // Skip connections for background free petals
            
            for (let j = i + 1; j < particles.length; j++) {
                if (particles[j].noConnect) continue; // Skip connections for background free petals
                
                const dx = particles[i].x - particles[j].x;
                const dy = particles[i].y - particles[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < maxDistance) {
                    const alpha = (1 - (dist / maxDistance)) * connectAlpha;
                    
                    ctx.strokeStyle = `rgba(225, 29, 72, ${alpha * 0.6})`;
                    ctx.beginPath();
                    ctx.moveTo(particles[i].x, particles[i].y);
                    ctx.lineTo(particles[j].x, particles[j].y);
                    ctx.stroke();
                }
            }
        }

        // Draw petals
        for (let i = 0; i < particles.length; i++) {
            particles[i].draw(ctx);
        }

        ctx.restore();

        requestAnimationFrame(render);
    }

    render();
});
