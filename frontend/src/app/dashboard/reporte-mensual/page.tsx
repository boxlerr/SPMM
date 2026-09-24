"use client";

/**
 * El reporte mensual (RF-21): se abre desde el botón «Reporte mensual» del Dashboard.
 *
 * Un mes del taller comparado con el anterior: órdenes, producción, personas, calidad,
 * materiales y (cuando esté RF-10) máquinas. Todo sale de GET /api/dashboard/reporte-mensual:
 * la pantalla no cuenta nada, sólo ordena lo que vino (lib/reporteMensual.ts), y el PDF, el
 * Excel y los CSV salen de esa misma lista.
 *
 * TRES REGLAS
 *
 *  · Quien no puede ver una parte no la ve: el backend no la manda (va en null) y acá no
 *    aparece, ni en la pantalla ni en los archivos. La sección de personas es la
 *    confidencial «Rendimiento por persona».
 *  · Cambiar el mes no tapa nada: lo que se estaba mirando queda a la vista con un
 *    «actualizando…» hasta que llega el nuevo. Si el nuevo falla, vuelve al mes que se veía
 *    y lo dice.
 *  · Con un backend de antes (sin la ruta: 404) lo dice con un aviso chico. Nunca se rompe.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Cog,
  Factory,
  Info,
  Minus,
  Package,
  RefreshCw,
  ShieldAlert,
  TriangleAlert,
  Users,
} from "lucide-react";

import { ExportarMenu } from "@/components/common/ExportarMenu";
import { API_URL } from "@/config";
import { alineaDerecha, fechaHoraAR, partesDeFecha, textoParaLeer, type ColumnaExport } from "@/lib/exportar";
import {
  archivoDelReporte,
  conMayuscula,
  datosDelArchivo,
  esFuturo,
  esReporte,
  fmtIndicador,
  mesAnterior,
  mesDeLaDireccion,
  mesesElegibles,
  mesSiguiente,
  mismoMes,
  mesActual,
  nombreDelMes,
  rutaDelReporte,
  seccionesDelReporte,
  tablaResumen,
  tablasDelReporte,
  tablasParaArchivo,
  variacion,
  type Indicador,
  type MesElegible,
  type ReporteMensual,
  type SeccionReporte,
  type TablaReporte,
} from "@/lib/reporteMensual";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const cabeceras = (): HeadersInit => {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

type Estado = "cargando" | "listo" | "sin_backend" | "sin_permiso" | "error";

const ICONOS: Record<SeccionReporte["clave"], { Icono: typeof Factory; color: string }> = {
  ordenes: { Icono: ClipboardList, color: "bg-blue-50 text-blue-600 border-blue-100/60" },
  produccion: { Icono: Factory, color: "bg-indigo-50 text-indigo-600 border-indigo-100/60" },
  personas: { Icono: Users, color: "bg-violet-50 text-violet-600 border-violet-100/60" },
  calidad: { Icono: ShieldAlert, color: "bg-amber-50 text-amber-600 border-amber-100/60" },
  materiales: { Icono: Package, color: "bg-emerald-50 text-emerald-600 border-emerald-100/60" },
  maquinas: { Icono: Cog, color: "bg-gray-100 text-gray-600 border-gray-200/60" },
};

// Cuántas tarjetas por renglón según cuántos indicadores tiene la parte: con 4, cuatro
// anchas y no cuatro angostas y dos huecos. Clases enteras: Tailwind no ve las armadas.
const GRILLA_INDICADORES: Record<number, string> = {
  0: "grid-cols-2",
  1: "grid-cols-2",
  2: "grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 lg:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3 xl:grid-cols-6",
};

// ─────────────────────────── los datos ───────────────────────────

/**
 * El reporte de `mes`. Lo anterior queda a la vista mientras llega lo nuevo. Si lo nuevo
 * falla y ya había algo, avisa con `onFallo` (la página vuelve al mes que se veía).
 */
function useReporteMensual(mes: MesElegible, onFallo: (mensaje: string, visto: MesElegible) => void) {
  const [datos, setDatos] = useState<ReporteMensual | null>(null);
  const [estado, setEstado] = useState<Estado>("cargando");
  const [error, setError] = useState<string | null>(null);
  const [actualizando, setActualizando] = useState(false);
  const [vuelta, setVuelta] = useState(0);
  const pedido = useRef(0);
  const datosRef = useRef<ReporteMensual | null>(null);
  datosRef.current = datos;
  const onFalloRef = useRef(onFallo);
  onFalloRef.current = onFallo;
  // El mes al que se volvió después de un fallo: ya está en pantalla, no se vuelve a pedir
  // (si el servidor sigue fallando, serían dos avisos y un pedido de más).
  const vuelto = useRef<MesElegible | null>(null);

  useEffect(() => {
    if (vuelto.current && vuelto.current.anio === mes.anio && vuelto.current.mes === mes.mes) {
      vuelto.current = null;
      return;
    }
    vuelto.current = null;
    const este = ++pedido.current;
    setActualizando(true);
    const fallar = (mensaje: string) => {
      const visto = datosRef.current;
      if (visto) {
        vuelto.current = { anio: visto.anio, mes: visto.mes };
        onFalloRef.current(mensaje, { anio: visto.anio, mes: visto.mes });
      } else {
        setError(mensaje);
        setEstado("error");
      }
    };
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/dashboard/reporte-mensual?anio=${mes.anio}&mes=${mes.mes}`,
          { headers: cabeceras() },
        );
        if (este !== pedido.current) return;
        // 404/405: un backend de antes de RF-21. 401/403: sin sesión o sin el Dashboard
        // (el aviso de «no tenés permiso» ya lo muestra AuthContext).
        if (res.status === 404 || res.status === 405) { setEstado("sin_backend"); return; }
        if (res.status === 401 || res.status === 403) { setEstado("sin_permiso"); return; }
        const body = await res.json().catch(() => null);
        if (este !== pedido.current) return;
        if (!res.ok) {
          fallar(body?.errors?.[0]?.message || "No se pudo armar el reporte de ese mes.");
          return;
        }
        if (!body?.success || !esReporte(body.data)) {
          fallar(body?.error || "No se pudo armar el reporte. Probá de nuevo en unos segundos.");
          return;
        }
        setDatos(body.data);
        setError(null);
        setEstado("listo");
      } catch {
        if (este === pedido.current) fallar("No se pudo conectar con el servidor. Probá de nuevo en unos segundos.");
      } finally {
        if (este === pedido.current) setActualizando(false);
      }
    })();
  }, [mes.anio, mes.mes, vuelta]);

  const reintentar = useCallback(() => {
    setEstado("cargando");
    setError(null);
    setVuelta((v) => v + 1);
  }, []);

  return { datos, estado, error, actualizando, reintentar };
}

// ─────────────────────────── piezas ───────────────────────────

function SelectorDeMes({ mes, onCambiar, disabled }: {
  mes: MesElegible;
  onCambiar: (m: MesElegible) => void;
  disabled?: boolean;
}) {
  const opciones = useMemo(() => {
    const lista = mesesElegibles();
    return lista.some((m) => mismoMes(m, mes)) ? lista : [...lista, mes];
  }, [mes]);
  const valor = `${mes.anio}-${mes.mes}`;
  const siguiente = mesSiguiente(mes);
  const boton = "flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 transition-colors hover:border-[#DC143C]/40 hover:text-[#DC143C] disabled:pointer-events-none disabled:opacity-40";
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button type="button" className={boton} onClick={() => onCambiar(mesAnterior(mes))} disabled={disabled}
              aria-label="Mes anterior" title="Mes anterior">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <select
        value={valor}
        onChange={(e) => {
          const [a, m] = e.target.value.split("-").map(Number);
          onCambiar({ anio: a, mes: m });
        }}
        disabled={disabled}
        aria-label="Mes del reporte"
        className="h-9 w-40 min-w-0 rounded-md border border-gray-200 bg-white px-2 text-sm font-medium text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#DC143C]/30 sm:w-48"
      >
        {opciones.map((m) => (
          <option key={`${m.anio}-${m.mes}`} value={`${m.anio}-${m.mes}`}>
            {conMayuscula(nombreDelMes(m.anio, m.mes))}
          </option>
        ))}
      </select>
      <button type="button" className={boton} onClick={() => onCambiar(siguiente)}
              disabled={disabled || esFuturo(siguiente)} aria-label="Mes siguiente" title="Mes siguiente">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function Variacion({ ind }: { ind: Indicador }) {
  const v = variacion(ind);
  if (!v) return null;
  const Icono = v.sentido === "sube" ? ArrowUp : v.sentido === "baja" ? ArrowDown : Minus;
  const tono = v.tono === "bien"
    ? "bg-emerald-50 text-emerald-700"
    : v.tono === "mal"
      ? "bg-red-50 text-red-700"
      : "bg-gray-100 text-gray-600";
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", tono)}>
      <Icono className="h-3 w-3" />
      {v.texto}
    </span>
  );
}

function TarjetaIndicador({ ind, mesAnteriorCorto }: { ind: Indicador; mesAnteriorCorto: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
      {/* En el teléfono la tarjeta mide ~105 px: el título se parte en dos renglones en
          vez de cortarse («DESVÍO CONTRA LO ESTIMADO» no entra en uno). */}
      <p className="break-words text-[11px] font-medium uppercase leading-tight tracking-wide text-gray-500">{ind.titulo}</p>
      <p className="mt-1 text-xl font-bold tabular-nums text-gray-900">{fmtIndicador(ind.actual, ind.tipo)}</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-1 text-[11px]">
        <span className="truncate text-gray-500">{mesAnteriorCorto}: {fmtIndicador(ind.anterior, ind.tipo)}</span>
        <Variacion ind={ind} />
      </div>
      {ind.ayuda && <p className="mt-1 text-[11px] leading-snug text-gray-400">{ind.ayuda}</p>}
    </div>
  );
}

function celda(c: ColumnaExport<any>, fila: any, i: number): string {
  return textoParaLeer(c, c.valor(fila, i));
}

function TablaDelReporte({ t }: { t: TablaReporte }) {
  const [todas, setTodas] = useState(false);
  const columnas = (t.lectura ?? t.columnas) as ColumnaExport<any>[];
  const visibles = t.primeras && !todas ? t.filas.slice(0, t.primeras) : t.filas;
  const derecha = (c: ColumnaExport<any>) => alineaDerecha(c.tipo);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-800">{t.titulo}</h3>
        {t.filas.length > 0 && (
          <span className="shrink-0 text-[11px] text-gray-400">
            {t.filas.length} {t.filas.length === 1 ? "fila" : "filas"}
          </span>
        )}
      </div>
      {t.filas.length === 0 ? (
        <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-sm text-gray-500">{t.vacio}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-100">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                {columnas.map((c) => (
                  <th key={c.titulo} scope="col"
                      className={cn("whitespace-nowrap px-3 py-2 font-medium", derecha(c) ? "text-right" : "text-left")}>
                    {c.titulo}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {visibles.map((fila, i) => (
                <tr key={i} className="hover:bg-gray-50/60">
                  {columnas.map((c) => {
                    const v = celda(c, fila, i);
                    return (
                      <td key={c.titulo}
                          className={cn("px-3 py-2 text-gray-700", derecha(c) ? "whitespace-nowrap text-right tabular-nums" : "min-w-[7rem]")}>
                        {v || <span className="text-gray-300">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            {t.total && (
              <tfoot className="border-t border-gray-200 bg-gray-50 font-semibold text-gray-900">
                <tr>
                  {columnas.map((c) => (
                    <td key={c.titulo}
                        className={cn("px-3 py-2", derecha(c) ? "whitespace-nowrap text-right tabular-nums" : "")}>
                      {celda(c, t.total, -1)}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {t.primeras !== undefined && t.filas.length > t.primeras && (
        <button type="button" onClick={() => setTodas((x) => !x)}
                className="mt-2 text-xs font-medium text-[#DC143C] hover:underline">
          {todas ? "Ver menos" : `Ver las ${t.filas.length}`}
        </button>
      )}
      {t.nota && <p className="mt-2 text-[11px] leading-snug text-gray-500">{t.nota}</p>}
    </div>
  );
}

function Seccion({ s, r }: { s: SeccionReporte; r: ReporteMensual }) {
  const { Icono, color } = ICONOS[s.clave];
  const mesAnteriorCorto = conMayuscula(r.anterior.titulo.split(" de ")[0]);
  const conDatos = s.indicadores.length > 0 || s.tablas.length > 0;
  return (
    <section id={`seccion-${s.clave}`}
             className="scroll-mt-44 overflow-hidden rounded-xl border border-gray-100 bg-white shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)]">
      <div className="flex items-start justify-between gap-3 border-b border-gray-50 px-4 py-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className={cn("shrink-0 rounded-lg border p-2", color)}>
            <Icono className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{s.titulo}</h2>
            <p className="text-xs text-gray-500">{s.descripcion}</p>
          </div>
        </div>
        {conDatos && (
          <ExportarMenu
            titulo={`Reporte mensual de ${r.titulo} · ${s.titulo}`}
            archivo={`${archivoDelReporte(r)}_${s.clave}`}
            secciones={() => [tablaResumen(r, [s]), ...tablasParaArchivo(s)]}
            cantidad={s.tablas.reduce((n, t) => n + t.filas.length, 0) + s.indicadores.length}
            filtros={() => datosDelArchivo(r)}
            rotulo={`Exportar «${s.titulo}» (CSV sólo de esta parte)`}
            soloIcono
          />
        )}
      </div>
      <div className="space-y-6 p-4 sm:p-6">
        {s.indicadores.length > 0 && (
          <div className={cn("grid gap-3", GRILLA_INDICADORES[Math.min(s.indicadores.length, 6)])}>
            {s.indicadores.map((ind) => (
              <TarjetaIndicador key={ind.titulo} ind={ind} mesAnteriorCorto={mesAnteriorCorto} />
            ))}
          </div>
        )}
        {s.sinDatos && (
          <p className="flex items-start gap-2 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-sm text-gray-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
            {s.sinDatos}
          </p>
        )}
        {s.tablas.map((t) => <TablaDelReporte key={t.clave} t={t} />)}
      </div>
    </section>
  );
}

function Aviso({ tono = "gris", titulo, children, accion }: {
  tono?: "gris" | "ambar" | "rojo";
  titulo: string;
  children?: React.ReactNode;
  accion?: React.ReactNode;
}) {
  const estilos = {
    gris: "border-gray-200 bg-white text-gray-700",
    ambar: "border-amber-200 bg-amber-50 text-amber-900",
    rojo: "border-red-200 bg-red-50 text-red-900",
  }[tono];
  return (
    <div className={cn("rounded-xl border px-4 py-4 shadow-sm", estilos)}>
      <p className="flex items-center gap-2 text-sm font-semibold">
        {tono === "gris" ? <Info className="h-4 w-4 shrink-0" /> : <TriangleAlert className="h-4 w-4 shrink-0" />}
        {titulo}
      </p>
      {children && <div className="mt-1 text-sm leading-relaxed opacity-90">{children}</div>}
      {accion && <div className="mt-3">{accion}</div>}
    </div>
  );
}

function Esqueleto() {
  return (
    <div className="space-y-6" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="animate-pulse rounded-xl border border-gray-100 bg-white p-6">
          <div className="h-4 w-40 rounded bg-gray-100" />
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[0, 1, 2, 3, 4, 5].map((j) => <div key={j} className="h-20 rounded-lg bg-gray-50" />)}
          </div>
          <div className="mt-5 h-32 rounded-lg bg-gray-50" />
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────── la pantalla ───────────────────────────

function ReporteMensualPantalla() {
  const router = useRouter();
  const params = useSearchParams();
  const [mes, setMes] = useState<MesElegible>(() => mesDeLaDireccion(params.get("anio"), params.get("mes")));

  const irA = useCallback((m: MesElegible) => {
    if (esFuturo(m)) return;
    setMes(m);
    router.replace(rutaDelReporte(m), { scroll: false });
  }, [router]);

  const onFallo = useCallback((mensaje: string, visto: MesElegible) => {
    toast.error(mensaje);
    setMes(visto);
    router.replace(rutaDelReporte(visto), { scroll: false });
  }, [router]);

  const { datos, estado, error, actualizando, reintentar } = useReporteMensual(mes, onFallo);
  const secciones = useMemo(() => (datos ? seccionesDelReporte(datos) : []), [datos]);
  const titulo = datos ? datos.titulo : nombreDelMes(mes.anio, mes.mes);
  const corte = datos?.periodo.parcial ? partesDeFecha(datos.periodo.corte) : null;
  const esteMes = mismoMes(mes, mesActual());

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Pegada arriba desde tablet; en el teléfono no: con el selector y el botón de
          exportar ocupa un tercio de la pantalla y taparía el reporte. */}
      <div className="z-10 border-b border-gray-200 bg-white shadow-sm md:sticky md:top-0">
        <div className="mx-auto max-w-[1600px] px-4 py-4 md:px-6 lg:px-8">
          {/* Como en el Dashboard: abajo de `lg` la campana de avisos flota arriba a la
              derecha, y el `pr-12` le deja su esquina. */}
          <div className="flex flex-col gap-3 pr-12 lg:flex-row lg:items-end lg:justify-between lg:pr-0">
            <div className="min-w-0">
              <Link href="/dashboard" className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-[#DC143C]">
                <ArrowLeft className="h-3.5 w-3.5" /> Dashboard
              </Link>
              <h1 className="mt-1 flex items-center gap-3 text-2xl font-bold text-gray-900 md:text-3xl">
                <span className="shrink-0 rounded-xl bg-gradient-to-br from-[#DC143C] to-[#B8112E] p-2 shadow-lg">
                  <CalendarRange className="h-6 w-6 text-white" />
                </span>
                <span className="min-w-0">Reporte mensual</span>
              </h1>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-gray-500">
                <span className="font-medium text-gray-800">{conMayuscula(titulo)}</span>
                {datos && <span>· comparado con {datos.anterior.titulo}</span>}
                {corte && (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800 ring-1 ring-amber-200">
                    Mes en curso · hasta el {fechaHoraAR(corte)}
                  </span>
                )}
                {actualizando && datos && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-gray-400">
                    <RefreshCw className="h-3 w-3 animate-spin" /> actualizando…
                  </span>
                )}
              </p>
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <SelectorDeMes mes={mes} onCambiar={irA} />
              <ExportarMenu
                titulo={`Reporte mensual de ${titulo}`}
                archivo={datos ? archivoDelReporte(datos) : "reporte_mensual"}
                secciones={() => (datos ? tablasDelReporte(datos) : [])}
                cantidad={datos ? secciones.reduce((n, s) => n + s.tablas.reduce((m, t) => m + t.filas.length, 0) + s.indicadores.length, 0) : 0}
                filtros={() => (datos ? datosDelArchivo(datos) : [])}
                rotulo="Exportar el reporte del mes: PDF con portada, Excel con una hoja por tabla o CSV"
                pdf={async () => {
                  const { construirPdfReporteMensual } = await import("@/lib/exportes/reporteMensualPdf");
                  return construirPdfReporteMensual(datos!);
                }}
                disabled={!datos || estado !== "listo"}
                className="h-9"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] space-y-6 px-4 py-6 md:px-6 md:py-8 lg:px-8" aria-busy={actualizando}>
        {estado === "cargando" && !datos && <Esqueleto />}

        {estado === "sin_backend" && (
          <Aviso titulo="El reporte mensual todavía no está en el servidor">
            Esta pantalla ya está, pero el servidor todavía no arma el reporte: aparece con la próxima
            actualización del backend. Mientras tanto, el Dashboard sigue como siempre.
          </Aviso>
        )}

        {estado === "sin_permiso" && (
          <Aviso titulo="No tenés permiso para ver el reporte mensual">
            Se abre con el Dashboard. Si lo necesitás, pedíselo a un administrador.
          </Aviso>
        )}

        {estado === "error" && !datos && (
          <Aviso tono="rojo" titulo="No se pudo armar el reporte"
                 accion={(
                   <button type="button" onClick={reintentar}
                           className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50">
                     <RefreshCw className="h-3.5 w-3.5" /> Probar de nuevo
                   </button>
                 )}>
            {error}
          </Aviso>
        )}

        {datos && estado !== "sin_backend" && estado !== "sin_permiso" && (
          <>
            {secciones.length === 0 ? (
              <Aviso titulo="No hay partes de este reporte para mostrarte">
                El reporte junta órdenes, producción, personas, calidad, materiales y máquinas, y tu usuario no ve
                ninguna de esas pantallas. Si las necesitás, pedíselas a un administrador.
              </Aviso>
            ) : (
              <nav aria-label="Partes del reporte" className="flex flex-wrap gap-2">
                {secciones.map((s) => {
                  const { Icono } = ICONOS[s.clave];
                  return (
                    <a key={s.clave} href={`#seccion-${s.clave}`}
                       className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-[#DC143C]/40 hover:text-[#DC143C]">
                      <Icono className="h-3.5 w-3.5" />
                      {s.titulo}
                    </a>
                  );
                })}
              </nav>
            )}

            {datos.avisos.length > 0 && (
              <Aviso tono="ambar" titulo="Para tener en cuenta">
                <ul className="list-disc space-y-1 pl-5">
                  {datos.avisos.map((a) => <li key={a}>{a}</li>)}
                </ul>
              </Aviso>
            )}

            {secciones.map((s) => <Seccion key={s.clave} s={s} r={datos} />)}

            {datos.como_se_cuenta.length > 0 && (
              <details className="group rounded-xl border border-gray-100 bg-white px-4 py-3 shadow-sm sm:px-6">
                <summary className="cursor-pointer select-none text-sm font-semibold text-gray-800">
                  Cómo se cuenta cada número
                </summary>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-gray-600">
                  {datos.como_se_cuenta.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </details>
            )}

            {esteMes && (
              <p className="text-center text-[11px] text-gray-400">
                El mes en curso se completa solo: volvé a abrirlo cuando cierre para ver el mes entero.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ReporteMensualPage() {
  // useSearchParams pide un Suspense arriba para que el build no se queje.
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50/50" />}>
      <ReporteMensualPantalla />
    </Suspense>
  );
}
