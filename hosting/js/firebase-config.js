// Firebase configuration for shorts-factory
const firebaseConfig = {
    apiKey: "AIzaSyCGqmyhUTRmMTZqQ_T-UZwScbe111npAas",
    authDomain: "shorts-factory-a123a.firebaseapp.com",
    projectId: "shorts-factory-a123a",
    storageBucket: "shorts-factory-a123a.firebasestorage.app",
    messagingSenderId: "886372970062",
    appId: "1:886372970062:web:493de77ce05eabbceb1d1f",
    measurementId: "G-551SKHKGRX"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
