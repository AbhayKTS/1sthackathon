# Security Policy — RevengersHack

**Website:** [revengershack.tech](https://revengershack.tech)

---

## Reporting Vulnerabilities

**Email:** security@revengershack.tech  
**Response time:** 24 hours  

> ⚠️ Please do **not** open public issues for security bugs. Report them privately via email.

---

## Scope

- Registration data protection  
- Admin access protection  
- API endpoint security  
- DDoS mitigation via Cloudflare  
- Firebase Authentication & Firestore Security Rules  
- Input sanitization and validation on all forms  
- Session management and inactivity timeout  

---

## Security Measures Implemented

| Layer | Protection |
|-------|-----------|
| HTTP Headers | X-Frame-Options, HSTS, CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy |
| Authentication | Firebase Auth (Email/Password + Google OAuth) |
| Admin Panel | Hidden route, role-based access, login lockout (5 attempts → 15 min lock) |
| Session | 30-minute inactivity auto-logout |
| Forms | Input sanitization, email/phone validation, client-side rate limiting (5/hour) |
| API | Helmet, CORS whitelist, express-rate-limit (100 req/15 min), payload size limit |
| Database | Firestore Security Rules (parameterized queries by design) |

---

## Firestore Security Rules (Recommended)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection — users can only read their own document
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if false; // Admin SDK only
    }
    
    // Join leads — rate limit: 1 write per 10 seconds per user
    match /joinGangLeads/{docId} {
      allow create: if request.auth != null
        && request.resource.data.keys().hasAll(['name', 'email', 'number', 'teamName'])
        && request.resource.data.name is string
        && request.resource.data.email is string;
      allow read, update, delete: if false;
    }
    
    // Admin-only collections
    match /teams/{teamId} {
      allow read: if request.auth != null;
      allow write: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    match /rounds/{roundId} {
      allow read: if request.auth != null;
      allow write: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    match /announcements/{annId} {
      allow read: if request.auth != null;
      allow create: if get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    
    match /submissions/{subId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
    }
  }
}
```

---

© 2025 RevengersHack — All Rights Reserved.
