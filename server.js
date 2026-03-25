const express = require('express');
const axios = require('axios');
const xml2js = require('xml2js');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 10000;
const XML_URL = 'https://xml.redsp.net/files/1094/93025amh27n/kines-home-redsp_v4.xml';
const CACHE_DURATION = 60 * 60 * 1000; // 1 hora

let cache = {
  data: null,
  lastUpdate: null
};

app.use(compression());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
});

// ─── HELPERS ROBUSTOS ───────────────────────────────────────────────────────

function getText(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return getText(value[0]);
  if (typeof value === 'object') return getText(value._ || value.es || value.en || Object.values(value)[0]);
  return String(value).trim();
}

function toNumber(value) {
  const text = getText(value).replace(',', '.').replace(/[^\d.-]/g, '');
  return parseFloat(text) || 0;
}

function toBool(value) {
  const text = getText(value).toLowerCase();
  return ['1', 'true', 'yes', 'si', 'sí'].includes(text);
}

function mapearPropiedad(item) {
  // Extraer imágenes (RedSP suele usar item.images[0].image)
  let images = [];
  if (item.images && item.images[0] && item.images[0].image) {
    images = item.images[0].image.map(img => getText(img));
  }

  // Extraer categorías
  const cat = item.category && item.category[0] ? item.category[0] : {};
  const categoryFlags = {
    urban: toBool(cat.urban),
    beach: toBool(cat.beach),
    golf: toBool(cat.golf),
    countryside: toBool(cat.countryside),
    firstLine: toBool(cat.first_line),
    touristProperty: toBool(cat.tourist_property),
    featured: toBool(cat.featured)
  };

  // Ubicación (Rutas específicas de RedSP)
  const provincia = getText(item.province);
  const ciudad = getText(item.city);
  const costa = getText(item.region || item.area || item.location);
  const tipo = getText(item.type);
  const estado = toBool(item.new_build) ? 'Obra Nueva' : 'Segunda Mano';

  return {
    ref: getText(item.ref),
    title: getText(item.title),
    type: tipo,
    estado,
    provincia,
    ciudad,
    costa,
    price: toNumber(item.price),
    bedrooms: toNumber(item.beds),
    bathrooms: toNumber(item.baths),
    built: toNumber(item.built),
    plot: toNumber(item.plot),
    terrace: toNumber(item.terrace),
    distanceBeach: toNumber(item.distance_beach),
    pool: toBool(item.pool),
    parking: toBool(item.parking),
    lift: toBool(item.lift),
    seaViews: toBool(item.sea_views),
    solarium: toBool(item.solarium),
    keyReady: toBool(item.key_ready),
    showHome: toBool(item.show_home),
    firstLine: categoryFlags.firstLine,
    featured: categoryFlags.featured,
    category: categoryFlags,
    description: getText(item.desc),
    images: images,
    image: images[0] || ''
  };
}

// ─── CACHE ───────────────────────────────────────────────────────────────────

async function actualizarCache() {
  try {
    console.log('🔄 Descargando XML...');
    const response = await axios.get(XML_URL, { timeout: 60000 });
    const parser = new xml2js.Parser({ explicitArray: true, mergeAttrs: false });
    const result = await parser.parseStringPromise(response.data);

    // Encontrar el array de propiedades
    const root = result.root || result.properties || result.list || result;
    const items = root.property || [];

    cache.data = items.map(mapearPropiedad);
    cache.lastUpdate = new Date();
    console.log(`✅ Cache lista: ${cache.data.length} propiedades`);
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// ─── ENDPOINTS ───────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'OK', total: cache.data?.length || 0, updated: cache.lastUpdate });
});

app.get('/api/properties', async (req, res) => {
  if (!cache.data) await actualizarCache();
  let data = [...cache.data];

  const { provincia, ciudad, costa, tipo, minPrice, maxPrice, minBeds, pool, parking, category } = req.query;

  if (provincia) data = data.filter(p => p.provincia.toLowerCase() === provincia.toLowerCase());
  if (ciudad) data = data.filter(p => p.ciudad.toLowerCase() === ciudad.toLowerCase());
  if (costa) data = data.filter(p => p.costa.toLowerCase() === costa.toLowerCase());
  if (tipo) data = data.filter(p => p.type.toLowerCase() === tipo.toLowerCase());
  if (minPrice) data = data.filter(p => p.price >= Number(minPrice));
  if (maxPrice) data = data.filter(p => p.price <= Number(maxPrice));
  if (minBeds) data = data.filter(p => p.bedrooms >= Number(minBeds));
  if (pool === 'true') data = data.filter(p => p.pool);
  if (parking === 'true') data = data.filter(p => p.parking);
  if (category) data = data.filter(p => p.category[category] === true);

  const filtros = {
    provincias: [...new Set(cache.data.map(p => p.provincia))].filter(Boolean).sort(),
    ciudades: [...new Set(cache.data.map(p => p.ciudad))].filter(Boolean).sort(),
    costas: [...new Set(cache.data.map(p => p.costa))].filter(Boolean).sort(),
    tipos: [...new Set(cache.data.map(p => p.type))].filter(Boolean).sort()
  };

  res.json({
    total: data.length,
    filtrosDisponibles: filtros,
    properties: data.slice(0, 100) // Limitamos a 100 para no saturar el navegador
  });
});

app.get('/api/properties/:ref', async (req, res) => {
  if (!cache.data) await actualizarCache();
  const p = cache.data.find(x => x.ref === req.params.ref);
  p ? res.json(p) : res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 Puerto ${PORT}`);
  actualizarCache();
});
