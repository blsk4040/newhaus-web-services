function shippingHandler(req, res) {
  const country = req.body?.content?.shippingAddress?.country;

  if (country === "ZA") {
    return res.json({
      rates: [
        { description: "Standard SA Delivery", price: 120 },
        { description: "Express Gauteng (1–2 days)", price: 80 }
      ]
    });
  }

  return res.json({
    rates: [
      { description: "International Shipping", price: 600 }
    ]
  });
}

module.exports = shippingHandler;