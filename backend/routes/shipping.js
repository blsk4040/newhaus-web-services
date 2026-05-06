function normalizeShippingInput(body = {}) {
  return {
    country: String(body.country || "ZA").trim().toUpperCase(),
    province: String(body.province || "").trim().toLowerCase()
  };
}

function calculateShippingRates(body = {}) {
  const { country, province } = normalizeShippingInput(body);
  const rates = [];

  if (!province && country === "ZA") {
    const error = new Error("Province is required to calculate South African shipping");
    error.statusCode = 400;
    error.publicMessage = "Province is required to calculate South African shipping";
    throw error;
  }

  if (country === "ZA") {
    rates.push({
      id: "standard",
      description: "Standard SA Delivery (2–4 days)",
      price: 120
    });

    if (
      province.includes("gauteng") ||
      province.includes("gp") ||
      province.includes("johannesburg") ||
      province.includes("pretoria") ||
      province.includes("centurion") ||
      province.includes("midrand")
    ) {
      rates.unshift({
        id: "express-gauteng",
        description: "Express Gauteng Delivery (1–2 days)",
        price: 80
      });
    }
  } else {
    rates.push({
      id: "international",
      description: "International Shipping (5–10 days)",
      price: 600
    });
  }

  return { country, province, rates };
}

function shippingHandler(req, res) {
  try {
    const result = calculateShippingRates(req.body || {});

    return res.json({
      success: true,
      ...result
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.publicMessage || error.message,
        rates: []
      });
    }

    console.error("SHIPPING ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to calculate shipping",
      rates: []
    });
  }
}

module.exports = shippingHandler;
module.exports.calculateShippingRates = calculateShippingRates;
