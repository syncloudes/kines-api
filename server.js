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
    data: null,
    lastUpdated: null
};

// ── Helpers para limpiar datos del XML de RedSP v4 ──

const getVal = (obj) => {
    if (obj === undefined || obj === null) return '';
    if (typeof obj === 'object') {
        if (obj['#text'] !== undefined) return String(obj['#text']).trim();
        if (Object.keys(obj).length === 0) return '';
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

// ── Extracción de imágenes ──
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

// ── Mapeo de una propiedad del XML a JSON limpio ──
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
        address_detail: getVal(p.address?.address_detail),
        location_detail_1: getVal(p.location_detail_1),
        location_detail_2: getVal(p.location_detail_2),

        latitude: getNum(p.location?.latitude),
        longitude: getNum(p.location?.longitude),

        price: getNum(p.price),
        price_to: getNum(p.price_to),
        currency: getVal(p.currency),
        price_freq: getVal(p.price_freq),

        bedrooms: getNum(p.beds),
        bathrooms: getNum(p.baths),
        toilets: getNum(p.toilets_wc),
        floors: getNum(p.number_of_floors),
        floor: getNum(p.floor),
        orientation: getVal(p.orientation),

        built: getNum(p.surface_area?.built_m2),
        usable: getNum(p.surface_area?.usable_living_area_m2),
        plot: getNum(p.surface_area?.plot_m2),
        terrace: getNum(p.surface_area?.terrace_m2),
        solarium_area: getNum(p.surface_area?.solarium_area_m2),
        garden_area: getNum(p.surface_area?.garden_m2),
        underground: getNum(p.surface_area?.underground_m2),

        distanceBeach: getNum(p.distances?.distance_to_beach_m),
        distanceAirport: getNum(p.distances?.distance_airport_m),
        distanceGolf: getNum(p.distances?.distance_golf_m),
        distanceAmenities: getNum(p.distances?.distance_amenities_m),

        pool: getBool(p.pools?.pool),
        communal_pool: getBool(p.pools?.communal_pool),
        private_pool: getBool(p.pools?.private_pool),

        parking: getNum(p.parking?.number_of_parking_spaces) > 0,
        parkingSpaces: getNum(p.parking?.number_of_parking_spaces),
        garageSpaces: getNum(p.parking?.number_of_garage_spaces),

        category: {
            urban: getBool(p.category?.urban),
            beach: getBool(p.category?.beach),
            golf: getBool(p.category?.golf),
            countryside: getBool(p.category?.countryside),
            first_line: getBool(p.category?.first_line),
            tourist_property: getBool(p.category?.tourist_property),
            featured: getBool(p.category?.featured),
        },

        views: {
            sea_views: getBool(p.views?.sea_views),
            village_views: getBool(p.views?.village_views),
            garden_views: getBool(p.views?.garden_views),
            pool_views: getBool(p.views?.pool_views),
            open_views: getBool(p.views?.open_views),
            mountain_views: getBool(p.views?.mountain_views),
        },

        features: {
            air_conditioning: getBool(p.features?.Air_Conditioning),
            appliances: getBool(p.features?.Appliances),
            armored_door: getBool(p.features?.Armored_Door),
            bbq: getBool(p.features?.bbq),
            corner: getBool(p.features?.corner),
            coworking: getBool(p.features?.coworking),
            domotics: getBool(p.features?.domotics),
            electric_blinds: getBool(p.features?.electric_blinds),
            furnished: getBool(p.features?.furnished),
            games_room: getBool(p.features?.games_room),
            garden: getBool(p.features?.garden),
            gated: getBool(p.features?.gated),
            gym: getBool(p.features?.gym),
            heating: getBool(p.features?.heating),
            jacuzzi: getBool(p.features?.jacuzzi),
            laundry_room: getBool(p.features?.laundry_room),
            lift: getBool(p.features?.lift),
            patio: getBool(p.features?.patio),
            safe_box: getBool(p.features?.safe_box),
            solarium: getBool(p.features?.solarium),
            spa: getBool(p.features?.spa),
            storage: getBool(p.features?.storage),
            storage_room: getBool(p.features?.storage_room),
            terrace: getBool(p.features?.terrace),
            white_goods: getBool(p.features?.white_goods),
        },

        lift: getBool(p.features?.lift),
        seaViews: getBool(p.views?.sea_views),
        solarium: getBool(p.features?.solarium),
        keyReady: getBool(p.key_ready),
        showHome: getBool(p.show_house),
        firstLine: getBool(p.category?.first_line),

        energy_consumption: getVal(p.energy_rating?.consumption),
        energy_emissions: getVal(p.energy_rating?.emissions),

        delivery_date: getVal(p.delivery_date),
        year_build: getVal(p.year_build),
        date: getVal(p.date),

        description: getVal(p.desc?.es || p.desc?.en || p.desc),
        description_en: getVal(p.desc?.en),
        description_es: getVal(p.desc?.es),

        images: images,
        image: images[0] || '',
    };
}

// ── Actualización del caché ──
async function updateCache() {
    try {
        console.log('Actualizando caché desde RedSP v4...');
        const response = await axios.get(XML_URL, { timeout: 60000 });

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            textNodeName: '#text',
            parseTagValue: true,
            trimValues: true,
        });

        const jsonObj = parser.parse(response.data);

        // FIX: el nodo raíz del XML es <redsp>, no <root>
        console.log('Nodo raíz XML:', Object.keys(jsonObj));
        const propertiesRaw = jsonObj.redsp?.property
            || jsonObj.root?.property
            || jsonObj.property
            || [];
        const propertiesArray = Array.isArray(propertiesRaw) ? propertiesRaw : [propertiesRaw];

        console.log('Propiedades encontradas:', propertiesArray.length);

        const mapped = propertiesArray.map(mapProperty);

        cache.data = mapped;
        cache.lastUpdated = new Date();
        console.log(`Caché actualizada: ${mapped.length} propiedades cargadas.`);
    } catch (error) {
        console.error('Error actualizando caché:', error.message);
    }
}

// ── Rutas ──

app.get('/api/properties', async (req, res) => {
    if (!cache.data) await updateCache();
    if (!cache.data) return res.status(503).json({ error: 'Datos no disponibles todavía' });

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
        properties: cache.data,
    });
});

app.get('/api/properties/:ref', async (req, res) => {
    if (!cache.data) await updateCache();
    if (!cache.data) return res.status(503).json({ error: 'Datos no disponibles todavía' });

    const prop = cache.data.find(p => p.ref === req.params.ref);
    prop ? res.json(prop) : res.status(404).json({ error: 'Propiedad no encontrada' });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        count: cache.data?.length || 0,
        lastUpdated: cache.lastUpdated,
    });
});

app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
    updateCache();
});

// Auto-refresh cada hora
setInterval(updateCache, 3600000);            games_room: getBool(p.features?.games_room),
            garden: getBool(p.features?.garden),
            gated: getBool(p.features?.gated),
            gym: getBool(p.features?.gym),
            heating: getBool(p.features?.heating),
            jacuzzi: getBool(p.features?.jacuzzi),
            laundry_room: getBool(p.features?.laundry_room),
            lift: getBool(p.features?.lift),
            patio: getBool(p.features?.patio),
            safe_box: getBool(p.features?.safe_box),
            solarium: getBool(p.features?.solarium),
            spa: getBool(p.features?.spa),
            storage: getBool(p.features?.storage),
            storage_room: getBool(p.features?.storage_room),
            terrace: getBool(p.features?.terrace),
            white_goods: getBool(p.features?.white_goods),
        },

        // Booleans directos para filtros rápidos del frontend
        lift: getBool(p.features?.lift),
        seaViews: getBool(p.views?.sea_views),
        solarium: getBool(p.features?.solarium),
        keyReady: getBool(p.key_ready),
        showHome: getBool(p.show_house),
        firstLine: getBool(p.category?.first_line),

        // Energía
        energy_consumption: getVal(p.energy_rating?.consumption),
        energy_emissions: getVal(p.energy_rating?.emissions),

        // Fechas
        delivery_date: getVal(p.delivery_date),
        year_build: getVal(p.year_build),
        date: getVal(p.date),

        // Descripción (multi-idioma)
        description: getVal(p.desc?.es || p.desc?.en || p.desc),
        description_en: getVal(p.desc?.en),
        description_es: getVal(p.desc?.es),

        // Imágenes – array de URLs
        images: images,
        image: images[0] || '',
    };
}

// ── Actualización del caché ──
async function updateCache() {
    try {
        console.log('Actualizando caché desde RedSP v4...');
        const response = await axios.get(XML_URL, { timeout: 60000 });

        const parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '',
            textNodeName: '#text',
            // No tratar números como tal para evitar perder ceros iniciales en refs
            parseTagValue: true,
            trimValues: true,
        });

        const jsonObj = parser.parse(response.data);

        // RedSP v4: root > property (array)
        const propertiesRaw = jsonObj.root?.property || jsonObj.property || [];
        const propertiesArray = Array.isArray(propertiesRaw) ? propertiesRaw : [propertiesRaw];

        const mapped = propertiesArray.map(mapProperty);

        cache.data = mapped;
        cache.lastUpdated = new Date();
        console.log(`Caché actualizada: ${mapped.length} propiedades cargadas.`);
    } catch (error) {
        console.error('Error actualizando caché:', error.message);
    }
}

// ── Rutas ──

app.get('/api/properties', async (req, res) => {
    if (!cache.data) await updateCache();
    if (!cache.data) return res.status(503).json({ error: 'Datos no disponibles todavía' });

    // Generar listas únicas para los filtros del frontend
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
        properties: cache.data,
    });
});

app.get('/api/properties/:ref', async (req, res) => {
    if (!cache.data) await updateCache();
    if (!cache.data) return res.status(503).json({ error: 'Datos no disponibles todavía' });

    const prop = cache.data.find(p => p.ref === req.params.ref);
    prop ? res.json(prop) : res.status(404).json({ error: 'Propiedad no encontrada' });
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        count: cache.data?.length || 0,
        lastUpdated: cache.lastUpdated,
    });
});

app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
    updateCache();
});

// Auto-refresh cada hora
setInterval(updateCache, 3600000);
