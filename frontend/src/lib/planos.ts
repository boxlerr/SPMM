/**
 * Planos: bajarlos, verlos y describirlos.
 *
 * Todo lo que toca el archivo pasa por acá porque el endpoint que lo sirve pide token
 * en el header `Authorization`, y eso deja afuera al `<a href>` y al `<img src>`
 * apuntados derecho a la API: el navegador navega "pelado" y la API contesta que no
 * está autenticado.
 */
import { API_URL } from "@/config";
import { olvidarMiniatura } from "@/lib/pdfThumb";

const authHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/** De dónde cuelga el plano: de la orden misma o del producto que la orden fabrica. */
export type PlanoOrigen = "ot" | "articulo";

/**
 * Un plano como lo devuelve el backend.
 *
 * `id_orden_trabajo` e `id_articulo` son excluyentes en la práctica pero los dos vienen
 * en la fila: un plano cargado a mano en la orden trae el primero, y uno que vive en el
 * producto (y por eso lo comparten todas sus órdenes) trae el segundo.
 */
export interface Plano {
    id: number;
    nombre: string;
    descripcion?: string | null;
    tipo_archivo: string;
    fecha_subida?: string | null;
    bytes?: number | null;
    id_orden_trabajo?: number | null;
    id_articulo?: number | null;
    origen: PlanoOrigen;
}

/**
 * Bajar un plano de una OT.
 *
 * Los links que apuntaban derecho a `/planos/{id}/archivo?download=true` no bajaban
 * nada: sin el token, la API rechaza la navegación. Se trae el archivo con fetch —que
 * sí lleva el token—, se hace un blob y se dispara la descarga desde ahí.
 */
export async function descargarPlano(id: number, nombre: string): Promise<void> {
    const res = await fetch(`${API_URL}/planos/${id}/archivo?download=true`, {
        headers: authHeaders(),
    });
    if (!res.ok) throw new Error(`No se pudo bajar el archivo (error ${res.status})`);

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    try {
        const a = document.createElement("a");
        a.href = url;
        a.download = nombre || `plano-${id}`;
        document.body.appendChild(a);
        a.click();
        a.remove();
    } finally {
        // Se le da un momento al navegador para que arranque la descarga antes de
        // soltar el blob; si se revoca en el acto, algunos la cancelan.
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    }
}

/**
 * Escapar texto que va a terminar adentro del HTML de la hoja a imprimir.
 *
 * El nombre del plano lo escribió una persona: el `nombre` del POST /planos es texto
 * libre y los que vinieron de Drive traen comillas y ampersands. Ese texto se mete en
 * el `<title>` y en el `alt` de la imagen, así que sin escapar, un plano llamado
 * `a" onerror="…` cierra el atributo y mete su propio script. La hoja se arma en un
 * iframe que hereda el origen de la app, o sea que ese script leería el token del
 * localStorage.
 */
const escaparHtml = (texto: string): string =>
    texto
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

/** Cómo terminó el pedido de impresión. */
export type ResultadoImpresion = "impreso" | "en_pestana";

/**
 * Mandar un plano a la impresora (pedido de Camilo, 3/9: el taller necesita el plano en
 * papel junto con la OT).
 *
 * Recibe el archivo ya bajado y no el id porque el endpoint que lo sirve pide token: no
 * se le puede apuntar un `<iframe src>` ni un `<img src>` derecho a la API, hay que
 * pasar por `traerArchivoPlano` (que además lo tiene cacheado si ya se vio la miniatura).
 *
 * Se imprime desde un iframe fuera de pantalla en vez de una ventana nueva por dos
 * motivos: la ventana emergente la bloquea el navegador cuando el click ya pasó —y acá
 * pasa, porque primero hay que esperar la bajada del archivo—, y encima el iframe deja
 * esperar el `load`, que es lo que evita el problema de siempre: imprimir un PDF o una
 * imagen recién embebidos saca la hoja en blanco porque todavía no cargaron.
 */
export async function imprimirPlano(
    blob: Blob,
    nombre: string,
    tipo?: string | null
): Promise<ResultadoImpresion> {
    const pdf = esPdf(tipo);
    const imagen = esImagen(tipo);
    if (!pdf && !imagen) {
        throw new Error(
            "Ese archivo no se puede imprimir desde acá: descargalo y abrilo con el programa que lo lee."
        );
    }

    const url = URL.createObjectURL(blob);
    // El objectURL no se suelta apenas se dispara el diálogo: mientras está abierto, el
    // navegador sigue leyendo de ahí, y revocarlo antes de tiempo manda la hoja en
    // blanco a la impresora.
    const soltarDespues = () => setTimeout(() => URL.revokeObjectURL(url), 60_000);

    const marco = document.createElement("iframe");
    marco.setAttribute("aria-hidden", "true");
    marco.title = nombre || "Plano";
    // Fuera de la pantalla pero con el tamaño de una hoja A4: con `display:none` o con
    // 0x0, varios navegadores directamente no arrancan el visor de PDF y el `load` no
    // llega nunca. El alto también decide cómo entra la imagen en la hoja.
    marco.style.cssText =
        "position:fixed;left:-10000px;top:0;width:794px;height:1123px;border:0;opacity:0";

    if (pdf) {
        marco.src = url;
    } else {
        const titulo = escaparHtml(nombre || "Plano");
        marco.srcdoc = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${titulo}</title><style>
html,body{margin:0;padding:0;height:100%}
body{display:flex;align-items:center;justify-content:center;background:#fff}
img{max-width:100%;max-height:100%;object-fit:contain}
@page{margin:8mm}
</style></head><body><img src="${url}" alt="${titulo}"></body></html>`;
    }

    // El `load` se engancha ANTES de meter el iframe en la página, y el contenido se
    // define antes también: un iframe que se agrega vacío dispara un `load` propio (el
    // de `about:blank`) y ahí mandaríamos a imprimir una hoja vacía.
    const cargado = new Promise<void>((listo, falla) => {
        const reloj = setTimeout(() => falla(new Error("tardó demasiado en cargar")), 20_000);
        marco.onload = () => {
            clearTimeout(reloj);
            listo();
        };
        marco.onerror = () => {
            clearTimeout(reloj);
            falla(new Error("no se pudo cargar"));
        };
    });

    document.body.appendChild(marco);

    try {
        await cargado;
        const ventana = marco.contentWindow;
        if (!ventana) throw new Error("el visor no quedó accesible");
        ventana.focus();
        ventana.print();
    } catch {
        // Safari no sabe imprimir un PDF metido en un iframe (y algún navegador viejo
        // del taller tampoco): se abre en una pestaña, donde el visor del propio
        // navegador trae su botón de imprimir.
        marco.remove();
        const pestana = window.open(url, "_blank");
        soltarDespues();
        if (!pestana) {
            throw new Error("Habilitá las ventanas emergentes para poder imprimir el plano.");
        }
        return "en_pestana";
    }

    // El iframe se saca recién cuando cerró el diálogo: sacarlo antes se lleva puesto
    // justo lo que se está por imprimir. `onafterprint` no llega en todos los
    // navegadores, así que además hay un plazo que lo limpia igual.
    let sacado = false;
    const sacar = () => {
        if (sacado) return;
        sacado = true;
        marco.remove();
        soltarDespues();
    };
    if (marco.contentWindow) marco.contentWindow.onafterprint = sacar;
    setTimeout(sacar, 60_000);

    return "impreso";
}

/**
 * Archivos ya traídos, por id de plano.
 *
 * La misma orden pide el archivo dos veces seguidas: primero la miniatura de la
 * tarjeta y después el visor cuando la tocan. Los planos que vinieron de Drive son
 * chicos (~27 KB medidos), así que sale mucho más barato guardarlos que volver a
 * pedirlos.
 *
 * Se cachea la PROMESA, no el blob: si dos tarjetas piden el mismo plano en el mismo
 * frame, sale un solo pedido a la red.
 *
 * El tope es en BYTES y no en cantidad de archivos: recorriendo la biblioteca entera,
 * un tope de "40 planos" no dice nada sobre cuánta memoria se está reteniendo —son 1 MB
 * si son los de Drive y 800 MB si alguien subió escaneos—. Se descarta el más viejo
 * hasta entrar en el tope.
 *
 * OJO: acá se guarda el Blob y NUNCA un objectURL. Cada consumidor se hace el suyo con
 * `URL.createObjectURL` y revoca el suyo al desmontar; si compartiéramos uno, el
 * primero en cerrarse dejaría a los demás mostrando una imagen rota.
 */
const MAX_BYTES_CACHE = 24 * 1024 * 1024;
const archivos = new Map<number, Promise<Blob>>();
/** Cuánto pesa lo ya resuelto. Las promesas en vuelo todavía no suman: no se sabe. */
const pesos = new Map<number, number>();

export async function traerArchivoPlano(id: number): Promise<Blob> {
    const enCurso = archivos.get(id);
    if (enCurso) return enCurso;

    const pedido = fetch(`${API_URL}/planos/${id}/archivo`, { headers: authHeaders() }).then(
        (res) => {
            if (!res.ok) throw new Error(`No se pudo cargar el archivo (error ${res.status})`);
            return res.blob();
        }
    );

    // Un error no queda cacheado: la conexión del taller se corta seguido y el segundo
    // intento tiene que volver a salir a la red, no repetir la falla para siempre.
    pedido.catch(() => {
        archivos.delete(id);
        pesos.delete(id);
    });
    pedido.then((blob) => {
        // Recién acá se sabe cuánto ocupa, así que la poda se hace al resolverse y no
        // al pedirlo. El propio archivo nunca se descarta a sí mismo: quien lo pidió lo
        // está por usar.
        //
        // Si mientras bajaba lo sacaron del cache (lo podó otro pedido, o lo borraron),
        // no se anota el peso: quedaría un fantasma sumando para siempre en un id que ya
        // no está guardado, y a partir de ahí el total nunca vuelve a bajar del tope y
        // cada miniatura se rebaja aunque ya se haya visto.
        if (!archivos.has(id)) return;
        pesos.set(id, blob.size);

        let total = 0;
        for (const n of pesos.values()) total += n;
        // Se descartan SOLO los que ya resolvieron (los que están en `pesos`): de los que
        // todavía están en vuelo no se sabe cuánto pesan, así que sacarlos no bajaría el
        // total y encima tiraría una descarga que alguien está esperando.
        for (const viejo of pesos.keys()) {
            if (total <= MAX_BYTES_CACHE) break;
            if (viejo === id) continue;
            total -= pesos.get(viejo) ?? 0;
            archivos.delete(viejo);
            pesos.delete(viejo);
        }
    }).catch(() => { /* ya lo maneja el catch de arriba */ });

    archivos.set(id, pedido);
    return pedido;
}

/** Tirar lo guardado de un plano (se reemplazó o se borró). Sin `id`, tira todo. */
export function olvidarPlano(id?: number) {
    if (id == null) {
        archivos.clear();
        pesos.clear();
        olvidarMiniatura();
        return;
    }
    archivos.delete(id);
    pesos.delete(id);
    olvidarMiniatura(id);
}

export function esImagen(tipo?: string | null): boolean {
    if (!tipo) return false;
    const t = tipo.toLowerCase();
    // El SVG queda AFUERA a propósito, aunque sea "image/". Un SVG es un documento y
    // puede traer <script> adentro. Al imprimir, si el navegador no deja imprimir desde
    // el iframe, se cae a abrir el archivo en una pestaña; un `blob:` creado por la app
    // se abre CON el origen de la app, así que ese script leería el token del
    // localStorage. Tratado como "no es imagen", no se previsualiza ni se imprime solo:
    // se baja, que es lo que corresponde para un archivo que no es un plano.
    if (t.startsWith("image/svg")) return false;
    return t.startsWith("image/");
}

export function esPdf(tipo?: string | null): boolean {
    if (!tipo) return false;
    const t = tipo.toLowerCase();
    // No alcanza con comparar contra "application/pdf": el tipo lo declara el navegador
    // que subió el archivo y en Windows llega también como "application/x-pdf".
    return t === "application/pdf" || t.endsWith("/pdf");
}

/** Tamaño legible. Coma decimal, como se escribe acá. */
export function formatearBytes(n?: number | null): string {
    if (n == null || !Number.isFinite(n) || n < 0) return "—";
    if (n < 1024) return `${Math.round(n)} B`;

    const kb = n / 1024;
    if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0).replace(".", ",")} kB`;

    const mb = kb / 1024;
    return `${mb.toFixed(mb < 10 ? 1 : 0).replace(".", ",")} MB`;
}
