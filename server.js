const express = require('express');
const axios = require('axios');
const { XMLParser } = require('fast-xml-parser');
const compression = require('compression');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const XML_URL = 'https://xml.redsp.net/files/1094/93025amh27n/kines-home-redsp_v4.xml';

app.use(compression());
app.use(cors());

let cache = {
    data: [],
    lastUpdated: null,
    loading: false
};

const getVal = (obj) => {
    if (obj === undefined || obj === null) return '';
    if (typeof obj === 'object') {
        if (obj['#text'] !== undefined) return String(obj['#text']).trim();
        return '';
    }
    return String(obj).trim();
};

const getBool = (val) => {
    const s = getVal(val).toLowerCase();
    return s === '1' || s === 'yes' || s === 'true' || s === 'si';
};

const getNum = (val) => {
    const n = parseFloat(getVal(val));
    return isNaN(n) ? 0 : n;
};

function extractImages(p) {
    const imgs = [];
    if (!p.images || !p.images.image) return imgs;
    const rawImages = Array.isArray(p.images.image) ? p.images.image : [p.images.image];
    for (const img of rawImages) {
        if (typeof img === 'string') {
            if (img.startsWith('http')) imgs.push(img);
        } else if (typeof img === 'object') {
            const url = getVal(img.url);
            if (url) imgs.push(url);
        }
    }
    return imgs;
}

function mapProperty(p) {
    const images = extractImages(p);
    return {
        id: getVal(p.id),
        ref: getVal(p.ref),
        development_ref: getVal(p.development_ref),
        title: getVal(p.title?.es || p.title?.en || p.title),
        title_en: getVal(p.title?.en),
        title_es: getVal(p.title?.es),
        type: getVal(p.type),
        estado: getBool(p.new_build) ? 'Obra Nueva' : 'Resale',
        new_build: getBool(p.new_build),
        off_plan: getBool(p.off_plan),
        provincia: getVal(p.address?.province),
        ciudad: getVal(p.address?.town),
        costa: getVal(p.costa),
        country: getVal(p.country),
        postal_code: getVal(p.address?.postal_code),
        latitude: getNum(p.location?.latitude),
        longitude: getNum(p.location?.longitude),
        price: getNum(p.price),
        price_to: getNum(p.price_to),
        currency: getVal(p.currency),
        bedrooms: getNum(p.beds),
        bathrooms: getNum(p.baths),
        built: getNum(p.surface_area?.built_m2),
        plot: getNum(p.surface_area?.plot_m2),
        terrace: getNum(p.surface_area?.terrace_m2),
        distanceBeach: getNum(p.distances?.distance_to_beach_m),
        distanceAirport: getNum(p.distances?.distance_airport_m),
        distanceGolf: getNum(p.distances?.distance_golf_m),
        pool: getBool(p.pools?.pool),
        communal_pool: getBool(p.pools?.communal_pool),
        private_pool: getBool(p.pools?.private_pool),
        parking: getNum(p.parking?.number_of_parking_spaces) > 0,
        parkingSpaces: getNum(p.parking?.number_of_parking_spaces),
        category: {
            urban: getBool(p.category?.urban),
            beach: getBool(p.category?.beach),
            golf: getBool(p.category?.golf),
            countryside: getBool(p.category?.countryside),
            first_line: getBool(p.category?.first_line),
            tourist_property: getBool(p.category?.tourist_property),
        },
        views: {
            sea_views: getBool(p.views?.sea_views),
            garden_views: getBool(p.views?.garden_views),
            pool_views: getBool(p.views?.pool_views),
            mountain_views: getBool(p.views?.mountain_views),
        },
        features: {
            air_conditioning: getBool(p.features?.Air_Conditioning),
            furnished: getBool(p.features?.furnished),
            garden: getBool(p.features?.garden),
            gym: getBool(p.features?.gym),
            lift: getBool(p.features?.lift),
            solarium: getBool(p.features?.solarium),
            spa: getBool(p.features?.spa),
            storage_room: getBool(p.features?.storage_room),
            terrace: getBool(p.features?.terrace),
        },
        lift: getBool(p.features?.lift),
        seaViews: getBool(p.views?.sea_views),
        solarium: getBool(p.features?.solarium),
        keyReady: getBool(p.key_ready),
        showHome: getBool(p.show_house),
        firstLine: getBool(p.category?.first_line),
        delivery_date: getVal(p.delivery_date),
        year_build: getVal(p.year_build),
        description: getVal(p.desc?.es || p.desc?.en || p.desc),
        description_en: getVal(p.desc?.en),
        description_es: getVal(p.desc?.es),
        images: images,
        image: images[0] || '',
    };
}

// Promesa de carga inicial para que las rutas esperen si el cache está vacío
let initialLoadPromise = null;

async function updateCache() {
    if (cache.loading) return; // Evita llamadas simultáneas
    cache.loading = true;
    try {
        console.log('Descargando XML desde REDSP...');
        const response = await axios.get(XML_URL, {
            timeout: 30000,
            responseType: 'text'
        });

        const cleanData = String(response.data)
            .replace(/^\uFEFF/, '')  // BOM
            .trim();

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            textNodeName: '#text',
            parseTagValue: true,
            trimValues: true,
        });

        const jsonObj = parser.parse(cleanData);
        const propertiesRaw = jsonObj.redsp?.property || jsonObj.root?.property || jsonObj.property || [];
        const propertiesArray = Array.isArray(propertiesRaw) ? propertiesRaw : [propertiesRaw];

        cache.data = propertiesArray.map(mapProperty);
        cache.lastUpdated = new Date();
        console.log(`Cache actualizada: ${cache.data.length} propiedades.`);
    } catch (error) {
        console.error('Error al actualizar cache:', error.message);
        if (!Array.isArray(cache.data)) cache.data = [];
    } finally {
        cache.loading = false;
    }
}

// Carga inicial al arrancar
initialLoadPromise = updateCache();

// Refresco automático cada hora
setInterval(updateCache, 3600000);

// Middleware: espera a que el cache esté listo antes de responder
async function ensureCache(req, res, next) {
    if (cache.data.length === 0) {
        console.log('Cache vacía, esperando carga inicial...');
        await initialLoadPromise;
        if (cache.data.length === 0) {
            // Si sigue vacío, intenta una vez más
            await updateCache();
        }
    }
    next();
}

// Rutas
app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'API Kines Homes activa', count: cache.data.length });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', count: cache.data.length, lastUpdated: cache.lastUpdated });
});

app.get('/api/properties', ensureCache, (req, res) => {
    const filtros = {
        provincias: [...new Set(cache.data.map(p => p.provincia))].filter(Boolean).sort(),
        ciudades: [...new Set(cache.data.map(p => p.ciudad))].filter(Boolean).sort(),
        costas: [...new Set(cache.data.map(p => p.costa))].filter(Boolean).sort(),
        tipos: [...new Set(cache.data.map(p => p.type))].filter(Boolean).sort(),
    };
    res.json({
        total: cache.data.length,
        lastUpdated: cache.lastUpdated,
        filtrosDisponibles: filtros,
        properties: cache.data
    });
});

app.get('/api/properties/:ref', ensureCache, (req, res) => {
    const prop = cache.data.find(p => p.ref === req.params.ref);
    prop ? res.json(prop) : res.status(404).json({ error: 'Propiedad no encontrada' });
});

app.listen(PORT, () => {
    console.log(`Servidor Kines Homes en puerto ${PORT}`);
});
