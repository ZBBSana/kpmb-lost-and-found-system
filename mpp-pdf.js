/*
  MPP MONTHLY PDF REPORT

  This file works with the existing KPMB hash-router application.
  It uses Cloud Firestore and generates the PDF in the browser.
*/

window.MppPdf = (() => {
  let pdfUrl = null;
  let pdfFileName = "KPMB_Monthly_Report.pdf";

  function pageHtml() {
    const today = new Date();

    // Set the default month using Malaysia time.
    const malaysiaMonth = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(today);

    const year = malaysiaMonth.find(part => part.type === "year").value;
    const month = malaysiaMonth.find(part => part.type === "month").value;

    return `
      <section class="page-heading">
        <h2>MPP Monthly PDF Report</h2>

        <p>
          Filter item reports by month, status, and report type.
          Generate a PDF to view, download, or print.
        </p>
      </section>

      <section class="card">
        <h3 class="card-title">Report Filters</h3>

        <div id="pdfMessage"></div>

        <form id="monthlyPdfForm">
          <div class="form-group">
            <label for="pdfMonth">Month *</label>

            <input
              type="month"
              id="pdfMonth"
              value="${year}-${month}"
              required
            >
          </div>

          <div class="form-group">
            <label for="pdfBasis">Month applies to *</label>

            <select id="pdfBasis">
              <option value="created">
                Date the report was created
              </option>

              <option value="changed">
                Date the status was changed
              </option>
            </select>
          </div>

          <div class="form-group">
            <label for="pdfStatus">Status</label>

            <select id="pdfStatus">
              <option value="">All statuses</option>
              <option value="active">Active</option>
              <option value="matched">Matched</option>
              <option value="claimed">Claimed</option>
              <option value="returned">Returned</option>
              <option value="unclaimed">Unclaimed</option>
              <option value="disposed">Disposed</option>
            </select>
          </div>

          <div class="form-group">
            <label for="pdfType">Report type</label>

            <select id="pdfType">
              <option value="">Lost and Found</option>
              <option value="lost">Lost only</option>
              <option value="found">Found only</option>
            </select>
          </div>

          <p class="form-note">
            For “report created”, the status filter checks the
            <strong>current status</strong>. For “status changed”,
            it checks the <strong>new status</strong> recorded in
            the selected month.
          </p>

          <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <button
              type="submit"
              id="generatePdfButton"
              class="btn btn-primary"
            >
              Generate PDF
            </button>

            <button
              type="button"
              id="downloadPdfButton"
              class="btn btn-outline"
              disabled
            >
              Download PDF
            </button>

            <button
              type="button"
              id="openPdfButton"
              class="btn btn-outline"
              disabled
            >
              Open / Print PDF
            </button>
          </div>
        </form>
      </section>

      <section class="card" style="margin-top: 20px;">
        <h3 class="card-title">Report Preview</h3>

        <p id="pdfSummary">No report has been generated yet.</p>

        <div class="table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Item</th>
                <th>Type</th>
                <th>Category</th>
                <th>Status</th>
                <th>Report ID</th>
              </tr>
            </thead>

            <tbody id="pdfPreviewBody">
              <tr>
                <td colspan="6">Choose filters and generate a report.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="card" style="margin-top: 20px;">
        <h3 class="card-title">PDF Viewer</h3>

        <p class="form-note">
          If the PDF does not appear here, use “Open / Print PDF”
          or download it.
        </p>

        <iframe
          id="monthlyPdfFrame"
          title="Monthly PDF report"
          style="width: 100%; height: 600px; border: 1px solid #ddd;"
        ></iframe>
      </section>
    `;
  }

  function malaysiaMonthRange(value) {
    const match = /^(\d{4})-(\d{2})$/.exec(value);

    if (!match) {
      throw new Error("Please select a valid month.");
    }

    const year = Number(match[1]);
    const month = Number(match[2]);

    if (year < 1 || month < 1 || month > 12) {
      throw new Error("Please select a valid month.");
    }

    /*
      Malaysia uses UTC+8. The start and end are inclusive/exclusive:
      [first day of month, first day of next month).
    */
    const start = Date.UTC(year, month - 1, 1) - 8 * 60 * 60 * 1000;
    const end = Date.UTC(year, month, 1) - 8 * 60 * 60 * 1000;

    return { start, end };
  }

  function toMillis(value) {
    if (!value) return null;

    if (typeof value.toMillis === "function") {
      return value.toMillis();
    }

    const date = new Date(value);
    const time = date.getTime();

    return Number.isNaN(time) ? null : time;
  }

  function inRange(value, range) {
    const time = toMillis(value);

    return time !== null && time >= range.start && time < range.end;
  }

  function formatMalaysiaDate(value) {
    const time = toMillis(value);

    if (time === null) return "-";

    return new Intl.DateTimeFormat("en-MY", {
      timeZone: "Asia/Kuala_Lumpur",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(time));
  }

  function showMessage(message, type, escapeHtml) {
    const box = document.getElementById("pdfMessage");

    if (!box) return;

    box.innerHTML = `
      <div class="alert alert-${type}">
        ${escapeHtml(message)}
      </div>
    `;
  }

  function clearPreviousPdf() {
    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      pdfUrl = null;
    }

    const frame = document.getElementById("monthlyPdfFrame");
    const download = document.getElementById("downloadPdfButton");
    const open = document.getElementById("openPdfButton");

    if (frame) frame.removeAttribute("src");
    if (download) download.disabled = true;
    if (open) open.disabled = true;
  }

  async function getRows(db, options) {
    const range = malaysiaMonthRange(options.month);

    const reportSnapshot = await db
      .collection("itemReports")
      .get();

    const reports = reportSnapshot.docs.map(document => ({
      ...document.data(),
      id: document.id
    }));

    const reportsById = new Map(
      reports.map(report => [report.id, report])
    );

    if (options.basis === "created") {
      return reports
        .filter(report => inRange(report.createdAt, range))
        .filter(report =>
          !options.status || report.reportStatus === options.status
        )
        .filter(report =>
          !options.type || report.reportType === options.type
        )
        .map(report => ({
          dateValue: report.createdAt,
          item: report.itemName || "-",
          type: report.reportType || "-",
          category: report.category || "-",
          status: report.reportStatus || "-",
          reportId: report.id
        }))
        .sort((a, b) => toMillis(a.dateValue) - toMillis(b.dateValue));
    }

    const historySnapshot = await db
      .collection("statusHistory")
      .get();

    return historySnapshot.docs
      .map(document => document.data())
      .filter(history => inRange(history.changedAt, range))
      .filter(history =>
        !options.status || history.newStatus === options.status
      )
      .map(history => {
        const report = reportsById.get(history.reportId);

        return {
          dateValue: history.changedAt,
          item: report?.itemName || "Report no longer available",
          type: report?.reportType || "-",
          category: report?.category || "-",
          status: history.newStatus || "-",
          reportId: history.reportId || "-"
        };
      })
      .filter(row => !options.type || row.type === options.type)
      .sort((a, b) => toMillis(a.dateValue) - toMillis(b.dateValue));
  }

  function renderPreview(rows, escapeHtml) {
    const body = document.getElementById("pdfPreviewBody");
    const summary = document.getElementById("pdfSummary");

    summary.textContent = `${rows.length} record(s) found.`;

    if (!rows.length) {
      body.innerHTML = `
        <tr>
          <td colspan="6">No records match the selected filters.</td>
        </tr>
      `;

      return;
    }

    body.innerHTML = rows.map(row => `
      <tr>
        <td>${escapeHtml(formatMalaysiaDate(row.dateValue))}</td>
        <td>${escapeHtml(row.item)}</td>
        <td>${escapeHtml(row.type)}</td>
        <td>${escapeHtml(row.category)}</td>
        <td>${escapeHtml(row.status)}</td>
        <td>${escapeHtml(row.reportId)}</td>
      </tr>
    `).join("");
  }

  function makePdf(rows, options, adminName) {
    if (!window.jspdf?.jsPDF) {
      throw new Error(
        "jsPDF did not load. Check the script tags and internet connection."
      );
    }

    const documentPdf = new window.jspdf.jsPDF();

    if (typeof documentPdf.autoTable !== "function") {
      throw new Error(
        "The PDF table library did not load. Check the script order."
      );
    }

    const basisLabel = options.basis === "created"
      ? "Report creation date; current status"
      : "Status change date; new status";

    documentPdf.setFontSize(15);
    documentPdf.text("KPMB Lost and Found", 14, 18);

    documentPdf.setFontSize(11);
    documentPdf.text("MPP Monthly Report", 14, 26);

    documentPdf.setFontSize(9);
    documentPdf.text(`Month: ${options.month}`, 14, 34);
    documentPdf.text(`Date basis: ${basisLabel}`, 14, 40);
    documentPdf.text(
      `Status: ${options.status || "All"} | Type: ${options.type || "All"}`,
      14,
      46
    );
    documentPdf.text(
      `Generated: ${formatMalaysiaDate(new Date())} (Malaysia time)`,
      14,
      52
    );
    documentPdf.text(`Generated by: ${adminName}`, 14, 58);
    documentPdf.text(`Records: ${rows.length}`, 14, 64);

    const tableRows = rows.length
      ? rows.map(row => [
          formatMalaysiaDate(row.dateValue),
          String(row.item),
          String(row.type),
          String(row.category),
          String(row.status),
          String(row.reportId)
        ])
      : [["No matching records", "", "", "", "", ""]];

    documentPdf.autoTable({
      startY: 70,

      head: [[
        "Date",
        "Item",
        "Type",
        "Category",
        "Status",
        "Report ID"
      ]],

      body: tableRows,

      styles: {
        fontSize: 8,
        cellPadding: 2
      },

      headStyles: {
        fillColor: [138, 109, 26]
      },

      didDrawPage: function (data) {
        const pageHeight = documentPdf.internal.pageSize.getHeight();

        documentPdf.setFontSize(8);
        documentPdf.text(
          `KPMB Lost and Found | Page ${data.pageNumber}`,
          14,
          pageHeight - 8
        );
      }
    });

    return documentPdf;
  }

  function bind(context) {
    const form = document.getElementById("monthlyPdfForm");

    if (!form) return;

    const generateButton = document.getElementById("generatePdfButton");
    const downloadButton = document.getElementById("downloadPdfButton");
    const openButton = document.getElementById("openPdfButton");

    // Every time the page is opened, start with no old PDF.
    clearPreviousPdf();

    form.addEventListener("submit", async event => {
      event.preventDefault();

      if (context.state.profile?.role !== "mpp_admin") {
        showMessage(
          "Only MPP administrators may generate this report.",
          "error",
          context.escapeHtml
        );
        return;
      }

      const options = {
        month: document.getElementById("pdfMonth").value,
        basis: document.getElementById("pdfBasis").value,
        status: document.getElementById("pdfStatus").value,
        type: document.getElementById("pdfType").value
      };

      clearPreviousPdf();

      generateButton.disabled = true;
      generateButton.textContent = "Generating...";

      showMessage("Loading report data...", "info", context.escapeHtml);

      try {
        const rows = await getRows(context.db, options);

        // Stop if the user left the report page while loading.
        if (!document.getElementById("monthlyPdfForm")) {
          return;
        }

        renderPreview(rows, context.escapeHtml);

        const pdf = makePdf(
          rows,
          options,
          context.state.profile.fullName || "MPP Administrator"
        );

        pdfUrl = URL.createObjectURL(pdf.output("blob"));

        pdfFileName =
          `KPMB_Report_${options.month}_${options.basis}.pdf`;

        document.getElementById("monthlyPdfFrame").src = pdfUrl;

        downloadButton.disabled = false;
        openButton.disabled = false;

        showMessage(
          `PDF generated successfully: ${rows.length} record(s).`,
          "success",
          context.escapeHtml
        );
      } catch (error) {
        console.error("PDF report error:", error);

        showMessage(
          error.message || "Could not generate the PDF.",
          "error",
          context.escapeHtml
        );
      } finally {
        if (document.getElementById("generatePdfButton") === generateButton) {
          generateButton.disabled = false;
          generateButton.textContent = "Generate PDF";
        }
      }
    });

    downloadButton.addEventListener("click", () => {
      if (!pdfUrl) return;

      const link = document.createElement("a");

      link.href = pdfUrl;
      link.download = pdfFileName;

      document.body.appendChild(link);
      link.click();
      link.remove();
    });

    openButton.addEventListener("click", () => {
      if (!pdfUrl) return;

      const newWindow = window.open(pdfUrl, "_blank");

      if (!newWindow) {
        showMessage(
          "The browser blocked the new tab. Allow pop-ups or download the PDF.",
          "error",
          context.escapeHtml
        );
      }
    });
  }

  return {
    pageHtml,
    bind
  };
})();