/* PixelArena — Firebase web config.
 * The apiKey here is a public client identifier (normal for Firebase web apps);
 * real security is enforced by the Firestore security rules in the console.
 */
window.PA_FIREBASE = {
  apiKey: "AIzaSyBqaribueOb34Mtn-Gh8SCC6So2QNEHu_k",
  authDomain: "pixelarena-1a3e5.firebaseapp.com",
  projectId: "pixelarena-1a3e5",
  storageBucket: "pixelarena-1a3e5.firebasestorage.app",
  messagingSenderId: "921258505777",
  appId: "1:921258505777:web:582cb89167edf5f8520710",
  measurementId: "G-YFH2LP8XFK"
};

/* Initialize the Firebase app as soon as the compat SDK is present.
 * leaderboard.js guards every Firestore call, so a missing/failed SDK
 * simply means "local leaderboards only" — the site never breaks. */
try {
  if (window.PA_FIREBASE && window.firebase && window.firebase.initializeApp &&
      !(window.firebase.apps && window.firebase.apps.length)) {
    window.firebase.initializeApp(window.PA_FIREBASE);
  }
} catch (e) { /* offline or SDK blocked — local mode */ }
