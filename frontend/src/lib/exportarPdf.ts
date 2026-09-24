/**
 * El PDF de una exportación. Este módulo se pide con import() recién al tocar «PDF»:
 * trae jspdf y jspdf-autotable, y ninguna pantalla los carga de entrada.
 *
 * Arriba va lo que dice qué es el papel —el logo y el nombre de Metalúrgica
 * Longchamps, el título, cuándo se generó y con qué filtros— y abajo de cada hoja el
 * número de página. Sin los filtros, un listado impreso de 12 órdenes no dice si son
 * todas o las de un cliente.
 *
 * La hoja va horizontal cuando la tabla no entra parada.
 *
 * Las letras son las estándar del PDF (Helvetica): no hay que incrustar ninguna fuente
 * y el archivo pesa poco, pero sólo tienen los caracteres del castellano de siempre.
 * Lo que no tienen (una flecha, un emoji, un ⚠) se reemplaza por algo que se lea,
 * en vez de salir como basura — ver `textoPdf`.
 *
 * UNA SOLA PUERTA A JSPDF
 *
 * Los otros PDF (el de la OT y el del rendimiento de una persona) toman jspdf y
 * jspdf-autotable DE ACÁ (por eso `autoTable` se reexporta abajo), nunca directo del
 * paquete. El empaquetador arma el trozo con jspdf según el camino por el que se llega
 * a él: cuando el PDF de la OT importaba jspdf-autotable por su cuenta, salían dos
 * trozos de ~450 KB con lo mismo adentro, y exportar la lista y después la OT en
 * Operaciones bajaba jspdf dos veces.
 */

import { jsPDF } from "jspdf";
import { autoTable, type RowInput, type Styles } from "jspdf-autotable";
import {
    ahoraAR,
    alineaDerecha,
    textoParaLeer,
    type ColumnaExport,
    type ReporteExport,
    type SeccionExport,
} from "./exportar";

/** Ver «Una sola puerta a jspdf», arriba. */
export { autoTable };
export type { RowInput };

// ---------------------------------------------------------------------------------
// Caracteres
// ---------------------------------------------------------------------------------

/** Los de cp1252 que no están en Latin-1: los que Helvetica del PDF sí sabe dibujar. */
const EXTRA_WINANSI = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

const REEMPLAZOS: Record<string, string> = {
    "→": "->", "←": "<-", "↑": "^", "↓": "v", "⇒": "=>", "↔": "<->",
    "≤": "<=", "≥": ">=", "≠": "!=", "≈": "~", "−": "-", "‐": "-", "‑": "-",
    "⚠": "!", "✓": "v", "✔": "v", "✗": "x", "✘": "x", "★": "*", "☆": "*",
    "\u00a0": " ", "\u2009": " ", "\u202f": " ", "\u200b": "",
};

/** Texto que Helvetica (WinAnsi) puede dibujar tal cual. */
export function textoPdf(texto: string): string {
    let salida = "";
    for (const ch of texto) {
        const cp = ch.codePointAt(0)!;
        if (ch === "\n" || ch === "\t" || (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || EXTRA_WINANSI.has(ch)) {
            salida += ch === "\t" ? " " : ch;
            continue;
        }
        if (ch in REEMPLAZOS) {
            salida += REEMPLAZOS[ch];
            continue;
        }
        // Una letra con un acento raro (ǎ, ő) pierde el acento; lo demás, afuera.
        const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const cpBase = base.codePointAt(0) ?? 0;
        if (base.length === 1 && ((cpBase >= 0x20 && cpBase <= 0x7e) || (cpBase >= 0xa0 && cpBase <= 0xff))) {
            salida += base;
        } else if (cp === 0x0d) {
            // \r suelto: se saltea (el \n ya corta el renglón).
        } else {
            salida += "?";
        }
    }
    return salida;
}

// ---------------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------------

interface Logo {
    dataUrl: string;
    ancho: number;
    alto: number;
}

let logoCache: Promise<Logo | null> | null = null;

/**
 * El logo de la hoja impresa de la OT (`public/longchamps_logo.png`), achicado.
 *
 * El original mide 3956 × 737: meterlo entero en cada PDF son cientos de KB para algo
 * que se imprime de 5 cm. Se dibuja una vez a 900 px de ancho y se reusa. Si no se
 * puede cargar (sin red), el PDF sale igual, con el nombre en letras.
 */
export function cargarLogo(): Promise<Logo | null> {
    if (!logoCache) {
        logoCache = (async () => {
            try {
                const res = await fetch("/longchamps_logo.png");
                if (!res.ok) return null;
                const blob = await res.blob();
                const bitmap = await createImageBitmap(blob);
                const ancho = Math.min(900, bitmap.width);
                const alto = Math.round((bitmap.height * ancho) / bitmap.width);
                const canvas = document.createElement("canvas");
                canvas.width = ancho;
                canvas.height = alto;
                const ctx = canvas.getContext("2d");
                if (!ctx) return null;
                ctx.drawImage(bitmap, 0, 0, ancho, alto);
                bitmap.close?.();
                return { dataUrl: canvas.toDataURL("image/png"), ancho, alto };
            } catch {
                return null;
            }
        })();
        // Un fallo no se guarda: la próxima vez se vuelve a intentar.
        logoCache.then((l) => { if (!l) logoCache = null; });
    }
    return logoCache;
}

// ---------------------------------------------------------------------------------
// Hoja
// ---------------------------------------------------------------------------------

export const AZUL: [number, number, number] = [30, 58, 95]; // #1e3a5f, el de la hoja de la OT
export const GRIS: [number, number, number] = [100, 100, 100];
export const MARGEN = 12; // mm

export type Orientacion = "portrait" | "landscape";

export function nuevoDocumento(orientacion: Orientacion): jsPDF {
    const doc = new jsPDF({ orientation: orientacion, unit: "mm", format: "a4", compress: true });
    doc.setProperties({ creator: "SPMM · Metalúrgica Longchamps" });
    return doc;
}

/**
 * El encabezado de la primera hoja. Devuelve dónde sigue la página (y en mm).
 *
 *   [logo]  METALÚRGICA LONGCHAMPS                         Generado el 22/09/2026 14:35
 *           Título
 *   Filtros: …
 *   ───────────────────────────────────────────────────────────────────────────────
 */
export function dibujarEncabezado(
    doc: jsPDF,
    opciones: {
        titulo: string;
        subtitulo?: string;
        derecha?: string;
        logo: Logo | null;
        filtros?: string[] | null;
        /** «Filtros» si no se dice (ver ReporteExport.rotuloFiltros). */
        rotuloFiltros?: string;
    },
): number {
    const ancho = doc.internal.pageSize.getWidth();
    let x = MARGEN;
    const arriba = MARGEN;
    const altoLogo = 11;

    if (opciones.logo) {
        const anchoLogo = (opciones.logo.ancho / opciones.logo.alto) * altoLogo;
        doc.addImage(opciones.logo.dataUrl, "PNG", MARGEN, arriba, anchoLogo, altoLogo, "logo-longchamps", "FAST");
        x = MARGEN + anchoLogo + 5;
    }

    const derecha = opciones.derecha ?? `Generado el ${ahoraAR()}`;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    const anchoDerecha = doc.getTextWidth(textoPdf(derecha));
    doc.text(textoPdf(derecha), ancho - MARGEN, arriba + 3, { align: "right" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...AZUL);
    doc.text("METALÚRGICA LONGCHAMPS", x, arriba + 3);

    doc.setFontSize(15);
    doc.setTextColor(17, 17, 17);
    const lugarTitulo = ancho - MARGEN - x - anchoDerecha - 4;
    const tituloLineas = doc.splitTextToSize(textoPdf(opciones.titulo), Math.max(60, lugarTitulo)) as string[];
    doc.text(tituloLineas.slice(0, 2), x, arriba + 9.5);
    let y = arriba + 9.5 + (Math.min(tituloLineas.length, 2) - 1) * 6;

    if (opciones.subtitulo) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(...GRIS);
        y += 5;
        doc.text(textoPdf(opciones.subtitulo), x, y);
    }

    y = Math.max(y, arriba + altoLogo) + 5;

    const filtros = opciones.filtros;
    if (filtros) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(...GRIS);
        const texto = filtros.length
            ? `${opciones.rotuloFiltros || "Filtros"}: ${filtros.join(" · ")}`
            : "Sin filtros: la lista completa de la pantalla.";
        const lineas = doc.splitTextToSize(textoPdf(texto), ancho - 2 * MARGEN) as string[];
        doc.text(lineas, MARGEN, y);
        y += lineas.length * 3.6;
    }

    doc.setDrawColor(...AZUL);
    doc.setLineWidth(0.6);
    doc.line(MARGEN, y, ancho - MARGEN, y);
    return y + 4;
}

/** «Página 2 de 5» en todas las hojas. Va al final, cuando ya se sabe cuántas son. */
export function numerarPaginas(doc: jsPDF, pie: string): void {
    const total = doc.getNumberOfPages();
    const ancho = doc.internal.pageSize.getWidth();
    const alto = doc.internal.pageSize.getHeight();
    for (let i = 1; i <= total; i++) {
        doc.setPage(i);
        doc.setDrawColor(210, 214, 220);
        doc.setLineWidth(0.2);
        doc.line(MARGEN, alto - 9, ancho - MARGEN, alto - 9);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...GRIS);
        doc.text(textoPdf(pie), MARGEN, alto - 5.5);
        doc.text(`Página ${i} de ${total}`, ancho - MARGEN, alto - 5.5, { align: "right" });
    }
}

/** Lo que mide (más o menos, en mm) una columna a 7,5 pt: para decidir la orientación. */
function anchoEstimado(sec: SeccionExport): number {
    const MM_POR_CARACTER = 1.45;
    const muestra = sec.filas.slice(0, 200);
    return sec.columnas.reduce((total, col) => {
        let max = col.titulo.length;
        muestra.forEach((fila, i) => {
            const t = textoParaLeer(col, col.valor(fila, i));
            const largo = t.split("\n").reduce((m, r) => Math.max(m, r.length), 0);
            if (largo > max) max = largo;
        });
        return total + Math.min(max, 45) * MM_POR_CARACTER + 3;
    }, 0);
}

export function orientacionDe(reporte: ReporteExport): Orientacion {
    if (reporte.orientacion === "vertical") return "portrait";
    if (reporte.orientacion === "horizontal") return "landscape";
    const usable = 210 - 2 * MARGEN;
    const mayor = Math.max(0, ...reporte.secciones.map(anchoEstimado));
    return mayor > usable ? "landscape" : "portrait";
}

/** La tabla de una sección, desde `y`. Devuelve dónde terminó. */
export function dibujarTabla(doc: jsPDF, sec: SeccionExport, y: number, opciones?: { vacio?: string }): number {
    const columnas = sec.columnas as ColumnaExport<any>[];
    const cuerpo: RowInput[] = sec.filas.length
        ? sec.filas.map((fila, i) => columnas.map((c) => textoPdf(textoParaLeer(c, c.valor(fila, i)))))
        : [[{ content: opciones?.vacio ?? "No hay filas para mostrar.", colSpan: Math.max(1, columnas.length), styles: { halign: "center", textColor: [150, 150, 150], fontStyle: "italic" } }]];

    // Las fechas y los Sí/No no se parten en dos renglones: miden siempre lo mismo y
    // partidas se leen mal. El ancho que sobra queda para los textos (cliente, producto).
    const estilosColumna: Record<number, Partial<Styles>> = {};
    columnas.forEach((c, i) => {
        if (alineaDerecha(c.tipo)) estilosColumna[i] = { halign: "right" };
        else if (c.tipo === "fecha" || c.tipo === "fechaHora" || c.tipo === "booleano") {
            estilosColumna[i] = { halign: "center", cellWidth: "wrap" };
        }
    });
    // Con muchas columnas (las listas de OT llegan a 18) la letra baja un poco para que
    // los textos no se corten a mitad de palabra.
    const letra = columnas.length > 14 ? 6.6 : columnas.length > 10 ? 7.1 : 7.6;

    autoTable(doc, {
        startY: y,
        head: [columnas.map((c) => textoPdf(c.titulo))],
        body: cuerpo,
        theme: "striped",
        margin: { top: MARGEN, left: MARGEN, right: MARGEN, bottom: 14 },
        styles: {
            font: "helvetica",
            fontSize: letra,
            cellPadding: 1.3,
            overflow: "linebreak",
            valign: "top",
            lineColor: [215, 219, 225],
            lineWidth: 0.1,
            textColor: [20, 20, 20],
        },
        headStyles: {
            fillColor: AZUL,
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: letra - 0.4,
            valign: "middle",
        },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: estilosColumna,
        showHead: "everyPage",
        rowPageBreak: "avoid",
        // El título de una columna de números va a la derecha, arriba de sus números.
        didParseCell: (data) => {
            if (data.section === "head") {
                const halign = estilosColumna[data.column.index]?.halign;
                if (halign) data.cell.styles.halign = halign;
            }
        },
    });
    return ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 6;
}

/** Título de una sección (cuando hay varias), pasando de hoja si no queda lugar. */
export function dibujarTituloDeSeccion(doc: jsPDF, titulo: string, y: number): number {
    const alto = doc.internal.pageSize.getHeight();
    if (y > alto - 40) {
        doc.addPage();
        y = MARGEN;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...AZUL);
    doc.text(textoPdf(titulo.toUpperCase()), MARGEN, y + 3);
    return y + 6;
}

export async function construirPdf(reporte: ReporteExport): Promise<Blob> {
    const doc = nuevoDocumento(orientacionDe(reporte));
    doc.setProperties({ title: textoPdf(reporte.titulo), creator: "SPMM · Metalúrgica Longchamps" });
    const logo = await cargarLogo();

    const cuantas = reporte.secciones.map((s) => s.filas.length);
    const resumenFilas = reporte.secciones.length === 1
        ? `${cuantas[0]} ${cuantas[0] === 1 ? "fila" : "filas"}`
        : reporte.secciones.map((s) => `${s.titulo}: ${s.filas.length}`).join(" · ");

    let y = dibujarEncabezado(doc, {
        titulo: reporte.titulo,
        subtitulo: reporte.subtitulo || resumenFilas,
        logo,
        filtros: reporte.filtros === null ? undefined : (reporte.filtros ?? []),
        rotuloFiltros: reporte.rotuloFiltros,
    });

    const varias = reporte.secciones.length > 1;
    reporte.secciones.forEach((sec) => {
        if (varias) y = dibujarTituloDeSeccion(doc, sec.titulo, y);
        y = dibujarTabla(doc, sec, y);
    });

    numerarPaginas(doc, `Metalúrgica Longchamps · ${reporte.titulo}`);
    return doc.output("blob");
}
