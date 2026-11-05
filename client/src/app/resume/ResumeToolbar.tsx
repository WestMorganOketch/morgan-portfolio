"use client";

import { ArrowLeft, Download, Printer } from "lucide-react";

export default function ResumeToolbar() {
  function goBack() {
    const referrer = document.referrer;
    if (referrer && new URL(referrer, window.location.href).origin === window.location.origin) {
      window.history.back();
      return;
    }
    window.location.assign("/");
  }

  function printResume() {
    const previousTitle = document.title;
    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener("afterprint", restoreTitle);
    };
    document.addEventListener("afterprint", restoreTitle, { once: true });
    document.title = "Morgan-West-Oketch-Resume";
    window.print();
    window.setTimeout(restoreTitle, 1000);
  }

  return (
    <div className="resume-toolbar" role="group" aria-label="Résumé actions">
      <button className="resume-button resume-button-ghost" onClick={goBack} type="button">
        <ArrowLeft aria-hidden="true" size={17} />
        Back
      </button>
      <div className="resume-toolbar-actions">
        <a
          aria-label="Download résumé as PDF"
          className="resume-button resume-button-primary"
          download="Morgan-West-Oketch-Resume.pdf"
          href="/resume.pdf"
        >
          <Download aria-hidden="true" size={17} />
          Download PDF (ATS)
        </a>
        <button
          aria-label="Print résumé"
          className="resume-button resume-button-secondary"
          onClick={printResume}
          type="button"
        >
          <Printer aria-hidden="true" size={17} />
          Print
        </button>
      </div>
    </div>
  );
}
