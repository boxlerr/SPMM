/**
 * El reporte mensual (RF-21): tipos, meses y QUÉ se muestra y se exporta.
 *
 * TODAS las cuentas son del backend (application/ReporteMensualService.py): qué es una
 * OT entregada a tiempo, las horas efectivas, la eficiencia de cada persona, las no
 * conformidades y los consumos del mes. Acá no hay una segunda cuenta: se ordena lo que
 * vino en secciones, indicadores y tablas, y de ESA misma lista salen la pantalla, el PDF,
 * el Excel y los CSV. Así no pueden decir cosas distintas.
 *
 * Una sección que el backend manda en null es una que quien mira no puede ver (RF-24):
 * no aparece, ni en la pantalla ni en los archivos.
 */

import type { ColumnaExport, SeccionExport } from "@/lib/exportar";
import { fmtMinutos } from "@/lib/asistencia";

// ── Lo que contesta GET /api/dashboard/reporte-mensual ────────────────────────

export interface PeriodoMes {
  anio: number;
  mes: number;
  titulo: string;
  desde: string;
  hasta: string;
  dias: number;
  /** El mes no terminó: los números son hasta `corte`. */
  parcial: boolean;
  corte: string;
}

export interface ResumenOrdenes {
  ingresadas: number;
  entregadas: number;
  a_tiempo: number;
  con_atraso: number;
  sin_fecha_prometida: number;
  pct_a_tiempo: number | null;
  dias_atraso_promedio: number | null;
  abiertas_al_cierre: number;
  atrasadas_al_cierre: number;
}

export interface OtEntregada {
  id: number;
  numero: number;
  cliente: string;
  articulo: string;
  fecha_prometida: string | null;
  fecha_entrega: string;
  a_tiempo: boolean | null;
  dias_atraso: number | null;
}

export interface OtAtrasada {
  id: number;
  numero: number;
  cliente: string;
  articulo: string;
  fecha_prometida: string;
  dias_atraso: number;
}

export interface ClienteDelMes {
  cliente: string;
  ingresadas: number;
  entregadas: number;
}

export interface Ordenes {
  resumen: ResumenOrdenes;
  anterior: ResumenOrdenes;
  entregadas: OtEntregada[];
  atrasadas: OtAtrasada[];
  recortado: boolean;
  /** null = no ve Clientes. */
  top_clientes: ClienteDelMes[] | null;
}

export interface Horas {
  horas_min: number;
  pasos_trabajados: number;
  pasos_terminados: number;
  estimado_min: number;
  real_min: number;
  comparados: number;
  sin_estimado: number;
  sin_datos: number;
  desvio_pct: number | null;
}

export interface ResumenProduccion extends Horas {
  abiertos_de_mas: { pasos: number; minutos: number };
  pausas_min: number | null;
  pausas_cantidad: number | null;
}

export interface ProcesoDelMes extends Horas {
  id_proceso: number | null;
  proceso: string;
}

export interface OtDelMes extends Horas {
  id: number;
  numero: number;
  articulo: string;
  cliente: string;
}

export interface PausaPorMotivo {
  motivo: string;
  texto: string;
  cantidad: number;
  iniciadas: number;
  minutos: number;
}

export interface Pausas {
  disponibles: boolean;
  cantidad: number;
  iniciadas: number;
  minutos: number;
  por_motivo: PausaPorMotivo[];
}

export interface Produccion {
  resumen: ResumenProduccion;
  anterior: ResumenProduccion;
  por_proceso: ProcesoDelMes[];
  top_ot: OtDelMes[];
  ots_trabajadas: number;
  /** null = no ve las pausas. */
  pausas: Pausas | null;
}

export interface AusenciasPersona {
  dias: number;
  dias_laborables: number;
  por_motivo: { motivo: string; texto: string; dias: number }[];
}

export interface PersonaDelMes {
  id_operario: number;
  persona: string;
  horas_trabajadas_min: number;
  tareas_trabajadas: number;
  tareas_completadas: number;
  tiempo_promedio_min: number | null;
  eficiencia_pct: number | null;
  nivel: "rapido" | "parejo" | "lento" | null;
  estimado_min: number;
  efectivo_min: number;
  pausas_min: number;
  /** null = no ve las ausencias (o el servidor no tiene la asistencia). */
  ausencias: AusenciasPersona | null;
}

export interface ResumenPersonas {
  personas: number;
  horas_trabajadas_min: number;
  tareas_completadas: number;
  estimado_min: number;
  efectivo_min: number;
  eficiencia_pct: number | null;
  dias_ausencia: number | null;
  dias_ausencia_laborables: number | null;
}

export interface Personas {
  resumen: ResumenPersonas;
  anterior: ResumenPersonas;
  filas: PersonaDelMes[];
  ausencias_visibles: boolean;
}

export interface ResumenCalidad {
  total: number;
  abiertas: number;
  cerradas: number;
  minutos_perdidos: number;
  piezas_afectadas: number;
  /** RF-12: de cuántas controladas y el % (sólo de las que dicen los dos números).
   * Un backend sin RF-12 no los manda. */
  piezas_controladas?: number;
  porcentaje_rechazo?: number | null;
  ordenes?: number;
}

export interface GrupoCalidad {
  clave: string | number | null;
  texto: string;
  cantidad: number;
  piezas: number;
  minutos: number;
  porcentaje_rechazo?: number | null;
}

export interface NoConformidadDelMes {
  id: number;
  numero: number;
  fecha: string;
  tipo: string;
  gravedad: string;
  estado: string;
  piezas_afectadas: number | null;
  piezas_controladas?: number | null;
  minutos_perdidos: number | null;
  proceso: string | null;
  paso?: number | null;
  persona: string | null;
  descripcion: string | null;
}

export interface Calidad {
  disponible: boolean;
  resumen: ResumenCalidad | null;
  anterior?: ResumenCalidad | null;
  por_tipo?: GrupoCalidad[];
  por_gravedad?: GrupoCalidad[];
  /** null = sin la sección «Rendimiento por persona» (la misma que pide RF-12 para
   * las piezas rechazadas por persona). */
  por_persona?: GrupoCalidad[] | null;
  lista?: NoConformidadDelMes[];
  recortado?: boolean;
}

export interface ResumenMateriales {
  cargas: number;
  materiales: number;
  ordenes: number;
}

export interface MaterialDelMes {
  id_pieza: number;
  cod_pieza: string | null;
  descripcion: string;
  unidad: string | null;
  cantidad: number;
  cargas: number;
  ordenes: number;
}

export interface ConsumoDeOt {
  id: number;
  numero: number;
  articulo: string;
  cod_pieza: string | null;
  descripcion: string;
  unidad: string | null;
  cantidad: number;
  cargas: number;
}

export interface Materiales {
  disponible: boolean;
  resumen: ResumenMateriales | null;
  anterior?: ResumenMateriales | null;
  por_material?: MaterialDelMes[];
  por_ot?: ConsumoDeOt[];
  recortado?: boolean;
}

export interface MaquinaDelMes {
  id_maquinaria: number;
  maquina: string;
  horas_min: number;
  tareas: number;
  horas_min_anterior: number | null;
  mantenimientos?: number;
}

export interface MantenimientoDelMes {
  id: number;
  id_maquinaria: number;
  maquina: string;
  fecha: string;
  hecho_por: string | null;
  nota: string | null;
}

interface ResumenMaquinas {
  maquinas: number;
  horas_min: number;
  mantenimientos?: number;
  avisos?: number;
}

/** RF-10: las horas de uso_maquina (las efectivas) y los mantenimientos hechos en el
 * mes. Si el servidor no las pudo leer, `disponible: false` y un texto. */
export interface Maquinas {
  disponible: boolean;
  texto?: string | null;
  resumen: ResumenMaquinas | null;
  anterior: ResumenMaquinas | null;
  filas: MaquinaDelMes[];
  mantenimientos?: MantenimientoDelMes[];
}

export interface ReporteMensual {
  anio: number;
  mes: number;
  titulo: string;
  periodo: PeriodoMes;
  anterior: PeriodoMes;
  generado: string;
  jornada: string;
  ordenes: Ordenes | null;
  produccion: Produccion | null;
  personas: Personas | null;
  calidad: Calidad | null;
  materiales: Materiales | null;
  maquinas: Maquinas | null;
  avisos: string[];
  como_se_cuenta: string[];
}

/** Que lo que vino tenga la forma mínima para dibujarse (un backend raro no rompe la pantalla). */
export function esReporte(d: unknown): d is ReporteMensual {
  if (!d || typeof d !== "object") return false;
  const r = d as Record<string, unknown>;
  return typeof r.anio === "number" && typeof r.mes === "number" && !!r.periodo && !!r.anterior;
}

// ── Meses ─────────────────────────────────────────────────────────────────────

export const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

export interface MesElegible {
  anio: number;
  mes: number;
}

export const nombreDelMes = (anio: number, mes: number) => `${MESES[mes - 1]} de ${anio}`;
export const conMayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t);

export function mesAnterior({ anio, mes }: MesElegible): MesElegible {
  return mes === 1 ? { anio: anio - 1, mes: 12 } : { anio, mes: mes - 1 };
}

export function mesSiguiente({ anio, mes }: MesElegible): MesElegible {
  return mes === 12 ? { anio: anio + 1, mes: 1 } : { anio, mes: mes + 1 };
}

const clave = (m: MesElegible) => m.anio * 12 + (m.mes - 1);

/** El mes que se abre si no se elige: el anterior, que es el que ya cerró. */
export function mesPorDefecto(hoy: Date = new Date()): MesElegible {
  return mesAnterior({ anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 });
}

export function mesActual(hoy: Date = new Date()): MesElegible {
  return { anio: hoy.getFullYear(), mes: hoy.getMonth() + 1 };
}

/** Del mes en curso para atrás, los que se pueden elegir (dos años). */
export function mesesElegibles(hoy: Date = new Date(), cuantos = 24): MesElegible[] {
  const salida: MesElegible[] = [];
  let m = mesActual(hoy);
  for (let i = 0; i < cuantos; i++) {
    salida.push(m);
    m = mesAnterior(m);
  }
  return salida;
}

export const esFuturo = (m: MesElegible, hoy: Date = new Date()) => clave(m) > clave(mesActual(hoy));
export const mismoMes = (a: MesElegible, b: MesElegible) => a.anio === b.anio && a.mes === b.mes;

/** El mes de la dirección (?anio=2026&mes=8), o el por defecto si falta o no sirve. */
export function mesDeLaDireccion(anio: string | null, mes: string | null, hoy: Date = new Date()): MesElegible {
  const a = Number(anio);
  const m = Number(mes);
  if (Number.isInteger(a) && Number.isInteger(m) && m >= 1 && m <= 12 && a >= 2020) {
    const pedido = { anio: a, mes: m };
    if (!esFuturo(pedido, hoy)) return pedido;
  }
  return mesPorDefecto(hoy);
}

export const rutaDelReporte = (m: MesElegible) => `/dashboard/reporte-mensual?anio=${m.anio}&mes=${m.mes}`;

// ── Formatos ──────────────────────────────────────────────────────────────────

const numero = (n: number, dec = 0) =>
  new Intl.NumberFormat("es-AR", { maximumFractionDigits: dec, minimumFractionDigits: 0 }).format(n);

/** Minutos a horas con dos decimales (para el Excel: se suman). */
export const horas = (min: number | null | undefined) =>
  min === null || min === undefined ? null : Math.round((min / 60) * 100) / 100;

export const fmtPct = (n: number | null | undefined, dec = 1) =>
  n === null || n === undefined ? "—" : `${numero(n, dec)} %`;

export function fmtDesvio(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n > 0 ? "+" : ""}${numero(n, 1)} %`;
}

export type TipoIndicador = "entero" | "decimal" | "horas" | "porcentaje";

export function fmtIndicador(valor: number | null | undefined, tipo: TipoIndicador): string {
  if (valor === null || valor === undefined) return "—";
  switch (tipo) {
    case "horas": return fmtMinutos(valor);
    case "porcentaje": return fmtPct(valor);
    case "decimal": return numero(valor, 1);
    default: return numero(valor);
  }
}

// ── Indicadores (las tarjetas de cada sección) ────────────────────────────────

export interface Indicador {
  titulo: string;
  actual: number | null;
  anterior: number | null;
  tipo: TipoIndicador;
  /** Qué es mejor: que suba, que baje, o ninguna de las dos (sólo se informa). */
  mejor: "sube" | "baja" | null;
  ayuda?: string;
}

export interface Variacion {
  texto: string;
  tono: "bien" | "mal" | "neutro";
  sentido: "sube" | "baja" | "igual";
}

/** «+3», «−2 h 10 min», «+5,2 pts»: lo que cambió contra el mes anterior. */
export function variacion(ind: Indicador): Variacion | null {
  if (ind.actual === null || ind.anterior === null) return null;
  const dif = Math.round((ind.actual - ind.anterior) * 10) / 10;
  if (dif === 0) return { texto: "igual", tono: "neutro", sentido: "igual" };
  const sentido = dif > 0 ? "sube" : "baja";
  const abs = Math.abs(dif);
  const cuanto = ind.tipo === "horas" ? fmtMinutos(abs) : ind.tipo === "porcentaje" ? `${numero(abs, 1)} pts` : numero(abs, 1);
  const tono = ind.mejor === null ? "neutro" : ind.mejor === sentido ? "bien" : "mal";
  return { texto: `${dif > 0 ? "+" : "−"}${cuanto}`, tono, sentido };
}

// ── Tablas: una definición para la pantalla, el PDF, el Excel y el CSV ─────────

export interface TablaReporte<T = any> {
  clave: string;
  titulo: string;
  /** El nombre de su hoja en el Excel: hasta 31 caracteres (lo que Excel admite). */
  hoja: string;
  filas: T[];
  /** Para el Excel y el CSV: números de verdad (horas con decimales, % en puntos). */
  columnas: ColumnaExport<T>[];
  /** Para la pantalla y el PDF: como se lee («2 h 10 min»). Sin esto, `columnas`. */
  lectura?: ColumnaExport<T>[];
  /** El renglón de totales (pantalla y PDF), con la forma de una fila. */
  total?: T;
  /** Cuántas filas se ven de entrada en la pantalla; el resto con «Ver todas». */
  primeras?: number;
  vacio: string;
  nota?: string;
}

export interface SeccionReporte {
  clave: "ordenes" | "produccion" | "personas" | "calidad" | "materiales" | "maquinas";
  titulo: string;
  descripcion: string;
  indicadores: Indicador[];
  tablas: TablaReporte[];
  /** La sección se ve pero no tiene datos que mostrar (RF-10, una tabla que falta). */
  sinDatos?: string;
}

const texto = (titulo: string, valor: (f: any) => unknown): ColumnaExport<any> => ({ titulo, valor });
const entero = (titulo: string, valor: (f: any) => unknown): ColumnaExport<any> => ({ titulo, tipo: "entero", valor });
const id = (titulo: string, valor: (f: any) => unknown): ColumnaExport<any> => ({ titulo, tipo: "id", valor });
const fecha = (titulo: string, valor: (f: any) => unknown): ColumnaExport<any> => ({ titulo, tipo: "fecha", valor });
const hs = (titulo: string, min: (f: any) => number | null | undefined): ColumnaExport<any> =>
  ({ titulo, tipo: "numero", decimales: 2, valor: (f) => horas(min(f)) });
/** Tipo «numero» sólo para alinear a la derecha: el valor es el texto que se lee. */
const hsLectura = (titulo: string, min: (f: any) => number | null | undefined): ColumnaExport<any> =>
  ({ titulo, tipo: "numero", valor: (f) => fmtMinutos(min(f)) });
const porc = (titulo: string, valor: (f: any) => number | null | undefined): ColumnaExport<any> =>
  ({ titulo, tipo: "porcentaje", decimales: 1, valor });
const desvioLectura = (titulo: string, valor: (f: any) => number | null | undefined): ColumnaExport<any> =>
  ({ titulo, tipo: "numero", valor: (f) => fmtDesvio(valor(f)) });

const ESTADO_ENTREGA = (f: OtEntregada) =>
  f.a_tiempo === null ? "Sin fecha prometida" : f.a_tiempo ? "A tiempo" : `${f.dias_atraso} ${f.dias_atraso === 1 ? "día" : "días"} tarde`;

function seccionOrdenes(o: Ordenes, r: ReporteMensual): SeccionReporte {
  const a = o.resumen;
  const b = o.anterior;
  const promedio = a.dias_atraso_promedio;
  const tablas: TablaReporte[] = [
    {
      clave: "entregadas",
      hoja: "OT entregadas",
      titulo: "Órdenes entregadas",
      filas: o.entregadas,
      columnas: [
        id("N° OT", (f) => f.numero), texto("Cliente", (f) => f.cliente), texto("Artículo", (f) => f.articulo),
        fecha("Prometida", (f) => f.fecha_prometida), fecha("Entregada", (f) => f.fecha_entrega),
        entero("Días de atraso", (f) => f.dias_atraso),
      ],
      lectura: [
        id("N° OT", (f) => f.numero), texto("Cliente", (f) => f.cliente), texto("Artículo", (f) => f.articulo),
        fecha("Prometida", (f) => f.fecha_prometida), fecha("Entregada", (f) => f.fecha_entrega),
        // En el renglón de totales, el resumen de cómo salieron.
        texto("Cómo salió", (f) => (f.resumen !== undefined ? f.resumen : ESTADO_ENTREGA(f))),
      ],
      total: {
        numero: null, cliente: `Total: ${a.entregadas} OT`, articulo: "", fecha_prometida: null,
        fecha_entrega: null, dias_atraso: null,
        resumen: `${a.a_tiempo} a tiempo · ${a.con_atraso} tarde${promedio !== null ? ` (${numero(promedio, 1)} días promedio)` : ""}`,
      },
      primeras: 10,
      vacio: "No se entregó ninguna OT en el mes.",
    },
    {
      clave: "atrasadas",
      hoja: "OT atrasadas al cierre",
      titulo: "Atrasadas al cierre del mes",
      filas: o.atrasadas,
      columnas: [
        id("N° OT", (f) => f.numero), texto("Cliente", (f) => f.cliente), texto("Artículo", (f) => f.articulo),
        fecha("Prometida", (f) => f.fecha_prometida), entero("Días de atraso", (f) => f.dias_atraso),
      ],
      total: { numero: null, cliente: `Total: ${a.atrasadas_al_cierre} OT`, articulo: "", fecha_prometida: null, dias_atraso: null },
      primeras: 10,
      vacio: "Ninguna OT abierta tenía la fecha prometida vencida al cierre.",
      nota: r.periodo.parcial
        ? "El mes no terminó: atrasadas hasta hoy (lo prometido para hoy todavía no cuenta)."
        : "Abiertas al terminar el mes con la fecha prometida vencida, también las que ya estaban en proceso.",
    },
  ];
  if (o.top_clientes) {
    tablas.push({
      clave: "clientes",
      hoja: "Clientes",
      titulo: "Clientes con más órdenes en el mes",
      filas: o.top_clientes,
      columnas: [texto("Cliente", (f) => f.cliente), entero("Ingresadas", (f) => f.ingresadas), entero("Entregadas", (f) => f.entregadas)],
      vacio: "No entró ni salió ninguna OT en el mes.",
    });
  }
  return {
    clave: "ordenes",
    titulo: "Órdenes",
    descripcion: "Lo que entró, lo que salió y si salió a tiempo.",
    indicadores: [
      { titulo: "Ingresadas", actual: a.ingresadas, anterior: b.ingresadas, tipo: "entero", mejor: null },
      { titulo: "Entregadas", actual: a.entregadas, anterior: b.entregadas, tipo: "entero", mejor: "sube" },
      {
        titulo: "Entregadas a tiempo", actual: a.pct_a_tiempo, anterior: b.pct_a_tiempo, tipo: "porcentaje", mejor: "sube",
        ayuda: `${a.a_tiempo} a tiempo, ${a.con_atraso} tarde${a.sin_fecha_prometida ? `, ${a.sin_fecha_prometida} sin fecha prometida` : ""}`,
      },
      {
        titulo: "Días de atraso promedio", actual: a.dias_atraso_promedio, anterior: b.dias_atraso_promedio, tipo: "decimal", mejor: "baja",
        ayuda: "de las que salieron tarde",
      },
      { titulo: "Abiertas al cierre", actual: a.abiertas_al_cierre, anterior: b.abiertas_al_cierre, tipo: "entero", mejor: null },
      { titulo: "Atrasadas al cierre", actual: a.atrasadas_al_cierre, anterior: b.atrasadas_al_cierre, tipo: "entero", mejor: "baja" },
    ],
    tablas,
  };
}

/** Lo que las horas NO cuentan, dicho: pasos abiertos de más y pasos sin datos. */
function ayudaHoras(a: ResumenProduccion): string {
  const sin: string[] = [];
  if (a.abiertos_de_mas?.pasos) {
    const n = a.abiertos_de_mas.pasos;
    sin.push(`sin ${fmtMinutos(a.abiertos_de_mas.minutos)} de ${n} ${n === 1 ? "paso abierto" : "pasos abiertos"} de más`);
  }
  if (a.sin_datos) sin.push(`${a.sin_datos} sin datos`);
  return sin.length ? `efectivas (${sin.join("; ")})` : "efectivas, en pasos de OT";
}

function seccionProduccion(p: Produccion): SeccionReporte {
  const a = p.resumen;
  const b = p.anterior;
  const columnasHoras = (primero: ColumnaExport<any>[], lectura: boolean): ColumnaExport<any>[] => [
    ...primero,
    lectura ? hsLectura("Horas en el mes", (f) => f.horas_min) : hs("Horas en el mes", (f) => f.horas_min),
    entero("Pasos terminados", (f) => f.pasos_terminados),
    // Sin pasos terminados con estimado no hay nada que comparar: «—», no «0 min».
    lectura ? hsLectura("Estimado", (f) => (f.comparados ? f.estimado_min : null)) : hs("Estimado (h)", (f) => (f.comparados ? f.estimado_min : null)),
    lectura ? hsLectura("Real", (f) => (f.comparados ? f.real_min : null)) : hs("Real (h)", (f) => (f.comparados ? f.real_min : null)),
    lectura ? desvioLectura("Desvío", (f) => f.desvio_pct) : porc("Desvío", (f) => f.desvio_pct),
  ];
  const tablas: TablaReporte[] = [
    {
      clave: "por_proceso",
      hoja: "Horas por proceso",
      titulo: "Horas por proceso",
      filas: p.por_proceso,
      columnas: columnasHoras([texto("Proceso", (f) => f.proceso)], false),
      lectura: columnasHoras([texto("Proceso", (f) => f.proceso)], true),
      total: { ...a, proceso: "Total" },
      vacio: "No se trabajó ningún paso en el mes.",
      nota: "Estimado y real son de los pasos terminados en el mes (el paso entero); las horas, lo trabajado adentro del mes.",
    },
    {
      clave: "top_ot",
      hoja: "OT con más horas",
      titulo: "Las OT con más horas",
      filas: p.top_ot,
      columnas: columnasHoras([id("N° OT", (f) => f.numero), texto("Artículo", (f) => f.articulo), texto("Cliente", (f) => f.cliente)], false),
      lectura: columnasHoras([id("N° OT", (f) => f.numero), texto("Artículo", (f) => f.articulo)], true),
      total: { ...a, numero: null, articulo: `Todas las OT del mes (${p.ots_trabajadas})`, cliente: "" },
      vacio: "Ninguna OT tuvo pasos trabajados en el mes.",
    },
  ];
  if (p.pausas && p.pausas.disponibles) {
    const pa = p.pausas;
    tablas.push({
      clave: "pausas",
      hoja: "Pausas",
      titulo: "Pausas y motivos",
      filas: pa.por_motivo,
      columnas: [texto("Motivo", (f) => f.texto), entero("Pausas", (f) => f.cantidad), entero("Empezaron en el mes", (f) => f.iniciadas), hs("Tiempo parado (h)", (f) => f.minutos)],
      lectura: [texto("Motivo", (f) => f.texto), entero("Pausas", (f) => f.cantidad), entero("Empezaron en el mes", (f) => f.iniciadas), hsLectura("Tiempo parado", (f) => f.minutos)],
      total: { texto: "Total", cantidad: pa.cantidad, iniciadas: pa.iniciadas, minutos: pa.minutos },
      vacio: "No hubo pausas en el mes.",
      nota: "Tiempo parado = lo que cayó adentro de la jornada del taller. Cada pausa por separado.",
    });
  }
  const indicadores: Indicador[] = [
    { titulo: "Horas trabajadas", actual: a.horas_min, anterior: b.horas_min, tipo: "horas", mejor: "sube", ayuda: ayudaHoras(a) },
    { titulo: "Pasos terminados", actual: a.pasos_terminados, anterior: b.pasos_terminados, tipo: "entero", mejor: "sube" },
    {
      // Sin «mejor»: el desvío tiene signo y lo bueno es acercarse a 0, no bajar (de −5 %
      // a −3 % es más preciso aunque «suba»). Se informa en tono neutro.
      titulo: "Desvío contra lo estimado", actual: a.desvio_pct, anterior: b.desvio_pct, tipo: "porcentaje", mejor: null,
      ayuda: a.comparados ? `${fmtMinutos(a.estimado_min)} estimadas, llevaron ${fmtMinutos(a.real_min)}` : "sin pasos terminados con estimado",
    },
  ];
  if (a.pausas_min !== null) {
    indicadores.push({ titulo: "Tiempo en pausa", actual: a.pausas_min, anterior: b.pausas_min, tipo: "horas", mejor: "baja", ayuda: `${a.pausas_cantidad ?? 0} pausas` });
  }
  return {
    clave: "produccion",
    titulo: "Producción",
    descripcion: "Horas de trabajo efectivo por proceso y por OT, y lo estimado contra lo que llevó.",
    indicadores,
    tablas,
  };
}

function seccionPersonas(pe: Personas): SeccionReporte {
  const a = pe.resumen;
  const b = pe.anterior;
  const conAusencias = pe.ausencias_visibles;
  const base = (lectura: boolean): ColumnaExport<any>[] => {
    const cols: ColumnaExport<any>[] = [
      texto("Persona", (f) => f.persona),
      lectura ? hsLectura("Horas trabajadas", (f) => f.horas_trabajadas_min) : hs("Horas trabajadas", (f) => f.horas_trabajadas_min),
      entero("Tareas completadas", (f) => f.tareas_completadas),
      lectura ? hsLectura("Promedio por tarea", (f) => f.tiempo_promedio_min) : hs("Promedio por tarea (h)", (f) => f.tiempo_promedio_min),
      lectura ? { titulo: "Eficiencia", tipo: "numero", valor: (f: any) => fmtPct(f.eficiencia_pct, 0) } : porc("Eficiencia", (f) => f.eficiencia_pct),
    ];
    if (conAusencias) {
      cols.push(entero("Días de ausencia", (f) => (f.ausencias ? f.ausencias.dias : null)));
      if (lectura) {
        cols.push(texto("Motivos", (f) => (f.ausencias?.por_motivo ?? []).map((m: any) => `${m.texto} ${m.dias}`).join(", ")));
      } else {
        cols.push(entero("Días laborables de ausencia", (f) => (f.ausencias ? f.ausencias.dias_laborables : null)));
      }
    }
    return cols;
  };
  const indicadores: Indicador[] = [
    { titulo: "Personas", actual: a.personas, anterior: b.personas, tipo: "entero", mejor: null, ayuda: "con trabajo o ausencias en el mes" },
    { titulo: "Horas trabajadas", actual: a.horas_trabajadas_min, anterior: b.horas_trabajadas_min, tipo: "horas", mejor: "sube", ayuda: "la suma de cada persona" },
    { titulo: "Tareas completadas", actual: a.tareas_completadas, anterior: b.tareas_completadas, tipo: "entero", mejor: "sube" },
    { titulo: "Eficiencia", actual: a.eficiencia_pct, anterior: b.eficiencia_pct, tipo: "porcentaje", mejor: "sube", ayuda: "estimado ÷ trabajado; 100 % = lo estimado" },
  ];
  if (conAusencias) {
    indicadores.push({ titulo: "Días de ausencia", actual: a.dias_ausencia, anterior: b.dias_ausencia, tipo: "entero", mejor: "baja", ayuda: `${a.dias_ausencia_laborables ?? 0} laborables` });
  }
  return {
    clave: "personas",
    titulo: "Personas",
    descripcion: "El rendimiento de cada persona en el mes: el mismo de su ficha.",
    indicadores,
    tablas: [{
      clave: "personas",
      hoja: "Personas",
      titulo: "Por persona",
      filas: pe.filas,
      columnas: base(false),
      lectura: base(true),
      total: {
        persona: "Total", horas_trabajadas_min: a.horas_trabajadas_min, tareas_completadas: a.tareas_completadas,
        tiempo_promedio_min: null, eficiencia_pct: a.eficiencia_pct,
        ausencias: conAusencias ? { dias: a.dias_ausencia ?? 0, dias_laborables: a.dias_ausencia_laborables ?? 0, por_motivo: [] } : null,
      },
      vacio: "Nadie tuvo pasos trabajados ni ausencias en el mes.",
      nota: "Cada paso se le cuenta a quien lo tiene elegido en la OT o, si no hay, a quien le dio el último plan.",
    }],
  };
}

function seccionCalidad(c: Calidad): SeccionReporte {
  const vacia: SeccionReporte = {
    clave: "calidad", titulo: "Calidad", descripcion: "No conformidades del mes.",
    indicadores: [], tablas: [], sinDatos: "No se pudieron leer las no conformidades.",
  };
  if (!c.disponible || !c.resumen) return vacia;
  const a = c.resumen;
  const b = c.anterior ?? null;
  // Un servidor sin RF-12 no manda de cuántas controladas: sin esa columna, como antes.
  const conRechazo = a.porcentaje_rechazo !== undefined;
  const grupo = (clave: string, titulo: string, primera: string, filas: GrupoCalidad[] | undefined): TablaReporte => ({
    clave,
    titulo,
    hoja: `No conformidades ${titulo.toLowerCase()}`,
    filas: filas ?? [],
    columnas: [
      texto(primera, (f) => f.texto), entero("No conformidades", (f) => f.cantidad), entero("Piezas rechazadas", (f) => f.piezas),
      ...(conRechazo ? [porc("% de rechazo", (f) => f.porcentaje_rechazo ?? null)] : []),
      entero("Minutos perdidos", (f) => f.minutos),
    ],
    total: { texto: "Total", cantidad: a.total, piezas: a.piezas_afectadas, porcentaje_rechazo: a.porcentaje_rechazo ?? null, minutos: a.minutos_perdidos },
    vacio: "No hubo no conformidades en el mes.",
  });
  // RF-12: el agrupado por persona sólo viene con la sección «Rendimiento por persona».
  const porPersona = c.por_persona ? [grupo("por_persona", "Por persona", "Persona", c.por_persona)] : [];
  return {
    clave: "calidad",
    titulo: "Calidad",
    descripcion: c.por_persona ? "No conformidades registradas en el mes, por tipo y por persona." : "No conformidades registradas en el mes, por tipo y por gravedad.",
    indicadores: [
      { titulo: "No conformidades", actual: a.total, anterior: b?.total ?? null, tipo: "entero", mejor: "baja", ayuda: `${a.abiertas} ${a.abiertas === 1 ? "abierta" : "abiertas"}, ${a.cerradas} ${a.cerradas === 1 ? "cerrada" : "cerradas"}` },
      {
        titulo: "Piezas rechazadas", actual: a.piezas_afectadas, anterior: b?.piezas_afectadas ?? null, tipo: "entero", mejor: "baja",
        ...(conRechazo && a.piezas_controladas ? { ayuda: `de ${numero(a.piezas_controladas)} controladas` } : {}),
      },
      ...(conRechazo ? [{
        titulo: "% de rechazo", actual: a.porcentaje_rechazo ?? null, anterior: b?.porcentaje_rechazo ?? null, tipo: "porcentaje" as const, mejor: "baja" as const,
        ayuda: a.porcentaje_rechazo === null ? "ninguna dijo de cuántas piezas controladas" : "sólo de las que dicen de cuántas controladas",
      }] : []),
      { titulo: "Minutos perdidos", actual: a.minutos_perdidos, anterior: b?.minutos_perdidos ?? null, tipo: "entero", mejor: "baja" },
    ],
    tablas: [
      grupo("por_tipo", "Por tipo", "Tipo", c.por_tipo),
      ...porPersona,
      grupo("por_gravedad", "Por gravedad", "Gravedad", c.por_gravedad),
      {
        clave: "no_conformidades",
      hoja: "No conformidades",
        titulo: "No conformidades del mes",
        filas: c.lista ?? [],
        columnas: [
          id("N° OT", (f) => f.numero), { titulo: "Fecha", tipo: "fechaHora", valor: (f: any) => f.fecha },
          texto("Tipo", (f) => f.tipo), texto("Gravedad", (f) => f.gravedad), texto("Estado", (f) => f.estado),
          entero("Piezas rechazadas", (f) => f.piezas_afectadas), entero("Piezas controladas", (f) => f.piezas_controladas ?? null),
          entero("Minutos perdidos", (f) => f.minutos_perdidos),
          entero("Paso", (f) => f.paso ?? null), texto("Proceso", (f) => f.proceso ?? ""), texto("Las hizo", (f) => f.persona ?? ""), texto("Qué pasó", (f) => f.descripcion ?? ""),
        ],
        lectura: [
          id("N° OT", (f) => f.numero), fecha("Fecha", (f) => f.fecha), texto("Tipo", (f) => f.tipo),
          texto("Gravedad", (f) => f.gravedad), texto("Estado", (f) => f.estado),
          texto("Rechazadas", (f) => (f.piezas_afectadas === null ? "—" : f.piezas_controladas ? `${numero(f.piezas_afectadas)} de ${numero(f.piezas_controladas)}` : numero(f.piezas_afectadas))),
          texto("Las hizo", (f) => f.persona ?? "—"),
        ],
        primeras: 10,
        vacio: "No hubo no conformidades en el mes.",
      },
    ],
  };
}

function seccionMateriales(m: Materiales): SeccionReporte {
  if (!m.disponible || !m.resumen) {
    return {
      clave: "materiales", titulo: "Materiales", descripcion: "Consumo de materiales del mes.",
      indicadores: [], tablas: [], sinDatos: "No se pudieron leer los consumos de materiales.",
    };
  }
  const a = m.resumen;
  const b = m.anterior ?? null;
  const cantidad: ColumnaExport<any> = { titulo: "Cantidad", tipo: "numero", decimales: 3, valor: (f) => f.cantidad };
  return {
    clave: "materiales",
    titulo: "Materiales",
    descripcion: "Lo que se consumió en las OT del mes (sin las cargas anuladas).",
    indicadores: [
      { titulo: "Cargas de consumo", actual: a.cargas, anterior: b?.cargas ?? null, tipo: "entero", mejor: null },
      { titulo: "Materiales distintos", actual: a.materiales, anterior: b?.materiales ?? null, tipo: "entero", mejor: null },
      { titulo: "OT con consumo", actual: a.ordenes, anterior: b?.ordenes ?? null, tipo: "entero", mejor: null },
    ],
    tablas: [
      {
        clave: "por_material",
      hoja: "Consumo por material",
        titulo: "Por material",
        filas: m.por_material ?? [],
        columnas: [texto("Código", (f) => f.cod_pieza ?? ""), texto("Material", (f) => f.descripcion), texto("Unidad", (f) => f.unidad ?? ""), cantidad, entero("Cargas", (f) => f.cargas), entero("OT", (f) => f.ordenes)],
        total: { cod_pieza: "Total", descripcion: "", unidad: "", cantidad: null, cargas: a.cargas, ordenes: a.ordenes },
        vacio: "No se cargó ningún consumo en el mes.",
        nota: "Las cantidades de unidades distintas no se suman.",
      },
      {
        clave: "por_ot",
      hoja: "Consumo por OT",
        titulo: "Por OT",
        filas: m.por_ot ?? [],
        columnas: [id("N° OT", (f) => f.numero), texto("Artículo", (f) => f.articulo), texto("Material", (f) => f.descripcion), texto("Unidad", (f) => f.unidad ?? ""), cantidad, entero("Cargas", (f) => f.cargas)],
        primeras: 10,
        vacio: "No se cargó ningún consumo en el mes.",
      },
    ],
  };
}

function seccionMaquinas(mq: Maquinas): SeccionReporte {
  const base: SeccionReporte = {
    clave: "maquinas",
    titulo: "Máquinas",
    descripcion: "Horas de uso de cada máquina y mantenimientos hechos en el mes.",
    indicadores: [],
    tablas: [],
  };
  if (!mq.disponible || !mq.resumen) {
    return { ...base, sinDatos: mq.texto || "Todavía no se registran las horas de uso de cada máquina." };
  }
  // RF-10: las horas efectivas de uso_maquina y los mantenimientos registrados en el mes.
  const conMantenimiento = mq.resumen.mantenimientos !== undefined;
  const mantenimientos = mq.mantenimientos ?? [];
  const indicadores: Indicador[] = [
    { titulo: "Máquinas con uso", actual: mq.resumen.maquinas, anterior: mq.anterior?.maquinas ?? null, tipo: "entero", mejor: null },
    { titulo: "Horas de uso", actual: mq.resumen.horas_min, anterior: mq.anterior?.horas_min ?? null, tipo: "horas", mejor: null, ayuda: "efectivas: dentro de la jornada y sin pausas" },
  ];
  if (conMantenimiento) {
    const avisos = mq.resumen.avisos ?? 0;
    indicadores.push({
      titulo: "Mantenimientos hechos", actual: mq.resumen.mantenimientos ?? 0, anterior: mq.anterior?.mantenimientos ?? null, tipo: "entero", mejor: null,
      ...(avisos ? { ayuda: `${avisos} ${avisos === 1 ? "aviso de mantenimiento salió" : "avisos de mantenimiento salieron"} en el mes` } : {}),
    });
  }
  const tablaMantenimientos: TablaReporte[] = conMantenimiento ? [{
    clave: "mantenimientos",
    hoja: "Mantenimientos",
    titulo: "Mantenimientos hechos",
    filas: mantenimientos,
    columnas: [fecha("Fecha", (f) => f.fecha), texto("Máquina", (f) => f.maquina), texto("Lo hizo", (f) => f.hecho_por ?? ""), texto("Nota", (f) => f.nota ?? "")],
    lectura: [fecha("Fecha", (f) => f.fecha), texto("Máquina", (f) => f.maquina), texto("Lo hizo", (f) => f.hecho_por ?? "—"), texto("Nota", (f) => f.nota ?? "")],
    vacio: "No se registró ningún mantenimiento en el mes.",
  }] : [];
  return {
    ...base,
    indicadores,
    tablas: [{
      clave: "maquinas",
      hoja: "Máquinas",
      titulo: "Por máquina",
      filas: mq.filas,
      columnas: [
        texto("Máquina", (f) => f.maquina), hs("Horas de uso", (f) => f.horas_min), entero("Tareas", (f) => f.tareas), hs("Horas del mes anterior", (f) => f.horas_min_anterior),
        ...(conMantenimiento ? [entero("Mantenimientos", (f) => f.mantenimientos ?? 0)] : []),
      ],
      lectura: [texto("Máquina", (f) => f.maquina), hsLectura("Horas de uso", (f) => f.horas_min), entero("Tareas", (f) => f.tareas), hsLectura("Mes anterior", (f) => f.horas_min_anterior)],
      total: { maquina: "Total", horas_min: mq.resumen.horas_min, tareas: null, horas_min_anterior: mq.anterior?.horas_min ?? null },
      vacio: "Ninguna máquina registró uso en el mes.",
      nota: "Tareas = pasos que sumaron horas. No suman lo arrancado con la máquina fuera de servicio, lo que volvió a Pendiente ni lo que quedó abierto sin cierre.",
    }, ...tablaMantenimientos],
  };
}

/** Las secciones que se ven, en orden. Las que vinieron en null no están. */
export function seccionesDelReporte(r: ReporteMensual): SeccionReporte[] {
  const salida: SeccionReporte[] = [];
  if (r.ordenes) salida.push(seccionOrdenes(r.ordenes, r));
  if (r.produccion) salida.push(seccionProduccion(r.produccion));
  if (r.personas) salida.push(seccionPersonas(r.personas));
  if (r.calidad) salida.push(seccionCalidad(r.calidad));
  if (r.materiales) salida.push(seccionMateriales(r.materiales));
  if (r.maquinas) salida.push(seccionMaquinas(r.maquinas));
  return salida;
}

// ── Exportar (RF-22) ──────────────────────────────────────────────────────────

interface FilaResumen {
  seccion: string;
  indicador: string;
  actual: number | null;
  anterior: number | null;
  unidad: string;
}

const UNIDAD: Record<TipoIndicador, string> = { entero: "", decimal: "", horas: "horas", porcentaje: "%" };

/** Un indicador como número para el Excel: las horas en horas, el resto tal cual. */
const comoNumero = (v: number | null, tipo: TipoIndicador) => (v === null ? null : tipo === "horas" ? horas(v) : v);

/** La hoja «Resumen»: cada indicador, este mes, el anterior y la diferencia, como números. */
export function tablaResumen(r: ReporteMensual, secciones = seccionesDelReporte(r)): SeccionExport<FilaResumen> {
  const filas: FilaResumen[] = [];
  secciones.forEach((s) => s.indicadores.forEach((i) => filas.push({
    seccion: s.titulo,
    indicador: i.titulo,
    actual: comoNumero(i.actual, i.tipo),
    anterior: comoNumero(i.anterior, i.tipo),
    unidad: UNIDAD[i.tipo],
  })));
  return {
    titulo: "Resumen",
    filas,
    columnas: [
      { titulo: "Sección", valor: (f) => f.seccion },
      { titulo: "Indicador", valor: (f) => f.indicador },
      { titulo: conMayuscula(r.titulo), tipo: "numero", valor: (f) => f.actual },
      { titulo: conMayuscula(r.anterior.titulo), tipo: "numero", valor: (f) => f.anterior },
      {
        titulo: "Diferencia", tipo: "numero", decimales: 2,
        valor: (f) => (f.actual === null || f.anterior === null ? null : Math.round((f.actual - f.anterior) * 100) / 100),
      },
      { titulo: "Unidad", valor: (f) => f.unidad },
    ],
  };
}

/** Las tablas de una sección, para el Excel o el CSV (una hoja por tabla). */
export function tablasParaArchivo(s: SeccionReporte): SeccionExport[] {
  return s.tablas.map((t) => ({
    titulo: t.hoja,
    filas: t.filas,
    columnas: t.columnas,
  }));
}

/** Todo el reporte: la hoja de resumen y una por tabla. */
export function tablasDelReporte(r: ReporteMensual): SeccionExport[] {
  const secciones = seccionesDelReporte(r);
  return [tablaResumen(r, secciones), ...secciones.flatMap(tablasParaArchivo)];
}

/** Lo que dice el encabezado de los archivos (en vez de «filtros»). */
export function datosDelArchivo(r: ReporteMensual): string[] {
  const partes = [`Mes: ${r.titulo}${r.periodo.parcial ? " (en curso, hasta hoy)" : ""}`, `Comparado con: ${r.anterior.titulo}`];
  return partes;
}

export const archivoDelReporte = (r: ReporteMensual) => `reporte_mensual_${r.anio}-${String(r.mes).padStart(2, "0")}`;
