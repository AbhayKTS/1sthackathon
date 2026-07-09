/**
 * firebase-init.js — Shared Firebase initialization module.
 *
 * Centralizes the Firebase app, Auth, and Firestore instances so that
 * pages like profile.js and support.js can import from a single source
 * without duplicating the configuration.
 */

import { initializeApp } from "firebase/app";
import { getAuth, onAuthStateChanged, signOut, connectAuthEmulator } from "firebase/auth";
import {
    getFirestore,
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    where,
    getDocs,
    addDoc,
    serverTimestamp,
    onSnapshot,
    orderBy,
    limit,
    updateDoc,
    deleteDoc,
    Timestamp,
    connectFirestoreEmulator
} from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBA9iXHl8WQdmoJ7QUiABxu7AXfizeRzfk",
    authDomain: "sthack-88def.firebaseapp.com",
    projectId: "sthack-88def",
    storageBucket: "sthack-88def.firebasestorage.app",
    messagingSenderId: "676755311648",
    appId: "1:676755311648:web:77041fc026d8a7b5910045"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    connectAuthEmulator(auth, "http://127.0.0.1:9099");
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3001/api'
    : 'https://revengershack.vercel.app/api';

export {
    app,
    auth,
    db,
    doc,
    getDoc,
    setDoc,
    collection,
    query,
    where,
    getDocs,
    addDoc,
    serverTimestamp,
    onSnapshot,
    orderBy,
    limit,
    updateDoc,
    deleteDoc,
    Timestamp,
    onAuthStateChanged,
    signOut,
    API_BASE
};
