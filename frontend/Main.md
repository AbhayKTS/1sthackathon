# RevengersHack National Level Hackathon
 
## Phase 2 to Phase 6 - Complete Technical Workflow & System Design
 
**Version:** 1.0
**Purpose:** Internal Development Documentation
**Target Audience:** Development Team & Organizers
 
---
 
# Overview
 
After Round 1 (PPT Submission) is completed on **Unstop**, only the shortlisted teams will enter the RevengersHack ecosystem.
 
The website is **not a registration portal**.
 
Instead, it acts as a **Hackathon Management Platform (HMP)** where selected participants complete verification, manage their teams, receive announcements, access problem statements, submit projects, and communicate with organizers.
 
The complete workflow is:
 
```
Unstop Registration
        │
        ▼
Round 1 (PPT Submission)
        │
        ▼
Shortlisting by Organizers
        │
        ▼
Export Selected Teams
        │
        ▼
Email Invitation
        │
        ▼
Website Verification
        │
        ▼
Complete Team Details
        │
        ▼
Admin Approval
        │
        ▼
Hackathon Dashboard Unlock
```
 
---
 
# Phase 2 – Shortlisted Team Invitation
 
## Objective
 
Invite only shortlisted teams to the official RevengersHack portal.
 
---
 
## Organizer Workflow
 
After evaluation,
 
Example
 
```
1200 Registered Teams
 
↓
 
1000 PPT Submitted
 
↓
 
40 Teams Selected
```
 
Export the selected team details from Unstop.
 
Example CSV
 
```
Team Name
 
Leader Name
 
Leader Email
 
Leader Phone
 
College
 
City
 
State
```
 
Import this CSV into your database.
 
---
 
## Database
 
Create a collection/table
 
```
InvitedTeams
```
 
Fields
 
```
id
 
teamName
 
leaderName
 
leaderEmail
 
leaderPhone
 
college
 
status
 
invitedAt
 
verificationStatus
 
verificationToken
 
round
```
 
Initially
 
```
status = Invited
```
 
---
 
## Email Automation
 
Automatically send emails.
 
Example
 
Subject
 
```
Congratulations!
You have been shortlisted for Round 2
```
 
Body
 
```
Dear Team,
 
Congratulations!
 
Your team has been shortlisted for Round 2 of RevengersHack.
 
Please complete your verification before the deadline.
 
Verification Link
 
https://revengershack.tech/verify
 
Deadline:
...
 
Regards
Team RevengersHack
```
 
---
 
## Dashboard Status
 
Admin Panel
 
```
40 Invited
 
38 Email Delivered
 
2 Failed
```
 
---
 
# Phase 3 – Verification Portal
 
## Objective
 
Verify that only shortlisted participants can access the hackathon dashboard.
 
---
 
## Verification Flow
 
```
Invitation Link
 
↓
 
Leader Email
 
↓
 
OTP Verification
 
↓
 
Email Verified
 
↓
 
Create Password
 
↓
 
Dashboard Access
```
 
---
 
## Verification Page
 
Fields
 
```
Leader Email
 
OTP
 
Create Password
 
Confirm Password
```
 
---
 
## Backend Logic
 
If email exists
 
```
Allow OTP
```
 
Otherwise
 
```
Access Denied
 
This email was not shortlisted.
```
 
---
 
## Database Update
 
Before
 
```
verificationStatus = Pending
```
 
After
 
```
verificationStatus = Verified
```
 
---
 
## Security
 
Use
 
Firebase Authentication
 
or
 
Email OTP Authentication
 
Never allow public registration.
 
---
 
# Phase 4 – Team Completion
 
## Objective
 
Collect complete participant details.
 
---
 
After login
 
Dashboard should immediately show
 
```
Complete Team Profile
```
 
Until completed
 
Dashboard remains locked.
 
---
 
## Team Details Form
 
### Team Information
 
```
Team Name
 
College Name
 
Department
 
Year
 
State
 
City
```
 
---
 
### Team Leader
 
```
Full Name
 
Email
 
Phone Number
 
GitHub
 
LinkedIn
```
 
---
 
### Team Members
 
Support
 
Minimum
 
```
2
```
 
Maximum
 
```
5
```
 
Each member
 
```
Name
 
Email
 
Phone
 
College
 
GitHub
 
LinkedIn
```
 
---
 
### Optional
 
```
Resume
 
Profile Photo
 
College ID
 
T-Shirt Size
 
Food Preference
```
 
---
 
## Validation
 
Check
 
Duplicate Email
 
Duplicate Phone
 
Maximum Team Size
 
Required Fields
 
Email Format
 
Phone Format
 
---
 
## Team Status
 
```
Incomplete
 
↓
 
Submitted
 
↓
 
Under Review
 
↓
 
Approved
```
 
---
 
# Admin Review
 
Dashboard
 
```
Pending Teams
 
35
```
 
Click
 
```
View Team
```
 
Display
 
Entire Team Information
 
Documents
 
Contacts
 
---
 
Buttons
 
```
Approve
 
Reject
 
Need Changes
```
 
---
 
Need Changes
 
Example
 
```
Member 2 email missing.
 
Please update.
```
 
Leader receives notification.
 
---
 
# Phase 5 – Admin Approval
 
## Objective
 
Verify every team before allowing participation.
 
---
 
Admin Dashboard
 
Statistics
 
```
Pending
 
Approved
 
Rejected
 
Need Changes
```
 
---
 
Team Card
 
```
Team Name
 
Leader
 
College
 
Members
 
Verification
 
Current Status
```
 
---
 
Actions
 
Approve
 
Reject
 
Need Changes
 
Add Notes
 
---
 
Automation
 
If Approved
 
```
Email
 
↓
 
Dashboard Unlock
 
↓
 
Round 2 Access
```
 
---
 
If Rejected
 
```
Email
 
↓
 
Status Updated
```
 
---
 
If Need Changes
 
```
Email
 
↓
 
Dashboard Notification
 
↓
 
Edit Enabled
```
 
---
 
# Phase 6 – Hackathon Dashboard
 
Only Approved Teams can access.
 
---
 
## Dashboard Sections
 
---
 
### 1. Welcome Section
 
```
Welcome
 
Team Name
 
Leader Name
 
Current Round
 
Countdown Timer
```
 
---
 
### 2. Timeline
 
```
Round Start
 
Submission Deadline
 
Mentoring
 
Final Presentation
 
Results
```
 
---
 
### 3. Announcements
 
Organizer Posts
 
```
Important Updates
 
Rule Changes
 
Schedule Updates
 
Meeting Links
```
 
Unread announcements should display notification badges.
 
---
 
### 4. Problem Statements
 
Cards
 
```
AI
 
Cybersecurity
 
Healthcare
 
Open Innovation
 
Education
```
 
Each contains
 
Description
 
Rules
 
Deliverables
 
Evaluation Criteria
 
---
 
### 5. Resources
 
Links
 
```
Rulebook
 
PPT Template
 
GitHub Guide
 
API Keys
 
Sponsor APIs
 
Dataset
 
Documentation
```
 
---
 
### 6. Discord
 
```
Join Discord
 
Server Rules
 
Channel List
 
Support
```
 
---
 
### 7. FAQs
 
Searchable
 
```
Payments
 
Eligibility
 
Submission
 
Certificates
 
Technical Issues
```
 
---
 
### 8. Support
 
```
Raise Ticket
 
Contact Organizer
 
Emergency Number
 
Email Support
```
 
---
 
### 9. Submission
 
Fields
 
```
GitHub Repository
 
Live Demo
 
Presentation
 
Demo Video
 
Documentation
 
Additional Notes
```
 
Button
 
```
Submit Project
```
 
---
 
### 10. Submission Status
 
```
Draft
 
Submitted
 
Locked
 
Reviewed
```
 
---
 
### 11. Team Management
 
Leader can
 
```
Edit Team
 
Invite Members
 
Remove Member
 
View Status
```
 
Only before deadline.
 
---
 
### 12. Notifications
 
Real-time
 
```
Approval
 
Announcements
 
Submission Updates
 
Deadline Reminder
 
Mentor Messages
```
 
---
 
### 13. Profile
 
```
Leader Details
 
College
 
Members
 
Edit Profile
 
Logout
```
 
---
 
# Suggested Database Structure
 
```
Users
│
├── userId
├── role
├── email
├── verified
 
Teams
│
├── teamId
├── teamName
├── leaderId
├── members[]
├── status
├── college
├── city
├── state
 
Invitations
│
├── invitationId
├── email
├── token
├── expiry
 
Announcements
│
├── title
├── body
├── createdAt
 
Submissions
│
├── github
├── demo
├── ppt
├── video
├── documentation
 
SupportTickets
│
├── user
├── subject
├── status
├── priority
```
 
---
 
# Recommended Tech Stack
 
**Frontend**
 
* Next.js (App Router)
* React
* TypeScript
* Tailwind CSS
* Framer Motion
* GSAP (for your Tokyo Revengers theme)
 
**Backend**
 
* Firebase Authentication (Email OTP/Login)
* Firestore Database
* Firebase Cloud Functions
* Firebase Storage
* Firebase Hosting
 
**Automation**
 
* Firebase Cloud Functions for:
 
  * Email invitations
  * Approval emails
  * Reminder emails
  * Dashboard notifications
* Brevo or Resend for transactional emails
 
**Admin Panel**
 
* Role-based authentication
* Analytics dashboard
* Team management
* Announcement manager
* Submission review
* Audit logs
 
---
 
# Future Enhancements (Optional but Impressive)
 
To make RevengersHack stand out from typical hackathon portals:
 
* **QR Code Check-in:** Generate a QR code for each approved team for offline verification.
* **Live Leaderboard:** Display submission status, mentor points, or challenge progress.
* **AI Support Bot:** An integrated chatbot that answers FAQs, explains rules, and helps participants navigate the portal.
* **Mentor Booking:** Allow teams to book mentor sessions with available time slots.
* **Certificate Automation:** Generate personalized certificates for participants, finalists, winners, mentors, and organizers automatically after the event.
* **Judge Portal:** A separate interface where judges can review submissions, score teams using predefined rubrics, and publish results directly to the leaderboard.
 
This architecture is scalable enough to comfortably handle **40-100 shortlisted teams** while keeping the organizers' workload low through automation, and it leaves room to expand into a full-fledged hackathon management platform for future editions of RevengersHack.