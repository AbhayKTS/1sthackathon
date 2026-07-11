import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;
const isProduction = process.env.NODE_ENV === 'production';

// ─── SECURITY MIDDLEWARE ────────────────────────────────────────
// Helmet sets secure HTTP headers
app.use(helmet({
    contentSecurityPolicy: false, // Managed by Firebase Hosting headers in production
    crossOriginEmbedderPolicy: false
}));

// CORS — restrict to known origins
const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5000',
    'https://sthack-88def.web.app',
    'https://sthack-88def.firebaseapp.com',
    'https://revengershack.tech',
    'https://www.revengershack.tech'
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl) in dev
        if (!origin && !isProduction) return callback(null, true);
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Global rate limiter: 100 requests per IP per 15 minutes
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.', code: 429 }
});
app.use(globalLimiter);

// Stricter rate limit for form submissions
const formLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many submissions. Please try again after an hour.', code: 429 }
});

app.use(express.json({ limit: '10kb' })); // Limit payload size

// ─── STATIC FILES ───────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..')));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── INPUT SANITIZATION HELPER ──────────────────────────────────
function sanitize(str) {
    if (typeof str !== 'string') return '';
    return str.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;');
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ─── API ROUTES ─────────────────────────────────────────────────
// Basic status route
app.get('/api/status', (req, res) => {
    res.json({ status: 'Backend is operational', timestamp: new Date() });
});

// Contact form submission — with rate limiting & validation
app.post('/api/contact', formLimiter, (req, res) => {
    const { name, email, message } = req.body;

    // Validate required fields
    if (!name || !email || !message) {
        return res.status(400).json({ error: 'All fields (name, email, message) are required.' });
    }

    // Validate email format
    if (!isValidEmail(email)) {
        return res.status(400).json({ error: 'Invalid email format.' });
    }

    // Sanitize inputs
    const safeName = sanitize(name);
    const safeEmail = sanitize(email);
    const safeMessage = sanitize(message);

    // Length checks
    if (safeName.length > 100 || safeEmail.length > 254 || safeMessage.length > 2000) {
        return res.status(400).json({ error: 'Input too long.' });
    }

    console.log(`Received contact request from ${safeName} (${safeEmail})`);
    res.status(201).json({ message: 'Intel received successfully. We will find you.' });
});

// ─── ERROR HANDLING ─────────────────────────────────────────────
// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found.' });
});

// Global error handler — never expose stack traces in production
app.use((err, req, res, _next) => {
    if (isProduction) {
        console.error('Server error:', err.message);
        res.status(500).json({ error: 'Internal server error.' });
    } else {
        console.error('Server error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
