"use client";

/**
 * La solapa «Rendimiento» de la ficha de la persona (RF-07): su reporte de un período,
 * exportable a PDF, Excel y CSV.
 *
 * Tarjetas: tareas completadas, tiempo promedio por tarea, eficiencia (con cómo leerla),
 * horas trabajadas, días de ausencia y pausas; abajo, la tabla de tareas. Todo sale de
 * GET /operarios/{id}/rendimiento, que usa los tiempos EFECTIVOS de RF-06: la pantalla
 * no cuenta nada, sólo muestra (lib/rendimiento.ts). Y los archivos salen de esa misma
 * respuesta, así que dicen lo mismo que la pantalla.
 *
 * TRES REGLAS
 *
 *  · Es la sección confidencial «Rendimiento por persona», la misma del cuadro del
 *    Dashboard: sin ella la solapa ni aparece y ni se pide (un 403 al abrir cada ficha
 *    sería un aviso de «no tenés permiso» de más).
 *  · Con un backend de antes (sin la ruta) tampoco aparece: la ficha queda como estaba.
 *  · Cambiar el período no tapa nada: lo anterior queda a la vista con un «actualizando…»
 *    hasta que llega lo nuevo. Si en la ficha se marca un paso o se cambia el Activo /
 *    Ausente, se vuelve a pedir en silencio.
 *
 * Si todavía no hay pasos marcados en SPMM, lo dice y explica por qué: no es un error.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CalendarOff,
  CheckCircle2,
  Clock,
  Gauge,
  Info,
  PauseCircle,
  Timer,
  TriangleAlert,
} from "lucide-react";

import { ExportarMenu } from "@/components/common/ExportarMenu";
import { Button } from "@/components/ui/button";
import { API_URL } from "@/config";
import { type EstadoSeccion, fechaCorta, fmtMinutos, momentoCorto, sinDatosLargo } from "@/lib/asistencia";
import {
  COMO_SE_LEE_EFICIENCIA,
  PERIODOS_RENDIMIENTO,
  type PeriodoRendimiento,
  type RendimientoOperario as DatosRendimiento,
  type TareaRendimiento,
  avisos,
  detalleAusencias,
  detalleCompletadas,
  detalleEficiencia,
  detalleHoras,
  detallePausas,
  detallePromedio,
  estadoEnElPeriodo,
  filtrosDeExportacion,
  fmtPct,
  notasFijas,
  problemaDelRango,
  rangoRendimiento,
  seccionesDeExportacion,
  textoDelPeriodo,
} from "@/lib/rendimiento";
import { cn } from "@/lib/utils";
import { MarcasDeTarea } from "./MarcasDeTarea";

const cabeceras = (): HeadersInit => {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * El reporte de una persona en un período. `version` sube cuando algo de la ficha pudo
 * cambiarlo (el estado de un paso, el Activo / Ausente): se vuelve a pedir en silencio.
 * `habilitado` = tiene la sección «Rendimiento por persona»; si no, ni se pide.
 */
export function useRendimiento(idOperario: number | undefined, periodo: PeriodoRendimiento,
                               version: number, habilitado: boolean) {
  const [datos, setDatos] = useState<DatosRendimiento | null>(null);
  const [estado, setEstado] = useState<EstadoSeccion>(habilitado ? "cargando" : "no");
  const [actualizando, setActualizando] = useState(false);
  const pedido = useRef(0);
  // Las dos puntas, como texto: son las que deciden si hay que volver a pedir.
  const { desde, hasta } = rangoRendimiento(periodo);

  const pedir = useCallback(async (silencioso: boolean) => {
    if (!idOperario || !habilitado) return;
    const este = ++pedido.current;
    if (!silencioso) setActualizando(true);
    try {
      const res = await fetch(
        `${API_URL}/operarios/${idOperario}/rendimiento?desde=${desde}&hasta=${hasta}`,
        { headers: cabeceras() },
      );
      if (este !== pedido.current) return;
      // 404/405: backend de antes de RF-07. 401/403: sin sesión o sin la sección.
      if ([401, 403, 404, 405].includes(res.status)) {
        setEstado("no");
        return;
      }
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (este !== pedido.current) return;
      if (!body?.status || !body.data || !Array.isArray(body.data.tareas) || !body.data.resumen) {
        setEstado((e) => (e === "si" ? e : "error"));
        return;
      }
      setDatos(body.data as DatosRendimiento);
      setEstado("si");
    } catch {
      if (este === pedido.current) setEstado((e) => (e === "si" ? e : "error"));
    } finally {
      if (este === pedido.current) setActualizando(false);
    }
  }, [idOperario, habilitado, desde, hasta]);

  // Otra persona (o sin permiso): de cero.
  useEffect(() => {
    setDatos(null);
    setEstado(habilitado ? "cargando" : "no");
  }, [idOperario, habilitado]);

  useEffect(() => {
    void pedir(false);
  }, [pedir]);

  const primeraVersion = useRef(version);
  useEffect(() => {
    if (version !== primeraVersion.current) void pedir(true);
  }, [version, pedir]);

  return { datos, estado, actualizando };
}

type Rendimiento = ReturnType<typeof useRendimiento>;

// ─────────────────────────── el período ───────────────────────────

function SelectorPeriodo({ periodo, desdeActual, hastaActual, onCambiar, actualizando }: {
  periodo: PeriodoRendimiento;
  /** Lo que se está mirando: el rango a mano arranca de acá, sin saltar. */
  desdeActual?: string;
  hastaActual?: string;
  onCambiar: (p: PeriodoRendimiento) => void;
  actualizando: boolean;
}) {
  // Lo tipeado del rango a mano: se aplica recién cuando las dos fechas están bien.
  const [desde, setDesde] = useState(periodo.desde ?? desdeActual ?? "");
  const [hasta, setHasta] = useState(periodo.hasta ?? hastaActual ?? "");
  const problema = periodo.clave === "rango" ? problemaDelRango(desde, hasta) : null;

  const aplicar = (d: string, h: string) => {
    setDesde(d);
    setHasta(h);
    if (!problemaDelRango(d, h)) onCambiar({ clave: "rango", desde: d, hasta: h });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={periodo.clave}
        onChange={(e) => {
          const c = e.target.value as PeriodoRendimiento["clave"];
          if (c === "rango") {
            const d = desdeActual ?? desde;
            const h = hastaActual ?? hasta;
            setDesde(d);
            setHasta(h);
            onCambiar({ clave: "rango", desde: d, hasta: h });
          } else {
            onCambiar({ clave: c });
          }
        }}
        aria-label="Período"
        className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {PERIODOS_RENDIMIENTO.map((p) => <option key={p.clave} value={p.clave}>{p.texto}</option>)}
      </select>
      {periodo.clave === "rango" && (
        <span className="flex items-center gap-1.5">
          <input
            type="date"
            value={desde}
            max={hasta || undefined}
            onChange={(e) => aplicar(e.target.value, hasta)}
            aria-label="Desde"
            className="h-8 w-[132px] rounded-md border border-gray-200 bg-white px-2 text-xs"
          />
          <span className="text-[11px] text-gray-400">al</span>
          <input
            type="date"
            value={hasta}
            min={desde || undefined}
            onChange={(e) => aplicar(desde, e.target.value)}
            aria-label="Hasta"
            className="h-8 w-[132px] rounded-md border border-gray-200 bg-white px-2 text-xs"
          />
        </span>
      )}
      {problema && <span className="text-[11px] text-red-600">{problema}</span>}
      {actualizando && !problema && <span className="text-[11px] text-gray-400">actualizando…</span>}
    </div>
  );
}

// ─────────────────────────── las tarjetas ───────────────────────────

function Tarjeta({ icono: Icono, titulo, valor, detalle, tono, ayuda }: {
  icono: typeof Clock;
  titulo: string;
  valor: string;
  detalle: string;
  tono?: "verde" | "ambar" | "azul";
  /** Lo que explica el número, al pasar el mouse. */
  ayuda?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-gray-100 bg-gray-50 p-2.5 sm:p-3" title={ayuda}>
      {/* El título se parte en dos renglones antes que cortarse: en el teléfono la
          tarjeta mide 150 px y «TAREAS COMPLET…» no dice qué es. */}
      <p className="flex items-start gap-1 text-[10px] sm:text-[11px] font-semibold uppercase leading-tight tracking-wide text-gray-500">
        <Icono className="hidden sm:block h-3 w-3 shrink-0 mt-px" /> <span>{titulo}</span>
      </p>
      <p className={cn(
        "mt-0.5 text-base sm:text-xl font-bold tabular-nums",
        tono === "verde" ? "text-emerald-700" : tono === "ambar" ? "text-amber-700" : tono === "azul" ? "text-blue-700" : "text-gray-800",
      )}>
        {valor}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-gray-500">{detalle}</p>
    </div>
  );
}

// ─────────────────────────── la tabla ───────────────────────────

const TONO_ESTADO = {
  verde: "bg-green-100 text-green-800",
  azul: "bg-blue-100 text-blue-700",
  ambar: "bg-amber-100 text-amber-800",
  gris: "bg-gray-100 text-gray-600",
} as const;

function Estado({ t }: { t: TareaRendimiento }) {
  const e = estadoEnElPeriodo(t);
  return (
    <span title={e.ayuda || undefined} className={cn("rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap", TONO_ESTADO[e.tono])}>
      {e.texto}
    </span>
  );
}

function Eficiencia({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400">—</span>;
  const clase = pct > 110 ? "text-emerald-700" : pct < 90 ? "text-amber-700" : "text-gray-700";
  return <span className={cn("font-semibold tabular-nums", clase)}>{pct} %</span>;
}

function cuando(t: TareaRendimiento): string {
  return `${momentoCorto(t.inicio_real)}${t.fin_real ? ` → ${momentoCorto(t.fin_real)}` : t.en_curso ? " → sigue" : ""}`;
}

function desglose(t: TareaRendimiento): string {
  if (t.sin_datos) return sinDatosLargo(t);
  const partes = [`Corrido ${fmtMinutos(t.corrido_min)} = efectivo ${fmtMinutos(t.efectivo_min)}`];
  if (t.pausa_min) partes.push(`+ en pausa ${fmtMinutos(t.pausa_min)}`);
  if (t.fuera_de_jornada_min) partes.push(`+ fuera de jornada ${fmtMinutos(t.fuera_de_jornada_min)}`);
  if (t.cerrado_min) partes.push(`+ terminado antes de reabrirlo ${fmtMinutos(t.cerrado_min)}`);
  if (t.efectivo_en_periodo_min !== null && t.efectivo_en_periodo_min !== t.efectivo_min) {
    partes.push(`· adentro del período: ${fmtMinutos(t.efectivo_en_periodo_min)}`);
  }
  if (t.origen === "plan") partes.push("· se la cuenta el último plan");
  return partes.join(" ");
}

function TablaTareas({ tareas, topeJornadas }: { tareas: TareaRendimiento[]; topeJornadas?: number }) {
  return (
    <>
      {/* Hasta xl, un renglón por tarea (como la solapa Tiempos): la columna derecha de
          la ficha no tiene ancho para siete columnas y una tabla con scroll de costado
          esconde justo la eficiencia. */}
      <ul className="xl:hidden divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white px-3">
        {tareas.map((t) => (
          <li key={t.id_otp} className="py-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3" title={desglose(t)}>
            <div className="min-w-0 space-y-0.5 text-xs">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="font-mono font-bold text-slate-700">OT {t.numero_ot}</span>
                <span className="min-w-0 truncate font-medium text-gray-900">
                  {t.paso != null ? `${t.paso}. ` : ""}{t.proceso || "Proceso"}
                </span>
                <Estado t={t} />
                <MarcasDeTarea reabierto={t.reabierto} cerradoMin={t.cerrado_min} abiertoDeMas={t.abierto_de_mas} topeJornadas={topeJornadas} />
                {t.origen === "plan" && <span className="text-[10px] text-gray-400">según el plan</span>}
              </p>
              <p className="truncate text-[11px] text-gray-500">
                <span className="tabular-nums">{cuando(t)}</span>
                {t.articulo ? ` · ${t.articulo}` : ""}
              </p>
            </div>
            <div className="grid shrink-0 grid-cols-3 gap-3 text-xs sm:w-[250px] sm:text-right">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Estimado</p>
                <p className="tabular-nums text-gray-700">{fmtMinutos(t.estimado_min)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Efectivo</p>
                <p className="tabular-nums font-semibold text-slate-900">{t.sin_datos ? "—" : fmtMinutos(t.efectivo_min)}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Eficiencia</p>
                <Eficiencia pct={t.eficiencia_pct} />
              </div>
            </div>
          </li>
        ))}
      </ul>

      {/* Pantalla ancha: la tabla. */}
      <div className="hidden xl:block overflow-x-auto rounded-lg border border-gray-100">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-2.5 py-2 text-left">OT</th>
              <th className="px-2.5 py-2 text-left">Paso</th>
              <th className="px-2.5 py-2 text-left">Inicio → fin</th>
              <th className="px-2.5 py-2 text-left">Estado</th>
              <th className="px-2.5 py-2 text-right">Estimado</th>
              <th className="px-2.5 py-2 text-right">Efectivo</th>
              <th className="px-2.5 py-2 text-right">Eficiencia</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {tareas.map((t) => (
              <tr key={t.id_otp} className="hover:bg-gray-50/60" title={desglose(t)}>
                <td className="px-2.5 py-1.5 font-mono font-bold text-slate-700 whitespace-nowrap">{t.numero_ot}</td>
                <td className="px-2.5 py-1.5 max-w-[220px]">
                  <p className="truncate font-medium text-gray-900">
                    {t.paso != null ? `${t.paso}. ` : ""}{t.proceso || "Proceso"}
                    {t.origen === "plan" && <span className="ml-1.5 text-[10px] font-normal text-gray-400">según el plan</span>}
                  </p>
                  {t.articulo && <p className="truncate text-[11px] text-gray-500">{t.articulo}</p>}
                </td>
                <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums text-[11px] text-gray-600">
                  <p>{momentoCorto(t.inicio_real)}</p>
                  <p className="text-gray-400">
                    {t.fin_real ? `→ ${momentoCorto(t.fin_real)}` : t.en_curso ? "→ sigue" : "→ sin fin"}
                  </p>
                </td>
                <td className="px-2.5 py-1.5">
                  <span className="flex flex-wrap items-center gap-1">
                    <Estado t={t} />
                    <MarcasDeTarea reabierto={t.reabierto} cerradoMin={t.cerrado_min} abiertoDeMas={t.abierto_de_mas} topeJornadas={topeJornadas} />
                  </span>
                </td>
                <td className="px-2.5 py-1.5 text-right tabular-nums text-gray-600 whitespace-nowrap">{fmtMinutos(t.estimado_min)}</td>
                <td className="px-2.5 py-1.5 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                  {t.sin_datos ? "—" : fmtMinutos(t.efectivo_min)}
                </td>
                <td className="px-2.5 py-1.5 text-right whitespace-nowrap"><Eficiencia pct={t.eficiencia_pct} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─────────────────────────── la solapa ───────────────────────────

function Vacio({ datos, periodo, onPeriodo }: {
  datos: DatosRendimiento; periodo: PeriodoRendimiento; onPeriodo: (p: PeriodoRendimiento) => void;
}) {
  const nunca = datos.historial.pasos === 0;
  const a = datos.resumen.ausencias;
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-gray-200 bg-gray-50/50 px-4 py-8 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <Gauge className="h-6 w-6 text-gray-400" />
      </div>
      {nunca ? (
        <>
          <p className="text-sm font-medium text-gray-700">Todavía no hay avance marcado en SPMM para esta persona</p>
          <p className="mt-1 max-w-md text-xs text-gray-500">
            El rendimiento se arma solo con el avance que se marca en SPMM: cuando un paso de una OT
            se pone <b>En proceso</b> y después <b>Terminado</b>, queda cuánto tardó. Mientras el
            avance se siga anotando en el sistema viejo o en papel, acá no hay nada que medir.
            No es un error: el reporte no crea el dato, lo muestra.
          </p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-700">Ningún paso trabajado en este período</p>
          <p className="mt-1 max-w-md text-xs text-gray-500">
            {datos.historial.ultimo_arranque
              ? <>El último paso que se le marcó arrancó el {fechaCorta(datos.historial.ultimo_arranque)}.</>
              : null}{" "}
            Probá con un período más largo.
          </p>
          {periodo.clave !== "90d" && (
            <Button type="button" variant="outline" size="sm" className="mt-3 h-7 text-xs" onClick={() => onPeriodo({ clave: "90d" })}>
              Ver los últimos 90 días
            </Button>
          )}
        </>
      )}
      {a && a.dias > 0 && (
        <p className="mt-3 text-[11px] text-gray-500">
          Días de ausencia en el período: <b>{a.dias}</b> ({detalleAusencias(datos.resumen)}).
        </p>
      )}
    </div>
  );
}

export default function RendimientoOperario({ rendimiento, periodo, onPeriodo, nombre }: {
  rendimiento: Rendimiento;
  periodo: PeriodoRendimiento;
  onPeriodo: (p: PeriodoRendimiento) => void;
  /** «Juan Pérez», como se muestra en la ficha: para el título de los archivos. */
  nombre: string;
}) {
  const { datos, estado, actualizando } = rendimiento;

  if (estado === "cargando" && !datos) {
    return <p className="px-4 py-6 text-xs text-gray-400">Armando el reporte…</p>;
  }
  if (estado === "error" && !datos) {
    return (
      <p className="m-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        No se pudo armar el reporte. Probá de nuevo en un rato.
      </p>
    );
  }
  if (!datos) return null;

  const r = datos.resumen;
  const vacio = r.tareas_trabajadas === 0;
  const textoPeriodo = textoDelPeriodo(periodo, datos.periodo.desde, datos.periodo.hasta);
  const titulo = `Rendimiento · ${nombre}`;
  const archivo = `rendimiento_${nombre}`;
  const nivel = r.eficiencia.nivel;
  const lista = avisos(datos);

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <SelectorPeriodo
            key={periodo.clave}
            periodo={periodo}
            desdeActual={datos.periodo.desde}
            hastaActual={datos.periodo.hasta}
            onCambiar={onPeriodo}
            actualizando={actualizando}
          />
          <p className="text-[11px] text-gray-400">{textoPeriodo}</p>
        </div>
        {/* RF-22: el mismo botón de toda la app. Excel con hoja de resumen y hoja de
            tareas; el PDF con el diseño de siempre y las tarjetas. */}
        <ExportarMenu
          titulo={titulo}
          archivo={archivo}
          secciones={() => seccionesDeExportacion(datos)}
          filtros={() => filtrosDeExportacion(textoPeriodo)}
          rotulo={`Exportar el reporte · ${textoPeriodo}`}
          pdf={async () => {
            const { construirPdfRendimiento } = await import("@/lib/exportes/rendimientoPdf");
            return construirPdfRendimiento(datos, { titulo, textoPeriodo });
          }}
          disabled={actualizando}
        />
      </div>

      {vacio ? (
        <Vacio datos={datos} periodo={periodo} onPeriodo={onPeriodo} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tarjeta
              icono={CheckCircle2}
              titulo="Tareas completadas"
              valor={String(r.tareas_completadas)}
              detalle={detalleCompletadas(r)}
              ayuda="Pasos terminados con el fin adentro del período"
            />
            <Tarjeta
              icono={Timer}
              titulo="Promedio por tarea"
              valor={fmtMinutos(r.tiempo_promedio_min)}
              detalle={detallePromedio(r)}
              ayuda="El tiempo efectivo promedio de las tareas completadas (el de la tarea entera)"
            />
            <Tarjeta
              icono={Gauge}
              titulo="Eficiencia"
              valor={fmtPct(r.eficiencia.pct)}
              detalle={detalleEficiencia(r)}
              tono={nivel === "rapido" ? "verde" : nivel === "lento" ? "ambar" : undefined}
              ayuda={COMO_SE_LEE_EFICIENCIA}
            />
            <Tarjeta
              icono={Clock}
              titulo="Horas trabajadas"
              valor={fmtMinutos(r.horas_trabajadas_min)}
              detalle={detalleHoras(r)}
              tono="azul"
              ayuda="El tiempo efectivo que cae adentro del período, de todos los pasos que trabajó"
            />
            <Tarjeta
              icono={CalendarOff}
              titulo="Días de ausencia"
              valor={r.ausencias ? String(r.ausencias.dias) : "—"}
              detalle={detalleAusencias(r)}
              ayuda="Los de su solapa Asistencia, adentro del período"
            />
            <Tarjeta
              icono={PauseCircle}
              titulo="Pausas"
              valor={datos.pausas_disponibles ? fmtMinutos(r.pausas.minutos) : "—"}
              detalle={detallePausas(r, datos.pausas_disponibles)}
              ayuda="Lo que sus pasos estuvieron pausados adentro de la jornada, en el período"
            />
          </div>

          {/* La eficiencia en castellano: el porcentaje solo no dice nada. */}
          <div className="rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2 text-xs text-slate-700">
            <p className="font-medium text-slate-900">{r.eficiencia.lectura}</p>
            <p className="mt-1 text-[11px] text-slate-500">{COMO_SE_LEE_EFICIENCIA}</p>
          </div>

          {lista.length > 0 && (
            <ul className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
              {lista.map((a) => (
                <li key={a} className="flex items-start gap-1.5">
                  <TriangleAlert className="h-3.5 w-3.5 shrink-0 mt-px" /> <span>{a}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="flex items-baseline justify-between gap-2">
            <h4 className="text-xs font-semibold text-gray-800">Tareas del período</h4>
            <span className="text-[11px] text-gray-500">
              {r.tareas_trabajadas} {r.tareas_trabajadas === 1 ? "trabajada" : "trabajadas"}
            </span>
          </div>
          <TablaTareas tareas={datos.tareas} topeJornadas={datos.tope_jornadas_abierto} />
        </>
      )}

      <div className="flex items-start gap-1.5 text-[11px] text-gray-500">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        <div className="space-y-1">
          {notasFijas(datos).map((n) => <p key={n}>{n}</p>)}
        </div>
      </div>
    </div>
  );
}
