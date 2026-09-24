/**
 * El PDF del reporte mensual (RF-21).
 *
 * Es el diseño de exportación de siempre (lib/exportarPdf.ts: el logo de Metalúrgica
 * Longchamps, el título, cuándo se generó y el número de página) con lo que un reporte de
 * un mes necesita y una tabla sola no da:
 *
 *   1. una PORTADA: el logo, el mes, contra qué mes se compara y qué partes trae;
 *   2. cada parte con sus indicadores (este mes, el anterior y la diferencia) y sus
 *      tablas, con el renglón de TOTALES al pie;
 *   3. al final, los avisos y cómo se cuenta cada cosa: el papel se lee sin nadie al lado.
 *
 * Todo sale de la misma lista que dibuja la pantalla (lib/reporteMensual.ts,
 * seccionesDelReporte): no hay otra cuenta. Se carga con import() recién al tocar «PDF».
 */

import type { jsPDF } from "jspdf";
import { ahoraAR, alineaDerecha, fechaHoraAR, partesDeFecha, textoParaLeer, type ColumnaExport } from "@/lib/exportar";
import {
  AZUL,
  GRIS,
  MARGEN,
  autoTable,
  cargarLogo,
  dibujarEncabezado,
  dibujarTituloDeSeccion,
  numerarPaginas,
  nuevoDocumento,
  textoPdf,
  type RowInput,
} from "@/lib/exportarPdf";
import {
  conMayuscula,
  fmtIndicador,
  seccionesDelReporte,
  variacion,
  type Indicador,
  type ReporteMensual,
  type TablaReporte,
} from "@/lib/reporteMensual";

const ROJO: [number, number, number] = [220, 20, 60]; // #DC143C, el de la app
const NEGRO: [number, number, number] = [17, 17, 17];
const VERDE: [number, number, number] = [4, 120, 87];
const AMBAR: [number, number, number] = [180, 83, 9];
const ALTO_PIE = 14;

function lugar(doc: jsPDF, y: number, hace: number): number {
  if (y + hace > doc.internal.pageSize.getHeight() - ALTO_PIE) {
    doc.addPage();
    return MARGEN;
  }
  return y;
}

// ── La portada ────────────────────────────────────────────────────────────────

async function portada(doc: jsPDF, r: ReporteMensual, partes: { titulo: string; descripcion: string }[]) {
  const ancho = doc.internal.pageSize.getWidth();
  const alto = doc.internal.pageSize.getHeight();
  const logo = await cargarLogo();

  doc.setFillColor(...AZUL);
  doc.rect(0, 0, ancho, 6, "F");
  doc.setFillColor(...ROJO);
  doc.rect(0, 6, ancho, 1.2, "F");

  let y = 26;
  if (logo) {
    const altoLogo = 20;
    const anchoLogo = Math.min(ancho - 2 * MARGEN, (logo.ancho / logo.alto) * altoLogo);
    doc.addImage(logo.dataUrl, "PNG", MARGEN + 6, y, anchoLogo, altoLogo, "logo-longchamps", "FAST");
    y += altoLogo + 30;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.setTextColor(...AZUL);
    doc.text("METALÚRGICA LONGCHAMPS", MARGEN + 6, y + 10);
    y += 40;
  }

  const x = MARGEN + 6;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...ROJO);
  doc.text("REPORTE MENSUAL", x, y);

  y += 14;
  doc.setFontSize(34);
  doc.setTextColor(...AZUL);
  doc.text(textoPdf(conMayuscula(r.titulo)), x, y);

  y += 10;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  doc.setTextColor(...GRIS);
  doc.text(textoPdf(`Comparado con ${r.anterior.titulo}`), x, y);

  if (r.periodo.parcial) {
    y += 8;
    const p = partesDeFecha(r.periodo.corte);
    doc.setFontSize(10);
    doc.setTextColor(...AMBAR);
    doc.text(textoPdf(`El mes todavía no terminó: los números son hasta el ${p ? fechaHoraAR(p) : "día de hoy"}.`), x, y);
  }

  y += 22;
  doc.setDrawColor(222, 226, 231);
  doc.setLineWidth(0.3);
  doc.line(x, y - 8, ancho - MARGEN - 6, y - 8);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  doc.text("QUÉ TRAE", x, y);
  y += 7;
  partes.forEach((s, i) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...NEGRO);
    doc.text(textoPdf(`${i + 1}.  ${s.titulo}`), x, y);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRIS);
    const renglones = doc.splitTextToSize(textoPdf(s.descripcion), ancho - 2 * MARGEN - 20) as string[];
    doc.text(renglones.slice(0, 2), x + 7, y + 5);
    y += 7 + renglones.slice(0, 2).length * 4.2;
  });
  if (!partes.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...GRIS);
    doc.text("Tu usuario no ve ninguna parte de este reporte.", x, y);
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  doc.text(textoPdf(`Generado el ${ahoraAR()} · SPMM`), x, alto - 22);
  doc.text("Metalúrgica Longchamps", x, alto - 17.5);
}

// ── Indicadores ───────────────────────────────────────────────────────────────

function dibujarIndicadores(doc: jsPDF, lista: Indicador[], r: ReporteMensual, y: number): number {
  if (!lista.length) return y;
  const ancho = doc.internal.pageSize.getWidth();
  const hueco = 3.5;
  const porFila = 3;
  const w = (ancho - 2 * MARGEN - hueco * (porFila - 1)) / porFila;
  // Con alguna aclaración de dos renglones, todas las tarjetas un poco más altas (parejas).
  doc.setFontSize(6.3);
  const renglonesAyuda = Math.max(1, ...lista.map((i) =>
    i.ayuda ? Math.min(2, (doc.splitTextToSize(textoPdf(i.ayuda), w - 6) as string[]).length) : 1));
  const alto = 19.5 + renglonesAyuda * 2.7;
  const filas = Math.ceil(lista.length / porFila);
  y = lugar(doc, y, filas * (alto + hueco));
  lista.forEach((ind, i) => {
    const col = i % porFila;
    const fila = Math.floor(i / porFila);
    const x = MARGEN + col * (w + hueco);
    const top = y + fila * (alto + hueco);
    doc.setFillColor(247, 248, 250);
    doc.setDrawColor(222, 226, 231);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, top, w, alto, 2, 2, "FD");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...GRIS);
    doc.text(textoPdf(ind.titulo.toUpperCase()), x + 3, top + 5);

    doc.setFontSize(14);
    doc.setTextColor(...NEGRO);
    doc.text(textoPdf(fmtIndicador(ind.actual, ind.tipo)), x + 3, top + 12);

    const v = variacion(ind);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    const antes = `${conMayuscula(r.anterior.titulo.split(" de ")[0])}: ${fmtIndicador(ind.anterior, ind.tipo)}`;
    doc.setTextColor(...GRIS);
    doc.text(textoPdf(antes), x + 3, top + 17);
    if (v) {
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...(v.tono === "bien" ? VERDE : v.tono === "mal" ? ROJO : GRIS));
      doc.text(textoPdf(v.texto), x + w - 3, top + 17, { align: "right" });
    }
    if (ind.ayuda) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.3);
      doc.setTextColor(150, 150, 150);
      const t = doc.splitTextToSize(textoPdf(ind.ayuda), w - 6) as string[];
      doc.text(t.slice(0, 2), x + 3, top + 20.5);
    }
  });
  return y + filas * alto + (filas - 1) * hueco + 6;
}

// ── Tablas con totales ────────────────────────────────────────────────────────

function dibujarTabla(doc: jsPDF, t: TablaReporte, y: number): number {
  y = lugar(doc, y, 22);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...NEGRO);
  doc.text(textoPdf(t.titulo), MARGEN, y + 3);
  y += 5;

  const columnas = (t.lectura ?? t.columnas) as ColumnaExport<any>[];
  const celda = (c: ColumnaExport<any>, fila: any, i: number) => textoPdf(textoParaLeer(c, c.valor(fila, i)));
  const cuerpo: RowInput[] = t.filas.length
    ? t.filas.map((fila, i) => columnas.map((c) => celda(c, fila, i)))
    : [[{ content: textoPdf(t.vacio), colSpan: Math.max(1, columnas.length), styles: { halign: "center", textColor: [150, 150, 150], fontStyle: "italic" } }]];
  const pie: RowInput[] | undefined = t.total && t.filas.length
    ? [columnas.map((c) => celda(c, t.total, -1))]
    : undefined;

  const estilos: Record<number, { halign?: "right" | "center"; cellWidth?: "wrap" }> = {};
  columnas.forEach((c, i) => {
    if (alineaDerecha(c.tipo)) estilos[i] = { halign: "right" };
    else if (c.tipo === "fecha" || c.tipo === "fechaHora") estilos[i] = { halign: "center", cellWidth: "wrap" };
  });
  const letra = columnas.length > 8 ? 6.8 : 7.4;

  autoTable(doc, {
    startY: y,
    head: [columnas.map((c) => textoPdf(c.titulo))],
    body: cuerpo,
    foot: pie,
    theme: "striped",
    margin: { top: MARGEN, left: MARGEN, right: MARGEN, bottom: ALTO_PIE },
    styles: {
      font: "helvetica", fontSize: letra, cellPadding: 1.3, overflow: "linebreak", valign: "top",
      lineColor: [215, 219, 225], lineWidth: 0.1, textColor: [20, 20, 20],
    },
    headStyles: { fillColor: AZUL, textColor: [255, 255, 255], fontStyle: "bold", fontSize: letra - 0.4, valign: "middle" },
    footStyles: { fillColor: [232, 236, 242], textColor: NEGRO, fontStyle: "bold", fontSize: letra },
    alternateRowStyles: { fillColor: [245, 247, 250] },
    columnStyles: estilos,
    showHead: "everyPage",
    showFoot: "lastPage",
    rowPageBreak: "avoid",
    didParseCell: (data) => {
      if (data.section === "head" || data.section === "foot") {
        const halign = estilos[data.column.index]?.halign;
        if (halign) data.cell.styles.halign = halign;
      }
    },
  });
  y = ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y) + 3;

  if (t.nota) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.setTextColor(...GRIS);
    const renglones = doc.splitTextToSize(textoPdf(t.nota), doc.internal.pageSize.getWidth() - 2 * MARGEN) as string[];
    y = lugar(doc, y, renglones.length * 3.4);
    doc.text(renglones, MARGEN, y + 2.5);
    y += renglones.length * 3.4;
  }
  return y + 5;
}

function parrafo(doc: jsPDF, texto: string, y: number, color: [number, number, number] = GRIS, tamano = 7.8): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(tamano);
  doc.setTextColor(...color);
  const renglones = doc.splitTextToSize(textoPdf(texto), doc.internal.pageSize.getWidth() - 2 * MARGEN) as string[];
  const interlinea = tamano * 0.45;
  for (const r of renglones) {
    y = lugar(doc, y, interlinea);
    doc.text(r, MARGEN, y + interlinea);
    y += interlinea + 0.5;
  }
  return y + 2;
}

// ── El documento ──────────────────────────────────────────────────────────────

export async function construirPdfReporteMensual(r: ReporteMensual): Promise<Blob> {
  const titulo = `Reporte mensual de ${r.titulo}`;
  const doc = nuevoDocumento("portrait");
  doc.setProperties({ title: textoPdf(titulo), creator: "SPMM · Metalúrgica Longchamps" });
  const secciones = seccionesDelReporte(r);

  await portada(doc, r, secciones.map((s) => ({ titulo: s.titulo, descripcion: s.descripcion })));

  doc.addPage();
  let y = dibujarEncabezado(doc, {
    titulo,
    subtitulo: `Comparado con ${r.anterior.titulo}${r.periodo.parcial ? " · mes en curso" : ""}`,
    logo: await cargarLogo(),
    filtros: null,
  });

  if (r.avisos.length) {
    y = dibujarTituloDeSeccion(doc, "Para tener en cuenta", y);
    for (const a of r.avisos) y = parrafo(doc, `- ${a}`, y, AMBAR) - 1;
    y += 3;
  }

  secciones.forEach((s, i) => {
    if (i > 0) y += 2;
    // El título no queda solo al pie de una hoja: va junto con la descripción y TODOS
    // sus indicadores (o el aviso de «sin datos»), que se dibujan de un tirón.
    const alIndicadores = Math.ceil(s.indicadores.length / 3) * 29;
    y = dibujarTituloDeSeccion(doc, `${i + 1}. ${s.titulo}`, lugar(doc, y, 22 + alIndicadores));
    y = parrafo(doc, s.descripcion, y);
    y = dibujarIndicadores(doc, s.indicadores, r, y);
    if (s.sinDatos) y = parrafo(doc, s.sinDatos, y, GRIS, 8.5);
    for (const t of s.tablas) y = dibujarTabla(doc, t, y);
  });

  if (r.como_se_cuenta.length) {
    y = dibujarTituloDeSeccion(doc, "Cómo se cuenta", lugar(doc, y + 2, 30));
    for (const n of r.como_se_cuenta) y = parrafo(doc, n, y, GRIS, 7.4);
  }

  numerarPaginas(doc, `Metalúrgica Longchamps · ${titulo}`);
  return doc.output("blob");
}
