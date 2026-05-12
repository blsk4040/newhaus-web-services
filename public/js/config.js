// Local defaults stay active while developing. Set the production URLs here before deploy.
(function () {
  const isLocalhost =
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1" ||
    window.location.protocol === "file:";

  window.NHX_API_BASE = window.NHX_API_BASE || (isLocalhost ? "http://localhost:3000" : "https://api.nhx.co.za");
  window.NHX_STRAPI_BASE = window.NHX_STRAPI_BASE || (isLocalhost ? "http://localhost:1337" : "https://passionate-fitness-890c46aa2c.strapiapp.com");

  window.__NHX_SERVER_URL__ = window.__NHX_SERVER_URL__ || window.NHX_API_BASE;
  window.__NHX_STRAPI_URL__ = window.__NHX_STRAPI_URL__ || window.NHX_STRAPI_BASE;
})();
