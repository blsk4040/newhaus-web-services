const axios = require("axios");

const STRAPI_URL = "http://localhost:1337";
const SNIPCART_SECRET_KEY = "YOUR_SECRET_KEY_HERE"; // IMPORTANT: server only

async function syncProducts() {
  try {
    const res = await axios.get(`${STRAPI_URL}/api/products?populate=*`);
    const products = res.data.data;

    for (const item of products) {
      const p = item.attributes;

      const product = {
        id: item.id.toString(),
        name: p.name,
        price: p.price,
        description: p.description || "",
        url: "https://nhx.co.za/shop",
        image: p.images?.data?.[0]?.attributes?.url
          ? STRAPI_URL + p.images.data[0].attributes.url
          : "",
        metadata: {
          stock: p.stock || 10,
          category: p.category?.data?.attributes?.slug || "general"
        }
      };

      await axios.post(
        "https://app.snipcart.com/api/products",
        product,
        {
          headers: {
            Authorization: `Bearer ${SNIPCART_SECRET_KEY}`,
            "Content-Type": "application/json"
          }
        }
      );

      console.log(`Synced: ${product.name}`);
    }

    console.log("SYNC COMPLETE 🚀");
  } catch (err) {
    console.error("Sync error:", err.response?.data || err.message);
  }
}

syncProducts();