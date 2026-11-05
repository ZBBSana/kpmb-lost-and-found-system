const firebaseConfig = {
  apiKey: "AIzaSyDfOJr6_jRA2MLCNvQDnudlv4MQT7hVCCc",
  authDomain: "lost-manage-project.firebaseapp.com",
  projectId: "lost-manage-project",
  storageBucket: "lost-manage-project.firebasestorage.app",
  messagingSenderId: "345381154763",
  appId: "1:345381154763:web:574be9b7beb594376fd04e",
  measurementId: "G-NGEF4F8Z85"
};

firebase.initializeApp(firebaseConfig);

window.auth = firebase.auth();
window.db = firebase.firestore();
