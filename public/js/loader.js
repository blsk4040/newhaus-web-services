// ==================== PRODUCTION UNIVERSAL LOADER ====================

function getComponentBasePath() {
  const loaderScript = document.currentScript || document.querySelector('script[src$="js/loader.js"]');

  if (loaderScript && loaderScript.src) {
    return new URL("../components/", loaderScript.src).pathname;
  }

  return "/components/";
}

function getSiteBasePath() {
  const loaderScript = document.currentScript || document.querySelector('script[src$="js/loader.js"]');

  if (loaderScript && loaderScript.src) {
    return new URL("../", loaderScript.src).pathname;
  }

  return "/";
}

function toSitePath(path) {
  const basePath = getSiteBasePath();

  if (path === "/") {
    return `${basePath}index.html`;
  }

  if (path.startsWith("/#")) {
    return `${basePath}index.html${path.slice(1)}`;
  }

  const cleanPath = path.replace(/^\//, "");
  return `${basePath}${cleanPath}`;
}

function getComponentVersion() {
  return "v=20260502-1";
}

function getApiBaseUrl() {
  const metaValue = document.querySelector('meta[name="nhx-api-base"]')?.content?.trim();
  const runtimeValue = typeof window.NHX_API_BASE === "string" ? window.NHX_API_BASE.trim() : "";
  const baseUrl = metaValue || runtimeValue || "";
  return baseUrl.replace(/\/$/, "");
}

async function safeFetch(url) {
  try {
    console.log("Fetching:", url);

    const res = await fetch(url);

    if (!res.ok) {
      console.warn("Failed:", url, "Status:", res.status);
      return null;
    }

    return await res.text();
  } catch (err) {
    console.error("Fetch error:", url, err);
    return null;
  }
}

async function loadComponent(id, file) {
  const container = document.getElementById(id);

  if (!container) {
    console.warn(`Missing container: #${id}`);
    return;
  }

  const url = `${getComponentBasePath()}${file}?${getComponentVersion()}`;
  const html = await safeFetch(url);

  if (!html) {
    console.error(`Component failed to load: ${file}`);
    return;
  }

  const cleanHTML = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  container.innerHTML = cleanHTML;

  console.log(`Loaded: ${file} -> #${id}`);
}

function initNavToggle() {
  const navToggle = document.getElementById("nav-toggle");
  const mobileNav = document.getElementById("mobile-nav");

  if (!navToggle || !mobileNav) return;
  if (navToggle.dataset.initialized === "true") return;

  navToggle.dataset.initialized = "true";

  navToggle.addEventListener("click", () => {
    mobileNav.classList.toggle("hidden");

    const expanded = !mobileNav.classList.contains("hidden");
    navToggle.setAttribute("aria-expanded", String(expanded));

    const icon = navToggle.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-bars", !expanded);
      icon.classList.toggle("fa-times", expanded);
    }
  });

  mobileNav.addEventListener("click", (event) => {
    if (!event.target.closest("a, button")) return;

    mobileNav.classList.add("hidden");
    navToggle.setAttribute("aria-expanded", "false");

    const icon = navToggle.querySelector("i");
    if (icon) {
      icon.classList.add("fa-bars");
      icon.classList.remove("fa-times");
    }
  });
}

function initFooterYear() {
  const el = document.getElementById("footer-year");
  if (el) el.textContent = new Date().getFullYear();
}

function normalizeInternalPaths() {
  document.querySelectorAll("a[href^='/']").forEach((link) => {
    const href = link.getAttribute("href");
    if (!href || href.startsWith("//")) return;
    link.setAttribute("href", toSitePath(href));
  });

  document.querySelectorAll("img[src^='/']").forEach((image) => {
    const src = image.getAttribute("src");
    if (!src || src.startsWith("//")) return;
    image.setAttribute("src", toSitePath(src));
  });
}

function setActiveNav() {
  const links = document.querySelectorAll(".nav-link");
  const path = window.location.pathname.toLowerCase();

  links.forEach((link) => link.classList.remove("active"));

  if (path.includes("system-assessment")) {
    const assessmentLink = document.querySelector('.nav-link[href*="system-assessment"]');
    if (assessmentLink) assessmentLink.classList.add("active");
    return;
  }

  if (path.includes("shop")) {
    const shopLink = document.querySelector('.nav-link[data-link="shop"]');
    if (shopLink) shopLink.classList.add("active");
    return;
  }

  const homeLink = document.querySelector('.nav-link[data-link="home"]');
  if (homeLink) homeLink.classList.add("active");
}

function handleAnchorLinks() {
  document.querySelectorAll('a[href^="#"], a[href^="/#"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      const id = href ? href.replace(/^\/#?/, "") : "";
      const target = document.getElementById(id);

      if (target) {
        event.preventDefault();
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function initScrollTargetButtons() {
  document.querySelectorAll("[data-scroll-target]").forEach((button) => {
    if (button.dataset.initialized === "true") return;

    button.dataset.initialized = "true";
    button.addEventListener("click", () => {
      const targetId = button.dataset.scrollTarget;
      const target = targetId ? document.getElementById(targetId) : null;

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

function initPricingLeadModal() {
  const modal = document.getElementById("pricingLeadModal");
  const modalClose = document.getElementById("pricingLeadModalClose");
  const pricingButtons = document.querySelectorAll(".pricing-lead-btn");
  const selectedPackageName = document.getElementById("selectedPackageName");
  const selectedPackagePrice = document.getElementById("selectedPackagePrice");
  const pricingLeadForm = document.getElementById("pricingLeadForm");
  const pricingLeadSubmit = document.getElementById("pricingLeadSubmit");
  const pricingLeadStatus = document.getElementById("pricingLeadStatus");
  const pricingMainChallenge = document.getElementById("pricingMainChallenge");

  const packageChallengeMap = {
    "Business Communication System": "Improve communication and calls",
    "Customer, Sales & Automation System": "Track customers and follow-ups",
    "Managed IT & Support": "Improve IT reliability and security",
    "Complete Business Operating System": "Build a complete connected system",
    "Cybersecurity & Compliance System": "Improve IT reliability and security"
  };

  if (!modal || !pricingLeadForm || pricingButtons.length === 0) {
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
    document.body.classList.add("pricing-modal-open");
    document.documentElement.classList.add("overflow-hidden");
    document.body.classList.add("overflow-hidden");
  }

  function closeModal() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    document.body.classList.remove("pricing-modal-open");
    document.documentElement.classList.remove("overflow-hidden");
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
    pricingLeadSubmit.textContent = isSubmitting ? "Submitting..." : "Submit System Advice Request";
  }

  pricingButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectedPackage = button.dataset.package || "";
      selectedPrice = button.dataset.price || "";

      if (selectedPackageName) selectedPackageName.textContent = selectedPackage;
      if (selectedPackagePrice) selectedPackagePrice.textContent = selectedPrice;

      pricingLeadStatus.classList.add("hidden");
      pricingLeadForm.reset();
      pricingLeadForm.classList.remove("hidden");
      if (pricingMainChallenge && packageChallengeMap[selectedPackage]) {
        pricingMainChallenge.value = packageChallengeMap[selectedPackage];
      }

      openModal();
    });
  });

  if (modalClose) {
    modalClose.addEventListener("click", closeModal);
  }

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeModal();
    }
  });

  pricingLeadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const payload = {
      formType: "Pricing CTA",
      crmLeadSource: "Website Pricing",
      fullName: document.getElementById("pricingFullName").value.trim(),
      email: document.getElementById("pricingEmail").value.trim(),
      phone: document.getElementById("pricingPhone").value.trim(),
      company: document.getElementById("pricingCompany").value.trim(),
      website: document.getElementById("pricingWebsite")?.value.trim() || "",
      mainChallenge: document.getElementById("pricingMainChallenge")?.value || "",
      businessSize: document.getElementById("pricingBusinessSize")?.value || "",
      selectedPackage,
      selectedPrice,
      notes: document.getElementById("pricingNotes").value.trim(),
      pageUrl: window.location.href
    };

    payload.message = [
      `Selected System: ${payload.selectedPackage}`,
      `Selected Price: ${payload.selectedPrice}`,
      `Main Challenge: ${payload.mainChallenge}`,
      `Business Size: ${payload.businessSize || "Not provided"}`,
      `Website: ${payload.website || "Not provided"}`,
      `Notes: ${payload.notes || "Not provided"}`
    ].join("\n");

    if (!payload.fullName || !payload.email || !payload.phone || !payload.company || !payload.mainChallenge) {
      showStatus("Please fill in your full name, email address, phone number, company, and main improvement area.", "error");
      return;
    }

    try {
      setSubmitting(true);
      showStatus("Submitting your request...", "info");

      const response = await fetch(`${getApiBaseUrl()}/api/create-lead`, {
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
          <div class="mb-4">Your request has been submitted successfully. We&rsquo;ll contact you shortly.</div>
          <div class="flex justify-center">
            <button type="button" onclick="window.location.href='${toSitePath('/#pricing')}'" class="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition">
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

  console.log("Pricing modal initialized");
}

function initContactLeadForm() {
  const contactLeadForm = document.getElementById("contactLeadForm");
  const contactLeadSubmit = document.getElementById("contactLeadSubmit");
  const contactLeadStatus = document.getElementById("contactLeadStatus");

  if (!contactLeadForm || !contactLeadSubmit || !contactLeadStatus) {
    console.warn("Contact form elements not found, skipping init.");
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

  contactLeadForm.addEventListener("submit", async (event) => {
    event.preventDefault();

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

      const response = await fetch(`${getApiBaseUrl()}/api/create-lead`, {
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
          <div class="text-4xl mb-3">&#10003;</div>
          <div class="text-2xl font-bold mb-2">Thank you for submitting</div>
          <div class="mb-3">Your message has been sent successfully.</div>
          <div class="text-sm mb-6">Our team will get back to you shortly.</div>
          <button
            type="button"
            onclick="window.location.href='${toSitePath('/#contact')}'"
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

  console.log("Contact form initialized");
}

document.addEventListener("DOMContentLoaded", async () => {
  console.log("Loader starting...");

  const tasks = [
    loadComponent("nav-container", "nav.html"),
    loadComponent("footer-container", "footer.html")
  ];

  await Promise.allSettled(tasks);

  console.log("All components loaded");

  normalizeInternalPaths();
  initPricingLeadModal();
  initContactLeadForm();

  initNavToggle();
  initFooterYear();
  handleAnchorLinks();
  initScrollTargetButtons();
  setActiveNav();

  if (typeof AOS !== "undefined") {
    AOS.refreshHard();
  }
});
