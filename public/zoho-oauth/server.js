const express = require("express");
const axios = require("axios");
const shippingHandler = require("../../backend/routes/shipping");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 3000;
const ZOHO_ACCOUNTS_BASE = "https://accounts.zoho.com";
const ZOHO_API_DOMAIN = process.env.ZOHO_API_DOMAIN || "https://www.zohoapis.com";

/* =========================================================
   CORS
========================================================= */
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "http://127.0.0.1:5501");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

app.use(express.json());

/* =========================================================
   HELPERS
========================================================= */
function splitFullName(fullName = "") {
  const trimmed = String(fullName).trim();

  if (!trimmed) {
    return {
      firstName: "Website",
      lastName: "Lead"
    };
  }

  const parts = trimmed.split(/\s+/);

  if (parts.length === 1) {
    return {
      firstName: "",
      lastName: parts[0]
    };
  }

  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts.slice(-1).join("")
  };
}

function calculateLeadScore(payload = {}) {
  let score = 0;

  // FORM TYPE
  if (payload.formType === "System Assessment") score += 2;
  if (payload.formType === "Pricing CTA") score += 1;
  if (payload.formType === "Contact Us") score += 1;

  // PACKAGE INTEREST
  if (payload.selectedPackage === "Full Business OS") score += 4;
  else if (payload.selectedPackage === "Business Operating System") score += 3;
  else if (payload.selectedPackage === "Operations Layer") score += 2;
  else if (payload.selectedPackage === "Communication Layer") score += 1;

  // BUDGET
  if (payload.budget === "R50k+") score += 4;
  else if (payload.budget === "R15k – R50k") score += 3;
  else if (payload.budget === "R5k – R15k") score += 2;
  else if (payload.budget === "R1k – R5k") score += 1;

  // URGENCY
  if (payload.urgency === "Immediately") score += 4;
  else if (payload.urgency === "Within 1 month") score += 3;
  else if (payload.urgency === "1–3 months") score += 2;
  else if (payload.urgency === "Just exploring") score += 0;

  // COMPANY SIZE
  if (payload.companySize === "50+ Employees") score += 4;
  else if (payload.companySize === "21–50 Employees") score += 3;
  else if (payload.companySize === "11–20 Employees") score += 2;
  else if (payload.companySize === "6–10 Employees") score += 1;

  // REVENUE
  if (payload.revenue === "R1M+") score += 4;
  else if (payload.revenue === "R500k – R1M") score += 3;
  else if (payload.revenue === "R200k – R500k") score += 2;
  else if (payload.revenue === "R50k – R200k") score += 1;

  // OPERATIONS / PAIN SIGNALS
  if (payload.automation === "No automation") score += 3;
  else if (payload.automation === "Basic (emails / reminders)") score += 2;
  else if (payload.automation === "Some workflows") score += 1;

  if (payload.leadTracking === "We don’t track leads") score += 3;
  else if (payload.leadTracking === "Manual (Excel / Notebook)") score += 2;
  else if (payload.leadTracking === "WhatsApp only") score += 2;

  if (payload.communication === "Personal phones") score += 2;
  else if (payload.communication === "Mix of everything") score += 1;

  // NOTES / CHALLENGE
  if (payload.challenge && String(payload.challenge).trim().length > 10) score += 1;
  if (payload.message && String(payload.message).trim().length > 10) score += 1;
  if (payload.notes && String(payload.notes).trim().length > 10) score += 1;

  return score;
}

function getLeadTemperature(score = 0) {
  if (score >= 12) return "HOT";
  if (score >= 6) return "WARM";
  return "COLD";
}

function shouldTriggerWhatsApp(payload = {}, leadTemperature = "COLD") {
  if (leadTemperature === "HOT") return true;

  if (
    payload.formType === "Pricing CTA" &&
    (payload.selectedPackage === "Full Business OS" ||
      payload.selectedPackage === "Business Operating System")
  ) {
    return true;
  }

  return false;
}

function buildLeadDescription(payload) {
  const lines = [];

  lines.push(`Form Type: ${payload.formType || "Website Lead"}`);
  lines.push(`Lead Score: ${payload.leadScore ?? 0}`);
  lines.push(`Lead Temperature: ${payload.leadTemperature || "COLD"}`);

  if (payload.selectedPackage) lines.push(`Selected Package: ${payload.selectedPackage}`);
  if (payload.selectedPrice) lines.push(`Selected Price: ${payload.selectedPrice}`);
  if (payload.businessType) lines.push(`Business Type: ${payload.businessType}`);
  if (payload.companySize) lines.push(`Company Size: ${payload.companySize}`);
  if (payload.revenue) lines.push(`Monthly Revenue: ${payload.revenue}`);
  if (payload.leadSource) lines.push(`How They Get Customers: ${payload.leadSource}`);
  if (payload.leadTracking) lines.push(`Lead Tracking: ${payload.leadTracking}`);
  if (payload.communication) lines.push(`Communication Setup: ${payload.communication}`);
  if (payload.automation) lines.push(`Automation Level: ${payload.automation}`);
  if (payload.budget) lines.push(`Budget: ${payload.budget}`);
  if (payload.urgency) lines.push(`Urgency: ${payload.urgency}`);
  if (payload.tools) lines.push(`Current Tools: ${payload.tools}`);
  if (payload.challenge) lines.push(`Biggest Challenge: ${payload.challenge}`);
  if (payload.message) lines.push(`Message: ${payload.message}`);
  if (payload.notes) lines.push(`Notes: ${payload.notes}`);
  if (payload.pageUrl) lines.push(`Page URL: ${payload.pageUrl}`);

  return lines.join("\n");
}

function mapCompanySizeToEmployees(companySize = "") {
  const map = {
    "1–5 Employees": 5,
    "6–10 Employees": 10,
    "11–20 Employees": 20,
    "21–50 Employees": 50,
    "50+ Employees": 50
  };

  return map[companySize] ?? undefined;
}

function mapRevenueToNumber(revenue = "") {
  const map = {
    "Under R50k": 50000,
    "R50k – R200k": 200000,
    "R200k – R500k": 500000,
    "R500k – R1M": 1000000,
    "R1M+": 1000000
  };

  return map[revenue] ?? undefined;
}

async function getZohoAccessToken() {
  const refreshToken = process.env.REFRESH_TOKEN;

  if (!refreshToken) {
    throw new Error("Missing REFRESH_TOKEN in .env");
  }

  const response = await axios.post(
    `${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`,
    null,
    {
      params: {
        refresh_token: refreshToken,
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: "refresh_token"
      }
    }
  );

  if (!response.data?.access_token) {
    throw new Error("Failed to refresh Zoho access token");
  }

  return response.data.access_token;
}

async function createZohoLead(payload) {
  const accessToken = await getZohoAccessToken();

  const { firstName, lastName } = splitFullName(payload.fullName || payload.name || "");

  const leadData = {
    /* STANDARD ZOHO FIELDS */
    First_Name: firstName || undefined,
    Last_Name: lastName || "Lead",
    Email: payload.email || undefined,
    Phone: payload.phone || undefined,
    Company: payload.company || "Website Lead",
    Lead_Source: payload.crmLeadSource || "Website",
    No_of_Employees: mapCompanySizeToEmployees(payload.companySize),
    Annual_Revenue: mapRevenueToNumber(payload.revenue),

    /* CUSTOM ZOHO FIELDS
       IMPORTANT: Replace any API name below if your Zoho API name differs
    */
    Lead_Temperature: payload.leadTemperature || "COLD",
    Score: payload.leadScore ?? 0,
    Form_Type: payload.formType || undefined,
    Business_Type: payload.businessType || undefined,
    Lead_Tracking_Method: payload.leadTracking || undefined,
    Communication_Setup: payload.communication || undefined,
    Automation_Level: payload.automation || undefined,
    Budget_Range: payload.budget || undefined,
    Urgency: payload.urgency || undefined,
    Current_Tools: payload.tools || undefined,
    Biggest_Challenge: payload.challenge || undefined,
    Selected_Package: payload.selectedPackage || undefined,
    Selected_Price: payload.selectedPrice || undefined,

    /* KEEP DESCRIPTION AS BACKUP CONTEXT */
    Description: buildLeadDescription(payload)
  };

  const response = await axios.post(
    `${ZOHO_API_DOMAIN}/crm/v2/Leads`,
    { data: [leadData] },
    {
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  );

  return {
    zoho: response.data,
    leadDataSent: leadData
  };
}

/* =========================================================
   ZOHO LOGIN
========================================================= */
app.get("/login", (req, res) => {
  const url =
    `${ZOHO_ACCOUNTS_BASE}/oauth/v2/auth?scope=ZohoCRM.modules.leads.CREATE,ZohoCRM.modules.leads.READ,ZohoCRM.modules.leads.UPDATE&client_id=${process.env.CLIENT_ID}&response_type=code&access_type=offline&redirect_uri=${process.env.REDIRECT_URI}`;

  res.redirect(url);
});

/* =========================================================
   ZOHO CALLBACK
========================================================= */
app.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    const response = await axios.post(
      `${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`,
      null,
      {
        params: {
          grant_type: "authorization_code",
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
          redirect_uri: process.env.REDIRECT_URI,
          code
        }
      }
    );

    console.log("TOKEN RESPONSE:", response.data);

    res.send(`
      <h2>Success 🎉</h2>
      <p>Zoho tokens received.</p>
      <p>Save the <strong>refresh_token</strong> into your .env file as <strong>REFRESH_TOKEN</strong>.</p>
    `);
  } catch (error) {
    console.log("CALLBACK ERROR:", error.response?.data || error.message);
    res.status(500).send("Error getting token");
  }
});

/* =========================================================
   TEST ZOHO
========================================================= */
app.get("/api/test-zoho", async (req, res) => {
  try {
    const accessToken = await getZohoAccessToken();

    res.json({
      success: true,
      message: "Zoho refresh token works",
      accessTokenPreview: `${accessToken.slice(0, 20)}...`
    });
  } catch (error) {
    console.error("TEST ZOHO ERROR:", error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
});

/* =========================================================
   CREATE LEAD
========================================================= */
app.post("/api/create-lead", async (req, res) => {
  try {
    const payload = req.body || {};

    const fullName = payload.fullName || payload.name;
    const email = payload.email;
    const company = payload.company;

    /* =========================
       REQUIRED VALIDATION
    ========================= */
    if (!fullName || !email || !company) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: fullName, email, and company are required"
      });
    }

    /* =========================
       CONTACT CHECK
    ========================= */
    if (!payload.email && !payload.phone) {
      return res.status(400).json({
        success: false,
        message: "Email or phone is required"
      });
    }

    /* =========================
       LEAD SCORING
    ========================= */
    const leadScore = calculateLeadScore(payload);
    const leadTemperature = getLeadTemperature(leadScore);
    const triggerWhatsApp = shouldTriggerWhatsApp(payload, leadTemperature);

    const enrichedPayload = {
      ...payload,
      leadScore,
      leadTemperature
    };

    const result = await createZohoLead(enrichedPayload);

    return res.status(200).json({
      success: true,
      message: "Lead created successfully in Zoho CRM",
      leadScore,
      leadTemperature,
      triggerWhatsApp,
      zoho: result.zoho,
      leadDataSent: result.leadDataSent
    });
  } catch (error) {
    console.error("CREATE LEAD ERROR:", error.response?.data || error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to create lead in Zoho CRM",
      error: error.response?.data || error.message
    });
  }
});

/* =========================================================
   SHIPPING
========================================================= */
app.post("/api/shipping", shippingHandler);

/* =========================================================
   START SERVER
========================================================= */
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}/login`);
});