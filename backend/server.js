import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Serve static files from root directory
app.use(express.static(path.join(__dirname, '..')));

// Serve frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Basic status route
app.get('/api/status', (req, res) => {
    res.json({ status: 'Backend is working', timestamp: new Date() });
});

// Mock Contact form submission
app.post('/api/contact', (req, res) => {
    const { name, email, message } = req.body;
    console.log(`Received contact request from ${name} (${email})`);
    res.status(201).json({ message: 'Intel received successfully. We will find you.' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
