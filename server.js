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

// Helpers para limpiar datos del XML de RedSP
const getVal = (obj) => {
    if (obj === undefined || obj === null) return '';
    if (typeof obj === 'object' && obj['#text'] !== undefined) return obj['#text'].toString().trim();
    if (typeof obj === 'object' && Object.keys(obj).length === 0) return '';
    return obj.toString().trim();
};

const getBool = (val) => {
    const s = getVal(val).toLowerCase();
    return s === '1' || s === 'yes' || s === 'true' || s === 'si';
};

const getNum = (val) => {
    const n = parseFloat(getVal(val));
    return isNaN(n) ? 0 : n;
};

async function updateCache() {
    try {
        console.log('Actualizando caché desde RedSP...');
        const response = await axios.get(XML_URL, { timeout: 30000 });
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
        const jsonObj = parser.parse(response.data);
        
        // En RedSP la ruta suele ser root.property o property
        const propertiesRaw = jsonObj.root?.property || jsonObj.property || [];
        const propertiesArray = Array.isArray(propertiesRaw) ? propertiesRaw : [propertiesRaw];

        const mapped = propertiesArray.map(p => {
            // Extracción de imágenes (RedSP usa <images><image>URL</image></images>)
            let imgs = [];
            if (p.images?.image) {
                imgs = Array.isArray(p.images.image) ? p.images.image.map(getVal) : [getVal(p.images.image)];
            }

            return {
                ref: getVal(p.reference),
                title: getVal(p.title?.es || p.title),
                type: getVal(p.type?.es || p.type),
                estado: getVal(p.new_build) === '1' ? 'Obra Nueva' : 'Resale',
                
                // Ubicación (Corregido para RedSP)
                provincia: getVal(p.province),
                ciudad: getVal(p.town),
                costa: getVal(p.area), 
                
                price: getNum(p.price),
                bedrooms: getNum(p.bedrooms),
                bathrooms: getNum(p.bathrooms),
                
                // Medidas
                built: getNum(p.built),
                plot: getNum(p.plot),
                terrace: getNum(p.terrace),
                distanceBeach: getNum(p.distance_to_sea),
                
                // Booleans (Filtros)
                pool: getBool(p.pool) || getBool(p.communal_pool) || getBool(p.private_pool),
                parking: getBool(p.parking) || getBool(p.garage),
                lift: getBool(p.lift),
                seaViews: getBool(p.sea_views),
                solarium: getBool(p.solarium),
                keyReady: getBool(p.key_ready),
                showHome: getBool(p.show_home),
                firstLine: getBool(p.front_line),
                
                category: getVal(p.category),
                description: getVal(p.description?.es || p.description),
                images: imgs,
                image: imgs[0] || ''
            };
        });

        cache.data = mapped;
        cache.lastUpdated = new Date();
        console.log(`Caché lista: ${mapped.length} propiedades.`);
    } catch (error) {
        console.error('Error actualizando caché:', error.message);
    }
}

// Rutas
app.get('/api/properties', async (req, res) => {
    if (!cache.data) await updateCache();
    
    // Generar listas únicas para los filtros del frontend
    const filtros = {
        provincias: [...new Set(cache.data.map(p => p.provincia))].filter(Boolean).sort(),
        ciudades: [...new Set(cache.data.map(p => p.ciudad))].filter(Boolean).sort(),
        costas: [...new Set(cache.data.map(p => p.costa))].filter(Boolean).sort(),
        tipos: [...new Set(cache.data.map(p => p.type))].filter(Boolean).sort()
    };

    res.json({
        total: cache.data.length,
        filtrosDisponibles: filtros,
        properties: cache.data
    });
});

app.get('/api/properties/:ref', async (req, res) => {
    if (!cache.data) await updateCache();
    const prop = cache.data.find(p => p.ref === req.params.ref);
    prop ? res.json(prop) : res.status(404).json({ error: 'No encontrada' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'OK', count: cache.data?.length || 0 });
});

app.listen(PORT, () => {
    console.log(`Servidor en puerto ${PORT}`);
    updateCache();
});

// Auto-refresh cada hora
setInterval(updateCache, 3600000);
