// index.js - Kines Homes: RedSP V4 proxy API
// Recomendado: configurar REDSP_FEED_URL como variable de entorno en Render
const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const cors = require('cors');

const app = express();
app.use(cors());

const REDSP_FEED_URL = process.env.REDSP_FEED_URL || 'https://www.redsp.net/trial/trial-feed-kyero.xml';
const FETCH_TIMEOUT_MS = 15000;
const CACHE_TTL_MS = (5 * 60 * 1000); // 5 minutos

let cachedProperties = null;
let cacheTimestamp = 0;

async function fetchAndParseFeed() {
  const now = Date.now();
  if (cachedProperties && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedProperties;
  }

  const response = await axios.get(REDSP_FEED_URL, { timeout: FETCH_TIMEOUT_MS, responseType: 'text' });
  const parser = new xml2js.Parser({ explicitArray: false, mergeAttrs: true });
  const doc = await parser.parseStringPromise(response.data);

  // Normalize property array
  let raw = doc?.root?.property || [];
  if (!Array.isArray(raw)) raw = [raw];

  const properties = raw.map(p => {
    // Normalize images
    let gallery = [];
    if (p.images && p.images.image) {
      const imgs = Array.isArray(p.images.image) ? p.images.image : [p.images.image];
      gallery = imgs.map(i => (i && i.url) ? i.url : null).filter(Boolean);
    }

    // Flatten features to readable list (only keys with '1')
    let featureList = [];
    if (p.features) {
      Object.keys(p.features).forEach(k => {
        const v = p.features[k];
        // xml2js may parse numeric values as strings
        if (v === '1' || v === 1 || v === true) {
          featureList.push(k.replace(/_/g, ' '));
        }
      });
    }

    // Extra features (text list)
    let extraFeatures = [];
    if (p.extra_features && p.extra_features.feature) {
      extraFeatures = Array.isArray(p.extra_features.feature)
        ? p.extra_features.feature
        : [p.extra_features.feature];
    }

    return {
      id: p.id || null,
      ref: p.ref || null,
      development_ref: p.development_ref || null,
      updated_at: p.date || null,
      price_from: p.price ? Number(p.price) : null,
      price_to: p.price_to ? Number(p.price_to) : null,
      currency: p.currency || null,
      price_freq: p.price_freq || null,
      new_build: p.new_build === '1' || p.new_build === 1,
      type: p.type || null,
      address: {
        street: p.address?.address_detail || null,
        number: p.address?.address_number || null,
        postal_code: p.address?.postal_code || null,
        town: p.address?.town || null,
        province: p.address?.province || null,
      },
      costa: p.costa || null,
      country: p.country || null,
      location: {
        lat: p.location?.latitude ? Number(p.location.latitude) : null,
        lng: p.location?.longitude ? Number(p.location.longitude) : null,
      },
      location_detail_1: p.location_detail_1 || null,
      location_detail_2: p.location_detail_2 || null,
      beds: p.beds ? Number(p.beds) : null,
      beds_single: p.beds_single ? Number(p.beds_single) : 0,
      beds_double: p.beds_double ? Number(p.beds_double) : 0,
      baths: p.baths ? Number(p.baths) : null,
      toilets_wc: p.toilets_wc ? Number(p.toilets_wc) : 0,
      number_of_floors: p.number_of_floors ? Number(p.number_of_floors) : null,
      floor: p.floor ? Number(p.floor) : null,
      orientation: p.orientation || null,
      key_ready: p.key_ready === '1',
      show_house: p.show_house === '1',
      delivery_date: p.delivery_date || null,
      months_to_deliver: p.months_to_deliver ? Number(p.months_to_deliver) : null,
      year_build: p.year_build ? Number(p.year_build) : null,
      off_plan: p.off_plan === '1',
      category: p.category || {},
      views: p.views || {},
      pools: p.pools || {},
      parking: {
        number_of_parking_spaces: p.parking?.number_of_parking_spaces ? Number(p.parking.number_of_parking_spaces) : 0,
        number_of_garage_spaces: p.parking?.number_of_garage_spaces ? Number(p.parking.number_of_garage_spaces) : 0
      },
      surface_area: {
        built_m2: p.surface_area?.built_m2 ? Number(p.surface_area.built_m2) : null,
        usable_m2: p.surface_area?.usable_living_area_m2 ? Number(p.surface_area.usable_living_area_m2) : null,
        terrace_m2: p.surface_area?.terrace_m2 ? Number(p.surface_area.terrace_m2) : 0,
        solarium_m2: p.surface_area?.solarium_area_m2 ? Number(p.surface_area.solarium_area_m2) : 0,
        garden_m2: p.surface_area?.garden_m2 ? Number(p.surface_area.garden_m2) : 0,
        underground_m2: p.surface_area?.underground_m2 ? Number(p.surface_area.underground_m2) : 0,
        plot_m2: p.surface_area?.plot_m2 ? Number(p.surface_area.plot_m2) : null
      },
      distances: p.distances || {},
      energy: p.energy_rating || {},
      title: (p.title?.es || p.title?.en || null),
      description: (p.desc?.es || p.desc?.en || null),
      features: featureList,
      extra_features: extraFeatures,
      main_image: gallery.length ? gallery[0] : null,
      gallery: gallery,
      media: p.media || {},
      restrictions: p.restrictions || {}
    };
  });

  cachedProperties = properties;
  cacheTimestamp = Date.now();
  return properties;
}

// Basic health
app.get('/', (req, res) => res.send('Kines RedSP proxy API is running'));

// List with simple filters: ?costa=Costa%20Blanca%20South&min_price=100000&max_price=300000&beds=2&town=Rojales
app.get('/api/properties', async (req, res) => {
  try {
    const all = await fetchAndParseFeed();
    let filtered = all;

    const { costa, town, min_price, max_price, beds, ref } = req.query;

    if (ref) {
      filtered = filtered.filter(p => p.ref && p.ref.toString() === ref.toString());
    }
    if (costa) {
      filtered = filtered.filter(p => p.costa && p.costa.toLowerCase().includes(costa.toLowerCase()));
    }
    if (town) {
      filtered = filtered.filter(p => p.address?.town && p.address.town.toLowerCase().includes(town.toLowerCase()));
    }
    if (min_price) {
      filtered = filtered.filter(p => p.price_from && p.price_from >= Number(min_price));
    }
    if (max_price) {
      filtered = filtered.filter(p => p.price_from && p.price_from <= Number(max_price));
    }
    if (beds) {
      filtered = filtered.filter(p => p.beds !== null && p.beds >= Number(beds));
    }

    res.json(filtered);
  } catch (err) {
    console.error('Fetch error:', err.message || err);
    res.status(500).json({ error: 'Error procesando el feed' });
  }
});

// Single property by id or ref
app.get('/api/properties/:id', async (req, res) => {
  try {
    const all = await fetchAndParseFeed();
    const id = req.params.id;
    const found = all.find(p => p.id === id || p.ref === id || p.development_ref === id);
    if (!found) return res.status(404).json({ error: 'No encontrado' });
    res.json(found);
  } catch (err) {
    console.error('Fetch error:', err.message || err);
    res.status(500).json({ error: 'Error procesando el feed' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kines RedSP proxy API listening on port ${PORT}`);
});
