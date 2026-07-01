/**
 * Squad marquee auto-scroll carousel controller.
 * Extracted from landing.html to comply with the Content-Security-Policy
 * which blocks all inline script execution.
 */
document.addEventListener('DOMContentLoaded', function () {
    const wrapper = document.querySelector('.squad-marquee-wrapper');
    const grid = document.querySelector('.squad-grid');
    const leftArrow = document.querySelector('.left-arrow');
    const rightArrow = document.querySelector('.right-arrow');

    if (!wrapper || !grid || !leftArrow || !rightArrow) return;

    let scrollSpeed = 1;
    let isPaused = false;
    let pauseTimeout;

    // Auto-scroll function — loops seamlessly because the card list is duplicated in HTML
    function scrollMarquee() {
        if (!isPaused) {
            wrapper.scrollLeft += scrollSpeed;

            // Loop logic: reset when reaching half the total scroll width
            // Works because the HTML duplicates exactly one set of cards.
            if (scrollSpeed > 0 && wrapper.scrollLeft >= (grid.scrollWidth / 2)) {
                wrapper.scrollLeft -= (grid.scrollWidth / 2);
            } else if (scrollSpeed < 0 && wrapper.scrollLeft <= 0) {
                wrapper.scrollLeft += (grid.scrollWidth / 2);
            }
        }
        requestAnimationFrame(scrollMarquee);
    }

    // Start auto-scroll
    requestAnimationFrame(scrollMarquee);

    // Pause on hover — stop auto-scroll while user inspects a card
    const pauseElements = [grid, leftArrow, rightArrow];
    pauseElements.forEach(el => {
        el.addEventListener('mouseenter', () => { isPaused = true; });
        el.addEventListener('mouseleave', () => {
            // Only unpause if we aren't in a click-scroll cooldown
            if (!pauseTimeout) isPaused = false;
        });
    });

    function pauseForScroll() {
        isPaused = true;
        clearTimeout(pauseTimeout);
        pauseTimeout = setTimeout(() => {
            pauseTimeout = null;
            // Only resume if mouse is not hovering any control element
            if (!grid.matches(':hover') && !leftArrow.matches(':hover') && !rightArrow.matches(':hover')) {
                isPaused = false;
            }
        }, 600); // 600ms — allows smooth scroll to finish before resuming
    }

    // Arrow click handlers — manual scroll with auto-scroll cooldown
    leftArrow.addEventListener('click', () => {
        pauseForScroll();
        wrapper.scrollBy({ left: -310, behavior: 'smooth' }); // card width + gap
    });

    rightArrow.addEventListener('click', () => {
        pauseForScroll();
        wrapper.scrollBy({ left: 310, behavior: 'smooth' }); // card width + gap
    });
});
