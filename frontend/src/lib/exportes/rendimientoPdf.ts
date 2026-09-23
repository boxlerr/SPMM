/**
 * El PDF del rendimiento de una persona (RF-07).
 *
 * Es el diseño de exportación de siempre (lib/exportarPdf.ts: el logo y el nombre de
 * Metalúrgica Longchamps, el título, cuándo se generó, el período y el número de página)
 * con lo que un reporte de una persona necesita y una tabla sola no da:
 *
 *   1. las seis tarjetas de la ficha, con su número y su aclaración;
 *   2. la eficiencia leída en castellano («lo que se estimaba en 10 h le llevó 8 h 20 min»)
 *      y cómo se lee el porcentaje, porque el papel se lee sin nadie al lado;
 *   3. la tabla de tareas;
 *   4. las aclaraciones: qué es tiempo efectivo, a quién se le cuenta cada paso y lo que
 *      quedó afuera de las cuentas.
 *
 * Todo sale de la misma respuesta del backend que dibuja la pantalla (lib/rendimiento.ts).
 * Se carga con import() recién al tocar «PDF» (trae jspdf).
 */

import type { jsPDF } from "jspdf";
import { fechaHoraAR, partesDeFecha, type ColumnaExport } from "@/lib/exportar";
import {
  GRIS,
  MARGEN,
  cargarLogo,
  dibujarEncabezado,
  dibujarTabla,
  dibujarTituloDeSeccion,
  numerarPaginas,
  nuevoDocumento,
  textoPdf,
} from "@/lib/exportarPdf";
import { fmtMinutos } from "@/lib/asistencia";
import {
  COMO_SE_LEE_EFICIENCIA,
  aclaraciones,
  detalleAusencias,
  detalleCompletadas,
  detalleEficiencia,
  detalleHoras,
  detallePausas,
  detallePromedio,
  estadoParaArchivo,
  filtrosDeExportacion,
  fmtPct,
  type RendimientoOperario,
  type TareaRendimiento,
} from "@/lib/rendimiento";

const ALTO_PIE = 14;
const NEGRO: [number, number, number] = [17, 17, 17];
const VERDE: [number, number, number] = [4, 120, 87];
const AMBAR: [number, number, number] = [180, 83, 9];

interface Tarjeta {
  titulo: string;
  valor: string;
  detalle: string;
  color?: [number, number, number];
}

function tarjetas(d: RendimientoOperario): Tarjeta[] {
  const r = d.resumen;
  const nivel = r.eficiencia.nivel;
  return [
    { titulo: "Tareas completadas", valor: String(r.tareas_completadas), detalle: detalleCompletadas(r) },
    { titulo: "Tiempo promedio por tarea", valor: fmtMinutos(r.tiempo_promedio_min), detalle: detallePromedio(r) },
    {
      titulo: "Eficiencia", valor: fmtPct(r.eficiencia.pct), detalle: detalleEficiencia(r),
      color: nivel === "rapido" ? VERDE : nivel === "lento" ? AMBAR : undefined,
    },
    { titulo: "Horas trabajadas", valor: fmtMinutos(r.horas_trabajadas_min), detalle: detalleHoras(r) },
    {
      titulo: "Días de ausencia", valor: r.ausencias ? String(r.ausencias.dias) : "—",
      detalle: detalleAusencias(r),
    },
    {
      titulo: "Pausas", valor: d.pausas_disponibles ? fmtMinutos(r.pausas.minutos) : "—",
      detalle: detallePausas(r, d.pausas_disponibles),
    },
  ];
}

/** Las tarjetas de a tres por renglón. Devuelve dónde sigue la página. */
function dibujarTarjetas(doc: jsPDF, lista: Tarjeta[], y: number): number {
  const ancho = doc.internal.pageSize.getWidth();
  const hueco = 4;
  const porFila = 3;
  const w = (ancho - 2 * MARGEN - hueco * (porFila - 1)) / porFila;
  const alto = 24;
  lista.forEach((t, i) => {
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
    doc.text(textoPdf(t.titulo.toUpperCase()), x + 3, top + 5);

    doc.setFontSize(15);
    doc.setTextColor(...(t.color ?? NEGRO));
    doc.text(textoPdf(t.valor), x + 3, top + 12.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...GRIS);
    const renglones = doc.splitTextToSize(textoPdf(t.detalle), w - 6) as string[];
    doc.text(renglones.slice(0, 3), x + 3, top + 17);
  });
  const filas = Math.ceil(lista.length / porFila);
  return y + filas * alto + (filas - 1) * hueco + 6;
}

/** Un párrafo que pasa de hoja si no entra. `negrita` va primero, en su propio renglón. */
function parrafo(doc: jsPDF, texto: string, y: number, opciones?: { negrita?: string; tamano?: number }): number {
  const ancho = doc.internal.pageSize.getWidth();
  const altoPagina = doc.internal.pageSize.getHeight();
  const tamano = opciones?.tamano ?? 8;
  const interlinea = tamano * 0.45;
  const bloques: { texto: string; bold: boolean }[] = [];
  if (opciones?.negrita) bloques.push({ texto: opciones.negrita, bold: true });
  bloques.push({ texto, bold: false });
  for (const b of bloques) {
    doc.setFont("helvetica", b.bold ? "bold" : "normal");
    doc.setFontSize(tamano);
    doc.setTextColor(...(b.bold ? NEGRO : GRIS));
    const renglones = doc.splitTextToSize(textoPdf(b.texto), ancho - 2 * MARGEN) as string[];
    for (const r of renglones) {
      if (y + interlinea > altoPagina - ALTO_PIE) {
        doc.addPage();
        y = MARGEN;
      }
      doc.text(r, MARGEN, y + interlinea);
      y += interlinea + 0.6;
    }
    y += 1;
  }
  return y + 2;
}

const momento = (v: string | null) => {
  const p = partesDeFecha(v);
  if (!p) return "";
  return fechaHoraAR(p).slice(0, 5) + fechaHoraAR(p).slice(10); // «22/09 08:00»
};

/**
 * La tabla del papel: los tiempos escritos como se leen («2 h 10 min»), no en horas con
 * decimales como en el Excel. Las columnas de tiempos van con tipo «numero» sólo para
 * que se alineen a la derecha: el valor es texto y se imprime tal cual.
 */
const COLUMNAS_PDF: ColumnaExport<TareaRendimiento>[] = [
  { titulo: "OT", tipo: "id", valor: (t) => t.numero_ot },
  { titulo: "Paso", valor: (t) => `${t.paso != null ? `${t.paso}. ` : ""}${t.proceso ?? "Proceso"}` },
  { titulo: "Artículo", valor: (t) => t.articulo ?? "" },
  {
    titulo: "Inicio -> fin",
    valor: (t) => `${momento(t.inicio_real)}${t.fin_real ? ` -> ${momento(t.fin_real)}` : t.en_curso ? " -> sigue" : ""}`,
  },
  { titulo: "En el período", valor: (t) => estadoParaArchivo(t) },
  { titulo: "Estimado", tipo: "numero", valor: (t) => fmtMinutos(t.estimado_min) },
  { titulo: "Efectivo", tipo: "numero", valor: (t) => (t.sin_datos ? "—" : fmtMinutos(t.efectivo_min)) },
  { titulo: "Eficiencia", tipo: "numero", valor: (t) => fmtPct(t.eficiencia_pct) },
];

export async function construirPdfRendimiento(
  d: RendimientoOperario,
  opciones: { titulo: string; textoPeriodo: string },
): Promise<Blob> {
  const doc = nuevoDocumento("portrait");
  doc.setProperties({ title: textoPdf(opciones.titulo), creator: "SPMM · Metalúrgica Longchamps" });
  const logo = await cargarLogo();

  let y = dibujarEncabezado(doc, {
    titulo: opciones.titulo,
    subtitulo: `${d.periodo.dias} ${d.periodo.dias === 1 ? "día" : "días"} · ${d.resumen.tareas_trabajadas} ${d.resumen.tareas_trabajadas === 1 ? "tarea trabajada" : "tareas trabajadas"}`,
    logo,
    filtros: filtrosDeExportacion(opciones.textoPeriodo),
  });

  y = dibujarTarjetas(doc, tarjetas(d), y);

  y = dibujarTituloDeSeccion(doc, "Cómo se lee la eficiencia", y);
  y = parrafo(doc, COMO_SE_LEE_EFICIENCIA, y, { negrita: d.resumen.eficiencia.lectura });

  y = dibujarTituloDeSeccion(doc, "Tareas", y);
  y = dibujarTabla(doc, { titulo: "Tareas", filas: d.tareas, columnas: COLUMNAS_PDF }, y, {
    vacio: "Ningún paso trabajado en este período.",
  });

  y = dibujarTituloDeSeccion(doc, "Aclaraciones", y);
  for (const a of aclaraciones(d)) y = parrafo(doc, `- ${a}`, y, { tamano: 7.5 }) - 2;

  numerarPaginas(doc, `Metalúrgica Longchamps · ${opciones.titulo}`);
  return doc.output("blob");
}
