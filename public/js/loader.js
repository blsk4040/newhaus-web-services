// ==================== PRODUCTION UNIVERSAL LOADER (STABLE FINAL) ====================

function getComponentBasePath() {
  return "/public/components/";
}

async function safeFetch(url) {
  try {
    console.log("🔍 Fetching:", url);

    const res = await fetch(url);

    if (!res.ok) {
      console.warn("⚠️ Failed:", url, "Status:", res.status);
      return null;
    }

    return await res.text();

  } catch (err) {
    console.error("❌ Fetch error:", url, err);
    return null;
  }
}

async function loadComponent(id, file) {
  const container = document.getElementById(id);

  if (!container) {
    console.warn(`⚠️ Missing container: #${id}`);
    return;
  }

  const base = getComponentBasePath();
  const url = base + file;

  const html = await safeFetch(url);

  if (!html) {
    console.error(`❌ Component failed to load: ${file}`);
    return;
  }

  const cleanHTML = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  container.innerHTML = cleanHTML;

  console.log(`✅ Loaded: ${file} → #${id}`);
}

// ====================== INIT FUNCTIONS ======================

function initNavToggle() {
  const navToggle = document.getElementById("nav-toggle");
  const mobileNav = document.getElementById("mobile-nav");

  if (!navToggle || !mobileNav) return;

  navToggle.addEventListener("click", () => {
    mobileNav.classList.toggle("hidden");

    const expanded = !mobileNav.classList.contains("hidden");
    navToggle.setAttribute("aria-expanded", expanded);

    const icon = navToggle.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-bars", !expanded);
      icon.classList.toggle("fa-times", expanded);
    }
  });
}

function initFooterYear() {
  const el = document.getElementById("footer-year");
  if (el) el.textContent = new Date().getFullYear();
}

function setActiveNav() {
  const links = document.querySelectorAll(".nav-link");
  const path = window.location.pathname.toLowerCase();

  links.forEach(l => l.classList.remove("active"));

  if (path.includes("system-assessment")) {
    const a = document.querySelector('.nav-link[href*="system-assessment"]');
    if (a) a.classList.add("active");
    return;
  }

  if (path.includes("shop")) {
    const s = document.querySelector('.nav-link[data-link="shop"]');
    if (s) s.classList.add("active");
    return;
  }

  const home = document.querySelector('.nav-link[data-link="home"]');
  if (home) home.classList.add("active");
}

function handleAnchorLinks() {
  document.querySelectorAll('a[href^="#"], a[href^="/#"]').forEach(a => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href").replace(/^\/#?/, "");
      const target = document.getElementById(id);

      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

// ====================== PRICING MODAL INIT ======================

function initPricingLeadModal() {
  const modal = document.getElementById("pricingLeadModal");
  const modalClose = document.getElementById("pricingLeadModalClose");
  const pricingButtons = document.querySelectorAll(".pricing-lead-btn");
  const selectedPackageName = document.getElementById("selectedPackageName");
  const selectedPackagePrice = document.getElementById("selectedPackagePrice");
  const pricingLeadForm = document.getElementById("pricingLeadForm");
  const pricingLeadSubmit = document.getElementById("pricingLeadSubmit");
  const pricingLeadStatus = document.getElementById("pricingLeadStatus");

  if (!modal || !pricingLeadForm || pricingButtons.length === 0) {
    console.warn("⚠️ Pricing modal elements not found, skipping init.");
    return;
  }

  if (modal.dataset.initialized === "true") {
    return;
  }

  modal.dataset.initialized = "true";

  let selectedPackage = "";
  let selectedPrice = "";

  function openModal() {
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    document.body.classList.add("overflow-hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    document.body.classList.remove("overflow-hidden");
  }

  function showStatus(message, type = "info") {
    pricingLeadStatus.classList.remove(
      "hidden",
      "bg-red-100", "text-red-700",
      "bg-green-100", "text-green-700",
      "bg-blue-100", "text-blue-700"
    );

    if (type === "error") {
      pricingLeadStatus.classList.add("bg-red-100", "text-red-700");
    } else if (type === "success") {
      pricingLeadStatus.classList.add("bg-green-100", "text-green-700");
    } else {
      pricingLeadStatus.classList.add("bg-blue-100", "text-blue-700");
    }

    pricingLeadStatus.innerHTML = message;
  }

  function setSubmitting(isSubmitting) {
    pricingLeadSubmit.disabled = isSubmitting;
    pricingLeadSubmit.textContent = isSubmitting ? "Submitting..." : "Submit Request";
  }

  pricingButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedPackage = button.dataset.package || "";
      selectedPrice = button.dataset.price || "";

      if (selectedPackageName) selectedPackageName.textContent = selectedPackage;
      if (selectedPackagePrice) selectedPackagePrice.textContent = selectedPrice;

      pricingLeadStatus.classList.add("hidden");
      pricingLeadForm.reset();

      openModal();
    });
  });

  if (modalClose) {
    modalClose.addEventListener("click", closeModal);
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });

  pricingLeadForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const payload = {
      formType: "Pricing CTA",
      crmLeadSource: "Website Pricing",
      fullName: document.getElementById("pricingFullName").value.trim(),
      email: document.getElementById("pricingEmail").value.trim(),
      phone: document.getElementById("pricingPhone").value.trim(),
      company: document.getElementById("pricingCompany").value.trim(),
      selectedPackage,
      selectedPrice,
      notes: document.getElementById("pricingNotes").value.trim(),
      pageUrl: window.location.href
    };

    if (!payload.fullName || !payload.email) {
      showStatus("Please fill in your full name and email address.", "error");
      return;
    }

    try {
      setSubmitting(true);
      showStatus("Submitting your request...", "info");

      const response = await fetch("http://localhost:3000/api/create-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to submit package request");
      }

      pricingLeadForm.classList.add("hidden");

      showStatus(
        `<div class="text-center">
          <div class="text-xl font-bold mb-2">Thank you</div>
          <div class="mb-4">Your request has been submitted successfully. We’ll contact you shortly.</div>
          <div class="flex justify-center">
            <button type="button" onclick="window.location.href='/public/index.html#pricing'" class="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition">
              Back to Home
            </button>
          </div>
        </div>`,
        "success"
      );

      setTimeout(() => {
        closeModal();
        pricingLeadForm.reset();
        pricingLeadForm.classList.remove("hidden");
        pricingLeadStatus.classList.add("hidden");
      }, 3500);

    } catch (error) {
      console.error("Pricing lead submit error:", error);
      showStatus("There was a problem submitting your request. Please try again.", "error");
    } finally {
      setSubmitting(false);
    }
  });

  console.log("✅ Pricing modal initialized");
}

// ====================== CONTACT FORM INIT ======================

function initContactLeadForm() {
  const contactLeadForm = document.getElementById("contactLeadForm");
  const contactLeadSubmit = document.getElementById("contactLeadSubmit");
  const contactLeadStatus = document.getElementById("contactLeadStatus");

  if (!contactLeadForm || !contactLeadSubmit || !contactLeadStatus) {
    console.warn("⚠️ Contact form elements not found, skipping init.");
    return;
  }

  if (contactLeadForm.dataset.initialized === "true") {
    return;
  }

  contactLeadForm.dataset.initialized = "true";

  function showContactStatus(message, type = "info") {
    contactLeadStatus.classList.remove(
      "hidden",
      "bg-red-100", "text-red-700",
      "bg-green-100", "text-green-700",
      "bg-blue-100", "text-blue-700"
    );

    if (type === "error") {
      contactLeadStatus.classList.add("bg-red-100", "text-red-700");
    } else if (type === "success") {
      contactLeadStatus.classList.add("bg-green-100", "text-green-700");
    } else {
      contactLeadStatus.classList.add("bg-blue-100", "text-blue-700");
    }

    contactLeadStatus.innerHTML = message;
  }

  function setContactSubmitting(isSubmitting) {
    contactLeadSubmit.disabled = isSubmitting;
    contactLeadSubmit.textContent = isSubmitting ? "Sending..." : "Send Message";
  }

  contactLeadForm.addEventListener("submit", async function (e) {
    e.preventDefault();

    const payload = {
      formType: "Contact Us",
      crmLeadSource: "Website Contact",
      fullName: document.getElementById("contactFullName").value.trim(),
      email: document.getElementById("contactEmail").value.trim(),
      phone: document.getElementById("contactPhone").value.trim(),
      company: document.getElementById("contactCompany").value.trim() || "Website Contact",
      businessType: document.getElementById("contactService").value || "General Enquiry",
      message: document.getElementById("contactMessage").value.trim(),
      notes: document.getElementById("contactMessage").value.trim(),
      pageUrl: window.location.href
    };

    if (!payload.fullName || !payload.email || !payload.message) {
      showContactStatus("Please fill in your full name, email address, and message.", "error");
      return;
    }

    try {
      setContactSubmitting(true);
      showContactStatus("Submitting your message...", "info");

      const response = await fetch("http://localhost:3000/api/create-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.message || "Failed to submit contact enquiry");
      }

      contactLeadForm.innerHTML = `
        <div class="bg-green-100 text-green-700 rounded-2xl p-8 text-center">
          <div class="text-4xl mb-3">✅</div>
          <div class="text-2xl font-bold mb-2">Thank you for submitting</div>
          <div class="mb-3">Your message has been sent successfully.</div>
          <div class="text-sm mb-6">Our team will get back to you shortly.</div>
          <button
            type="button"
            onclick="window.location.href='/public/index.html#contact'"
            class="bg-blue-600 text-white px-6 py-3 rounded-xl hover:bg-blue-700 transition"
          >
            Back to Contact Section
          </button>
        </div>
      `;

    } catch (error) {
      console.error("Contact form submit error:", error);
      showContactStatus("There was a problem sending your message. Please try again.", "error");
    } finally {
      setContactSubmitting(false);
    }
  });

  console.log("✅ Contact form initialized");
}

// ====================== MAIN BOOT ======================

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Loader starting...");

  const tasks = [
    loadComponent("nav-container", "nav.html"),
    loadComponent("footer-container", "footer.html")
  ];

  if (document.getElementById("services-container")) {
    tasks.push(loadComponent("services-container", "services.html"));
  }

  if (document.getElementById("pricing-container")) {
    tasks.push(loadComponent("pricing-container", "pricing.html"));
  }

  if (document.getElementById("trust-container")) {
    tasks.push(loadComponent("trust-container", "trust.html"));
  }

  if (document.getElementById("sla-container")) {
    tasks.push(loadComponent("sla-container", "sla.html"));
  }

  if (document.getElementById("contact-container")) {
    tasks.push(loadComponent("contact-container", "contact.html"));
  }

  await Promise.allSettled(tasks);

  console.log("✅ All components loaded (final pass)");

  if (document.getElementById("pricing-container")) {
    initPricingLeadModal();
  }

  if (document.getElementById("contact-container")) {
    initContactLeadForm();
  }

  initNavToggle();
  initFooterYear();
  handleAnchorLinks();
  setActiveNav();

  if (typeof AOS !== "undefined") {
    AOS.refreshHard();
  }
});