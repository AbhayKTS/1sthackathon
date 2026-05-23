const CONFIG = {
    loadingDuration: 6000, // 6 seconds
    redirectUrl: 'landing.html'
};

const LOADING_MESSAGES = [
    "Initializing neural link...",
    "Scanning the backstreets...",
    "Bypassing firewalls...",
    "Gathering the inner circle...",
    "Decrypting the timeline...",
    "Rewriting the destiny..."
];

document.addEventListener('DOMContentLoaded', () => {
    updateTime();
    startLoading();

    // Update time every minute
    setInterval(updateTime, 60000);
});

function updateTime() {
    const timeElement = document.getElementById('current-time');
    if (!timeElement) return;

    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';

    // Format: 02:47 AM (matching screenshot style)
    timeElement.textContent = `${hours % 12 || 12}:${minutes} ${ampm}`;
}

function startLoading() {
    const progressBar = document.querySelector('.progress-bar');
    const percentCount = document.getElementById('percent-count');
    const loadingText = document.getElementById('loadingText');

    let progress = 0;
    const interval = 50; // Update every 50ms
    const step = 100 / (CONFIG.loadingDuration / interval);

    const loadingInterval = setInterval(() => {
        progress += step;
        if (progress >= 100) {
            progress = 100;
            clearInterval(loadingInterval);
            completeLoading();
        }

        // Update UI
        if (progressBar) progressBar.style.width = `${progress}%`;
        if (percentCount) percentCount.textContent = Math.floor(progress);

        // Randomly update text
        if (Math.random() > 0.98) {
            const msg = LOADING_MESSAGES[Math.floor(Math.random() * LOADING_MESSAGES.length)];
            if (loadingText) loadingText.textContent = msg;
        }
    }, interval);
}

function completeLoading() {
    // Add fade out effect
    document.body.style.transition = 'opacity 1s ease-out';
    document.body.style.opacity = '0';

    setTimeout(() => {
        window.location.href = CONFIG.redirectUrl;
    }, 1000);
}
