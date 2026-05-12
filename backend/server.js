const express = require("express");
const axios = require("axios");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
const shippingHandler = require("./routes/shipping");
const { calculateShippingRates } = shippingHandler;
require("dotenv").config();

const app = express();
app.set("trust proxy", getTrustProxySetting(process.env.TRUST_PROXY));

const PORT = process.env.PORT || 3000;
const ZOHO_ACCOUNTS_BASE = process.env.ZOHO_ACCOUNTS_BASE || "https://accounts.zoho.com";
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com";
const DEFAULT_ALLOWED_ORIGINS = ["http://127.0.0.1:5501", "http://localhost:5501"];

const DUPLICATE_ORDER_WINDOW_MS = Number(process.env.DUPLICATE_ORDER_WINDOW_MS || 2 * 60 * 1000);
const recentOrders = new Map();
let orderWorkflowQueue = Promise.resolve();
const rateLimitBuckets = new Map();

/* =========================================================
   CORS
========================================================= */
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  next();
});

app.use((req, res, next) => {
  const allowedOrigins = getAllowedOrigins();
  const origin = req.headers.origin;

  if (origin) {
    if (!allowedOrigins.includes(origin)) {
      return res.status(403).json({
        success: false,
        message: "Origin not allowed"
      });
    }

    res.header("Access-Control-Allow-Origin", origin);
    res.header("Vary", "Origin");
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Token");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(createRateLimitMiddleware({
  key: "api-global",
  windowMs: Number(process.env.API_RATE_LIMIT_WINDOW_MS || 60 * 1000),
  maxRequests: Number(process.env.API_RATE_LIMIT_MAX || 120)
}));

/* =========================================================
   LOGGING
========================================================= */
function createRequestId() {
  return `REQ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function logInfo(requestId, message, meta = {}) {
  console.log(`[INFO] [${requestId}] ${message}`, meta);
}

function logWarn(requestId, message, meta = {}) {
  console.warn(`[WARN] [${requestId}] ${message}`, meta);
}

function logError(requestId, message, error) {
  console.error(`[ERROR] [${requestId}] ${message}`, error?.response?.data || error?.message || error);
}

function getTrustProxySetting(value) {
  const normalized = String(value || "").trim().toLowerCase();

  if (!normalized || normalized === "false" || normalized === "0") return false;
  if (normalized === "true" || normalized === "1") return true;
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return value;
}

function getAllowedOrigins() {
  const configured = process.env.FRONTEND_ORIGINS || process.env.FRONTEND_ORIGIN || "";

  if (!configured.trim()) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  return configured
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
}

function getClientIp(req) {
  return (
    req.ip ||
    req.headers["x-forwarded-for"] ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

function createRateLimitMiddleware({ key, windowMs, maxRequests }) {
  return (req, res, next) => {
    const bucketKey = `${key}:${getClientIp(req)}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(bucketKey);

    if (!bucket || now >= bucket.resetAt) {
      rateLimitBuckets.set(bucketKey, {
        count: 1,
        resetAt: now + windowMs
      });
      return next();
    }

    if (bucket.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        message: "Too many requests. Please try again later."
      });
    }

    bucket.count += 1;
    next();
  };
}

/* =========================================================
   HELPERS
========================================================= */
function splitFullName(fullName = "") {
  const trimmed = String(fullName || "").trim();

  if (!trimmed) {
    return { firstName: "", lastName: "Customer" };
  }

  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    return { firstName: "", lastName: parts[0] };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1).join("") || "Customer"
  };
}

function calculateLeadScore(payload = {}) {
  let score = 0;

  if (payload.formType === "System Assessment") score += 2;
  if (payload.formType === "Pricing CTA") score += 1;
  if (payload.formType === "Contact Us") score += 1;

  if (payload.selectedPackage === "Full Business OS") score += 4;
  else if (payload.selectedPackage === "Business Operating System") score += 3;
  else if (payload.selectedPackage === "Operations Layer") score += 2;
  else if (payload.selectedPackage === "Communication Layer") score += 1;

  if (payload.budget === "R50k+") score += 4;
  else if (payload.budget === "R15k – R50k") score += 3;
  else if (payload.budget === "R5k – R15k") score += 2;
  else if (payload.budget === "R1k – R5k") score += 1;

  if (payload.urgency === "Immediately") score += 4;
  else if (payload.urgency === "Within 1 month") score += 3;
  else if (payload.urgency === "1–3 months") score += 2;

  if (payload.companySize === "50+ Employees") score += 4;
  else if (payload.companySize === "21–50 Employees") score += 3;
  else if (payload.companySize === "11–20 Employees") score += 2;
  else if (payload.companySize === "6–10 Employees") score += 1;

  if (payload.revenue === "R1M+") score += 4;
  else if (payload.revenue === "R500k – R1M") score += 3;
  else if (payload.revenue === "R200k – R500k") score += 2;
  else if (payload.revenue === "R50k – R200k") score += 1;

  return score;
}

function getLeadTemperature(score = 0) {
  if (score >= 12) return "HOT";
  if (score >= 6) return "WARM";
  return "COLD";
}

function calculateWebsiteLeadScore(payload = {}) {
  let score = 0;

  if (payload.formType === "System Assessment") score += 2;
  if (payload.formType === "Pricing CTA") score += 1;
  if (payload.formType === "System Advice Request") score += 1;
  if (payload.formType === "Contact Us") score += 1;

  score += getPackageLeadScore(payload.selectedPackage);
  score += getContactServiceLeadScore(payload.businessType);

  const budget = normalizeLeadValue(payload.budget);
  if (budget === "r50k+") score += 4;
  else if (budget === "r15k - r50k") score += 3;
  else if (budget === "r5k - r15k") score += 2;
  else if (budget === "r1k - r5k") score += 1;

  const urgency = normalizeLeadValue(payload.urgency);
  if (urgency === "immediately") score += 4;
  else if (urgency === "within 1 month") score += 3;
  else if (urgency === "1-3 months") score += 2;

  const companySize = normalizeLeadValue(payload.companySize);
  if (companySize === "50+ employees") score += 4;
  else if (companySize === "21-50 employees") score += 3;
  else if (companySize === "11-20 employees") score += 2;
  else if (companySize === "6-10 employees") score += 1;

  const revenue = normalizeLeadValue(payload.revenue);
  if (revenue === "r1m+") score += 4;
  else if (revenue === "r500k - r1m") score += 3;
  else if (revenue === "r200k - r500k") score += 2;
  else if (revenue === "r50k - r200k") score += 1;

  return score;
}

function normalizeLeadValue(value = "") {
  return String(value || "")
    .trim()
    .replace(/[–—]/g, "-")
    .replace(/\s*-\s*/g, " - ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getPackageLeadScore(selectedPackage = "") {
  const packageName = normalizeLeadValue(selectedPackage);

  const packageScores = new Map([
    ["complete business operating system", 11],
    ["full business os", 11],
    ["cybersecurity & compliance system", 8],
    ["customer, sales & automation system", 7],
    ["business operating system", 7],
    ["managed it & support", 7],
    ["operations layer", 6],
    ["business communication system", 6],
    ["communication layer", 6]
  ]);

  return packageScores.get(packageName) || 0;
}

function getContactServiceLeadScore(service = "") {
  const serviceName = normalizeLeadValue(service);

  const serviceScores = new Map([
    ["cybersecurity", 5],
    ["automation", 5],
    ["zoho crm", 5],
    ["it support", 4],
    ["voip", 3],
    ["general enquiry", 0]
  ]);

  return serviceScores.get(serviceName) || 0;
}

function formatMoney(value = 0) {
  return Number(value || 0).toFixed(2);
}

function getZohoErrorMessage(error) {
  const data = error?.response?.data;

  if (data?.data?.[0]) {
    return data.data[0].message || data.data[0].code || JSON.stringify(data.data[0]);
  }

  if (data?.error?.message) return data.error.message;
  if (data?.message) return data.message;
  return error.message || "Unknown error";
}

function cleanText(value = "") {
  return String(value || "").trim();
}

function isValidEmail(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function assertRequiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name} in .env`);
  }

  return value;
}

function createPublicError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.publicMessage = message;
  return error;
}

function normalizeZohoSearchValue(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .trim();
}

function buildOrderFingerprint(payload = {}, subtotal = 0, shipping = 0) {
  const email = cleanText(payload.email).toLowerCase();
  const phone = cleanText(payload.phone);
  const items = Array.isArray(payload.items) ? payload.items : [];

  const normalizedItems = items
    .map(item => ({
      documentId: item.documentId || item.id || "",
      name: cleanText(item.name).toLowerCase(),
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0)
    }))
    .sort((a, b) => `${a.documentId}${a.name}`.localeCompare(`${b.documentId}${b.name}`));

  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ email, phone, subtotal, shipping, items: normalizedItems }))
    .digest("hex");
}

function cleanupRecentOrders() {
  const now = Date.now();

  for (const [key, value] of recentOrders.entries()) {
    if (now - value.timestamp > DUPLICATE_ORDER_WINDOW_MS) {
      recentOrders.delete(key);
    }
  }
}

function assertNotDuplicateOrder(fingerprint) {
  cleanupRecentOrders();

  const existing = recentOrders.get(fingerprint);

  if (existing && Date.now() - existing.timestamp <= DUPLICATE_ORDER_WINDOW_MS) {
    const error = new Error(
      `Duplicate order blocked. Existing order number: ${existing.orderNumber}`
    );
    error.statusCode = 409;
    error.publicMessage = "This looks like a duplicate order. Please wait a moment before submitting again.";
    throw error;
  }
}

function rememberOrderFingerprint(fingerprint, orderNumber) {
  recentOrders.set(fingerprint, {
    orderNumber,
    timestamp: Date.now()
  });
}

async function runOrderWorkflowExclusive(task) {
  const previous = orderWorkflowQueue;
  let releaseQueue;

  orderWorkflowQueue = new Promise(resolve => {
    releaseQueue = resolve;
  });

  await previous;

  try {
    return await task();
  } finally {
    releaseQueue();
  }
}

function assertInternalRouteAllowed(req) {
  if (String(process.env.ENABLE_INTERNAL_DEBUG_ROUTES || "false") !== "true") {
    const error = new Error("Not found");
    error.statusCode = 404;
    error.publicMessage = "Not found";
    throw error;
  }

  const expectedToken = process.env.INTERNAL_ROUTE_TOKEN;

  if (expectedToken && req.headers["x-internal-token"] !== expectedToken) {
    const error = new Error("Forbidden");
    error.statusCode = 403;
    error.publicMessage = "Forbidden";
    throw error;
  }
}

async function getZohoAccessToken() {
  const refreshToken = assertRequiredEnv("REFRESH_TOKEN");
  const clientId = assertRequiredEnv("CLIENT_ID");
  const clientSecret = assertRequiredEnv("CLIENT_SECRET");

  const response = await axios.post(
    `${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`,
    null,
    {
      params: {
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token"
      }
    }
  );

  return response.data.access_token;
}

/* =========================================================
   EMAIL
========================================================= */
function emailEnabled() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getMailer() {
  if (!emailEnabled()) return null;

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

function buildOrderSummaryText(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];

  const itemLines = items
    .map((item, index) => {
      return `${index + 1}. ${item.name} x${item.quantity} - R${formatMoney(item.price)}`;
    })
    .join("\n");

  return `Order #: ${order.orderNumber}
Customer: ${order.fullName}
Email: ${order.email}
Phone: ${order.phone}
Company: ${order.company || "Shop Customer"}

Delivery Address:
${order.deliveryAddress}
${order.city}, ${order.province}, ${order.country || "ZA"}

Shipping Method: ${order.shippingMethod || "Not specified"}
Shipping Amount: R${formatMoney(order.shippingAmount)}

Items:
${itemLines}

Subtotal: R${formatMoney(order.subtotal)}
Shipping: R${formatMoney(order.shippingAmount)}
Total: R${formatMoney(order.total)}`;
}

function buildCustomerEmailHtml(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];

  const itemRows = items.map(item => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee;">${item.name}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${item.quantity}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">R${formatMoney(item.price)}</td>
    </tr>
  `).join("");

  return `
    <div style="font-family:Arial,sans-serif;color:#111;line-height:1.5;max-width:680px;margin:auto;">
      <h2 style="color:#1e40af;">Thank you for your order</h2>
      <p>Hello ${order.fullName || "Customer"},</p>
      <p>We have received your order. Our team will review it and contact you shortly.</p>

      <h3>Order Details</h3>
      <p><strong>Order Number:</strong> ${order.orderNumber}</p>

      <table style="width:100%;border-collapse:collapse;margin-top:12px;">
        <thead>
          <tr>
            <th style="padding:8px;border-bottom:2px solid #ddd;text-align:left;">Product</th>
            <th style="padding:8px;border-bottom:2px solid #ddd;text-align:center;">Qty</th>
            <th style="padding:8px;border-bottom:2px solid #ddd;text-align:right;">Price</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <p><strong>Subtotal:</strong> R${formatMoney(order.subtotal)}</p>
      <p><strong>Delivery:</strong> R${formatMoney(order.shippingAmount)}</p>
      <p style="font-size:18px;"><strong>Total:</strong> R${formatMoney(order.total)}</p>

      <h3>Delivery Address</h3>
      <p>${order.deliveryAddress || ""}<br>${order.city || ""}, ${order.province || ""}, ${order.country || "ZA"}</p>

      <p>Need help? Reply to this email or contact NewHaus IT Services.</p>
      <p style="margin-top:24px;">Regards,<br><strong>NewHaus IT Services</strong><br>simplifying IT</p>
    </div>
  `;
}

async function sendCustomerOrderConfirmation(order = {}, requestId = "NO_REQ") {
  if (!emailEnabled()) {
    logWarn(requestId, "Customer email skipped because SMTP is not configured");
    return { sent: false, skipped: true, reason: "SMTP not configured" };
  }

  const mailer = getMailer();

  const info = await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: order.email,
    subject: `NewHaus Order Received - ${order.orderNumber}`,
    text: buildOrderSummaryText(order),
    html: buildCustomerEmailHtml(order)
  });

  logInfo(requestId, "Customer confirmation email sent", { messageId: info.messageId });
  return { sent: true, messageId: info.messageId };
}

async function sendAdminOrderNotification(order = {}, requestId = "NO_REQ") {
  if (!emailEnabled()) {
    logWarn(requestId, "Admin email skipped because SMTP is not configured");
    return { sent: false, skipped: true, reason: "SMTP not configured" };
  }

  const adminEmail = process.env.ADMIN_ORDER_EMAIL || process.env.SMTP_USER;
  const mailer = getMailer();

  const info = await mailer.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: adminEmail,
    subject: `New Shop Order - ${order.orderNumber} - R${formatMoney(order.total)}`,
    text: buildOrderSummaryText(order)
  });

  logInfo(requestId, "Admin notification email sent", { messageId: info.messageId });
  return { sent: true, messageId: info.messageId };
}

async function sendOrderEmailsSafe(order = {}, requestId = "NO_REQ") {
  const results = {
    customer: null,
    admin: null
  };

  try {
    results.customer = await sendCustomerOrderConfirmation(order, requestId);
  } catch (error) {
    logError(requestId, "Customer confirmation email failed", error);
    results.customer = { sent: false, error: error.message };
  }

  try {
    results.admin = await sendAdminOrderNotification(order, requestId);
  } catch (error) {
    logError(requestId, "Admin notification email failed", error);
    results.admin = { sent: false, error: error.message };
  }

  return results;
}

/* =========================================================
   ZOHO LEADS - FOR INDEX.HTML / WEBSITE FORMS ONLY
========================================================= */
async function createZohoLead(payload) {
  const token = await getZohoAccessToken();
  const { firstName, lastName } = splitFullName(payload.fullName);

  const response = await axios.post(
    `${ZOHO_API_DOMAIN}/crm/v2/Leads`,
    {
      data: [
        {
          First_Name: firstName,
          Last_Name: lastName || "Lead",
          Email: payload.email,
          Phone: payload.phone,
          Company: payload.company || "Website Lead",
          Lead_Source: payload.crmLeadSource || "Website",
          Lead_Status: payload.leadStatus || "Not Contacted",
          Lead_Temperature: payload.leadTemperature,
          Score: payload.leadScore,
          Description: payload.message
        }
      ]
    },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  return response.data;
}

/* =========================================================
   ZOHO ACCOUNTS - FIND OR CREATE
========================================================= */
async function findZohoAccountByName(accountName, token) {
  const name = cleanText(accountName);
  if (!name) return null;

  const safeName = normalizeZohoSearchValue(name);

  const res = await axios.get(`${ZOHO_API_DOMAIN}/crm/v2/Accounts/search`, {
    params: { criteria: `(Account_Name:equals:${safeName})` },
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    validateStatus: status => (status >= 200 && status < 300) || status === 204
  });

  if (res.status === 204 || !res.data?.data?.length) return null;
  return res.data.data[0];
}

async function createZohoAccount(payload, token) {
  const accountName = cleanText(payload.company) || cleanText(payload.fullName) || "Shop Customer";

  const accountPayload = {
    Account_Name: accountName,
    Phone: payload.phone || "",
    Billing_Street: payload.deliveryAddress || payload.address || "",
    Billing_City: payload.city || "",
    Billing_State: payload.province || "",
    Billing_Country: payload.country || "ZA",
    Shipping_Street: payload.deliveryAddress || payload.address || "",
    Shipping_City: payload.city || "",
    Shipping_State: payload.province || "",
    Shipping_Country: payload.country || "ZA",
    Description: `Auto-created from NewHaus shop checkout. Email: ${payload.email || "N/A"}`
  };

  const res = await axios.post(
    `${ZOHO_API_DOMAIN}/crm/v2/Accounts`,
    { data: [accountPayload] },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  const result = res.data?.data?.[0];

  if (!result || result.status !== "success") {
    throw new Error(`Failed to create Zoho Account: ${JSON.stringify(res.data)}`);
  }

  return {
    id: result.details?.id,
    Account_Name: accountName,
    autoCreated: true
  };
}

async function findOrCreateZohoAccount(payload, token) {
  const accountName = cleanText(payload.company) || cleanText(payload.fullName) || "Shop Customer";

  let account = await findZohoAccountByName(accountName, token);

  if (account?.id) {
    return {
      id: account.id,
      Account_Name: account.Account_Name || accountName,
      autoCreated: false
    };
  }

  console.log(`Zoho Account not found. Auto-creating account: ${accountName}`);
  account = await createZohoAccount({ ...payload, company: accountName }, token);

  if (!account?.id) {
    throw new Error(`Zoho Account was created but no ID was returned for: ${accountName}`);
  }

  return account;
}

/* =========================================================
   ZOHO CONTACTS - FIND OR CREATE
========================================================= */
async function findZohoContactByEmail(email, token) {
  const cleanEmail = cleanText(email);
  if (!cleanEmail) return null;

  const safeEmail = normalizeZohoSearchValue(cleanEmail);

  const res = await axios.get(`${ZOHO_API_DOMAIN}/crm/v2/Contacts/search`, {
    params: { criteria: `(Email:equals:${safeEmail})` },
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    validateStatus: status => (status >= 200 && status < 300) || status === 204
  });

  if (res.status === 204 || !res.data?.data?.length) return null;
  return res.data.data[0];
}

async function createZohoContact(payload, account, token) {
  const { firstName, lastName } = splitFullName(payload.fullName);

  const contactPayload = {
    First_Name: firstName,
    Last_Name: lastName || "Customer",
    Email: payload.email || "",
    Phone: payload.phone || "",
    Mailing_Street: payload.deliveryAddress || payload.address || "",
    Mailing_City: payload.city || "",
    Mailing_State: payload.province || "",
    Mailing_Country: payload.country || "ZA",
    Description: "Auto-created from NewHaus shop checkout."
  };

  if (account?.id) {
    contactPayload.Account_Name = { id: account.id };
  }

  const res = await axios.post(
    `${ZOHO_API_DOMAIN}/crm/v2/Contacts`,
    { data: [contactPayload] },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  const result = res.data?.data?.[0];

  if (!result || result.status !== "success") {
    throw new Error(`Failed to create Zoho Contact: ${JSON.stringify(res.data)}`);
  }

  return {
    id: result.details?.id,
    Full_Name: payload.fullName,
    Email: payload.email,
    autoCreated: true
  };
}

async function findOrCreateZohoContact(payload, account, token) {
  let contact = await findZohoContactByEmail(payload.email, token);

  if (contact?.id) {
    return {
      id: contact.id,
      Full_Name: contact.Full_Name || payload.fullName,
      Email: contact.Email || payload.email,
      autoCreated: false
    };
  }

  console.log(`Zoho Contact not found. Auto-creating contact: ${payload.email}`);
  contact = await createZohoContact(payload, account, token);

  if (!contact?.id) {
    throw new Error(`Zoho Contact was created but no ID was returned for: ${payload.email}`);
  }

  return contact;
}

/* =========================================================
   ZOHO PRODUCTS - FIND OR AUTO CREATE
========================================================= */
async function findZohoProductByName(name, token) {
  const productName = cleanText(name);
  if (!productName) return null;

  const safeName = normalizeZohoSearchValue(productName);

  const res = await axios.get(`${ZOHO_API_DOMAIN}/crm/v2/Products/search`, {
    params: { criteria: `(Product_Name:equals:${safeName})` },
    headers: { Authorization: `Zoho-oauthtoken ${token}` },
    validateStatus: status => (status >= 200 && status < 300) || status === 204
  });

  if (res.status === 204 || !res.data?.data?.length) return null;
  return res.data.data[0];
}

async function createZohoProductFromCartItem(item, token) {
  const productName = cleanText(item.name);
  const unitPrice = Number(item.price || 0);

  if (!productName) {
    throw new Error("Cannot create Zoho Product because the cart item has no name.");
  }

  const productPayload = {
    Product_Name: productName,
    Unit_Price: unitPrice,
    Product_Active: true,
    Description: [
      productName === "Delivery Fee"
        ? "Auto-created delivery fee item from NewHaus shop checkout."
        : "Auto-created from NewHaus shop checkout.",
      item.documentId ? `Strapi documentId: ${item.documentId}` : null,
      item.id ? `Strapi id: ${item.id}` : null,
      item.brand ? `Brand: ${item.brand}` : null
    ].filter(Boolean).join("\n")
  };

  const res = await axios.post(
    `${ZOHO_API_DOMAIN}/crm/v2/Products`,
    { data: [productPayload] },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  const result = res.data?.data?.[0];

  if (!result || result.status !== "success") {
    throw new Error(`Failed to create Zoho Product for ${productName}: ${JSON.stringify(res.data)}`);
  }

  return {
    id: result.details?.id,
    Product_Name: productName,
    Unit_Price: unitPrice,
    autoCreated: true
  };
}

async function findOrCreateZohoProduct(item, token) {
  const productName = cleanText(item.name);

  let product = await findZohoProductByName(productName, token);

  if (product?.id) {
    return {
      id: product.id,
      Product_Name: product.Product_Name || productName,
      Unit_Price: product.Unit_Price || item.price || 0,
      autoCreated: false
    };
  }

  console.log(`Zoho Product not found. Auto-creating product: ${productName}`);
  product = await createZohoProductFromCartItem(item, token);

  if (!product?.id) {
    throw new Error(`Zoho Product was created but no ID was returned for: ${productName}`);
  }

  return product;
}

async function buildZohoProductDetails(items, token, shipping = 0) {
  const list = [];

  for (const item of items) {
    const quantity = Number(item.quantity || 1);
    const listPrice = Number(item.price || 0);

    if (quantity <= 0) {
      throw new Error(`Invalid quantity for item: ${item.name || "Unknown item"}`);
    }

    if (listPrice < 0) {
      throw new Error(`Invalid price for item: ${item.name || "Unknown item"}`);
    }

    const product = await findOrCreateZohoProduct(item, token);

    list.push({
      product: { id: product.id },
      quantity,
      list_price: listPrice,
      Discount: 0
    });
  }

  const shippingAmount = Number(shipping || 0);

  if (shippingAmount > 0) {
    const shippingProduct = await findOrCreateZohoProduct(
      { name: "Delivery Fee", price: shippingAmount },
      token
    );

    list.push({
      product: { id: shippingProduct.id },
      quantity: 1,
      list_price: shippingAmount,
      Discount: 0
    });
  }

  return list;
}

/* =========================================================
   ZOHO SALES ORDER - LINKED TO ACCOUNT + CONTACT
========================================================= */
async function createZohoSalesOrder(payload, setStage = () => {}) {
  const token = await getZohoAccessToken();

  setStage("creating_zoho_account");
  const account = await findOrCreateZohoAccount(payload, token);

  setStage("creating_zoho_contact");
  const contact = await findOrCreateZohoContact(payload, account, token);

  setStage("preparing_zoho_products");
  const productDetails = await buildZohoProductDetails(
    payload.items || [],
    token,
    payload.shippingAmount || 0
  );

  const order = {
    Subject: payload.orderNumber,
    Customer_No: payload.phone || payload.email || payload.orderNumber,
    Status: "Created",
    Carrier: payload.carrier || "FedEX",

    Account_Name: { id: account.id },
    Contact_Name: { id: contact.id },
    Product_Details: productDetails,

    Billing_Street: payload.deliveryAddress || payload.address || "",
    Billing_City: payload.city || "",
    Billing_State: payload.province || "",
    Billing_Country: payload.country || "ZA",

    Shipping_Street: payload.deliveryAddress || payload.address || "",
    Shipping_City: payload.city || "",
    Shipping_State: payload.province || "",
    Shipping_Country: payload.country || "ZA",

    Description: payload.message
  };

  setStage("creating_zoho_sales_order_record");
  const res = await axios.post(
    `${ZOHO_API_DOMAIN}/crm/v2/Sales_Orders`,
    { data: [order] },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${token}`,
        "Content-Type": "application/json"
      }
    }
  );

  if (!res.data?.data?.[0] || res.data.data[0].status !== "success") {
    throw new Error(`Zoho Sales Order failed: ${JSON.stringify(res.data)}`);
  }

  return { salesOrder: res.data, account, contact };
}

/* =========================================================
   STRAPI STOCK CHECK + UPDATE
========================================================= */
async function getStrapiProduct(productId) {
  const STRAPI_URL = process.env.STRAPI_URL;
  const TOKEN = process.env.STRAPI_API_TOKEN;

  if (!STRAPI_URL) throw new Error("Missing STRAPI_URL in .env");
  if (!TOKEN) throw new Error("Missing STRAPI_API_TOKEN in .env");

  const res = await axios.get(`${STRAPI_URL}/api/products/${productId}`, {
    headers: { Authorization: `Bearer ${TOKEN}` }
  });

  const product = res.data?.data || {};
  const attributes = product.attributes || {};

  return {
    id: product.id || productId,
    documentId: product.documentId || attributes.documentId || productId,
    name: product.name || attributes.name || "",
    stock: Number(product.stock ?? attributes.stock ?? 0),
    price: Number(product.price ?? attributes.price ?? 0)
  };
}

async function buildAuthoritativeOrderItems(items = []) {
  const authoritativeItems = [];

  for (const item of items) {
    const id = item.documentId || item.id;
    const quantity = Number(item.quantity || 1);

    if (!id) {
      throw createPublicError(`Missing Strapi product documentId for item: ${item.name || "Unknown item"}`);
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw createPublicError(`Invalid quantity for item: ${item.name || "Unknown item"}`);
    }

    const product = await getStrapiProduct(id);

    if (!product.name) {
      throw createPublicError(`Product not found for item id: ${id}`, 404);
    }

    if (!Number.isFinite(product.price) || product.price < 0) {
      throw new Error(`Invalid price configured in Strapi for product: ${product.name}`);
    }

    authoritativeItems.push({
      id: product.id,
      documentId: product.documentId,
      name: product.name,
      quantity,
      price: product.price
    });
  }

  return authoritativeItems;
}

async function getStrapiProductStock(productId) {
  const product = await getStrapiProduct(productId);
  return product.stock;
}

async function updateStrapiProductStock(productId, stock) {
  const STRAPI_URL = process.env.STRAPI_URL;
  const TOKEN = process.env.STRAPI_API_TOKEN;

  if (!STRAPI_URL) throw new Error("Missing STRAPI_URL in .env");
  if (!TOKEN) throw new Error("Missing STRAPI_API_TOKEN in .env");

  await axios.put(
    `${STRAPI_URL}/api/products/${productId}`,
    { data: { stock } },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

async function reserveStrapiStock(items = []) {
  const reservations = [];

  for (const item of items) {
    const id = item.documentId || item.id;
    const orderedQuantity = Number(item.quantity || 1);

    if (!id) {
      throw new Error(`Missing Strapi product documentId for item: ${item.name || "Unknown item"}`);
    }

    const product = await getStrapiProduct(id);
    const currentStock = product.stock;

    if (currentStock < orderedQuantity) {
      const error = new Error(
        `Not enough stock for ${item.name}. Current stock: ${currentStock}, ordered: ${orderedQuantity}`
      );
      error.statusCode = 409;
      error.publicMessage = `${item.name} does not have enough stock. Available: ${currentStock}`;
      throw error;
    }

    const newStock = Math.max(currentStock - orderedQuantity, 0);

    await updateStrapiProductStock(id, newStock);

    reservations.push({
      id,
      name: item.name || product.name || "Unknown item",
      previousStock: currentStock,
      reservedQuantity: orderedQuantity,
      newStock
    });
  }

  return reservations;
}

async function rollbackStrapiStockReservations(reservations = [], requestId = "NO_REQ") {
  for (const reservation of reservations.slice().reverse()) {
    try {
      await updateStrapiProductStock(reservation.id, reservation.previousStock);
      logWarn(requestId, "Rolled back reserved stock", {
        productId: reservation.id,
        productName: reservation.name,
        restoredStock: reservation.previousStock
      });
    } catch (rollbackError) {
      logError(requestId, `Failed to roll back stock for product ${reservation.id}`, rollbackError);
    }
  }
}

function resolveShippingSelection(payload = {}) {
  const shippingResult = calculateShippingRates(payload);
  const requestedId = cleanText(payload.shippingMethod || payload.shippingRateId || payload.shippingOptionId);
  const selectedRate = requestedId
    ? shippingResult.rates.find(rate => rate.id === requestedId)
    : shippingResult.rates[0];

  if (!selectedRate) {
    throw createPublicError("Invalid shipping method selected");
  }

  return {
    country: shippingResult.country,
    province: shippingResult.province,
    shippingMethodId: selectedRate.id,
    shippingMethodLabel: selectedRate.description,
    shippingAmount: Number(selectedRate.price || 0)
  };
}

/* =========================================================
   STRAPI ORDER HISTORY
========================================================= */
async function saveStrapiOrderHistory(orderPayload = {}) {
  const STRAPI_URL = process.env.STRAPI_URL;
  const TOKEN = process.env.STRAPI_API_TOKEN;

  if (!STRAPI_URL) {
    throw new Error("Missing STRAPI_URL in .env");
  }

  if (!TOKEN) {
    throw new Error("Missing STRAPI_API_TOKEN in .env");
  }

  const res = await axios.post(
    `${STRAPI_URL}/api/orders`,
    {
      data: {
        orderNumber: orderPayload.orderNumber,
        customerName: orderPayload.fullName,
        email: orderPayload.email,
        phone: orderPayload.phone,
        company: orderPayload.company || "Shop Customer",
        deliveryAddress: orderPayload.deliveryAddress,
        city: orderPayload.city,
        province: orderPayload.province,
        country: orderPayload.country || "ZA",
        shippingMethod: orderPayload.shippingMethod || "Not specified",
        subtotal: Number(orderPayload.subtotal || 0),
        shippingAmount: Number(orderPayload.shippingAmount || 0),
        total: Number(orderPayload.total || 0),
        orderStatus: "Created",
        zohoAccountId: orderPayload.zohoAccountId || "",
        zohoContactId: orderPayload.zohoContactId || "",
        zohoSalesOrderId: orderPayload.zohoSalesOrderId || "",
        items: JSON.stringify(orderPayload.items || []),
        notes: orderPayload.message || ""
      }
    },
    {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );

  return res.data;
}

/* =========================================================
   HEALTH
========================================================= */
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    service: "newhaus-backend-api"
  });
});

app.get("/", (req, res) => {
  res.json({
    success: true,
    service: "newhaus-backend-api",
    health: "/api/health"
  });
});

/* =========================================================
   TEST ZOHO TOKEN
========================================================= */
app.get("/api/test-zoho-token", async (req, res) => {
  try {
    assertInternalRouteAllowed(req);
    const accessToken = await getZohoAccessToken();

    return res.json({
      success: true,
      message: "Zoho access token generated successfully",
      tokenStart: accessToken.slice(0, 10)
    });
  } catch (err) {
    console.error("ZOHO TOKEN TEST ERROR:", err.response?.data || err.message);

    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.publicMessage || "Failed to generate Zoho access token",
      error: err.response?.data || err.message
    });
  }
});

/* =========================================================
   CALLBACK HELPER FOR GENERATING REFRESH TOKEN
========================================================= */
app.get("/callback", (req, res) => {
  try {
    assertInternalRouteAllowed(req);

    res.send(`
      <h2>Zoho Authorization Code</h2>
      <p>Copy this code and use it to generate your refresh token:</p>
      <textarea style="width:100%;height:140px;">${req.query.code || "No code found"}</textarea>
    `);
  } catch (error) {
    return res.status(error.statusCode || 500).send(error.publicMessage || "Not found");
  }
});

/* =========================================================
   WEBSITE LEAD ENDPOINT - INDEX.HTML FORMS
========================================================= */
app.post("/api/create-lead", createRateLimitMiddleware({
  key: "lead",
  windowMs: Number(process.env.LEAD_RATE_LIMIT_WINDOW_MS || 5 * 60 * 1000),
  maxRequests: Number(process.env.LEAD_RATE_LIMIT_MAX || 10)
}), async (req, res) => {
  const requestId = createRequestId();

  try {
    const payload = req.body || {};

    const fullName = cleanText(payload.fullName);
    const email = cleanText(payload.email);
    const phone = cleanText(payload.phone);
    const company = cleanText(payload.company) || "Website Lead";

    if (!fullName || !email) {
      throw createPublicError("Full name and email are required");
    }

    if (!isValidEmail(email)) {
      throw createPublicError("A valid email address is required");
    }

    const leadScore = calculateWebsiteLeadScore(payload);
    const leadTemperature = getLeadTemperature(leadScore);

    const leadResult = await createZohoLead({
      ...payload,
      fullName,
      email,
      phone,
      company,
      leadScore,
      leadTemperature,
      crmLeadSource: payload.crmLeadSource || "Website",
      message: payload.message || payload.description || "Website form submission"
    });

    logInfo(requestId, "Lead created successfully", { email, company });

    return res.json({
      success: true,
      requestId,
      message: "Lead created successfully",
      zohoLeadCreated: true,
      leadResult
    });

  } catch (err) {
    logError(requestId, "CREATE LEAD ERROR", err);

    return res.status(err.statusCode || 500).json({
      success: false,
      requestId,
      message: err.publicMessage || "Failed to create lead",
      error: getZohoErrorMessage(err)
    });
  }
});

/* =========================================================
   CREATE ORDER (SHOP ONLY → SALES ORDERS)
========================================================= */
app.post("/api/create-order", createRateLimitMiddleware({
  key: "order",
  windowMs: Number(process.env.ORDER_RATE_LIMIT_WINDOW_MS || 10 * 60 * 1000),
  maxRequests: Number(process.env.ORDER_RATE_LIMIT_MAX || 5)
}), async (req, res) => {
  const requestId = createRequestId();
  let checkoutStage = "received";

  try {
    const responsePayload = await runOrderWorkflowExclusive(async () => {
      const p = req.body || {};
      const items = Array.isArray(p.items) ? p.items : [];

      checkoutStage = "validating_checkout";

      if (!items.length) {
        return {
          statusCode: 400,
          body: { success: false, requestId, message: "Cart empty" }
        };
      }

      if (!p.fullName || !p.email || !p.phone || !p.deliveryAddress || !p.city || !p.province) {
        return {
          statusCode: 400,
          body: {
            success: false,
            requestId,
            message: "Missing required checkout fields"
          }
        };
      }

      if (!isValidEmail(p.email)) {
        throw createPublicError("A valid email address is required");
      }

      checkoutStage = "loading_strapi_products";
      const authoritativeItems = await buildAuthoritativeOrderItems(items);

      checkoutStage = "resolving_shipping";
      const shippingSelection = resolveShippingSelection(p);
      const subtotal = authoritativeItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const shipping = shippingSelection.shippingAmount;
      const total = subtotal + shipping;
      const fingerprint = buildOrderFingerprint({ ...p, items: authoritativeItems }, subtotal, shipping);
      const orderNumber = `NHX-${Date.now()}`;
      let stockReservations = [];

      assertNotDuplicateOrder(fingerprint);

      try {
        checkoutStage = "reserving_strapi_stock";
        stockReservations = await reserveStrapiStock(authoritativeItems);
        logInfo(requestId, "Stock reserved before downstream order processing", {
          orderNumber,
          itemsReserved: stockReservations.length
        });

        let desc = `Order #: ${orderNumber}\n`;
        desc += `Customer: ${p.fullName}\n`;
        desc += `Email: ${p.email}\n`;
        desc += `Phone: ${p.phone}\n`;
        desc += `Company: ${p.company || "Shop Customer"}\n\n`;
        desc += `Delivery Address:\n`;
        desc += `${p.deliveryAddress}\n`;
        desc += `${p.city}, ${p.province}, ${shippingSelection.country}\n\n`;
        desc += `Shipping Method: ${shippingSelection.shippingMethodLabel}\n`;
        desc += `Shipping Amount: R${formatMoney(shipping)}\n\n`;
        desc += `Items:\n`;

        authoritativeItems.forEach((i, index) => {
          desc += `${index + 1}. ${i.name} x${i.quantity} - R${formatMoney(i.price)}\n`;
        });

        desc += `\nSubtotal: R${formatMoney(subtotal)}`;
        desc += `\nShipping: R${formatMoney(shipping)}`;
        desc += `\nTotal: R${formatMoney(total)}`;

        logInfo(requestId, "Creating Zoho shop order lead", { orderNumber, email: p.email, total });

        checkoutStage = "creating_zoho_order_lead";
        const leadResult = await createZohoLead({
          ...p,
          items: authoritativeItems,
          subtotal,
          shippingAmount: shipping,
          total,
          orderNumber,
          shippingMethod: shippingSelection.shippingMethodLabel,
          country: shippingSelection.country,
          crmLeadSource: p.crmLeadSource || "Website Shop",
          leadStatus: "Not Contacted",
          leadTemperature: "HOT",
          leadScore: 15,
          company: p.company || "Website Shop Customer",
          message: [
            "SHOP ORDER REQUEST - follow up as a sales opportunity.",
            "",
            desc
          ].join("\n")
        });

        const zohoLeadId = leadResult?.data?.[0]?.details?.id || "";

        checkoutStage = "saving_strapi_order_history";
        const strapiOrderHistory = await saveStrapiOrderHistory({
          ...p,
          items: authoritativeItems,
          subtotal,
          shippingAmount: shipping,
          total,
          orderNumber,
          shippingMethod: shippingSelection.shippingMethodLabel,
          country: shippingSelection.country,
          message: [
            desc,
            "",
            zohoLeadId ? `Zoho Lead ID: ${zohoLeadId}` : "Zoho Lead ID: Not returned"
          ].join("\n"),
          zohoAccountId: "",
          zohoContactId: "",
          zohoSalesOrderId: ""
        });

        rememberOrderFingerprint(fingerprint, orderNumber);

        checkoutStage = "sending_order_emails";
        const emailResults = await sendOrderEmailsSafe({
          ...p,
          items: authoritativeItems,
          subtotal,
          shippingAmount: shipping,
          total,
          orderNumber,
          shippingMethod: shippingSelection.shippingMethodLabel,
          country: shippingSelection.country,
          message: desc
        }, requestId);

        checkoutStage = "completed";
        logInfo(requestId, "Order completed successfully", { orderNumber, zohoLeadId });

        return {
          statusCode: 200,
          body: {
            success: true,
            requestId,
            orderNumber,
            zohoLeadCreated: true,
            zohoSalesOrderCreated: false,
            zohoLeadId,
            strapiOrderHistory,
            emailResults,
            result: leadResult
          }
        };
      } catch (error) {
        if (stockReservations.length) {
          await rollbackStrapiStockReservations(stockReservations, requestId);
        }

        throw error;
      }
    });

    return res.status(responsePayload.statusCode).json(responsePayload.body);

  } catch (err) {
    logError(requestId, `ORDER ERROR at ${checkoutStage}`, err);

    const statusCode = err.statusCode || 500;

    return res.status(statusCode).json({
      success: false,
      requestId,
      stage: checkoutStage,
      message: err.publicMessage || "Failed to submit order",
      error: getZohoErrorMessage(err)
    });
  }
});

/* =========================================================
   SHIPPING
========================================================= */
app.post("/api/shipping", shippingHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
