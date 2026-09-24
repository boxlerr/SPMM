/**
 * El PDF de una orden de trabajo: la misma hoja que sale con «Imprimir», pero como
 * archivo, para mandarla o guardarla sin pasar por el diálogo de impresión.
 *
 * Son las mismas dos hojas y en el mismo orden:
 *   1. PROCESOS, para el recurso humano: los datos de la orden, cada proceso con tres
 *      renglones de carga (día 1, 2 y 3) y los casilleros en blanco para anotar a mano
 *      fecha, quién, hora de inicio, de fin y total; la nota de taller y las firmas.
 *   2. MATERIAS PRIMAS, para el pañol: qué retirar, con la columna «Retirado» para tildar.
 *
 * Mismos colores (el azul #1e3a5f), mismas líneas marcadas y casilleros altos: se
 * imprime, se llena con birome y se fotocopia. Se suma lo que pide un archivo y no el
 * papel de la impresora: cuándo se generó y el número de página.
 *
 * Se carga con import() recién al tocar «PDF» en la OT (trae jspdf). jspdf y
 * jspdf-autotable se toman de lib/exportarPdf y no del paquete: así el trozo con
 * jspdf es el mismo que el de las listas y se baja una sola vez (ver ahí).
 */

import type { jsPDF } from "jspdf";
import {
    AZUL,
    MARGEN,
    autoTable,
    cargarLogo,
    numerarPaginas,
    nuevoDocumento,
    textoPdf,
    type RowInput,
} from "@/lib/exportarPdf";
import { ahoraAR, fechaAR, partesDeFecha, textoParaLeer } from "@/lib/exportar";
import type { DatosDeOT } from "./ot";
import { cuandoLegible } from "@/lib/estadoControlOT";

const GRIS_TEXTO: [number, number, number] = [102, 102, 102];
const GRIS_LINEA: [number, number, number] = [153, 153, 153];
const NEGRO: [number, number, number] = [17, 17, 17];
const ALTO_PIE = 16; // lo que se reserva abajo para el número de página

type Logo = Awaited<ReturnType<typeof cargarLogo>>;

const fecha = (v: string) => {
    const p = partesDeFecha(v);
    return p ? fechaAR(p) : "-";
};

/** «6,5» y no «6.5»: en el papel los números van como se leen acá. */
const cifra = (v: string) => textoParaLeer({ titulo: "", tipo: "numero", valor: () => v }, v);

/** El encabezado de cada hoja: logo, empresa, qué hoja es y el número de OT. */
function encabezado(doc: jsPDF, logo: Logo, titulo: string, numero: string, abajo: string): number {
    const ancho = doc.internal.pageSize.getWidth();
    const y0 = MARGEN;
    const alto = 11;
    let x = MARGEN;

    if (logo) {
        const w = (logo.ancho / logo.alto) * alto;
        doc.addImage(logo.dataUrl, "PNG", MARGEN, y0, w, alto, "logo-longchamps", "FAST");
        x += w + 5;
    } else {
        // Sin logo (sin red): la marca en letras, como hace la hoja impresa.
        doc.setDrawColor(...AZUL);
        doc.setLineWidth(0.8);
        doc.roundedRect(MARGEN, y0, alto, alto, 1.5, 1.5, "S");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(12);
        doc.setTextColor(...AZUL);
        doc.text("ML", MARGEN + alto / 2, y0 + alto / 2 + 1.5, { align: "center" });
        x += alto + 5;
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(15);
    doc.setTextColor(...NEGRO);
    const ot = textoPdf(`OT N° ${numero}`);
    doc.text(ot, ancho - MARGEN, y0 + 5.5, { align: "right" });
    const anchoDerecha = Math.max(doc.getTextWidth(ot), 40);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRIS_TEXTO);
    doc.text(textoPdf(abajo), ancho - MARGEN, y0 + 10, { align: "right" });

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...AZUL);
    doc.text("METALÚRGICA LONGCHAMPS", x, y0 + 3.5);
    doc.setFontSize(14);
    doc.setTextColor(...NEGRO);
    const lineas = doc.splitTextToSize(textoPdf(titulo), ancho - MARGEN - x - anchoDerecha - 4) as string[];
    doc.text(lineas.slice(0, 2), x, y0 + 9.5);

    const yLinea = y0 + alto + 2.5 + (Math.min(lineas.length, 2) - 1) * 5;
    doc.setDrawColor(...AZUL);
    doc.setLineWidth(1);
    doc.line(MARGEN, yLinea, ancho - MARGEN, yLinea);
    return yLinea + 5;
}

/** La grilla de datos de a dos columnas («CLIENTE ....... ACME»), con su línea abajo. */
function grilla(doc: jsPDF, pares: [string, string][], y: number): number {
    const ancho = doc.internal.pageSize.getWidth();
    const hueco = 8;
    const colW = (ancho - 2 * MARGEN - hueco) / 2;
    for (let i = 0; i < pares.length; i += 2) {
        const fila = pares.slice(i, i + 2).map(([k, v]) => {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.5);
            const clave = textoPdf(k.toUpperCase());
            const anchoClave = doc.getTextWidth(clave);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            const valor = doc.splitTextToSize(textoPdf(v || "-"), colW - anchoClave - 4) as string[];
            return { clave, valor: valor.slice(0, 3) };
        });
        const renglones = Math.max(...fila.map((c) => c.valor.length));
        const alto = 3.6 * renglones + 3;
        fila.forEach((c, col) => {
            const x = MARGEN + col * (colW + hueco);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.5);
            doc.setTextColor(...GRIS_TEXTO);
            doc.text(c.clave, x, y + 3.6);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(8.5);
            doc.setTextColor(...NEGRO);
            doc.text(c.valor, x + colW, y + 3.6, { align: "right" });
            doc.setDrawColor(217, 217, 217);
            doc.setLineWidth(0.2);
            doc.line(x, y + alto, x + colW, y + alto);
        });
        y += alto + 0.8;
    }
    return y + 3;
}

/** «PROCESOS (PLANIFICADO + CARGA REAL)» en azul, subrayado. Pasa de hoja si no entra. */
function subtitulo(doc: jsPDF, texto: string, y: number, lugarMinimo = 24): number {
    const alto = doc.internal.pageSize.getHeight();
    if (y + lugarMinimo > alto - ALTO_PIE) {
        doc.addPage();
        y = MARGEN;
    }
    const ancho = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(...AZUL);
    doc.text(textoPdf(texto.toUpperCase()), MARGEN, y + 3.5);
    doc.setDrawColor(...AZUL);
    doc.setLineWidth(0.5);
    doc.line(MARGEN, y + 5, ancho - MARGEN, y + 5);
    return y + 7.5;
}

/** Una caja para escribir (nota de taller, observaciones del pañol). */
function caja(doc: jsPDF, texto: string, y: number, altoMinimo = 14): number {
    const ancho = doc.internal.pageSize.getWidth();
    const alto = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    const lineas = texto ? (doc.splitTextToSize(textoPdf(texto), ancho - 2 * MARGEN - 4) as string[]) : [];
    const h = Math.max(altoMinimo, lineas.length * 3.8 + 4);
    if (y + h > alto - ALTO_PIE) {
        doc.addPage();
        y = MARGEN;
    }
    doc.setDrawColor(...GRIS_LINEA);
    doc.setLineWidth(0.25);
    doc.rect(MARGEN, y, ancho - 2 * MARGEN, h);
    if (lineas.length) {
        doc.setTextColor(...NEGRO);
        doc.text(lineas, MARGEN + 2, y + 4.5);
    }
    return y + h + 4;
}

function pieDeHoja(doc: jsPDF, texto: string, y: number): number {
    const ancho = doc.internal.pageSize.getWidth();
    const alto = doc.internal.pageSize.getHeight();
    if (y + 8 > alto - ALTO_PIE) {
        doc.addPage();
        y = MARGEN;
    }
    doc.setDrawColor(221, 221, 221);
    doc.setLineWidth(0.2);
    doc.line(MARGEN, y, ancho - MARGEN, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(136, 136, 136);
    doc.text(textoPdf(texto), ancho / 2, y + 4, { align: "center" });
    return y + 8;
}

const finDeTabla = (doc: jsPDF, y: number) =>
    ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y);

/** Cuántos renglones de carga lleva cada proceso: uno por día, igual que la hoja impresa. */
const RENGLONES_POR_PROCESO = 3;

export async function pdfDeOT(d: DatosDeOT): Promise<Blob> {
    const doc = nuevoDocumento("portrait");
    doc.setProperties({ title: textoPdf(`OT N° ${d.numero}`), creator: "SPMM · Metalúrgica Longchamps" });
    const logo = await cargarLogo();
    const generado = `Generado el ${ahoraAR()}`;
    const producto = [d.codigo, d.articulo].filter(Boolean).join(" — ") || "-";

    // ---------------- Hoja 1: procesos ----------------
    let y = encabezado(doc, logo, "Orden de Trabajo — Procesos", d.numero, generado);
    y = grilla(doc, [
        ["Cliente", d.cliente],
        ["Prioridad", d.prioridad],
        ["Producto", producto],
        ["Sector", d.sector],
        ["Cantidad", cifra(d.cantidad)],
        ["N° Pedido", d.nPedido],
        ["F. Entrada", fecha(d.fechaEntrada)],
        ["F. Prometida", fecha(d.fechaPrometida)],
    ], y);

    y = subtitulo(doc, "Procesos (planificado + carga real)", y);

    const cuerpo: RowInput[] = d.procesos.length
        ? d.procesos.flatMap((p, i) =>
            Array.from({ length: RENGLONES_POR_PROCESO }, (_, k) =>
                k === 0
                    ? [String(i + 1), textoPdf(p.proceso || "-"), textoPdf(p.maquina || "Sin recurso maquinaria"),
                        p.minutos != null ? cifra(String(p.minutos)) : "0", "1", "", "", "", "", ""]
                    : ["", "", "", "", String(k + 1), "", "", "", "", ""]))
        : [[{ content: "Sin procesos cargados", colSpan: 10, styles: { halign: "center", textColor: [153, 153, 153] } }]];

    autoTable(doc, {
        startY: y,
        head: [["#", "Proceso", "Recurso maquinaria", "Min. plan.", "Día", "Fecha", "Recurso humano", "H. inicio", "H. fin", "Total"]],
        body: cuerpo,
        theme: "grid",
        margin: { top: MARGEN, left: MARGEN, right: MARGEN, bottom: ALTO_PIE },
        styles: {
            font: "helvetica",
            fontSize: 8,
            cellPadding: 1.4,
            lineColor: GRIS_LINEA,
            lineWidth: 0.2,
            textColor: NEGRO,
            valign: "middle",
            minCellHeight: 7,
            overflow: "linebreak",
        },
        headStyles: { fillColor: AZUL, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.5, minCellHeight: 6 },
        columnStyles: {
            0: { halign: "center", cellWidth: 7 },
            1: { cellWidth: 38 },
            2: { cellWidth: 30 },
            3: { halign: "center", cellWidth: 13 },
            4: { halign: "center", cellWidth: 9, fillColor: [244, 246, 249], textColor: AZUL, fontStyle: "bold" },
            5: { cellWidth: 17 },
            7: { cellWidth: 13 },
            8: { cellWidth: 13 },
            9: { cellWidth: 12 },
        },
        rowPageBreak: "avoid",
        showHead: "everyPage",
        didParseCell: (data) => {
            if (data.section === "head") {
                data.cell.styles.halign = [0, 3, 4, 5, 7, 8, 9].includes(data.column.index) ? "center" : "left";
            }
            if (data.section === "body" && d.procesos.length) {
                const primero = data.row.index % RENGLONES_POR_PROCESO === 0;
                if (primero && data.column.index !== 4) data.cell.styles.fontStyle = "bold";
                if (primero && data.column.index === 2 && !d.procesos[data.row.index / RENGLONES_POR_PROCESO]?.maquina) {
                    data.cell.styles.textColor = [153, 153, 153];
                    data.cell.styles.fontStyle = "normal";
                }
            }
        },
        // La línea gruesa arriba de cada proceso lo separa del anterior: los renglones
        // de abajo son la continuación del mismo, para los días siguientes.
        didDrawCell: (data) => {
            if (data.section === "body" && d.procesos.length && data.row.index % RENGLONES_POR_PROCESO === 0) {
                doc.setDrawColor(...AZUL);
                doc.setLineWidth(0.5);
                doc.line(data.cell.x, data.cell.y, data.cell.x + data.cell.width, data.cell.y);
            }
        },
    });
    y = finDeTabla(doc, y) + 2;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...GRIS_TEXTO);
    doc.text(
        "Cada proceso trae tres renglones, uno por día: no hace falta cargarlo dos veces en el sistema. Si lleva más de tres días, seguí en la Nota de taller.",
        MARGEN, y + 2.5, { maxWidth: doc.internal.pageSize.getWidth() - 2 * MARGEN },
    );
    y += 7;

    y = subtitulo(doc, "Nota de taller", y);
    y = caja(doc, d.notaDeTaller, y);
    if (d.descripcion) {
        y = subtitulo(doc, "Descripción", y);
        y = caja(doc, d.descripcion, y, 10);
    }
    // RF-11: las casillas de «Estado y control» marcadas. Sólo si hay alguna: la hoja de
    // una OT recién cargada sale igual que siempre.
    if (d.estadoYControl) {
        const quien = [d.controladoPor ? `controlada por ${d.controladoPor}` : "",
                       cuandoLegible(d.controladoEl)]
            .filter(Boolean).join(" · ");
        y = subtitulo(doc, "Estado y control", y);
        y = caja(doc, d.estadoYControl + (quien ? ` (${quien})` : ""), y, 8);
    }

    // Firmas
    {
        const ancho = doc.internal.pageSize.getWidth();
        const alto = doc.internal.pageSize.getHeight();
        if (y + 18 > alto - ALTO_PIE) {
            doc.addPage();
            y = MARGEN;
        }
        const hueco = 8;
        const w = (ancho - 2 * MARGEN - 2 * hueco) / 3;
        ["Firma del recurso humano", "Control / Calidad", "Fecha de cierre"].forEach((rotulo, i) => {
            const x = MARGEN + i * (w + hueco);
            doc.setDrawColor(...NEGRO);
            doc.setLineWidth(0.3);
            doc.line(x, y + 10, x + w, y + 10);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(6.5);
            doc.setTextColor(...GRIS_TEXTO);
            doc.text(textoPdf(rotulo.toUpperCase()), x, y + 13.5);
        });
        y += 18;
    }
    pieDeHoja(doc, "Hoja de PROCESOS — para el recurso humano · Metalúrgica Longchamps", y);

    // ---------------- Hoja 2: materias primas ----------------
    doc.addPage();
    y = encabezado(doc, logo, "Materias Primas", d.numero, "Retirar en pañol");
    y = grilla(doc, [
        ["Cliente", d.cliente],
        ["Producto", producto],
        ["Cantidad", cifra(d.cantidad)],
        ["N° Pedido", d.nPedido],
    ], y);
    y = subtitulo(doc, "Materias primas", y);

    autoTable(doc, {
        startY: y,
        head: [["Código", "Descripción", "Proveedor", "Cant.", "Un.", "Retirado", "Obs."]],
        body: d.materias.length
            ? d.materias.map((m) => [
                textoPdf(m.codigo), textoPdf(m.descripcion), textoPdf(m.proveedor || ""),
                textoPdf(cifra(m.cantidad)), textoPdf(m.unidad), "", "",
            ])
            : [[{ content: "Sin materias primas", colSpan: 7, styles: { halign: "center", textColor: [153, 153, 153] } }]],
        theme: "grid",
        margin: { top: MARGEN, left: MARGEN, right: MARGEN, bottom: ALTO_PIE },
        styles: {
            font: "helvetica",
            fontSize: 8,
            cellPadding: 1.4,
            lineColor: GRIS_LINEA,
            lineWidth: 0.2,
            textColor: NEGRO,
            valign: "middle",
            minCellHeight: 7,
            overflow: "linebreak",
        },
        headStyles: { fillColor: AZUL, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.5, minCellHeight: 6 },
        columnStyles: {
            0: { cellWidth: 26 },
            3: { halign: "center", cellWidth: 13 },
            4: { halign: "center", cellWidth: 11 },
            5: { halign: "center", cellWidth: 17 },
            6: { cellWidth: 30 },
        },
        rowPageBreak: "avoid",
        showHead: "everyPage",
        didParseCell: (data) => {
            if (data.section === "head" && [3, 4, 5].includes(data.column.index)) data.cell.styles.halign = "center";
        },
    });
    y = finDeTabla(doc, y) + 4;

    y = subtitulo(doc, "Observaciones pañol", y);
    y = caja(doc, "", y);
    pieDeHoja(doc, "Hoja de MATERIAS PRIMAS — para el pañol", y);

    numerarPaginas(doc, `Metalúrgica Longchamps · OT N° ${d.numero} · ${generado}`);
    return doc.output("blob");
}
