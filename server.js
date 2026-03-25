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

// ─── HELPERS ────────────────────────────────────────────────────────────────

function getText(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '';
    return getText(value[0]);
  }
  if (typeof value === 'object') {
    if ('_' in value) return String(value._).trim();
    const keys = Object.keys(value);
    for (const key of keys) {
      const result = getText(value[key]);
      if (result) return result;
    }
  }
  return '';
}

function toNumber(value) {
  const text = getText(value).replace(',', '.').replace(/[^\d.-]/g, '');
  const num = Number(text);
  return Number.isNaN(num) ? 0 : num;
}

function toBool(value) {
  const text = getText(value).toLowerCase();
  return ['1', 'true', 'yes', 'si', 'sí'].includes(text);
}

function getNestedText(obj, paths = []) {
  for (const path of paths) {
    const parts = path.split('.');
    let current = obj;
    let found = true;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        found = false;
        break;
      }
    }
    if (found) {
      const value = getText(current);
      if (value) return value;
    }
  }
  return '';
}

function getNestedNumber(obj, paths = []) {
  for (const path of paths) {
    const parts = path.split('.');
    let current = obj;
    let found = true;
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = current[part];
      } else {
        found = false;
        break;
      }
    }
    if (found) {
      const value = toNumber(current);
      if (value) return value;
    }
  }
  return 0;
}

function extractImages(imagesNode) {
  if (!imagesNode) return [];
  const rawImages = imagesNode.image || imagesNode.images || imagesNode;
  if (!Array.isArray(rawImages)) {
    const single = getText(rawImages);
    return single ? [single] : [];
  }
  return rawImages
    .map((img) => {
      if (typeof img === 'string') return img.trim();
      if (img && typeof img === 'object') return getText(img.url || img);
      return '';
    })
    .filter(Boolean);
}

function extractCategoryFlags(categoryNode) {
  return {
    urban: toBool(categoryNode?.urban),
    beach: toBool(categoryNode?.beach),
    golf: toBool(categoryNode?.golf),
    countryside: toBool(categoryNode?.countryside),
    firstLine: toBool(categoryNode?.first_line),
    touristProperty: toBool(categoryNode?.tourist_property),
    featured: toBool(categoryNode?.featured)
  };
}

function mapearPropiedad(item) {
  const categoria = extractCategoryFlags(item.category || {});

  const provincia = getNestedText(item, [
    'province', 'provincia',
    'location.province', 'location.provincia',
    'address.province', 'address.provincia'
  ]);

  const ciudad = getNestedText(item, [
    'city', 'ciudad', 'town', 'municipality',
    'location.city', 'location.ciudad',
    'address.city', 'address.town'
  ]);

  const costa = getNestedText(item, [
    'location', 'area', 'zone', 'region', 'costa',
    'location.area', 'location.zone', 'address.area'
  ]);

  const estado = getNestedText(item, ['new_build', 'status', 'estado']);

  const images = extractImages(item.images);

  return {
    ref: getNestedText(item, ['ref', 'reference', 'id']),
    title: getNestedText(item, ['title', 'name']),
    type: getNestedText(item, ['type', 'property_type']),
    estado,
    provincia,
    ciudad,
    costa,

    price: getNestedNumber(item, ['price', 'precio']),
    bedrooms: getNestedNumber(item, ['beds', 'bedrooms', 'habitaciones']),
    bathrooms: getNestedNumber(item, ['baths', 'bathrooms', 'banos', 'baños']),
    built: getNestedNumber(item, ['built', 'built_size', 'constructed_area', 'm2', 'surface']),
    plot: getNestedNumber(item, ['plot', 'plot_size', 'parcela']),
    terrace: getNestedNumber(item, ['terrace', 'terrace_size']),
    distanceBeach: getNestedNumber(item, ['distance_beach', 'distance_to_beach', 'beach_distance']),

    lat: getNestedText(item, ['lat', 'latitude', 'location.lat']),
    lng: getNestedText(item, ['lng', 'lon', 'longitude', 'location.lng', 'location.lon']),

    pool: toBool(item.pool),
    keyReady: toBool(item.key_ready || item.llave_mano),
    showHome: toBool(item.show_home || item.piso_piloto),
    parking: toBool(item.parking),
    lift: toBool(item.lift || item.elevator || item.ascensor),
    seaViews: toBool(item.sea_views || item.vistas_mar),
    solarium: toBool(item.solarium),
    firstLine: categoria.firstLine || toBool(item.first_line),
    featured: categoria.featured,

    category: categoria,

    description: getNestedText(item, [
      'desc.es', 'desc.en',
      'description.es', 'description.en',
      'desc', 'description'
    ]),

    images,
    image: images[0] || ''
  };
}

// ─── CACHE ───────────────────────────────────────────────────────────────────

async function actualizarCache() {
  try {
    console.log('🔄 Descargando XML desde redsp...');
    const response = await axios.get(XML_URL, { timeout: 30000 });
    const parser = new xml2js.Parser({ explicitArray: true, mergeAttrs: false });
    const result = await parser.parseStringPromise(response.data);

    const root = result[Object.keys(result)[0]];
    let items = [];

    if (root.property) items = root.property;
    else if (root.properties?.property) items = root.properties.property;
    else if (root.item) items = root.item;
    else if (root.listing) items = root.listing;
    else {
      const keys = Object.keys(root);
      for (const key of keys) {
        if (Array.isArray(root[key]) && root[key].length > 0) {
          items = root[key];
          break;
        }
      }
    }

    cache.data = items.map(mapearPropiedad);
    cache.lastUpdate = new Date();
    console.log(`✅ XML procesado: ${cache.data.length} propiedades`);
  } catch (error) {
    console.error('❌ Error actualizando caché:', error.message);
  }
}

function cacheValida() {
  return cache.data && cache.lastUpdate && (Date.now() - cache.lastUpdate.getTime() < CACHE_DURATION);
}

async function obtenerPropiedades() {
  if (!cacheValida()) await actualizarCache();
  return cache.data || [];
}

// ─── ENDPOINTS ───────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    cacheActiva: !!cache.data,
    ultimaActualizacion: cache.lastUpdate,
    totalPropiedades: cache.data?.length || 0
  });
});

app.get('/api/properties', async (req, res) => {
  try {
    let resultado = await obtenerPropiedades();

    const {
      provincia, ciudad, costa, tipo, estado,
      pool, parking, lift, seaViews, solarium,
      firstLine, keyReady, showHome,
      minPrice, maxPrice,
      minBeds, minBaths,
      minBuilt, minPlot, minTerrace,
      maxDistanceBeach,
      categoria,
      page, limit
    } = req.query;

    if (provincia) resultado = resultado.filter(p => p.provincia.toLowerCase().includes(provincia.toLowerCase()));
    if (ciudad) resultado = resultado.filter(p => p.ciudad.toLowerCase().includes(ciudad.toLowerCase()));
    if (costa) resultado = resultado.filter(p => p.costa.toLowerCase().includes(costa.toLowerCase()));
    if (tipo) resultado = resultado.filter(p => p.type.toLowerCase().includes(tipo.toLowerCase()));
    if (estado) resultado = resultado.filter(p => p.estado.toLowerCase().includes(estado.toLowerCase()));

    if (pool === 'true') resultado = resultado.filter(p => p.pool);
    if (parking === 'true') resultado = resultado.filter(p => p.parking);
    if (lift === 'true') resultado = resultado.filter(p => p.lift);
    if (seaViews === 'true') resultado = resultado.filter(p => p.seaViews);
    if (solarium === 'true') resultado = resultado.filter(p => p.solarium);
    if (firstLine === 'true') resultado = resultado.filter(p => p.firstLine);
    if (keyReady === 'true') resultado = resultado.filter(p => p.keyReady);
    if (showHome === 'true') resultado = resultado.filter(p => p.showHome);

    if (minPrice) resultado = resultado.filter(p => p.price >= Number(minPrice));
    if (maxPrice) resultado = resultado.filter(p => p.price <= Number(maxPrice));
    if (minBeds) resultado = resultado.filter(p => p.bedrooms >= Number(minBeds));
    if (minBaths) resultado = resultado.filter(p => p.bathrooms >= Number(minBaths));
    if (minBuilt) resultado = resultado.filter(p => p.built >= Number(minBuilt));
    if (minPlot) resultado = resultado.filter(p => p.plot >= Number(minPlot));
    if (minTerrace) resultado = resultado.filter(p => p.terrace >= Number(minTerrace));
    if (maxDistanceBeach) resultado = resultado.filter(p => p.distanceBeach > 0 && p.distanceBeach <= Number(maxDistanceBeach));

    if (categoria) {
      resultado = resultado.filter(p => p.category && p.category[categoria] === true);
    }

    const filtrosDisponibles = {
      provincias: [...new Set(resultado.map(p => p.provincia).filter(Boolean))].sort(),
      ciudades: [...new Set(resultado.map(p => p.ciudad).filter(Boolean))].sort(),
      costas: [...new Set(resultado.map(p => p.costa).filter(Boolean))].sort(),
      tipos: [...new Set(resultado.map(p => p.type).filter(Boolean))].sort(),
      estados: [...new Set(resultado.map(p => p.estado).filter(Boolean))].sort(),
      categorias: {
        urban: resultado.some(p => p.category?.urban),
        beach: resultado.some(p => p.category?.beach),
        golf: resultado.some(p => p.category?.golf),
        countryside: resultado.some(p => p.category?.countryside),
        firstLine: resultado.some(p => p.category?.firstLine),
        touristProperty: resultado.some(p => p.category?.touristProperty),
        featured: resultado.some(p => p.category?.featured)
      }
    };

    const total = resultado.length;
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 50;
    const start = (pageNum - 1) * limitNum;
    const paginated = resultado.slice(start, start + limitNum);

    res.json({
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
      filtrosDisponibles,
      properties: paginated
    });
  } catch (error) {
    console.error('Error en /api/properties:', error.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

app.get('/api/properties/:ref', async (req, res) => {
  try {
    const propiedades = await obtenerPropiedades();
    const propiedad = propiedades.find(p => p.ref === req.params.ref);
    if (!propiedad) return res.status(404).json({ error: 'Propiedad no encontrada' });
    res.json(propiedad);
  } catch (error) {
    console.error('Error en /api/properties/:ref:', error.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── INICIO ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 Kines Homes API corriendo en puerto ${PORT}`);
  actualizarCache();
  setInterval(actualizarCache, CACHE_DURATION);
});
