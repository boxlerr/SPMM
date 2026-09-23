/**
 * El reporte de rendimiento de una persona (RF-07): tipos, períodos y lo que se exporta.
 *
 * TODAS las cuentas son del backend (application/RendimientoOperarioService.py): qué es
 * una tarea completada, el promedio, la eficiencia, las horas sin contar dos veces, las
 * pausas y las ausencias. Acá no hay una segunda cuenta —ni una segunda jornada—: sólo
 * se arma el período que se pide y se da formato. La pantalla y los tres archivos
 * (PDF, Excel, CSV) salen de la misma respuesta, así que no pueden decir cosas distintas.
 */

import type { ColumnaExport, SeccionExport } from "@/lib/exportar";
import { fechaCorta, fmtMinutos, isoLocal, rangoDePeriodo } from "@/lib/asistencia";

// ── Lo que contesta GET /operarios/{id}/rendimiento ───────────────────────────

export interface TareaRendimiento {
  id_otp: number;
  id_orden_trabajo: number;
  numero_ot: number;
  articulo: string | null;
  proceso: string | null;
  paso: number | null;
  id_estado: number;
  estado: string;
  inicio_real: string;
  fin_real: string | null;
  en_curso: boolean;
  /** Terminado sin fin registrado (o con el fin antes del arranque): no se mide. */
  sin_datos: boolean;
  /** «ot» = la persona elegida a mano en la OT; «plan» = según el último plan. */
  origen: "ot" | "plan";
  estimado_min: number | null;
  corrido_min: number | null;
  fuera_de_jornada_min: number | null;
  pausa_min: number | null;
  /** El del paso entero. */
  efectivo_min: number | null;
  /** Sólo lo que cae adentro del período (es lo que suma a «horas trabajadas»). */
  efectivo_en_periodo_min: number | null;
  /** Terminada con el fin adentro del período: cuenta como completada. */
  terminada_en_periodo: boolean;
  /** Completada y con efectivo mayor que cero: entra en el promedio. */
  medible: boolean;
  eficiencia_pct: number | null;
}

export type NivelEficiencia = "rapido" | "parejo" | "lento";

export interface ResumenRendimiento {
  tareas_trabajadas: number;
  tareas_completadas: number;
  en_curso: number;
  sin_datos: number;
  sin_tiempo: number;
  sin_estimado: number;
  tiempo_promedio_min: number | null;
  tareas_medidas: number;
  eficiencia: {
    pct: number | null;
    nivel: NivelEficiencia | null;
    estimado_min: number;
    efectivo_min: number;
    tareas: number;
    /** La eficiencia en castellano, con los números que la forman. */
    lectura: string;
  };
  horas_trabajadas_min: number;
  superpuesto_min: number;
  pausas: {
    minutos: number;
    cantidad: number;
    por_motivo: { motivo: string; texto: string; minutos: number }[];
  };
  /** null = el servidor no tiene la asistencia (RF-06). */
  ausencias: {
    dias: number;
    dias_laborables: number;
    por_motivo: { motivo: string; texto: string; dias: number }[];
  } | null;
}

export interface RendimientoOperario {
  id_operario: number;
  persona: string;
  periodo: { desde: string; hasta: string; dias: number };
  generado: string;
  jornada: string;
  pausas_disponibles: boolean;
  ausencias_disponibles: boolean;
  historial: { pasos: number; ultimo_arranque: string | null };
  resumen: ResumenRendimiento;
  recortado: boolean;
  tareas: TareaRendimiento[];
}

// ── Cómo se lee ───────────────────────────────────────────────────────────────

/** Lo que la eficiencia es y lo que no, para la pantalla y para el PDF. */
export const COMO_SE_LEE_EFICIENCIA =
  "Eficiencia = tiempo estimado ÷ tiempo trabajado, de las tareas terminadas en el período. " +
  "100 % es tardar justo lo estimado; más de 100 %, menos de lo estimado (125 %: lo de 5 h " +
  "en 4 h); menos de 100 %, más (80 %: lo de 4 h en 5 h). Se compara contra el tiempo " +
  "cargado en la OT: si la estimación está mal, este número también.";

/** Cómo se cuenta, siempre igual: va al pie de la solapa y del PDF. */
export function notasFijas(d: RendimientoOperario): string[] {
  return [
    `El tiempo trabajado es el efectivo: el de la jornada del taller (${d.jornada}), sin lo ` +
      "que el paso o su OT estuvieron en pausa.",
    "Cada paso se le cuenta a quien lo tiene elegido en la OT o, si no hay, a quien le dio " +
      "el último plan: el sistema no registra quién lo hizo de verdad.",
  ];
}

/** Lo que quedó afuera de las cuentas o falta, sólo cuando pasa: va a la vista. */
export function avisos(d: RendimientoOperario): string[] {
  const r = d.resumen;
  const salida: string[] = [];
  if (r.sin_tiempo) {
    salida.push(
      `${r.sin_tiempo} ${r.sin_tiempo === 1 ? "tarea terminada no tiene" : "tareas terminadas no tienen"} ` +
      "tiempo medido (se marcó el arranque y el fin juntos, o se trabajó fuera de la jornada): " +
      "no entran en el promedio ni en la eficiencia.",
    );
  }
  if (r.sin_datos) {
    salida.push(
      `${r.sin_datos} ${r.sin_datos === 1 ? "paso figura terminado" : "pasos figuran terminados"} ` +
      "sin fecha de fin: no se pueden medir ni ubicar en el período.",
    );
  }
  if (r.sin_estimado) {
    salida.push(
      `${r.sin_estimado} ${r.sin_estimado === 1 ? "tarea no tiene" : "tareas no tienen"} tiempo ` +
      "estimado en la OT: entran en el promedio, no en la eficiencia.",
    );
  }
  if (r.superpuesto_min > 0) {
    salida.push(
      `Tuvo pasos abiertos a la vez: ${fmtMinutos(r.superpuesto_min)} se superponen y en las ` +
      "horas trabajadas se cuentan una sola vez.",
    );
  }
  if (!d.pausas_disponibles) {
    salida.push("El servidor todavía no tiene las pausas de las OT: el tiempo no las descuenta.");
  }
  if (!d.ausencias_disponibles) {
    salida.push("El servidor todavía no tiene la asistencia: los días de ausencia no se saben.");
  }
  if (d.recortado) {
    salida.push(`La tabla muestra las ${d.tareas.length} tareas más recientes; los totales son de todas.`);
  }
  return salida;
}

/** Todo junto, para los archivos. */
export function aclaraciones(d: RendimientoOperario): string[] {
  return [...avisos(d), ...notasFijas(d)];
}

// ── Períodos ──────────────────────────────────────────────────────────────────

export type ClavePeriodoRendimiento = "mes" | "mes_pasado" | "30d" | "90d" | "rango";

export interface PeriodoRendimiento {
  clave: ClavePeriodoRendimiento;
  /** Sólo para «rango»: «AAAA-MM-DD», los dos incluidos. */
  desde?: string;
  hasta?: string;
}

export const PERIODOS_RENDIMIENTO: { clave: ClavePeriodoRendimiento; texto: string }[] = [
  { clave: "mes", texto: "Este mes" },
  { clave: "mes_pasado", texto: "Mes pasado" },
  { clave: "30d", texto: "Últimos 30 días" },
  { clave: "90d", texto: "Últimos 90 días" },
  { clave: "rango", texto: "Elegir fechas…" },
];

/** El mismo tope que el backend (TOPE_DIAS_PERIODO). */
export const TOPE_DIAS_PERIODO = 366;

/** Las dos puntas del período, incluidas, como las pide la API. */
export function rangoRendimiento(p: PeriodoRendimiento, hoy: Date = new Date()): { desde: string; hasta: string } {
  switch (p.clave) {
    case "mes":
    case "mes_pasado":
    case "30d":
      return rangoDePeriodo(p.clave, hoy);
    case "90d":
      return {
        desde: isoLocal(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 89)),
        hasta: isoLocal(hoy),
      };
    case "rango": {
      const hasta = p.hasta || isoLocal(hoy);
      return { desde: p.desde || hasta, hasta };
    }
  }
}

/** Qué le pasa al rango a mano, o null si está bien. */
export function problemaDelRango(desde: string, hasta: string): string | null {
  if (!desde || !hasta) return "Elegí las dos fechas.";
  if (hasta < desde) return "La fecha final es anterior a la inicial.";
  const [a1, m1, d1] = desde.split("-").map(Number);
  const [a2, m2, d2] = hasta.split("-").map(Number);
  const dias = Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000) + 1;
  if (dias > TOPE_DIAS_PERIODO) return "Puede ser de hasta un año: achicalo.";
  return null;
}

/** «Últimos 30 días (24/08/2026 al 22/09/2026)». */
export function textoDelPeriodo(p: PeriodoRendimiento, desde: string, hasta: string): string {
  const fechas = desde === hasta ? `el ${fechaCorta(desde)}` : `del ${fechaCorta(desde)} al ${fechaCorta(hasta)}`;
  if (p.clave === "rango") return fechas.charAt(0).toUpperCase() + fechas.slice(1);
  const nombre = PERIODOS_RENDIMIENTO.find((x) => x.clave === p.clave)?.texto ?? "";
  return `${nombre} (${fechas})`;
}

// ── Textos de las tarjetas (pantalla, PDF y Excel dicen lo mismo) ─────────────

export type TonoEstado = "verde" | "azul" | "ambar" | "gris";

/** Qué fue de la tarea EN EL PERÍODO: lo mismo en la tabla, el PDF y el Excel. */
export function estadoEnElPeriodo(t: TareaRendimiento): { texto: string; tono: TonoEstado; ayuda: string } {
  if (t.sin_datos) {
    return { texto: "Sin fin", tono: "ambar", ayuda: "Figura terminado pero sin fecha de fin: no se puede medir" };
  }
  if (t.terminada_en_periodo) {
    return t.medible
      ? { texto: "Completada", tono: "verde", ayuda: "Terminó adentro del período: cuenta como completada" }
      : { texto: "Completada", tono: "verde", ayuda: "Terminó en el período, pero sin tiempo medido (arranque y fin juntos, o fuera de la jornada): no entra en el promedio" };
  }
  if (t.en_curso) {
    return { texto: "En curso", tono: "azul", ayuda: "Todavía no terminó: suma a las horas, no a las completadas" };
  }
  if (t.id_estado === 3) {
    return { texto: "Terminó después", tono: "gris", ayuda: "Se trabajó en el período, pero terminó después" };
  }
  return { texto: t.estado, tono: "gris", ayuda: "" };
}

/** El estado como va en un archivo: con la aclaración cuando hace falta. */
export function estadoParaArchivo(t: TareaRendimiento): string {
  const e = estadoEnElPeriodo(t);
  if (t.sin_datos) return "Sin fin registrado";
  if (t.terminada_en_periodo && !t.medible) return "Completada (sin tiempo medido)";
  return e.texto;
}

export const fmtPct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n} %`);

export function detalleCompletadas(r: ResumenRendimiento): string {
  const partes = [`de ${r.tareas_trabajadas} ${r.tareas_trabajadas === 1 ? "trabajada" : "trabajadas"}`];
  if (r.en_curso) partes.push(`${r.en_curso} en curso`);
  return partes.join(" · ");
}

export function detallePromedio(r: ResumenRendimiento): string {
  if (!r.tareas_medidas) return "sin tareas terminadas con tiempo medido";
  return `efectivo, de ${r.tareas_medidas} ${r.tareas_medidas === 1 ? "tarea medida" : "tareas medidas"}`;
}

export function detalleEficiencia(r: ResumenRendimiento): string {
  const e = r.eficiencia;
  if (e.pct === null) return "sin tareas para comparar";
  const como = e.nivel === "rapido" ? "tardó menos de lo estimado" : e.nivel === "lento" ? "tardó más de lo estimado" : "tardó más o menos lo estimado";
  return `${como} · ${fmtMinutos(e.estimado_min)} estimadas en ${fmtMinutos(e.efectivo_min)}`;
}

export function detalleHoras(r: ResumenRendimiento): string {
  return r.superpuesto_min > 0
    ? `efectivas, en pasos de OT (sin contar dos veces ${fmtMinutos(r.superpuesto_min)} superpuestos)`
    : "efectivas, en pasos de OT";
}

export function detalleAusencias(r: ResumenRendimiento): string {
  const a = r.ausencias;
  if (!a) return "el servidor no tiene la asistencia";
  if (!a.dias) return "sin ausencias cargadas";
  const motivos = a.por_motivo.map((m) => `${m.texto} ${m.dias}`).join(", ");
  return `${a.dias_laborables} ${a.dias_laborables === 1 ? "laborable" : "laborables"}${motivos ? ` · ${motivos}` : ""}`;
}

export function detallePausas(r: ResumenRendimiento, pausasDisponibles = true): string {
  if (!pausasDisponibles) return "el servidor no tiene las pausas";
  const p = r.pausas;
  if (!p.cantidad) return "sus pasos no se pausaron";
  const principal = p.por_motivo[0];
  return `${p.cantidad} ${p.cantidad === 1 ? "pausa" : "pausas"}${principal ? ` · más por ${principal.texto.toLowerCase()} (${fmtMinutos(principal.minutos)})` : ""}`;
}

// ── Exportar (RF-22): Excel con hoja de resumen y hoja de tareas ──────────────

interface FilaResumen {
  indicador: string;
  valor: number | null;
  unidad: string;
  detalle: string;
}

const horas = (min: number | null | undefined) =>
  min === null || min === undefined ? null : Math.round((min / 60) * 100) / 100;

/** La hoja «Resumen»: un renglón por tarjeta, con el número de verdad y cómo se lee. */
export function filasDeResumen(d: RendimientoOperario): FilaResumen[] {
  const r = d.resumen;
  const filas: FilaResumen[] = [
    { indicador: "Tareas completadas", valor: r.tareas_completadas, unidad: "tareas", detalle: detalleCompletadas(r) },
    {
      indicador: "Tiempo promedio por tarea", valor: horas(r.tiempo_promedio_min), unidad: "horas",
      detalle: r.tiempo_promedio_min === null ? detallePromedio(r) : `${fmtMinutos(r.tiempo_promedio_min)} · ${detallePromedio(r)}`,
    },
    { indicador: "Eficiencia", valor: r.eficiencia.pct, unidad: "%", detalle: r.eficiencia.lectura },
    {
      indicador: "Horas trabajadas", valor: horas(r.horas_trabajadas_min), unidad: "horas",
      detalle: `${fmtMinutos(r.horas_trabajadas_min)} · ${detalleHoras(r)}`,
    },
    {
      indicador: "Días de ausencia", valor: r.ausencias ? r.ausencias.dias : null, unidad: "días",
      detalle: detalleAusencias(r),
    },
    {
      indicador: "Pausas", valor: d.pausas_disponibles ? horas(r.pausas.minutos) : null, unidad: "horas",
      detalle: d.pausas_disponibles ? `${fmtMinutos(r.pausas.minutos)} · ${detallePausas(r)}` : detallePausas(r, false),
    },
    { indicador: "Tareas trabajadas", valor: r.tareas_trabajadas, unidad: "tareas", detalle: "arrancaron, siguieron o terminaron en el período" },
    { indicador: "En curso", valor: r.en_curso, unidad: "tareas", detalle: "todavía sin terminar" },
  ];
  r.pausas.por_motivo.forEach((m) => {
    filas.push({ indicador: `Pausas · ${m.texto}`, valor: horas(m.minutos), unidad: "horas", detalle: fmtMinutos(m.minutos) });
  });
  filas.push({ indicador: "Cómo se lee la eficiencia", valor: null, unidad: "", detalle: COMO_SE_LEE_EFICIENCIA });
  aclaraciones(d).forEach((a) => filas.push({ indicador: "Aclaración", valor: null, unidad: "", detalle: a }));
  return filas;
}

const COLUMNAS_RESUMEN: ColumnaExport<FilaResumen>[] = [
  { titulo: "Indicador", valor: (f) => f.indicador },
  // Sin decimales fijos: «12» tareas y «2,17» horas, cada uno como es.
  { titulo: "Valor", tipo: "numero", valor: (f) => f.valor },
  { titulo: "Unidad", valor: (f) => f.unidad },
  { titulo: "Detalle", valor: (f) => f.detalle },
];

const ORIGEN: Record<TareaRendimiento["origen"], string> = { ot: "Elegida en la OT", plan: "Según el plan" };

/** La hoja «Tareas»: los tiempos en horas con decimales, para sumar y filtrar. */
export const COLUMNAS_TAREAS_RENDIMIENTO: ColumnaExport<TareaRendimiento>[] = [
  { titulo: "OT", tipo: "id", valor: (t) => t.numero_ot },
  { titulo: "Paso", tipo: "entero", valor: (t) => t.paso },
  { titulo: "Proceso", valor: (t) => t.proceso ?? "" },
  { titulo: "Artículo", valor: (t) => t.articulo ?? "" },
  { titulo: "En el período", valor: (t) => estadoParaArchivo(t) },
  { titulo: "Inicio", tipo: "fechaHora", valor: (t) => t.inicio_real },
  { titulo: "Fin", tipo: "fechaHora", valor: (t) => t.fin_real },
  { titulo: "Completada en el período", tipo: "booleano", valor: (t) => t.terminada_en_periodo },
  { titulo: "Estado del paso hoy", valor: (t) => (t.en_curso ? "En curso" : t.estado) },
  { titulo: "Estimado (h)", tipo: "numero", decimales: 2, valor: (t) => horas(t.estimado_min) },
  { titulo: "Efectivo (h)", tipo: "numero", decimales: 2, valor: (t) => horas(t.efectivo_min) },
  { titulo: "Efectivo en el período (h)", tipo: "numero", decimales: 2, valor: (t) => horas(t.efectivo_en_periodo_min) },
  { titulo: "En pausa (h)", tipo: "numero", decimales: 2, valor: (t) => horas(t.pausa_min) },
  { titulo: "Fuera de jornada (h)", tipo: "numero", decimales: 2, valor: (t) => horas(t.fuera_de_jornada_min) },
  { titulo: "Corrido (h)", tipo: "numero", decimales: 2, valor: (t) => horas(t.corrido_min) },
  { titulo: "Eficiencia", tipo: "porcentaje", decimales: 0, valor: (t) => t.eficiencia_pct },
  { titulo: "Atribución", valor: (t) => ORIGEN[t.origen] ?? t.origen },
];

export function seccionesDeExportacion(d: RendimientoOperario): SeccionExport[] {
  return [
    { titulo: "Resumen", filas: filasDeResumen(d), columnas: COLUMNAS_RESUMEN },
    { titulo: "Tareas", filas: d.tareas, columnas: COLUMNAS_TAREAS_RENDIMIENTO },
  ];
}

/** Lo que va en «Filtros» del PDF y de la hoja «Datos del reporte» (la persona ya
 *  está en el título). */
export function filtrosDeExportacion(textoPeriodo: string): string[] {
  return [`Período: ${textoPeriodo.charAt(0).toLowerCase()}${textoPeriodo.slice(1)}`];
}

