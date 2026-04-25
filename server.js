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
    lastUpdated: null
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
        title: getVal(p.title?.es || p.title?.en || p.title),
        type: getVal(p.type),
        estado: getBool(p.new_build) ? 'Obra Nueva' : 'Resale',
        provincia: getVal(p.address?.province),
        ciudad: getVal(p.address?.town),
        costa: getVal(p.costa),
        price: getNum(p.price),
        bedrooms: getNum(p.beds),
        bathrooms: getNum(p.baths),
        image: images[0] || '',
        images: images,
        description: getVal(p.desc?.es || p.desc?.en || p.desc),
        latitude: getNum(p.location?.latitude),
        longitude: getNum(p.location?.longitude),
        features: {
            lift: getBool(p.features?.lift),
            pool: getBool(p.pools?.pool),
            garden: getBool(p.features?.garden)
        }
    };
}

async function updateCache() {
    try {
        console.log('Descargando XML...');
        // Forzamos respuesta como texto plano para evitar líos de tipos
        const response = await axios.get(XML_URL, { 
            timeout: 30000,
            responseType: 'text' 
        });
        
        // Limpieza absoluta de espacios y caracteres invisibles al inicio
        const cleanData = response.data.replace(/^\s+|\s+$/g, '').replace(/^\ufeff/g, '');

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
        console.log(`Éxito total: ${cache.data.length} propiedades cargadas.`);
    } catch (error) {
        console.error('Error detallado:', error.message);
        if (!cache.data) cache.data = [];
    }
}

app.get('/api/properties', async (req, res) => {
    if (cache.data.length === 0) await updateCache();
    const filtros = {
        provincias: [...new Set(cache.data.map(p => p.provincia))].filter(Boolean).sort(),
        ciudades: [...new Set(cache.data.map(p => p.ciudad))].filter(Boolean).sort(),
        costas: [...new Set(cache.data.map(p => p.costa))].filter(Boolean).sort(),
        tipos: [...new Set(cache.data.map(p => p.type))].filter(Boolean).sort(),
    };
    res.json({ total: cache.data.length, lastUpdated: cache.lastUpdated, filtrosDisponibles: filtros, properties: cache.data });
});

app.get('/api/properties/:ref', (req, res) => {
    const prop = cache.data.find(p => p.ref === req.params.ref);
    prop ? res.json(prop) : res.status(404).json({ error: 'No encontrado' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', count: cache.data.length, lastUpdated: cache.lastUpdated });
});

app.listen(PORT, () => {
    console.log(`Servidor Live en puerto ${PORT}`);
    updateCache();
});

setInterval(updateCache, 3600000);
