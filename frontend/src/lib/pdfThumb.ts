/**
 * Miniatura de la primera página de un PDF.
 *
 * Casi todos los planos del taller son PDF, y una lista de nombres de archivo no le
 * dice nada a nadie: el operario reconoce el plano por el dibujo, no por
 * "PL-1023 rev B.pdf". La única forma de mostrar ese dibujo sin mandar el archivo a
 * ningún servicio de terceros es dibujarlo acá, con pdf.js.
 *
 * pdf.js entra SIEMPRE por import dinámico: pesa más de un mega y toca `window` al
 * cargarse, así que en el import de arriba rompería el render del server y se llevaría
 * puesto el bundle de cualquier pantalla que muestre un plano. Entra recién cuando
 * alguien mira una miniatura de verdad.
 */

/**
 * Miniaturas ya dibujadas, por id de plano.
 *
 * Renderizar es lo caro (un plano grande son varios cientos de milisegundos), y el
 * panel de planos se monta y desmonta cada vez que se abre una orden. Sin esto, volver
 * a la misma orden vuelve a dibujar todo desde cero.
 *
 * El tope existe porque un PNG de 400px en base64 pesa cientos de KB: recorriendo la
 * biblioteca entera, sin límite, la pestaña se come cientos de megas. Se descarta la
 * más vieja aprovechando que el Map recuerda el orden de inserción.
 */
const MAX_MINIATURAS = 60;
const miniaturas = new Map<string, string>();

let pdfjs: Promise<typeof import("pdfjs-dist")> | null = null;

/**
 * pdf.js 4 usa `Promise.withResolvers`, que recién existe desde Chrome 119. En las
 * máquinas del taller hay navegadores más viejos, y ahí no es que la miniatura sale
 * fea: revienta con "is not a function" antes de dibujar el primer plano.
 */
function asegurarWithResolvers() {
    const P = Promise as unknown as { withResolvers?: unknown };
    if (typeof P.withResolvers === "function") return;
    P.withResolvers = function <T>() {
        let resolve!: (valor: T | PromiseLike<T>) => void;
        let reject!: (motivo?: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return { promise, resolve, reject };
    };
}

/**
 * UN worker para todos los planos, y de a pocos a la vez.
 *
 * `getDocument()` sin `worker` le crea un Web Worker propio a CADA documento, y cada uno
 * se baja el pdf.worker.min.mjs entero (1,3 MB). Con la biblioteca en 1183 planos —de los
 * cuales 920 son PDF— y las tarjetas dibujando apenas entran en pantalla, bajar rápido
 * abría decenas de workers en paralelo: la pestaña se clava y las máquinas del taller se
 * quedan sin memoria. Se comparte uno solo y se hace cola.
 *
 * El tope de 3 en simultáneo es porque dibujar es trabajo de CPU: más al mismo tiempo no
 * termina antes, y deja la pantalla trabada mientras tanto.
 */
let worker: any = null;
const EN_PARALELO = 3;
let dibujando = 0;
const cola: Array<() => void> = [];

function pedirTurno(): Promise<void> {
    if (dibujando < EN_PARALELO) {
        dibujando++;
        return Promise.resolve();
    }
    return new Promise((sigue) => cola.push(sigue));
}

function soltarTurno() {
    const siguiente = cola.shift();
    if (siguiente) siguiente();
    else dibujando--;
}

function cargarPdfjs() {
    if (!pdfjs) {
        asegurarWithResolvers();
        pdfjs = import("pdfjs-dist").then((lib) => {
            // El worker está vendorizado en public/ y NO se toma de un CDN: la copia
            // del CDN viaja con su propia versión y alcanza que no coincida con la del
            // paquete para que pdf.js se plante y no dibuje nada.
            lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
            return lib;
        });
        // Si la descarga se cae (el taller pierde internet un rato), no queda el
        // fracaso cacheado para siempre: el próximo plano vuelve a intentar.
        pdfjs.catch(() => {
            pdfjs = null;
        });
    }
    return pdfjs;
}

/**
 * Dibuja la primera página de `blob` y devuelve un PNG como data URL.
 *
 * `clave` es el id del plano: sin ella se dibuja igual, pero no se cachea.
 *
 * TIRA si el PDF está roto o el navegador no da canvas. Es a propósito: el llamador
 * tiene que caer al ícono genérico, no mostrar una tarjeta vacía.
 */
export async function miniaturaDePdf(
    blob: Blob,
    anchoMax = 400,
    clave?: string | number
): Promise<string> {
    const id = clave != null ? String(clave) : null;
    if (id) {
        const hecha = miniaturas.get(id);
        if (hecha) {
            // Reinsertar la deja como "recién usada" y la salva del descarte.
            miniaturas.delete(id);
            miniaturas.set(id, hecha);
            return hecha;
        }
    }

    const lib = await cargarPdfjs();
    if (!worker) worker = new lib.PDFWorker();

    await pedirTurno();
    const documento = await lib
        .getDocument({ data: new Uint8Array(await blob.arrayBuffer()), worker })
        .promise
        .catch((e: unknown) => {
            soltarTurno();
            throw e;
        });

    try {
        const pagina = await documento.getPage(1);
        const vistaBase = pagina.getViewport({ scale: 1 });
        // Se agranda como mucho 4x: un plano chico escalado sin tope sale gigante en
        // memoria y borroso igual.
        const escala = Math.min(anchoMax / (vistaBase.width || anchoMax), 4);
        const vista = pagina.getViewport({ scale: escala > 0 ? escala : 1 });

        const lienzo = document.createElement("canvas");
        lienzo.width = Math.max(1, Math.floor(vista.width));
        lienzo.height = Math.max(1, Math.floor(vista.height));

        const ctx = lienzo.getContext("2d");
        if (!ctx) throw new Error("El navegador no dio un canvas para dibujar el plano");

        // Un plano es línea negra sobre nada: sin pintar el fondo, el PNG sale
        // transparente y el dibujo queda flotando sobre el gris de la tarjeta.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, lienzo.width, lienzo.height);

        await pagina.render({ canvasContext: ctx, viewport: vista }).promise;
        pagina.cleanup();

        const png = lienzo.toDataURL("image/png");
        if (id) {
            miniaturas.set(id, png);
            while (miniaturas.size > MAX_MINIATURAS) {
                const vieja = miniaturas.keys().next();
                if (vieja.done) break;
                miniaturas.delete(vieja.value);
            }
        }
        return png;
    } finally {
        // Se destruye el DOCUMENTO, no el worker: el worker es compartido y sigue
        // sirviendo a los demás planos. Sin esto queda el PDF entero adentro del worker.
        documento.destroy().catch(() => undefined);
        soltarTurno();
    }
}

/** Tirar la miniatura guardada (el archivo cambió o se borró). Sin `clave`, tira todas. */
export function olvidarMiniatura(clave?: string | number) {
    if (clave == null) miniaturas.clear();
    else miniaturas.delete(String(clave));
}
