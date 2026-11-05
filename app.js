const app = document.getElementById("app");

const { auth, db } = window;

const CATEGORIES = [
  "Electronics",
  "Wallet",
  "Keys",
  "Identification Card",
  "Bag",
  "Books",
  "Clothing",
  "Accessories",
  "Other"
];

const REPORT_STATUSES = [
  "active",
  "matched",
  "claimed",
  "returned",
  "unclaimed",
  "disposed"
];

const state = {
  ready: false,
  user: null,
  profile: null
};

/* -----------------------------------
   GENERAL HELPER FUNCTIONS
----------------------------------- */

function now() {
  return firebase.firestore.Timestamp.now();
}

function route() {
  const value = (window.location.hash || "#/home")
    .replace(/^#\/?/, "");

  return value || "home";
}

function go(path) {
  window.location.hash = `#/${path}`;
}

function getRouteParts() {
  const parts = route()
    .split("/")
    .filter(part => part.trim() !== "");

  return [
    parts[0] || "home",
    parts[1] || null
  ];
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showLoading() {
  app.innerHTML = `
    <div class="loading-screen">
      <div class="spinner"></div>
      <p>Loading KPMB Lost and Found System...</p>
    </div>
  `;
}

function showSystemError(error) {
  console.error(error);

  app.innerHTML = `
    <div class="loading-screen">
      <div class="alert alert-error" style="max-width: 620px;">
        <strong>System Error</strong><br>
        ${escapeHtml(error.message || "An unexpected error occurred.")}
        <br><br>
        Open browser Developer Tools using F12 and check the Console tab.
      </div>
    </div>
  `;
}

function setFlash(message, type = "success") {
  sessionStorage.setItem(
    "flash",
    JSON.stringify({ message, type })
  );
}

function getFlash() {
  const raw = sessionStorage.getItem("flash");

  if (!raw) {
    return "";
  }

  sessionStorage.removeItem("flash");

  const flash = JSON.parse(raw);

  return `
    <div class="alert alert-${flash.type}">
      ${escapeHtml(flash.message)}
    </div>
  `;
}

function showFormMessage(message, type = "error") {
  const element = document.getElementById("formMessage");

  if (!element) {
    return;
  }

  element.innerHTML = `
    <div class="alert alert-${type}">
      ${escapeHtml(message)}
    </div>
  `;
}

function firebaseError(error = {}) {
  const errors = {
    "auth/email-already-in-use":
      "This email address is already registered.",

    "auth/invalid-email":
      "Please enter a valid email address.",

    "auth/weak-password":
      "Password must contain at least 6 characters.",

    "auth/invalid-credential":
      "Incorrect email address or password.",

    "auth/user-not-found":
      "No account was found using this email address.",

    "auth/wrong-password":
      "Incorrect email address or password.",

    "auth/too-many-requests":
      "Too many login attempts. Please try again later.",

    "permission-denied":
      "You do not have permission to perform this action.",

    "storage/unauthorized":
      "You do not have permission to upload this file.",

    "storage/canceled":
      "The image upload was cancelled.",

    "storage/unknown":
      "An unknown image-upload error occurred."
  };

  return (
    errors[error.code] ||
    error.message ||
    "An unexpected error occurred."
  );
}

function mapDocument(document) {
  return {
    id: document.id,
    ...document.data()
  };
}

function convertDate(value) {
  if (!value) {
    return null;
  }

  if (value.toDate) {
    return value.toDate();
  }

  return new Date(value);
}

function formatDate(value) {
  const date = convertDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatDateTime(value) {
  const date = convertDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString("en-MY", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toDateTimeLocal(value) {
  const date = convertDate(value);

  if (!date || Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset() * 60000;

  return new Date(date.getTime() - offset)
    .toISOString()
    .slice(0, 16);
}

function statusLabel(status = "active") {
  return String(status)
    .split("_")
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function statusBadge(status = "active") {
  return `
    <span class="status-tag status-${escapeHtml(status)}">
      ${escapeHtml(statusLabel(status))}
    </span>
  `;
}

function categoryOptions(selected = "") {
  return CATEGORIES.map(category => `
    <option value="${category}" ${selected === category ? "selected" : ""}>
      ${category}
    </option>
  `).join("");
}

function reportStatusOptions(selected = "active") {
  return REPORT_STATUSES.map(status => `
    <option value="${status}" ${selected === status ? "selected" : ""}>
      ${statusLabel(status)}
    </option>
  `).join("");
}

function truncate(text = "", length = 100) {
  const content = String(text || "");

  if (content.length <= length) {
    return content;
  }

  return `${content.slice(0, length)}...`;
}

function isActiveReport(report) {
  return ["active", "matched"].includes(report.reportStatus);
}

function isOlderThanThirtyDays(report) {
  const reportDate = convertDate(
    report.dateOccurred || report.createdAt
  );

  if (!reportDate) {
    return false;
  }

  const today = new Date();
  const difference = today - reportDate;

  return difference >= 30 * 24 * 60 * 60 * 1000;
}

/* -----------------------------------
   FIRESTORE DATA FUNCTIONS
----------------------------------- */

async function getProfile(userId) {
  const snapshot = await db
    .collection("users")
    .doc(userId)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  return {
    userId: snapshot.id,
    ...snapshot.data()
  };
}

async function getReport(reportId) {
  if (!reportId) {
    return null;
  }

  const snapshot = await db
    .collection("itemReports")
    .doc(reportId)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  return mapDocument(snapshot);
}

async function getAllReports() {
  const snapshot = await db
    .collection("itemReports")
    .get();

  return snapshot.docs
    .map(mapDocument)
    .sort((a, b) => {
      const dateA = convertDate(a.createdAt)?.getTime() || 0;
      const dateB = convertDate(b.createdAt)?.getTime() || 0;

      return dateB - dateA;
    });
}

async function getMyReports() {
  const snapshot = await db
    .collection("itemReports")
    .where("reporterId", "==", state.user.uid)
    .get();

  return snapshot.docs
    .map(mapDocument)
    .sort((a, b) => {
      const dateA = convertDate(a.createdAt)?.getTime() || 0;
      const dateB = convertDate(b.createdAt)?.getTime() || 0;

      return dateB - dateA;
    });
}

async function getMyClaims() {
  const snapshot = await db
    .collection("ownershipClaims")
    .where("claimantId", "==", state.user.uid)
    .get();

  return snapshot.docs
    .map(mapDocument)
    .sort((a, b) => {
      const dateA = convertDate(a.submittedAt)?.getTime() || 0;
      const dateB = convertDate(b.submittedAt)?.getTime() || 0;

      return dateB - dateA;
    });
}

async function getNotifications() {
  let snapshot;

  if (state.profile.role === "mpp_admin") {
    snapshot = await db
      .collection("notifications")
      .where("recipientRole", "==", "mpp_admin")
      .get();
  } else {
    snapshot = await db
      .collection("notifications")
      .where("recipientId", "==", state.user.uid)
      .get();
  }

  return snapshot.docs
    .map(mapDocument)
    .sort((a, b) => {
      const dateA = convertDate(a.createdAt)?.getTime() || 0;
      const dateB = convertDate(b.createdAt)?.getTime() || 0;

      return dateB - dateA;
    });
}

async function createNotification(
  recipientId,
  recipientRole,
  type,
  title,
  message,
  reportId = null,
  claimId = null
) {
  await db.collection("notifications").add({
    recipientId,
    recipientRole,
    notificationType: type,
    title,
    message,
    relatedReportId: reportId,
    relatedClaimId: claimId,
    isRead: false,
    createdAt: now()
  });
}

/* -----------------------------------
   NAVIGATION
----------------------------------- */

function guestNavigation() {
  return `
    <nav class="navbar">
      <a href="#/home" class="brand">
        <div class="brand-icon">LF</div>

        <div>
          <h1>KPMB Lost & Found</h1>
          <p>Web-Based Management System</p>
        </div>
      </a>

      <div class="nav-links">
        <a href="#/home">Home</a>
        <a href="#/login">Login</a>
        <a href="#/register">Student Registration</a>
      </div>
    </nav>
  `;
}

function studentNavigation() {
  return `
    <nav class="navbar">
      <a href="#/student-dashboard" class="brand">
        <div class="brand-icon">LF</div>

        <div>
          <h1>KPMB Lost & Found</h1>
          <p>Student Portal</p>
        </div>
      </a>

      <div class="nav-links">
        <a href="#/student-dashboard">Dashboard</a>
        <a href="#/report">Report Item</a>
        <a href="#/browse">Browse Items</a>
        <a href="#/my-reports">My Reports</a>
        <a href="#/my-matches">Matches</a>
        <a href="#/my-claims">My Claims</a>
        <a href="#/notifications">Notifications</a>

        <span class="user-badge">
          ${escapeHtml(state.profile.fullName)}
        </span>

        <button id="logoutButton">Logout</button>
      </div>
    </nav>
  `;
}

function mppNavigation() {
  return `
    <nav class="navbar">
      <a href="#/mpp-dashboard" class="brand">
        <div class="brand-icon">LF</div>

        <div>
          <h1>KPMB Lost & Found</h1>
          <p>MPP Administrator Portal</p>
        </div>
      </a>

      <div class="nav-links">
        <a href="#/mpp-dashboard">Dashboard</a>
        <a href="#/manage-reports">Manage Reports</a>
        <a href="#/manage-claims">Manage Claims</a>
        <a href="#/unclaimed-items">Unclaimed Items</a>
        <a href="#/returned-history">History</a>
        <a href="#/mpp-report">Monthly PDF Report</a>
        <a href="#/notifications">Notifications</a>

        <span class="user-badge">
          ${escapeHtml(state.profile.fullName)}
        </span>

        <button id="logoutButton">Logout</button>
      </div>
    </nav>
  `;
}

function footer() {
  return `
    <footer class="footer">
      <p>
        KPMB Web-Based Lost and Found Management System
        &copy; 2026
      </p>
    </footer>
  `;
}

function layout(content) {
  let navigation = guestNavigation();
  let themeClass = "theme-guest";

  if (state.user && state.profile?.role === "student") {
    navigation = studentNavigation();
    themeClass = "theme-student";
  }

  if (state.user && state.profile?.role === "mpp_admin") {
    navigation = mppNavigation();
    themeClass = "theme-mpp";
  }

  return `
    <div class="app-shell ${themeClass}">
      ${navigation}

      <main class="container">
        ${getFlash()}
        ${content}
      </main>

      ${footer()}
    </div>
  `;
}

/* -----------------------------------
   PUBLIC PAGES
----------------------------------- */

function homePage() {
  return `
    <section class="hero">
      <h1>KPMB Lost and Found Management System</h1>

      <p>
        A centralized platform for KPMB students to report lost
        and found items, upload photographs, search records,
        submit ownership claims, and receive item updates.
      </p>

      <div class="hero-buttons">
        <a href="#/register" class="btn btn-light">
          Register as Student
        </a>

        <a href="#/login" class="btn btn-secondary">
          Login
        </a>
      </div>
    </section>

    <section class="page-heading">
      <h2>System Features</h2>

      <p>
        The system reduces dependency on WhatsApp and provides
        a structured digital record for KPMB lost and found activities.
      </p>
    </section>

    <section class="grid grid-3">
      <article class="dashboard-card">
        <h3>Report Items</h3>
        <p>
          Students can report lost or found items with details,
          location, date, contact information, and photos.
        </p>
      </article>

      <article class="dashboard-card">
        <h3>Search and Filter</h3>
        <p>
          Browse lost and found records using keywords, location,
          category, date, report type, and report status.
        </p>
      </article>

      <article class="dashboard-card">
        <h3>Ownership Claims</h3>
        <p>
          Students can submit evidence while MPP members verify
          ownership before returning valuable items.
        </p>
      </article>
    </section>
  `;
}

function registerPage() {
  return `
    <section class="page-heading">
      <h2>Student Registration</h2>

      <p>
        KPMB students can register from this page. MPP administrator
        accounts are created manually by the developer or authorised MPP members.
      </p>
    </section>

    <section class="card form-card">
      <h3 class="card-title">Create Student Account</h3>

      <div id="formMessage"></div>

      <form id="registerForm">
        <div class="form-group">
          <label for="fullName">Full Name *</label>
          <input
            type="text"
            id="fullName"
            required
            placeholder="Enter your full name"
          >
        </div>

        <div class="form-group">
          <label for="studentId">Student ID *</label>
          <input
            type="text"
            id="studentId"
            required
            placeholder="Example: BCS2403-038"
          >
        </div>

        <div class="form-group">
          <label for="email">KPMB Email Address *</label>
          <input
            type="email"
            id="email"
            required
            placeholder="Enter your email address"
          >
        </div>

        <div class="form-group">
          <label for="phoneNumber">Phone Number *</label>
          <input
            type="tel"
            id="phoneNumber"
            required
            placeholder="Example: 0123456789"
          >
        </div>

        <div class="form-group">
          <label for="password">Password *</label>
          <input
            type="password"
            id="password"
            minlength="6"
            required
            placeholder="At least 6 characters"
          >
        </div>

        <div class="form-group">
          <label for="confirmPassword">Confirm Password *</label>
          <input
            type="password"
            id="confirmPassword"
            minlength="6"
            required
            placeholder="Re-enter password"
          >
        </div>

        <button type="submit" class="btn btn-primary">
          Register Student Account
        </button>
      </form>

      <p class="form-note">
        Already registered?
        <a href="#/login"><strong>Login here</strong></a>.
      </p>
    </section>
  `;
}

function loginPage() {
  return `
    <section class="page-heading">
      <h2>System Login</h2>

      <p>
        Students and authorised MPP members can log in using
        their registered email address and password.
      </p>
    </section>

    <section class="card form-card">
      <h3 class="card-title">Login</h3>

      <div id="formMessage"></div>

      <form id="loginForm">
        <div class="form-group">
          <label for="loginEmail">Email Address *</label>

          <input
            type="email"
            id="loginEmail"
            required
            placeholder="Enter your email address"
          >
        </div>

        <div class="form-group">
          <label for="loginPassword">Password *</label>

          <input
            type="password"
            id="loginPassword"
            required
            placeholder="Enter your password"
          >
        </div>

        <button type="submit" class="btn btn-primary">
          Login
        </button>
      </form>

      <p class="form-note">
        New student?
        <a href="#/register">
          <strong>Register an account here</strong>
        </a>.
      </p>
    </section>
  `;
}

/* -----------------------------------
   STUDENT DASHBOARD
----------------------------------- */

async function studentDashboardPage() {
  const [reports, claims, notifications, matches] = await Promise.all([
    getMyReports(),
    getMyClaims(),
    getNotifications(),
    getMyMatchSuggestions()
  ]);

  const unread = notifications.filter(item => !item.isRead).length;

  return `
    <section class="page-heading">
      <h2>Student Dashboard</h2>

      <p>
        Welcome, <strong>${escapeHtml(state.profile.fullName)}</strong>.
        Use the system to report, search, and claim items.
      </p>

      <span class="role-tag role-student">
        Student Account
      </span>
    </section>

    <section class="grid grid-3">
      <article class="dashboard-card">
        <h3>My Reports</h3>
        <div class="stat-number">${reports.length}</div>
        <p>Total lost-item and found-item reports submitted by you.</p>

        <a class="btn btn-outline" href="#/my-reports">
          View My Reports
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Possible Matches</h3>
        <div class="stat-number">${matches.length}</div>
        <p>Possible matches between your lost and found item reports.</p>

        <a class="btn btn-outline" href="#/my-matches">
          View Matches
        </a>
      </article>

      <article class="dashboard-card">
        <h3>My Claims</h3>
        <div class="stat-number">${claims.length}</div>
        <p>Ownership claims submitted for found-item reports.</p>

        <a class="btn btn-outline" href="#/my-claims">
          View My Claims
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Unread Notifications</h3>
        <div class="stat-number">${unread}</div>
        <p>Possible matches, claim decisions, and report-status updates.</p>

        <a class="btn btn-outline" href="#/notifications">
          View Notifications
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Report Lost Item</h3>
        <p>Submit a report for an item that you lost at KPMB.</p>

        <a class="btn btn-primary" href="#/report">
          Report Item
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Browse Items</h3>
        <p>Search lost and found records to identify possible matches.</p>

        <a class="btn btn-primary" href="#/browse">
          Browse Items
        </a>
      </article>
    </section>

     <section class="page-heading" style="margin-top: 30px;">
      <h2>My Items: Live Status</h2>

      <p>
        The current status updates automatically when it changes.
        A possible match is a suggestion and does not automatically
        change the official item status.
      </p>
    </section>

    <section id="liveItemStatuses">
      <p>Loading your item statuses...</p>
    </section>
  `;
}


/* -----------------------------------
   STUDENT LIVE ITEM STATUS
----------------------------------- */

// This stores the function used to stop the Firestore listener.
let stopStudentStatusListener = null;

function stopStudentLiveStatus() {
  if (stopStudentStatusListener) {
    stopStudentStatusListener();
    stopStudentStatusListener = null;
  }
}

function startStudentLiveStatus() {
  // Make sure an older listener is stopped first.
  stopStudentLiveStatus();

  if (!state.user || state.profile?.role !== "student") {
    return;
  }

  const userId = state.user.uid;

  const container = document.getElementById("liveItemStatuses");

  if (!container) {
    return;
  }

  stopStudentStatusListener = db
    .collection("itemReports")
    .where("reporterId", "==", userId)
    .onSnapshot(
      snapshot => {
        // Do not update the page if the user has navigated away.
        if (
          route() !== "student-dashboard" ||
          !state.user ||
          state.user.uid !== userId
        ) {
          return;
        }

        const currentContainer =
          document.getElementById("liveItemStatuses");

        if (!currentContainer) {
          return;
        }

        const reports = snapshot.docs
          .map(mapDocument)
          .sort((first, second) => {
            const firstDate =
              convertDate(first.createdAt)?.getTime() || 0;

            const secondDate =
              convertDate(second.createdAt)?.getTime() || 0;

            return secondDate - firstDate;
          });

        if (reports.length === 0) {
          currentContainer.innerHTML = `
            <section class="card">
              <h3 class="card-title">No Reports Yet</h3>

              <p>You have not submitted an item report.</p>

              <a href="#/report" class="btn btn-primary">
                Report an Item
              </a>
            </section>
          `;

          return;
        }

        currentContainer.innerHTML = reports.map(report => {
          const reportId = encodeURIComponent(report.id);

          return `
            <article class="card" style="margin-bottom: 15px;">
              <h3 class="card-title">
                ${escapeHtml(report.itemName || "Unnamed item")}
              </h3>

              <p>
                <strong>Report type:</strong>
                ${escapeHtml(statusLabel(report.reportType))}
              </p>

              <p>
                <strong>Location:</strong>
                ${escapeHtml(report.location || "-")}
              </p>

              <p>
                <strong>Date:</strong>
                ${formatDate(report.dateOccurred)}
              </p>

              <p>
                <strong>Current status:</strong>
                ${statusBadge(report.reportStatus)}
              </p>

              <div style="margin-top: 12px;">
                <a
                  href="#/item/${reportId}"
                  class="btn btn-outline btn-small"
                >
                  View Report
                </a>

                <a
                  href="#/matches/${reportId}"
                  class="btn btn-outline btn-small"
                >
                  View Possible Matches
                </a>
              </div>
            </article>
          `;
        }).join("");
      },

      error => {
        console.error("Live item status error:", error);

        const currentContainer =
          document.getElementById("liveItemStatuses");

        if (currentContainer && route() === "student-dashboard") {
          currentContainer.innerHTML = `
            <div class="alert alert-error">
              Unable to load live item statuses.
              Check the browser Console for details.
            </div>
          `;
        }
      }
    );
}

/* -----------------------------------
   MPP DASHBOARD
----------------------------------- */

async function mppDashboardPage() {
  const [reports, claimsSnapshot, notifications] = await Promise.all([
    getAllReports(),
    db.collection("ownershipClaims").get(),
    getNotifications()
  ]);

  const claims = claimsSnapshot.docs.map(mapDocument);

  const pendingClaims = claims.filter(
    claim => claim.claimStatus === "pending"
  ).length;

  const unclaimed = reports.filter(report =>
    report.reportType === "found" &&
    isOlderThanThirtyDays(report) &&
    ["active", "matched"].includes(report.reportStatus)
  ).length;

  const unread = notifications.filter(item => !item.isRead).length;

  return `
    <section class="page-heading">
      <h2>MPP Administrator Dashboard</h2>

      <p>
        Welcome, <strong>${escapeHtml(state.profile.fullName)}</strong>.
        Manage reports, ownership claims, and lost and found records.
      </p>

      <span class="role-tag role-mpp">
        MPP Administrator Account
      </span>
    </section>

    <section class="grid grid-3">
      <article class="dashboard-card">
        <h3>All Item Reports</h3>
        <div class="stat-number">${reports.length}</div>
        <p>Total lost-item and found-item reports in the system.</p>

        <a class="btn btn-primary" href="#/manage-reports">
          Manage Reports
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Pending Claims</h3>
        <div class="stat-number">${pendingClaims}</div>
        <p>Ownership claims waiting for MPP review and verification.</p>

        <a class="btn btn-primary" href="#/manage-claims">
          Manage Claims
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Unclaimed Items</h3>
        <div class="stat-number">${unclaimed}</div>
        <p>Found items older than one month that are not claimed.</p>

        <a class="btn btn-outline" href="#/unclaimed-items">
          View Items
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Returned History</h3>
        <p>View returned items and completed ownership claim records.</p>

        <a class="btn btn-outline" href="#/returned-history">
          View History
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Unread Notifications</h3>
        <div class="stat-number">${unread}</div>
        <p>New ownership claims and relevant system updates.</p>

        <a class="btn btn-outline" href="#/notifications">
          View Notifications
        </a>
      </article>

      <article class="dashboard-card">
        <h3>Browse Reports</h3>
        <p>Browse current lost and found reports as an MPP member.</p>

        <a class="btn btn-outline" href="#/browse">
          Browse Items
        </a>
      </article>
      
      <article class="dashboard-card">
        <h3>Monthly PDF Report</h3>

        <p>
          Generate, view, download, and print monthly item reports.
          Filter by status and report type.
        </p>

        <a class="btn btn-primary" href="#/mpp-report">
          Generate PDF Report
        </a>
      </article>
    </section>
  `;
}

/* -----------------------------------
   REPORT FORM
----------------------------------- */

function reportFormPage(existingReport = null) {
  const isEditing = Boolean(existingReport);

  const report = existingReport || {
    reportType: "lost",
    itemName: "",
    category: "",
    description: "",
    identifyingCharacteristics: "",
    location: "",
    dateOccurred: "",
    contactNumber: state.profile.phoneNumber || "",
    storageOrCollectionInfo: "",
    isValuable: false,
    photoUrls: []
  };

  const images = report.photoUrls?.length
    ? `
      <div class="photo-gallery">
        ${report.photoUrls.map(url => `
          <img src="${url}" alt="Item photo">
        `).join("")}
      </div>
    `
    : "";

  return `
    <section class="page-heading">
      <h2>
        ${isEditing ? "Update Item Report" : "Report Lost or Found Item"}
      </h2>

      <p>
        Enter accurate item information. Fields marked with * are required.
      </p>
    </section>

    <section class="card form-card">
      <h3 class="card-title">
        ${isEditing ? "Edit Report" : "Item Report Form"}
      </h3>

      <div id="formMessage"></div>

      <form id="reportForm" data-report-id="${isEditing ? report.id : ""}">
                <div class="form-group">
          <label for="reportType">Report Type *</label>

          <select
            id="reportType"
            required
            ${isEditing ? "disabled" : ""}
          >
            <option
              value="lost"
              ${report.reportType === "lost" ? "selected" : ""}
            >
              Lost Item
            </option>

            <option
              value="found"
              ${report.reportType === "found" ? "selected" : ""}
            >
              Found Item
            </option>
          </select>

          ${
            isEditing
              ? `
                <p class="form-note">
                  Report type cannot be changed after submission.
                </p>
              `
              : ""
          }
        </div>

        <div class="form-group">
          <label for="itemName">Item Name *</label>

          <input
            type="text"
            id="itemName"
            required
            value="${escapeHtml(report.itemName)}"
            placeholder="Example: Black Wallet"
          >
        </div>

        <div class="form-group">
          <label for="category">Category *</label>

          <select id="category" required>
            <option value="">Select category</option>
            ${categoryOptions(report.category)}
          </select>
        </div>

        <div class="form-group">
          <label for="description">Item Description *</label>

          <textarea
            id="description"
            required
            placeholder="Describe the item clearly"
          >${escapeHtml(report.description)}</textarea>
        </div>

        <div class="form-group">
          <label for="identifyingCharacteristics">
            Identifying Characteristics
          </label>

          <textarea
            id="identifyingCharacteristics"
            placeholder="Example: brand, colour, sticker, serial number, scratches"
          >${escapeHtml(report.identifyingCharacteristics)}</textarea>
        </div>

        <div class="form-group">
          <label for="location">Location *</label>

          <input
            type="text"
            id="location"
            required
            value="${escapeHtml(report.location)}"
            placeholder="Example: Library, Cafeteria, Block A"
          >
        </div>

        <div class="form-group">
          <label for="dateOccurred">Date and Time *</label>

          <input
            type="datetime-local"
            id="dateOccurred"
            required
            value="${toDateTimeLocal(report.dateOccurred)}"
          >
        </div>

        <div class="form-group">
          <label for="contactNumber">Contact Number *</label>

          <input
            type="tel"
            id="contactNumber"
            required
            value="${escapeHtml(report.contactNumber)}"
            placeholder="Example: 0123456789"
          >
        </div>

        <div class="form-group">
          <label for="storageOrCollectionInfo">
            Storage / Collection Information
          </label>

          <textarea
            id="storageOrCollectionInfo"
            placeholder="For found items: state where the item is kept or collection information"
          >${escapeHtml(report.storageOrCollectionInfo)}</textarea>
        </div>

        <div class="checkbox-group">
          <input
            type="checkbox"
            id="isValuable"
            ${report.isValuable ? "checked" : ""}
          >

          <label for="isValuable">
            This is a valuable item (phone, wallet, ID card, electronic device)
          </label>
        </div>

        <div class="form-group">
          <label for="reportPhotos">Upload Item Photos</label>

          <input
            type="file"
            id="reportPhotos"
            accept="image/png, image/jpeg, image/jpg"
            multiple
          >

          <p class="form-note">
            Maximum 3 images. Each image must be JPG, JPEG, or PNG and below 5 MB.
          </p>

          ${images}
        </div>

        <button type="submit" class="btn btn-primary">
          ${isEditing ? "Update Report" : "Submit Report"}
        </button>
      </form>
    </section>
  `;
}

/* -----------------------------------
   CLOUDINARY IMAGE UPLOAD
----------------------------------- */

async function uploadImages(fileList, uploadType) {
  const files = Array.from(fileList || []);

  if (!files.length) {
    return [];
  }

  if (!window.CLOUDINARY_CONFIG?.cloudName) {
    throw new Error(
      "Cloudinary configuration is missing. Check cloudinary-config.js."
    );
  }

  if (!window.CLOUDINARY_CONFIG?.uploadPreset) {
    throw new Error(
      "Cloudinary upload preset is missing. Check cloudinary-config.js."
    );
  }

  if (files.length > 3) {
    throw new Error("You can upload a maximum of 3 images.");
  }

  const imageUrls = [];

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      throw new Error("Only image files are allowed.");
    }

    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Each image must be below 5 MB.");
    }

    const formData = new FormData();

    formData.append("file", file);
    formData.append(
      "upload_preset",
      window.CLOUDINARY_CONFIG.uploadPreset
    );

    formData.append(
      "tags",
      `kpmb-lost-found,${uploadType},${state.user.uid}`
    );

    const response = await fetch(
      `https://api.cloudinary.com/v1_1/${window.CLOUDINARY_CONFIG.cloudName}/image/upload`,
      {
        method: "POST",
        body: formData
      }
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result?.error?.message ||
        "Image upload to Cloudinary failed."
      );
    }

    imageUrls.push(result.secure_url);
  }

  return imageUrls;
}

/* -----------------------------------
   RULE-BASED POSSIBLE MATCHING
----------------------------------- */

function normalise(text = "") {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getWords(text = "") {
  return [
    ...new Set(
      normalise(text)
        .split(" ")
        .filter(word => word.length >= 3)
    )
  ];
}

function countSharedWords(firstText = "", secondText = "") {
  const firstWords = getWords(firstText);
  const secondWords = getWords(secondText);

  return firstWords.filter(word => secondWords.includes(word));
}

function calculateMatch(firstReport, secondReport) {
  let score = 0;
  const reasons = [];

  const firstCategory = normalise(firstReport.category);
  const secondCategory = normalise(secondReport.category);

  const firstItemName = normalise(firstReport.itemName);
  const secondItemName = normalise(secondReport.itemName);

  const firstLocation = normalise(firstReport.location);
  const secondLocation = normalise(secondReport.location);

  const firstDescription = `
    ${firstReport.itemName || ""}
    ${firstReport.description || ""}
    ${firstReport.identifyingCharacteristics || ""}
  `;

  const secondDescription = `
    ${secondReport.itemName || ""}
    ${secondReport.description || ""}
    ${secondReport.identifyingCharacteristics || ""}
  `;

  if (
    firstCategory &&
    secondCategory &&
    firstCategory === secondCategory
  ) {
    score += 2;
    reasons.push("same category");
  }

  if (
    firstItemName &&
    secondItemName &&
    firstItemName === secondItemName
  ) {
    score += 3;
    reasons.push("same item name");
  } else {
    const sharedNameWords = countSharedWords(
      firstReport.itemName,
      secondReport.itemName
    );

    if (sharedNameWords.length >= 1) {
      score += 2;
      reasons.push("similar item name");
    }
  }

  const sharedDescriptionWords = countSharedWords(
    firstDescription,
    secondDescription
  );

  if (sharedDescriptionWords.length >= 2) {
    score += 2;
    reasons.push("similar description or characteristics");
  } else if (sharedDescriptionWords.length === 1) {
    score += 1;
    reasons.push("one similar description keyword");
  }

  if (
    firstLocation &&
    secondLocation &&
    (
      firstLocation.includes(secondLocation) ||
      secondLocation.includes(firstLocation)
    )
  ) {
    score += 2;
    reasons.push("similar location");
  }

  const firstDate = convertDate(firstReport.dateOccurred);
  const secondDate = convertDate(secondReport.dateOccurred);

  if (firstDate && secondDate) {
    const differenceInDays = Math.abs(
      firstDate.getTime() - secondDate.getTime()
    ) / (1000 * 60 * 60 * 24);

    if (differenceInDays <= 7) {
      score += 2;
      reasons.push("date within 7 days");
    } else if (differenceInDays <= 14) {
      score += 1;
      reasons.push("date within 14 days");
    }
  }

  return {
    score,
    reason: reasons.join(", ")
  };
}

async function runMatching(newReport) {
  const oppositeReportType =
    newReport.reportType === "lost" ? "found" : "lost";

  const snapshot = await db
    .collection("itemReports")
    .where("reportType", "==", oppositeReportType)
    .get();

  const possibleReports = snapshot.docs
    .map(mapDocument)
    .filter(report =>
      report.id !== newReport.id &&
      ["active", "matched"].includes(report.reportStatus)
    );

  let createdMatchCount = 0;

  for (const possibleReport of possibleReports) {
    const result = calculateMatch(newReport, possibleReport);

    if (result.score < 4) {
      continue;
    }

    const lostReport =
      newReport.reportType === "lost"
        ? newReport
        : possibleReport;

    const foundReport =
      newReport.reportType === "found"
        ? newReport
        : possibleReport;

    const matchId = `${lostReport.id}__${foundReport.id}`;

    const matchReference = db
      .collection("matchSuggestions")
      .doc(matchId);

    const existingMatch = await matchReference.get();

    if (existingMatch.exists) {
      continue;
    }

    await matchReference.set({
      lostReportId: lostReport.id,
      foundReportId: foundReport.id,
      matchScore: result.score,
      matchReason: result.reason,
      matchStatus: "suggested",
      createdAt: now()
    });

    await createNotification(
      newReport.reporterId,
      "student",
      "match",
      "Possible Item Match Found",
      `A possible match was found for your ${newReport.reportType} item report.`,
      newReport.id
    );

    if (possibleReport.reporterId !== newReport.reporterId) {
      await createNotification(
        possibleReport.reporterId,
        "student",
        "match",
        "Possible Item Match Found",
        `A possible match was found for your ${possibleReport.reportType} item report.`,
        possibleReport.id
      );
    }

    createdMatchCount++;
  }

  return createdMatchCount;
}

/* -----------------------------------
   BROWSE / SEARCH PAGE
----------------------------------- */

function itemCard(report) {
  const firstPhoto = report.photoUrls?.[0];

  let photoHtml = `
    <div class="item-no-image">
      LF
    </div>
  `;

  if (firstPhoto) {
    photoHtml = `
      <img
        class="item-image"
        src="${escapeHtml(firstPhoto)}"
        alt="${escapeHtml(report.itemName)}"
      >
    `;
  }

  return `
    <article class="item-card">
      ${photoHtml}

      <div class="item-content">
        <h3>${escapeHtml(report.itemName)}</h3>

        <p class="item-meta">
          ${escapeHtml(statusLabel(report.reportType))} Item
          · ${escapeHtml(report.category)}
        </p>

        <p>
          ${escapeHtml(truncate(report.description, 110))}
        </p>

        <p class="item-meta">
          Location: ${escapeHtml(report.location)}
        </p>

        <p class="item-meta">
          Date: ${formatDate(report.dateOccurred)}
        </p>

        ${statusBadge(report.reportStatus)}

        <div style="margin-top: 13px;">
          <a
            class="btn btn-outline btn-small"
            href="#/item/${encodeURIComponent(report.id)}"
          >
            View Details
          </a>
        </div>
      </div>
    </article>
  `;
}

function browsePage() {
  return `
    <section class="page-heading">
      <h2>Browse Lost and Found Items</h2>

      <p>
        Search and filter item reports using keywords, report type,
        category, location, and date.
      </p>
    </section>

    <section class="filter-box">
      <form id="searchForm">
        <div class="filter-grid">
          <input
            type="text"
            id="searchKeyword"
            placeholder="Search item name or description"
          >

          <select id="filterType">
            <option value="">All Report Types</option>
            <option value="lost">Lost Items</option>
            <option value="found">Found Items</option>
          </select>

          <select id="filterCategory">
            <option value="">All Categories</option>
            ${categoryOptions("")}
          </select>

          <input
            type="text"
            id="filterLocation"
            placeholder="Filter by location"
          >

          <input
            type="date"
            id="filterDate"
          >
        </div>

        <div style="margin-top: 12px;">
          <button type="submit" class="btn btn-primary">
            Search Items
          </button>

          <button
            type="button"
            id="clearSearchButton"
            class="btn btn-outline"
          >
            Clear
          </button>
        </div>
      </form>
    </section>

    <section id="searchResults">
      <div class="loading-screen" style="min-height: 180px;">
        <div class="spinner"></div>
        <p>Loading item reports...</p>
      </div>
    </section>
  `;
}

async function loadSearchResults() {
  const resultContainer = document.getElementById("searchResults");

  if (!resultContainer) {
    return;
  }

  const reports = await getAllReports();

  const keyword = document
    .getElementById("searchKeyword")
    .value
    .trim()
    .toLowerCase();

  const reportType = document.getElementById("filterType").value;
  const category = document.getElementById("filterCategory").value;

  const location = document
    .getElementById("filterLocation")
    .value
    .trim()
    .toLowerCase();

  const selectedDate = document.getElementById("filterDate").value;

  const filteredReports = reports.filter(report => {
    const searchableText = `
      ${report.itemName || ""}
      ${report.description || ""}
      ${report.identifyingCharacteristics || ""}
      ${report.category || ""}
      ${report.location || ""}
    `.toLowerCase();

    const matchesKeyword =
      !keyword || searchableText.includes(keyword);

    const matchesType =
      !reportType || report.reportType === reportType;

    const matchesCategory =
      !category || report.category === category;

    const matchesLocation =
      !location ||
      String(report.location || "")
        .toLowerCase()
        .includes(location);

    const reportDate = convertDate(report.dateOccurred);

    const reportDateText = reportDate
      ? reportDate.toISOString().slice(0, 10)
      : "";
      
    const matchesDate =
      !selectedDate || reportDateText === selectedDate;

    return (
      matchesKeyword &&
      matchesType &&
      matchesCategory &&
      matchesLocation &&
      matchesDate
    );
  });

  if (!filteredReports.length) {
    resultContainer.innerHTML = `
      <section class="card">
        <h3 class="card-title">No Items Found</h3>

        <p>
          No lost or found item reports match the selected search criteria.
        </p>
      </section>
    `;

    return;
  }

  resultContainer.innerHTML = `
    <p style="margin-bottom: 15px; color: #606864;">
      ${filteredReports.length} item report(s) found.
    </p>

    <div class="item-grid">
      ${filteredReports.map(itemCard).join("")}
    </div>
  `;
}

/* -----------------------------------
   ITEM DETAIL PAGE
----------------------------------- */

async function itemDetailPage(reportId) {
  const report = await getReport(reportId);

  if (!report) {
    return `
      <section class="card">
        <h2 class="card-title">Item Report Not Found</h2>
        <p>The requested item report does not exist.</p>
      </section>
    `;
  }

  const photos = report.photoUrls || [];

  const mainImage = photos[0]
    ? `
      <img
        class="details-image"
        src="${photos[0]}"
        alt="${escapeHtml(report.itemName)}"
      >
    `
    : `
      <div class="item-no-image" style="height: 330px; border-radius: 10px;">
        LF
      </div>
    `;

  const gallery = photos.length > 1
    ? `
      <div class="photo-gallery">
        ${photos.map(url => `
          <img src="${url}" alt="Item photo">
        `).join("")}
      </div>
    `
    : "";

  const isOwner = report.reporterId === state.user.uid;

  let actions = `
    <a href="#/browse" class="btn btn-outline">
      Back to Browse
    </a>
  `;

  const canSubmitClaim =
    state.profile.role === "student" &&
    report.reportType === "found" &&
    report.reporterId !== state.user.uid &&
    ["active", "matched"].includes(report.reportStatus);

  if (canSubmitClaim) {
    actions += `
      <a href="#/claim/${report.id}" class="btn btn-primary">
        Submit Ownership Claim
      </a>
    `;
  }

  if (
    state.profile.role === "student" &&
    isOwner &&
    isActiveReport(report)
  ) {
    actions += `
      <a href="#/edit/${report.id}" class="btn btn-primary">
        Edit My Report
      </a>

      <a href="#/matches/${report.id}" class="btn btn-outline">
        View Possible Matches
      </a>

      <button
        class="btn btn-danger"
        id="deleteReportButton"
        data-report-id="${report.id}"
      >
        Delete Report
      </button>
    `;
  }

  if (state.profile.role === "mpp_admin") {
    actions += `
      <a href="#/manage-reports" class="btn btn-primary">
        Manage Report Status
      </a>
    `;
  }

  let reporterInfo = "";

  if (state.profile.role === "mpp_admin") {
    const reporter = await getProfile(report.reporterId);

    if (reporter) {
      reporterInfo = `
        <div class="detail-row">
          <strong>Reporter Information (MPP Only)</strong>
          <span>
            ${escapeHtml(reporter.fullName)}<br>
            Student ID: ${escapeHtml(reporter.studentId)}<br>
            Phone: ${escapeHtml(reporter.phoneNumber)}
          </span>
        </div>
      `;
    }
  }

  return `
    <section class="page-heading">
      <h2>Item Report Details</h2>

      <p>
        Review the item information and current report status.
      </p>
    </section>

    <section class="card">
      <div class="details-grid">
        <div>
          ${mainImage}
          ${gallery}
        </div>

        <div>
          <h2 style="color: #0b4f43; margin-bottom: 10px;">
            ${escapeHtml(report.itemName)}
          </h2>

          ${statusBadge(report.reportStatus)}

          <div class="detail-row">
            <strong>Report Type</strong>
            <span>${escapeHtml(statusLabel(report.reportType))} Item</span>
          </div>

          <div class="detail-row">
            <strong>Category</strong>
            <span>${escapeHtml(report.category)}</span>
          </div>

          <div class="detail-row">
            <strong>Description</strong>
            <span>${escapeHtml(report.description)}</span>
          </div>

          <div class="detail-row">
            <strong>Identifying Characteristics</strong>
            <span>
              ${escapeHtml(report.identifyingCharacteristics || "-")}
            </span>
          </div>

          <div class="detail-row">
            <strong>Location</strong>
            <span>${escapeHtml(report.location)}</span>
          </div>

          <div class="detail-row">
            <strong>Date and Time</strong>
            <span>${formatDateTime(report.dateOccurred)}</span>
          </div>

          <div class="detail-row">
            <strong>Valuable Item</strong>
            <span>${report.isValuable ? "Yes" : "No"}</span>
          </div>

          <div class="detail-row">
            <strong>Storage / Collection Information</strong>
            <span>
              ${escapeHtml(report.storageOrCollectionInfo || "-")}
            </span>
          </div>

          ${reporterInfo}

          <div style="margin-top: 18px; display: flex; gap: 10px; flex-wrap: wrap;">
            ${actions}
          </div>
        </div>
      </div>
    </section>
  `;
}

/* -----------------------------------
   MY REPORTS
----------------------------------- */

async function myReportsPage() {
  const reports = await getMyReports();

  return `
    <section class="page-heading">
      <h2>My Reports</h2>

      <p>
        View, update, delete, and check possible matches for your active reports.
      </p>
    </section>

    ${
      reports.length
        ? `
          <div class="item-grid">
            ${reports.map(report => {
              const actions = isActiveReport(report)
                ? `
                  <a class="btn btn-outline btn-small" href="#/edit/${report.id}">
                    Edit
                  </a>

                  <a class="btn btn-outline btn-small" href="#/matches/${report.id}">
                    Matches
                  </a>

                  <button
                    class="btn btn-danger btn-small delete-report-button"
                    data-report-id="${report.id}"
                  >
                    Delete
                  </button>
                `
                : "";

              return `
                <article class="item-card">
                  ${
                    report.photoUrls?.[0]
                      ? `
                        <img
                          class="item-image"
                          src="${report.photoUrls[0]}"
                          alt="${escapeHtml(report.itemName)}"
                        >
                      `
                      : `<div class="item-no-image">LF</div>`
                  }

                  <div class="item-content">
                    <h3>${escapeHtml(report.itemName)}</h3>

                    <p class="item-meta">
                      ${escapeHtml(statusLabel(report.reportType))} Item
                    </p>

                    <p class="item-meta">
                      ${formatDate(report.dateOccurred)}
                    </p>

                    ${statusBadge(report.reportStatus)}

                    <div style="margin-top: 12px; display: flex; gap: 7px; flex-wrap: wrap;">
                      <a class="btn btn-primary btn-small" href="#/item/${report.id}">
                        View
                      </a>

                      ${actions}
                    </div>
                  </div>
                </article>
              `;
            }).join("")}
          </div>
        `
        : `
          <section class="card">
            <h3 class="card-title">No Reports Yet</h3>

            <p>
              You have not submitted a lost-item or found-item report.
            </p>

            <div style="margin-top: 15px;">
              <a class="btn btn-primary" href="#/report">
                Create Report
              </a>
            </div>
          </section>
        `
    }
  `;
}

/* -----------------------------------
   POSSIBLE MATCHES
----------------------------------- */

async function getMyMatchSuggestions() {
  const myReports = await getMyReports();

  const myReportIds = new Set(
    myReports.map(report => report.id)
  );

  const snapshot = await db
    .collection("matchSuggestions")
    .get();

  return snapshot.docs
    .map(mapDocument)
    .filter(match =>
      myReportIds.has(match.lostReportId) ||
      myReportIds.has(match.foundReportId)
    );
}

function matchItemPreview(title, report) {
  const photo = report?.photoUrls?.[0]
    ? `
      <img
        src="${report.photoUrls[0]}"
        alt="${escapeHtml(report.itemName)}"
      >
    `
    : `
      <div class="match-no-photo">No Photo</div>
    `;

  return `
    <div class="match-item">
      <h4>${escapeHtml(title)}</h4>
      ${photo}
      <p><strong>${escapeHtml(report?.itemName || "-")}</strong></p>
      <p>Category: ${escapeHtml(report?.category || "-")}</p>
      <p>Location: ${escapeHtml(report?.location || "-")}</p>
      <p>Date: ${formatDate(report?.dateOccurred)}</p>
    </div>
  `;
}

function matchCard(match, lostReport, foundReport) {
  return `
    <article class="match-card">
      <div class="match-header">
        <div>
          <h3>Possible Lost and Found Match</h3>
          <p>Match Score: ${escapeHtml(match.matchScore)}</p>
        </div>

        <span class="status-tag status-matched">
          ${escapeHtml(statusLabel(match.matchStatus))}
        </span>
      </div>

      <p class="match-reason">
        <strong>Matching Reason:</strong>
        ${escapeHtml(match.matchReason)}
      </p>

      <div class="match-pair">
        ${matchItemPreview("Lost Item Report", lostReport)}
        ${matchItemPreview("Found Item Report", foundReport)}
      </div>

      <div style="margin-top: 15px; display: flex; gap: 10px; flex-wrap: wrap;">
        <a
          href="#/item/${lostReport.id}"
          class="btn btn-outline btn-small"
        >
          View Lost Report
        </a>

        <a
          href="#/item/${foundReport.id}"
          class="btn btn-primary btn-small"
        >
          View Found Report
        </a>
      </div>
    </article>
  `;
}

async function myMatchesPage() {
  const matches = await getMyMatchSuggestions();

  const matchRecords = await Promise.all(
    matches.map(async match => {
      const [lostReport, foundReport] = await Promise.all([
        getReport(match.lostReportId),
        getReport(match.foundReportId)
      ]);

      return {
        ...match,
        lostReport,
        foundReport
      };
    })
  );

  const validMatches = matchRecords.filter(
    match => match.lostReport && match.foundReport
  );

  return `
    <section class="page-heading">
      <h2>My Possible Matches</h2>

      <p>
        The system compares lost and found reports using category,
        item name, description, location, date, and identifying characteristics.
        Photos are shown for manual comparison.
      </p>
    </section>

    ${
      validMatches.length
        ? `
          <section class="match-grid">
            ${validMatches.map(match =>
              matchCard(
                match,
                match.lostReport,
                match.foundReport
              )
            ).join("")}
          </section>
        `
        : `
          <section class="card">
            <h3 class="card-title">No Possible Matches Found</h3>
            <p>
              There are currently no possible matches for your reports.
            </p>
          </section>
        `
    }
  `;
}

async function possibleMatchesPage(reportId) {
  if (!reportId) {
    return `
      <section class="card">
        <h2 class="card-title">Report ID Missing</h2>
        <p>Please open matches from a specific item report.</p>
      </section>
    `;
  }

  const report = await getReport(reportId);

  if (!report) {
    return `
      <section class="card">
        <h2 class="card-title">Item Report Not Found</h2>
        <p>
          The report may have been deleted or the page link does not contain a valid report ID.
        </p>
      </section>
    `;
  }

  if (
    state.profile.role === "student" &&
    report.reporterId !== state.user.uid
  ) {
    return `
      <section class="card">
        <h2 class="card-title">Access Denied</h2>
        <p>You can only view matches related to your own reports.</p>
      </section>
    `;
  }

  const fieldName =
    report.reportType === "lost"
      ? "lostReportId"
      : "foundReportId";

  const snapshot = await db
    .collection("matchSuggestions")
    .where(fieldName, "==", reportId)
    .get();

  const matchRecords = await Promise.all(
    snapshot.docs.map(async document => {
      const match = mapDocument(document);

      const [lostReport, foundReport] = await Promise.all([
        getReport(match.lostReportId),
        getReport(match.foundReportId)
      ]);

      return {
        ...match,
        lostReport,
        foundReport
      };
    })
  );

  const validMatches = matchRecords.filter(
    match => match.lostReport && match.foundReport
  );

  return `
    <section class="page-heading">
      <h2>Possible Matches for ${escapeHtml(report.itemName)}</h2>

      <p>
        These matches are generated using category, item name,
        description, location, date, and identifying characteristics.
      </p>
    </section>

    ${
      validMatches.length
        ? `
          <section class="match-grid">
            ${validMatches.map(match =>
              matchCard(
                match,
                match.lostReport,
                match.foundReport
              )
            ).join("")}
          </section>
        `
        : `
          <section class="card">
            <h3 class="card-title">No Possible Matches Found</h3>
            <p>No similar report has been identified yet.</p>
          </section>
        `
    }
  `;
}

/* -----------------------------------
   OWNERSHIP CLAIM
----------------------------------- */

async function claimFormPage(reportId) {
  const report = await getReport(reportId);

  if (!report) {
    return `
      <section class="card">
        <h2 class="card-title">Item Report Not Found</h2>
        <p>The requested item report does not exist.</p>
      </section>
    `;
  }

  if (report.reportType !== "found") {
    return `
      <section class="card">
        <h2 class="card-title">Claim Not Allowed</h2>
        <p>Ownership claims can only be submitted for found-item reports.</p>
      </section>
    `;
  }

  if (report.reporterId === state.user.uid) {
    return `
      <section class="card">
        <h2 class="card-title">Claim Not Allowed</h2>
        <p>You cannot claim an item that you reported as found.</p>
      </section>
    `;
  }

  if (!["active", "matched"].includes(report.reportStatus)) {
    return `
      <section class="card">
        <h2 class="card-title">Claim Not Available</h2>
        <p>This item is no longer available for ownership claims.</p>
      </section>
    `;
  }

  const claims = await getMyClaims();

  const existingClaim = claims.find(
    claim => claim.reportId === reportId
  );

  if (existingClaim) {
    return `
      <section class="card">
        <h2 class="card-title">Claim Already Submitted</h2>

        <p>
          You have already submitted a claim for this item.
        </p>

        <p style="margin-top: 12px;">
          Current status:
          ${statusBadge(existingClaim.claimStatus)}
        </p>
      </section>
    `;
  }

  return `
    <section class="page-heading">
      <h2>Submit Ownership Claim</h2>

      <p>
        Provide accurate information to help MPP members verify
        that you are the rightful owner.
      </p>
    </section>

    <section class="card form-card">
      <h3 class="card-title">
        Claiming: ${escapeHtml(report.itemName)}
      </h3>

      <div id="formMessage"></div>

      <form id="claimForm" data-report-id="${report.id}">
        <div class="form-group">
          <label for="evidenceDescription">
            Ownership Evidence *
          </label>

          <textarea
            id="evidenceDescription"
            required
            minlength="10"
            placeholder="Describe unique characteristics, proof of ownership, brand, colour, serial number, or other details."
          ></textarea>
        </div>

        <div class="form-group">
          <label for="evidencePhotos">
            Supporting Evidence Photos
          </label>

          <input
            type="file"
            id="evidencePhotos"
            accept="image/png, image/jpeg, image/jpg"
            multiple
          >

          <p class="form-note">
            Optional. Maximum 3 images. Each image must be below 5 MB.
          </p>
        </div>

        <button type="submit" class="btn btn-primary">
          Submit Ownership Claim
        </button>

        <a href="#/item/${report.id}" class="btn btn-outline">
          Cancel
        </a>
      </form>
    </section>
  `;
}

async function myClaimsPage() {
  const claims = await getMyClaims();

  const records = await Promise.all(
    claims.map(async claim => {
      const report = await getReport(claim.reportId);

      return {
        ...claim,
        report
      };
    })
  );

  return `
    <section class="page-heading">
      <h2>My Ownership Claims</h2>

      <p>
        View the status of ownership claims that you submitted.
      </p>
    </section>

    ${
      records.length
        ? `
          <section class="card">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Submitted Date</th>
                    <th>Claim Status</th>
                    <th>MPP Remarks</th>
                    <th>Collection Instruction</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  ${records.map(record => `
                    <tr>
                      <td>
                        ${escapeHtml(record.report?.itemName || "Deleted Item")}
                      </td>

                      <td>${formatDateTime(record.submittedAt)}</td>

                      <td>${statusBadge(record.claimStatus)}</td>

                      <td>
                        ${escapeHtml(record.reviewerRemarks || "-")}
                      </td>

                      <td>
                        ${escapeHtml(record.collectionInstruction || "-")}
                      </td>

                      <td>
                        ${
                          record.report
                            ? `
                              <a
                                class="btn btn-outline btn-small"
                                href="#/item/${record.report.id}"
                              >
                                View Item
                              </a>
                            `
                            : "-"
                        }
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </section>
        `
        : `
          <section class="card">
            <h3 class="card-title">No Claims Submitted</h3>
            <p>You have not submitted any ownership claims.</p>
          </section>
        `
    }
  `;
}

/* -----------------------------------
   MPP REPORT MANAGEMENT
----------------------------------- */

async function manageReportsPage() {
  const reports = await getAllReports();

  return `
    <section class="page-heading">
      <h2>Manage Item Reports</h2>

      <p>
        Review all reports and update their status where necessary.
      </p>
    </section>

    <section class="card">
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Type</th>
              <th>Location</th>
              <th>Date</th>
              <th>Current Status</th>
              <th>Update Status</th>
              <th>Action</th>
            </tr>
          </thead>

          <tbody>
            ${reports.map(report => `
              <tr>
                <td>
                  <strong>${escapeHtml(report.itemName)}</strong><br>
                  <small>${escapeHtml(report.category)}</small>
                </td>

                <td>${escapeHtml(statusLabel(report.reportType))}</td>

                <td>${escapeHtml(report.location)}</td>

                <td>${formatDate(report.dateOccurred)}</td>

                <td>${statusBadge(report.reportStatus)}</td>

                <td>
                  <form
                    class="statusForm"
                    data-report-id="${report.id}"
                  >
                    <select name="reportStatus">
                      ${reportStatusOptions(report.reportStatus)}
                    </select>

                    <textarea
                      name="remarks"
                      placeholder="MPP remarks (optional)"
                    ></textarea>

                    <button
                      type="submit"
                      class="btn btn-primary btn-small"
                      style="margin-top: 7px;"
                    >
                      Update
                    </button>
                  </form>
                </td>

                <td>
                  <a
                    href="#/item/${report.id}"
                    class="btn btn-outline btn-small"
                  >
                    View
                  </a>
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

async function updateReportStatus(reportId, newStatus, remarks) {
  const reportReference = db
    .collection("itemReports")
    .doc(reportId);

  const reportSnapshot = await reportReference.get();

  if (!reportSnapshot.exists) {
    throw new Error("Item report was not found.");
  }

  const report = mapDocument(reportSnapshot);

  if (report.reportStatus === newStatus) {
    throw new Error(
      "Please select a different status before updating."
    );
  }

  const batch = db.batch();

  batch.update(reportReference, {
    reportStatus: newStatus,
    updatedAt: now()
  });

  const historyReference = db
    .collection("statusHistory")
    .doc();

  batch.set(historyReference, {
    reportId,
    previousStatus: report.reportStatus,
    newStatus,
    changedBy: state.user.uid,
    remarks: remarks || "",
    changedAt: now()
  });

  const notificationReference = db
    .collection("notifications")
    .doc();

  batch.set(notificationReference, {
    recipientId: report.reporterId,
    recipientRole: "student",
    notificationType: "status_update",
    title: "Item Report Status Updated",
    message: `Your report for "${report.itemName}" was updated to ${statusLabel(newStatus)}.`,
    relatedReportId: reportId,
    relatedClaimId: null,
    isRead: false,
    createdAt: now()
  });

  await batch.commit();
}

/* -----------------------------------
   MPP CLAIM MANAGEMENT
----------------------------------- */

async function manageClaimsPage() {
  const snapshot = await db
    .collection("ownershipClaims")
    .get();

  const claims = snapshot.docs
    .map(mapDocument)
    .sort((a, b) => {
      const dateA = convertDate(a.submittedAt)?.getTime() || 0;
      const dateB = convertDate(b.submittedAt)?.getTime() || 0;

      return dateB - dateA;
    });

  const records = await Promise.all(
    claims.map(async claim => {
      const [report, claimant] = await Promise.all([
        getReport(claim.reportId),
        getProfile(claim.claimantId)
      ]);

      return {
        ...claim,
        report,
        claimant
      };
    })
  );

  return `
    <section class="page-heading">
      <h2>Manage Ownership Claims</h2>

      <p>
        Review student ownership evidence and approve or reject claims.
      </p>
    </section>

    ${
      records.length
        ? `
          <section class="card">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Claimant</th>
                    <th>Submitted Date</th>
                    <th>Claim Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  ${records.map(record => `
                    <tr>
                      <td>
                        ${escapeHtml(record.report?.itemName || "Deleted Item")}
                      </td>

                      <td>
                        ${escapeHtml(record.claimant?.fullName || "Unknown Student")}<br>
                        <small>
                          ${escapeHtml(record.claimant?.studentId || "-")}
                        </small>
                      </td>

                      <td>${formatDateTime(record.submittedAt)}</td>

                      <td>${statusBadge(record.claimStatus)}</td>

                      <td>
                        <a
                          href="#/review-claim/${record.id}"
                          class="btn btn-primary btn-small"
                        >
                          Review Claim
                        </a>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </section>
        `
        : `
          <section class="card">
            <h3 class="card-title">No Claims Available</h3>
            <p>No ownership claims have been submitted yet.</p>
          </section>
        `
    }
  `;
}

async function reviewClaimPage(claimId) {
  const claimSnapshot = await db
    .collection("ownershipClaims")
    .doc(claimId)
    .get();

  if (!claimSnapshot.exists) {
    return `
      <section class="card">
        <h2 class="card-title">Claim Not Found</h2>
      </section>
    `;
  }

  const claim = mapDocument(claimSnapshot);

  const [report, claimant] = await Promise.all([
    getReport(claim.reportId),
    getProfile(claim.claimantId)
  ]);

  const evidenceImages = claim.evidencePhotoUrls?.length
    ? `
      <div class="photo-gallery">
        ${claim.evidencePhotoUrls.map(url => `
          <img src="${url}" alt="Ownership evidence">
        `).join("")}
      </div>
    `
    : "<p>No evidence photos uploaded.</p>";

  const reviewForm = claim.claimStatus === "pending"
    ? `
      <form id="claimReviewForm" data-claim-id="${claim.id}">
        <div class="form-group">
          <label for="decision">Decision *</label>

          <select id="decision" required>
            <option value="">Select decision</option>
            <option value="approved">Approve Claim</option>
            <option value="rejected">Reject Claim</option>
          </select>
        </div>

        <div class="form-group">
          <label for="reviewerRemarks">MPP Remarks *</label>

          <textarea
            id="reviewerRemarks"
            required
            placeholder="Explain the approval or rejection decision."
          ></textarea>
        </div>

        <div class="form-group">
          <label for="collectionInstruction">
            Collection Instruction
          </label>

          <textarea
            id="collectionInstruction"
            placeholder="For approved claims, state collection location, date, or time."
          ></textarea>
        </div>

        <button type="submit" class="btn btn-primary">
          Save Claim Decision
        </button>
      </form>
    `
    : `
      <div class="alert alert-info">
        This claim was already reviewed.
      </div>

      <div class="detail-row">
        <strong>Decision</strong>
        <span>${statusBadge(claim.claimStatus)}</span>
      </div>

      <div class="detail-row">
        <strong>MPP Remarks</strong>
        <span>${escapeHtml(claim.reviewerRemarks || "-")}</span>
      </div>

      <div class="detail-row">
        <strong>Collection Instruction</strong>
        <span>${escapeHtml(claim.collectionInstruction || "-")}</span>
      </div>
    `;

  return `
    <section class="page-heading">
      <h2>Review Ownership Claim</h2>

      <p>
        Verify the claimant's evidence before approving or rejecting the claim.
      </p>
    </section>

    <section class="grid grid-2">
      <section class="card">
        <h3 class="card-title">Item Information</h3>

        <div class="detail-row">
          <strong>Item Name</strong>
          <span>${escapeHtml(report?.itemName || "Deleted Item")}</span>
        </div>

        <div class="detail-row">
          <strong>Description</strong>
          <span>${escapeHtml(report?.description || "-")}</span>
        </div>

        <div class="detail-row">
          <strong>Location Found</strong>
          <span>${escapeHtml(report?.location || "-")}</span>
        </div>

        <div class="detail-row">
          <strong>Item Status</strong>
          <span>${statusBadge(report?.reportStatus || "active")}</span>
        </div>

        ${
          report?.photoUrls?.[0]
            ? `
              <img
                class="details-image"
                style="height: 230px; margin-top: 15px;"
                src="${report.photoUrls[0]}"
                alt="${escapeHtml(report.itemName)}"
              >
            `
            : ""
        }
      </section>

      <section class="card">
        <h3 class="card-title">Claimant and Evidence</h3>

        <div class="detail-row">
          <strong>Claimant Name</strong>
          <span>${escapeHtml(claimant?.fullName || "Unknown")}</span>
        </div>

        <div class="detail-row">
          <strong>Student ID</strong>
          <span>${escapeHtml(claimant?.studentId || "-")}</span>
        </div>

        <div class="detail-row">
          <strong>Phone Number</strong>
          <span>${escapeHtml(claimant?.phoneNumber || "-")}</span>
        </div>

        <div class="detail-row">
          <strong>Ownership Evidence</strong>
          <span>${escapeHtml(claim.evidenceDescription)}</span>
        </div>

        <div class="detail-row">
          <strong>Supporting Photos</strong>
          ${evidenceImages}
        </div>

        <div style="margin-top: 18px;">
          ${reviewForm}
        </div>
      </section>
    </section>
  `;
}

async function reviewOwnershipClaim(
  claimId,
  decision,
  reviewerRemarks,
  collectionInstruction
) {
  const claimReference = db
    .collection("ownershipClaims")
    .doc(claimId);

  const claimSnapshot = await claimReference.get();

  if (!claimSnapshot.exists) {
    throw new Error("Claim was not found.");
  }

  const claim = mapDocument(claimSnapshot);
  const report = await getReport(claim.reportId);

  const batch = db.batch();

  batch.update(claimReference, {
    claimStatus: decision,
    reviewedBy: state.user.uid,
    reviewerRemarks,
    collectionInstruction,
    reviewedAt: now()
  });

  if (decision === "approved") {
    const reportReference = db
      .collection("itemReports")
      .doc(claim.reportId);

    batch.update(reportReference, {
      reportStatus: "claimed",
      updatedAt: now()
    });

    const historyReference = db
      .collection("statusHistory")
      .doc();

    batch.set(historyReference, {
      reportId: claim.reportId,
      previousStatus: report?.reportStatus || "active",
      newStatus: "claimed",
      changedBy: state.user.uid,
      remarks: "Ownership claim approved.",
      changedAt: now()
    });
  }

  const notificationReference = db
    .collection("notifications")
    .doc();

  batch.set(notificationReference, {
    recipientId: claim.claimantId,
    recipientRole: "student",
    notificationType: "claim",
    title:
      decision === "approved"
        ? "Ownership Claim Approved"
        : "Ownership Claim Rejected",
    message:
      decision === "approved"
        ? `Your claim for "${report?.itemName || "the item"}" has been approved.`
        : `Your claim for "${report?.itemName || "the item"}" has been rejected.`,
    relatedReportId: claim.reportId,
    relatedClaimId: claimId,
    isRead: false,
    createdAt: now()
  });

  await batch.commit();
}

/* -----------------------------------
   UNCLAIMED ITEMS
----------------------------------- */

async function unclaimedItemsPage() {
  const reports = await getAllReports();

  const unclaimedReports = reports.filter(report =>
    report.reportType === "found" &&
    isOlderThanThirtyDays(report) &&
    ["active", "matched", "unclaimed"].includes(report.reportStatus)
  );

  return `
    <section class="page-heading">
      <h2>Unclaimed Item Management</h2>

      <p>
        These found-item reports are older than one month and require MPP review.
      </p>
    </section>

    ${
      unclaimedReports.length
        ? `
          <section class="card">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Location</th>
                    <th>Date Found</th>
                    <th>Current Status</th>
                    <th>Update Status</th>
                  </tr>
                </thead>

                <tbody>
                  ${unclaimedReports.map(report => `
                    <tr>
                      <td>${escapeHtml(report.itemName)}</td>
                      <td>${escapeHtml(report.location)}</td>
                      <td>${formatDate(report.dateOccurred)}</td>
                      <td>${statusBadge(report.reportStatus)}</td>

                      <td>
                        <form
                          class="statusForm"
                          data-report-id="${report.id}"
                        >
                          <select name="reportStatus">
                            <option value="unclaimed">Unclaimed</option>
                            <option value="disposed">Disposed</option>
                          </select>

                          <textarea
                            name="remarks"
                            placeholder="MPP remarks"
                          ></textarea>

                          <button
                            type="submit"
                            class="btn btn-warning btn-small"
                            style="margin-top: 7px;"
                          >
                            Update
                          </button>
                        </form>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </section>
        `
        : `
          <section class="card">
            <h3 class="card-title">No Unclaimed Items</h3>
            <p>No found-item reports currently require unclaimed-item management.</p>
          </section>
        `
    }
  `;
}

/* -----------------------------------
   RETURNED ITEM HISTORY
----------------------------------- */

async function returnedHistoryPage() {
  const reports = await getAllReports();

  const returnedReports = reports.filter(
    report => report.reportStatus === "returned"
  );

  return `
    <section class="page-heading">
      <h2>Returned Item History</h2>

      <p>
        View completed records of items returned to verified owners.
      </p>
    </section>

    ${
      returnedReports.length
        ? `
          <section class="card">
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Report Type</th>
                    <th>Location</th>
                    <th>Date Reported</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>

                <tbody>
                  ${returnedReports.map(report => `
                    <tr>
                      <td>${escapeHtml(report.itemName)}</td>
                      <td>${escapeHtml(statusLabel(report.reportType))}</td>
                      <td>${escapeHtml(report.location)}</td>
                      <td>${formatDate(report.createdAt)}</td>
                      <td>${statusBadge(report.reportStatus)}</td>
                      <td>
                        <a
                          class="btn btn-outline btn-small"
                          href="#/item/${report.id}"
                        >
                          View
                        </a>
                      </td>
                    </tr>
                  `).join("")}
                </tbody>
              </table>
            </div>
          </section>
        `
        : `
          <section class="card">
            <h3 class="card-title">No Returned Item Records</h3>
            <p>No item reports have been marked as returned yet.</p>
          </section>
        `
    }
  `;
}

/* -----------------------------------
   NOTIFICATIONS
----------------------------------- */

async function notificationsPage() {
  const notifications = await getNotifications();

  return `
    <section class="page-heading">
      <h2>Notifications</h2>

      <p>
        View possible item matches, ownership-claim updates, and report-status changes.
      </p>
    </section>

    ${
      notifications.length
        ? notifications.map(notification => `
          <article class="notification ${notification.isRead ? "" : "unread"}">
            <h4>${escapeHtml(notification.title)}</h4>

            <p>${escapeHtml(notification.message)}</p>

            <small>
              ${formatDateTime(notification.createdAt)}
            </small>

            <div style="margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap;">
              ${
                notification.relatedReportId
                  ? `
                    <a
                      class="btn btn-outline btn-small"
                      href="#/item/${notification.relatedReportId}"
                    >
                      View Related Item
                    </a>
                  `
                  : ""
              }

              ${
                !notification.isRead
                  ? `
                    <button
                      class="btn btn-primary btn-small mark-read-button"
                      data-notification-id="${notification.id}"
                    >
                      Mark as Read
                    </button>
                  `
                  : ""
              }
            </div>
          </article>
        `).join("")
        : `
          <section class="card">
            <h3 class="card-title">No Notifications</h3>
            <p>You do not have any notifications at the moment.</p>
          </section>
        `
    }
  `;
}

/* -----------------------------------
   AUTHENTICATION
----------------------------------- */

async function handleRegistration(event) {
  event.preventDefault();

  const fullName = document.getElementById("fullName").value.trim();
  const studentId = document.getElementById("studentId").value.trim();
  const email = document.getElementById("email").value.trim();
  const phoneNumber = document.getElementById("phoneNumber").value.trim();
  const password = document.getElementById("password").value;
  const confirmPassword = document.getElementById("confirmPassword").value;

  if (password !== confirmPassword) {
    showFormMessage("Password and Confirm Password do not match.");
    return;
  }

  try {
    showFormMessage("Creating student account...", "info");

    const credential = await auth.createUserWithEmailAndPassword(
      email,
      password
    );

    await credential.user.updateProfile({
      displayName: fullName
    });

    await db.collection("users").doc(credential.user.uid).set({
      fullName,
      studentId,
      email,
      phoneNumber,
      role: "student",
      accountStatus: "active",
      createdAt: now(),
      updatedAt: now()
    });

    state.user = credential.user;

    state.profile = {
      userId: credential.user.uid,
      fullName,
      studentId,
      email,
      phoneNumber,
      role: "student",
      accountStatus: "active"
    };

    setFlash(
      "Student account registered successfully.",
      "success"
    );

    go("student-dashboard");
  } catch (error) {
    showFormMessage(firebaseError(error));
  }
}

async function handleLogin(event) {
  event.preventDefault();

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    showFormMessage("Logging in...", "info");

    const credential = await auth.signInWithEmailAndPassword(
      email,
      password
    );

    const profile = await getProfile(credential.user.uid);

    if (!profile) {
      await auth.signOut();

      showFormMessage(
        "This account does not have a system role. Contact the project developer."
      );

      return;
    }

    state.user = credential.user;
    state.profile = profile;

    if (profile.role === "mpp_admin") {
      setFlash("MPP administrator login successful.", "success");
      go("mpp-dashboard");
    } else {
      setFlash("Student login successful.", "success");
      go("student-dashboard");
    }
  } catch (error) {
    showFormMessage(firebaseError(error));
  }
}

async function handleLogout() {
  await auth.signOut();

  setFlash("You have logged out successfully.", "success");
  go("home");
}

/* -----------------------------------
   REPORT FORM SUBMISSION
----------------------------------- */

async function handleReportForm(event) {
  event.preventDefault();

  const reportId = event.currentTarget.dataset.reportId;

  const reportType = document.getElementById("reportType").value;
  const itemName = document.getElementById("itemName").value.trim();
  const category = document.getElementById("category").value;
  const description = document.getElementById("description").value.trim();

  const identifyingCharacteristics = document
    .getElementById("identifyingCharacteristics")
    .value
    .trim();

  const location = document.getElementById("location").value.trim();
  const dateOccurredValue = document.getElementById("dateOccurred").value;
  const contactNumber = document.getElementById("contactNumber").value.trim();

  const storageOrCollectionInfo = document
    .getElementById("storageOrCollectionInfo")
    .value
    .trim();

  const isValuable = document.getElementById("isValuable").checked;
  const files = document.getElementById("reportPhotos").files;

  try {
    showFormMessage("Saving item report...", "info");

    const photoUrls = await uploadImages(files, "itemPhotos");

    const reportData = {
      reportType,
      itemName,
      category,
      description,
      identifyingCharacteristics,
      location,
      dateOccurred: firebase.firestore.Timestamp.fromDate(
        new Date(dateOccurredValue)
      ),
      contactNumber,
      storageOrCollectionInfo,
      isValuable,
      updatedAt: now()
    };

    if (reportId) {
      const existingReport = await getReport(reportId);

      if (!existingReport) {
        throw new Error("The report you are trying to update was not found.");
      }

      const allPhotoUrls = [
        ...(existingReport.photoUrls || []),
        ...photoUrls
      ];

      const updatedReport = {
        ...existingReport,
        id: reportId,
        ...reportData,
        photoUrls: allPhotoUrls
      };

      await db
        .collection("itemReports")
        .doc(reportId)
        .update({
          ...reportData,
          photoUrls: allPhotoUrls
        });

      await runMatching(updatedReport);

      setFlash(
        "Item report updated successfully. Possible matches were rechecked.",
        "success"
      );

      go(`item/${reportId}`);
    } else {
      const reference = db.collection("itemReports").doc();

      const newReport = {
        id: reference.id,
        ...reportData,
        reporterId: state.user.uid,
        photoUrls,
        reportStatus: "active",
        createdAt: now()
      };

      await reference.set(newReport);

      await runMatching(newReport);

      setFlash(
        "Item report submitted successfully. The system checked for possible matches.",
        "success"
      );

      go("my-reports");
    }
  } catch (error) {
    console.error("Report form error:", error);
    showFormMessage(firebaseError(error));
  }
}

/* -----------------------------------
   DELETE REPORT
----------------------------------- */

async function deleteReport(reportId) {
  const report = await getReport(reportId);

  if (!report) {
    alert("The report was not found.");
    return;
  }

  if (!isActiveReport(report)) {
    alert("Returned, claimed, unclaimed, or disposed reports cannot be deleted.");
    return;
  }

  const confirmed = window.confirm(
    "Are you sure you want to delete this item report?"
  );

  if (!confirmed) {
    return;
  }

  try {
    await db
      .collection("itemReports")
      .doc(reportId)
      .delete();

    setFlash("Item report deleted successfully.", "success");

    go("my-reports");
  } catch (error) {
    alert(firebaseError(error));
  }
}

/* -----------------------------------
   OWNERSHIP CLAIM SUBMISSION
----------------------------------- */

async function handleClaimForm(event) {
  event.preventDefault();

  const reportId = event.currentTarget.dataset.reportId;

  try {
    const report = await getReport(reportId);

    if (!report) {
      throw new Error("Item report was not found.");
    }

    if (report.reportType !== "found") {
      throw new Error(
        "Ownership claims can only be submitted for found items."
      );
    }

    if (report.reporterId === state.user.uid) {
      throw new Error(
        "You cannot submit a claim for your own found-item report."
      );
    }

    if (!["active", "matched"].includes(report.reportStatus)) {
      throw new Error(
        "This item is no longer available for an ownership claim."
      );
    }

    const evidenceDescription = document
      .getElementById("evidenceDescription")
      .value
      .trim();

    const files = document.getElementById("evidencePhotos").files;

    showFormMessage("Submitting ownership claim...", "info");

    const evidencePhotoUrls = await uploadImages(
      files,
      "claimEvidence"
    );

    const claimReference = await db
      .collection("ownershipClaims")
      .add({
        reportId,
        claimantId: state.user.uid,
        evidenceDescription,
        evidencePhotoUrls,
        claimStatus: "pending",
        reviewedBy: null,
        reviewerRemarks: "",
        collectionInstruction: "",
        submittedAt: now(),
        reviewedAt: null
      });

    await createNotification(
      null,
      "mpp_admin",
      "claim",
      "New Ownership Claim Submitted",
      "A student submitted an ownership claim that requires MPP review.",
      reportId,
      claimReference.id
    );

    setFlash(
      "Ownership claim submitted successfully. MPP members will review your evidence.",
      "success"
    );

    go("my-claims");
  } catch (error) {
    console.error("Claim submission error:", error);
    showFormMessage(firebaseError(error));
  }
}

/* -----------------------------------
   EVENT BINDINGS
----------------------------------- */

function bindEvents() {
    if (document.getElementById("monthlyPdfForm")) {
    window.MppPdf.bind({
      db,
      state,
      escapeHtml
    });
  }
  const registerForm = document.getElementById("registerForm");
  const loginForm = document.getElementById("loginForm");
  const reportForm = document.getElementById("reportForm");
  const claimForm = document.getElementById("claimForm");
  const logoutButton = document.getElementById("logoutButton");
  const searchForm = document.getElementById("searchForm");
  const clearSearchButton = document.getElementById("clearSearchButton");
  const deleteReportButton = document.getElementById("deleteReportButton");

  if (registerForm) {
    registerForm.addEventListener("submit", handleRegistration);
  }

  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  if (reportForm) {
    reportForm.addEventListener("submit", handleReportForm);
  }

  if (claimForm) {
    claimForm.addEventListener("submit", handleClaimForm);
  }

  if (logoutButton) {
    logoutButton.addEventListener("click", handleLogout);
  }

  if (searchForm) {
    searchForm.addEventListener("submit", async event => {
      event.preventDefault();

      try {
        await loadSearchResults();
      } catch (error) {
        console.error(error);
      }
    });

    loadSearchResults().catch(console.error);
  }

  if (clearSearchButton) {
    clearSearchButton.addEventListener("click", async () => {
      document.getElementById("searchKeyword").value = "";
      document.getElementById("filterType").value = "";
      document.getElementById("filterCategory").value = "";
      document.getElementById("filterLocation").value = "";
      document.getElementById("filterDate").value = "";

      try {
        await loadSearchResults();
      } catch (error) {
        console.error(error);
      }
    });
  }

  if (deleteReportButton) {
    deleteReportButton.addEventListener("click", () => {
      deleteReport(deleteReportButton.dataset.reportId);
    });
  }

  document.querySelectorAll(".delete-report-button").forEach(button => {
    button.addEventListener("click", () => {
      deleteReport(button.dataset.reportId);
    });
  });

  document.querySelectorAll(".statusForm").forEach(form => {
    form.addEventListener("submit", async event => {
      event.preventDefault();

      const reportId = form.dataset.reportId;

      const newStatus = form.querySelector(
        '[name="reportStatus"]'
      ).value;

      const remarks = form.querySelector(
        '[name="remarks"]'
      ).value.trim();

      try {
        await updateReportStatus(reportId, newStatus, remarks);

                setFlash("Item status updated successfully.", "success");

        // Refresh the current page after the update.
        await renderSafely();
      } catch (error) {
        alert(firebaseError(error));
      }
    });
  });
  

  const claimReviewForm = document.getElementById("claimReviewForm");

  if (claimReviewForm) {
    claimReviewForm.addEventListener("submit", async event => {
      event.preventDefault();

      const claimId = claimReviewForm.dataset.claimId;
      const decision = document.getElementById("decision").value;

      const reviewerRemarks = document
        .getElementById("reviewerRemarks")
        .value
        .trim();

      const collectionInstruction = document
        .getElementById("collectionInstruction")
        .value
        .trim();

      if (!decision) {
        alert("Please select a claim decision.");
        return;
      }

      try {
        await reviewOwnershipClaim(
          claimId,
          decision,
          reviewerRemarks,
          collectionInstruction
        );

        setFlash(
          "Ownership claim reviewed successfully.",
          "success"
        );

        go("manage-claims");
      } catch (error) {
        alert(firebaseError(error));
      }
    });
  }

  document.querySelectorAll(".mark-read-button").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await db
          .collection("notifications")
          .doc(button.dataset.notificationId)
          .update({
            isRead: true
          });

        await renderSafely();
      } catch (error) {
        alert(firebaseError(error));
      }
    });
  });
}

/* -----------------------------------
   MAIN ROUTER
----------------------------------- */

async function render() {
  // Stop the dashboard listener before rendering another page.
  stopStudentLiveStatus();

  if (!state.ready) {
    showLoading();
    return;
  }

  const [page, id] = getRouteParts();

  if (!state.user) {
    if (!["home", "login", "register"].includes(page)) {
      go("login");
      return;
    }

    let content = homePage();

    if (page === "login") {
      content = loginPage();
    }

    if (page === "register") {
      content = registerPage();
    }

    app.innerHTML = layout(content);
    bindEvents();
    return;
  }

  if (!state.profile) {
    app.innerHTML = layout(`
      <section class="card form-card">
        <h2 class="card-title">Account Role Not Found</h2>

        <p>
          Your account exists, but the system cannot find your role
          in Cloud Firestore. Please contact the project developer.
        </p>

        <div style="margin-top: 16px;">
          <button id="logoutButton" class="btn btn-danger">
            Logout
          </button>
        </div>
      </section>
    `);

    bindEvents();
    return;
  }

  const studentPages = [
    "student-dashboard",
    "report",
    "edit",
    "browse",
    "item",
    "my-reports",
    "my-matches",
    "matches",
    "claim",
    "my-claims",
    "notifications"
  ];

  const mppPages = [
    "mpp-dashboard",
    "browse",
    "item",
    "manage-reports",
    "manage-claims",
    "review-claim",
    "unclaimed-items",
    "returned-history",
    "mpp-report",
    "notifications"
  ];

  if (
    state.profile.role === "student" &&
    !studentPages.includes(page)
  ) {
    go("student-dashboard");
    return;
  }

  if (
    state.profile.role === "mpp_admin" &&
    !mppPages.includes(page)
  ) {
    go("mpp-dashboard");
    return;
  }

  let content = "";

  if (page === "student-dashboard") {
    content = await studentDashboardPage();
  }

  if (page === "mpp-dashboard") {
    content = await mppDashboardPage();
  }

  if (page === "report") {
    content = reportFormPage();
  }

  if (page === "edit") {
    const report = await getReport(id);

    if (!report) {
      content = `
        <section class="card">
          <h2 class="card-title">Report Not Found</h2>
        </section>
      `;
    } else if (
      state.profile.role !== "student" ||
      report.reporterId !== state.user.uid
    ) {
      content = `
        <section class="card">
          <h2 class="card-title">Access Denied</h2>
          <p>You can only edit your own reports.</p>
        </section>
      `;
    } else if (!isActiveReport(report)) {
      content = `
        <section class="card">
          <h2 class="card-title">Report Cannot Be Edited</h2>
          <p>
            Claimed, returned, unclaimed, and disposed reports cannot be edited.
          </p>
        </section>
      `;
    } else {
      content = reportFormPage(report);
    }
  }

  if (page === "browse") {
    content = browsePage();
  }

  if (page === "item") {
    content = await itemDetailPage(id);
  }

  if (page === "my-reports") {
    content = await myReportsPage();
  }

  if (page === "my-matches") {
    content = await myMatchesPage();
  }

  if (page === "matches") {
    content = await possibleMatchesPage(id);
  }

  if (page === "claim") {
    content = await claimFormPage(id);
  }

  if (page === "my-claims") {
    content = await myClaimsPage();
  }

  if (page === "manage-reports") {
    content = await manageReportsPage();
  }

  if (page === "manage-claims") {
    content = await manageClaimsPage();
  }

  if (page === "review-claim") {
    content = await reviewClaimPage(id);
  }

  if (page === "unclaimed-items") {
    content = await unclaimedItemsPage();
  }

  if (page === "returned-history") {
    content = await returnedHistoryPage();
  }
    
  if (page === "mpp-report") {
    content = window.MppPdf.pageHtml();
  }

    if (page === "notifications") {
    content = await notificationsPage();
  }

  // If the user changed pages while data was loading,
  // do not display the previous page.
  const [currentPage, currentId] = getRouteParts();

  if (currentPage !== page || currentId !== id) {
    return;
  }

  app.innerHTML = layout(content);
  bindEvents();

  // Start the live listener only on the student dashboard.
  if (
    page === "student-dashboard" &&
    state.profile?.role === "student"
  ) {
    startStudentLiveStatus();
  }
}

async function renderSafely() {
  try {
    await render();
  } catch (error) {
    showSystemError(error);
  }
}

/* -----------------------------------
   FIREBASE AUTH STATE
----------------------------------- */

auth.onAuthStateChanged(async user => {
  state.user = user;
  state.profile = null;

  if (user) {
    try {
      state.profile = await getProfile(user.uid);
    } catch (error) {
      console.error("Unable to load user profile:", error);
    }
  }

  state.ready = true;

    await renderSafely();
});

window.addEventListener("hashchange", renderSafely);