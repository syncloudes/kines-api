import express from 'express';
import fetch from 'node-fetch';
import { parseStringPromise } from 'xml2js';
import compression from 'compression';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// CONFIGURACIÓN
// ============================================================
const XML_URL = 'https://xml.redsp.net/files/1094/93025amh27n/kines-home-redsp_v4.xml';
const CACHE_DURACION = 60 * 60 * 1000; // 1 hora en ms

// ============================================================
// CACHÉ EN MEMORIA
// ============================================================
let cache = {
    datos: null,
    ultimaActualizacion: 0
};

// ============================================================
// MIDDLEWARES
// ============================================================
app.use(compression());
app.use(cors());
app.use(express.json());

// ============================================================
// FUNCIÓN: MAPEO XML → JSON LIMPIO
// ============================================================
function mapearPropiedad(p) {
    const imagenes = [];
    if (p.images?.[0]?.image) {
        for (const img of p.images[0].image) {
            const url = img.url?.[0] || img;
            if (url) imagenes.push(url);
        }
    }

    return {
        id:             p.id?.[0] || p.reference?.[0],
        ref:            p.reference?.[0] || '',
        titulo:         p.title_en?.[0] || p.title?.[0] || '',
        tituloEs:       p.title_es?.[0] || p.title?.[0] || '',

        estado:         p.status?.[0] === 'sale' ? 'Disponible' : (p.status?.[0] || ''),
        provincia:      p.province?.[0] || '',
        costa:          p.region?.[0] || '',
        ciudad:         p.city?.[0] || '',
        tipo:           p.type?.[0] || '',
        precio:         parseFloat(p.price?.[0] || 0),
        dormitorios:    parseInt(p.bedrooms?.[0] || 0),
        banos:          parseInt(p.bathrooms?.[0] || 0),
        tienePiscina:   p.pool?.[0] === '1',

        m2Construidos:          parseInt(p.built?.[0] || 0),
        m2Parcela:              parseInt(p.plot?.[0] || 0),
        m2Terraza:              parseInt(p.terrace?.[0] || 0),
        distanciaPlayaMetros:   parseInt(p.distance_beach?.[0] || 0),
        llaveEnMano:            p.new_build?.[0] === '1' && (new Date(p.completion_date?.[0]) <= new Date()),
        tieneParking:           p.parking?.[0] === '1',
        tieneAscensor:          p.lift?.[0] === '1',
        vistasAlMar:            p.sea_views?.[0] === '1',
        tieneSolarium:          p.solarium?.[0] === '1',
        primeraLinea:           p.frontline?.[0] === '1',
        pisoPiloto:             p.show_house?.[0] === '1',
        categoria:              p.category?.[0] || '',

        imagenPrincipal: imagenes[0] || '',
        imagenes:        imagenes,

        descripcionEs:  p.desc_es?.[0] || p.description_es?.[0] || '',
        descripcionEn:  p.desc_en?.[0] || p.description_en?.[0] || '',

        direccion:  p.address?.[0] || '',
        cp:         p.postcode?.[0] || '',
        pais:       p.country?.[0] || '',
        ubicacion: {
            lat: parseFloat(p.location?.[0]?.lat?.[0] || p.latitude?.[0] || 0),
            lng: parseFloat(p.location?.[0]?.lng?.[0] || p.longitude?.[0] || 0)
        },

        anoConstruccion:    parseInt(p.year?.[0] || 0),
        fechaEntrega:       p.completion_date?.[0] || '',
        obraNueva:          p.new_build?.[0] === '1',
        certificadoEnergia: p.energy_rating?.[0] || '',
        zona:               p.urbanisation?.[0] || p.zone?.[0] || ''
    };
}

// ============================================================
// FUNCIÓN: OBTENER DATOS (con caché)
// ============================================================
async function obtenerDatos() {
    const ahora = Date.now();

    if (cache.datos && (ahora - cache.ultimaActualizacion < CACHE_DURACION)) {
        console.log('✅ Sirviendo desde caché');
        return cache.datos;
    }

    console.log('🔄 Descargando XML desde redsp...');
    try {
        const respuesta = await fetch(XML_URL);
        const xmlTexto = await respuesta.text();
        const xmlObj = await parseStringPromise(xmlTexto, { explicitArray: true });

        const propiedadesRaw = xmlObj?.properties?.property
            || xmlObj?.root?.property
            || xmlObj?.feed?.property
            || [];

        const propiedadesMapeadas = propiedadesRaw.map(mapearPropiedad);

        const filtrosDisponibles = {
            provincias:  [...new Set(propiedadesMapeadas.map(p => p.provincia).filter(Boolean))].sort(),
            ciudades:    [...new Set(propiedadesMapeadas.map(p => p.ciudad).filter(Boolean))].sort(),
            costas:      [...new Set(propiedadesMapeadas.map(p => p.costa).filter(Boolean))].sort(),
            tipos:       [...new Set(propiedadesMapeadas.map(p => p.tipo).filter(Boolean))].sort(),
            categorias:  [...new Set(propiedadesMapeadas.map(p => p.categoria).filter(Boolean))].sort(),
            precios: {
                min: Math.min(...propiedadesMapeadas.map(p => p.precio).filter(Boolean)),
                max: Math.max(...propiedadesMapeadas.map(p => p.precio).filter(Boolean))
            },
            dormitorios: [...new Set(propiedadesMapeadas.map(p => p.dormitorios).filter(Boolean))].sort((a, b) => a - b),
            banos:       [...new Set(propiedadesMapeadas.map(p => p.banos).filter(Boolean))].sort((a, b) => a - b)
        };

        cache.datos = { filtrosDisponibles, propiedades: propiedadesMapeadas };
        cache.ultimaActualizacion = ahora;

        console.log(`✅ XML procesado: ${propiedadesMapeadas.length} propiedades`);
        return cache.datos;

    } catch (error) {
        console.error('❌ Error al procesar XML:', error.message);
        if (cache.datos) return cache.datos;
        throw error;
    }
}

// ============================================================
// ENDPOINTS
// ============================================================
app.get('/api/properties', async (req, res) => {
    try {
        const { filtrosDisponibles, propiedades } = await obtenerDatos();

        let resultado = [...propiedades];

        if (req.query.provincia)    resultado = resultado.filter(p => p.provincia === req.query.provincia);
        if (req.query.ciudad)       resultado = resultado.filter(p => p.ciudad === req.query.ciudad);
        if (req.query.costa)        resultado = resultado.filter(p => p.costa === req.query.costa);
        if (req.query.tipo)         resultado = resultado.filter(p => p.tipo === req.query.tipo);
        if (req.query.estado)       resultado = resultado.filter(p => p.estado === req.query.estado);
        if (req.query.categoria)    resultado = resultado.filter(p => p.categoria === req.query.categoria);
        if (req.query.piscina)      resultado = resultado.filter(p => p.tienePiscina === true);
        if (req.query.parking)      resultado = resultado.filter(p => p.tieneParking === true);
        if (req.query.ascensor)     resultado = resultado.filter(p => p.tieneAscensor === true);
        if (req.query.vistasmar)    resultado = resultado.filter(p => p.vistasAlMar === true);
        if (req.query.solarium)     resultado = resultado.filter(p => p.tieneSolarium === true);
        if (req.query.primeralinea) resultado = resultado.filter(p => p.primeraLinea === true);
        if (req.query.llaveenmano)  resultado = resultado.filter(p => p.llaveEnMano === true);
        if (req.query.pisopiloto)   resultado = resultado.filter(p => p.pisoPiloto === true);

        if (req.query.minprecio)    resultado = resultado.filter(p => p.precio >= parseFloat(req.query.minprecio));
        if (req.query.maxprecio)    resultado = resultado.filter(p => p.precio <= parseFloat(req.query.maxprecio));
        if (req.query.dormitorios)  resultado = resultado.filter(p => p.dormitorios >= parseInt(req.query.dormitorios));
        if (req.query.banos)        resultado = resultado.filter(p => p.banos >= parseInt(req.query.banos));
        if (req.query.m2min)        resultado = resultado.filter(p => p.m2Construidos >= parseInt(req.query.m2min));
        if (req.query.parcela)      resultado = resultado.filter(p => p.m2Parcela >= parseInt(req.query.parcela));
        if (req.query.terraza)      resultado = resultado.filter(p => p.m2Terraza >= parseInt(req.query.terraza));
        if (req.query.playa)        resultado = resultado.filter(p => p.distanciaPlayaMetros <= parseInt(req.query.playa));

        const listado = resultado.map(({ imagenes, descripcionEs, descripcionEn, ...resto }) => resto);

        res.set('Cache-Control', 'public, max-age=300');
        res.json({ total: listado.length, filtrosDisponibles, propiedades: listado });

    } catch (error) {
        res.status(500).json({ error: 'Error al obtener propiedades' });
    }
});

app.get('/api/properties/:ref', async (req, res) => {
    try {
        const { propiedades } = await obtenerDatos();
        const propiedad = propiedades.find(p => p.ref === req.params.ref || p.id === req.params.ref);

        if (!propiedad) {
            return res.status(404).json({ error: 'Propiedad no encontrada' });
        }

        res.set('Cache-Control', 'public, max-age=300');
        res.json(propiedad);

    } catch (error) {
        res.status(500).json({ error: 'Error al obtener la propiedad' });
    }
});

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        cacheActiva: !!cache.datos,
        ultimaActualizacion: cache.ultimaActualizacion
            ? new Date(cache.ultimaActualizacion).toISOString()
            : 'Sin datos aún',
        totalPropiedades: cache.datos?.propiedades?.length || 0
    });
});

// ============================================================
// ARRANQUE
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 Kines Homes API corriendo en puerto ${PORT}`);
    obtenerDatos().catch(console.error);
});
