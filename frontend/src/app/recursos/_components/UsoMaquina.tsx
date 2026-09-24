"use client";

/**
 * La sección «Uso» del detalle de una máquina (RF-10): cuántas horas se usó en el
 * período y en qué OT, qué proceso y quién.
 *
 * Los tramos no se cargan acá: los escribe solo el backend cuando un paso pasa a «En
 * proceso» (se abre) y a «Terminado» (se cierra), con la máquina elegida a mano en la OT
 * o, si no hay, la del plan. Las cuentas son del backend (application/UsoMaquinaService):
 * las horas EFECTIVAS son las de la jornada del taller menos las pausas, la misma cuenta
 * que los tiempos de las personas.
 *
 * Si el backend todavía no tiene la ruta, la solapa ni aparece (ver DetalleMaquina).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Info, Timer, Wrench } from "lucide-react";

import { ExportarMenu } from "@/components/common/ExportarMenu";
import { API_URL } from "@/config";
import { type EstadoSeccion, fmtMinutos, momentoCorto } from "@/lib/asistencia";
import type { ColumnaExport } from "@/lib/exportar";
import {
  PERIODOS_RENDIMIENTO,
  type PeriodoRendimiento,
  problemaDelRango,
  rangoRendimiento,
  textoDelPeriodo,
} from "@/lib/rendimiento";
import { NO_SUMA_CORTO, type TramoDeUso, type UsoDeMaquina, origenTexto } from "@/lib/usoMaquina";
import { cn } from "@/lib/utils";

const cabeceras = (): HeadersInit => {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** El uso de una máquina en un período. Se pide al abrir el detalle (para saber si el
 *  backend lo tiene) y otra vez, sin tapar la lista, al cambiar el período. */
export function useUsoMaquina(idMaquina: number | undefined, periodo: PeriodoRendimiento) {
  const [datos, setDatos] = useState<UsoDeMaquina | null>(null);
  const [estado, setEstado] = useState<EstadoSeccion>("cargando");
  const [actualizando, setActualizando] = useState(false);
  const pedido = useRef(0);
  const { desde, hasta } = rangoRendimiento(periodo);
  const valido = !problemaDelRango(desde, hasta);

  const pedir = useCallback(async () => {
    if (!idMaquina || !valido) return;
    const este = ++pedido.current;
    setActualizando(true);
    try {
      const res = await fetch(`${API_URL}/maquinarias/${idMaquina}/uso?desde=${desde}&hasta=${hasta}`,
        { headers: cabeceras() });
      if (este !== pedido.current) return;
      if ([401, 403, 404, 405].includes(res.status)) {
        setEstado("no");
        return;
      }
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (este !== pedido.current) return;
      if (!body?.status || !Array.isArray(body?.data?.usos)) {
        setEstado((e) => (e === "si" ? e : "error"));
        return;
      }
      setDatos(body.data as UsoDeMaquina);
      setEstado("si");
    } catch {
      if (este === pedido.current) setEstado((e) => (e === "si" ? e : "error"));
    } finally {
      if (este === pedido.current) setActualizando(false);
    }
  }, [idMaquina, desde, hasta, valido]);

  useEffect(() => {
    setDatos(null);
    setEstado("cargando");
  }, [idMaquina]);

  useEffect(() => {
    void pedir();
  }, [pedir]);

  return { datos, estado, actualizando, desde, hasta };
}

type Uso = ReturnType<typeof useUsoMaquina>;

function SelectorPeriodo({ periodo, desdeActual, hastaActual, onCambiar, actualizando }: {
  periodo: PeriodoRendimiento;
  desdeActual: string;
  hastaActual: string;
  onCambiar: (p: PeriodoRendimiento) => void;
  actualizando: boolean;
}) {
  // Lo tipeado del rango a mano: se aplica recién cuando las dos fechas están bien.
  const [desde, setDesde] = useState(periodo.desde ?? desdeActual);
  const [hasta, setHasta] = useState(periodo.hasta ?? hastaActual);
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
            setDesde(desdeActual);
            setHasta(hastaActual);
            onCambiar({ clave: "rango", desde: desdeActual, hasta: hastaActual });
          } else {
            onCambiar({ clave: c });
          }
        }}
        aria-label="Período"
        className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-[#445EF2]"
      >
        {PERIODOS_RENDIMIENTO.map((p) => <option key={p.clave} value={p.clave}>{p.texto}</option>)}
      </select>
      {periodo.clave === "rango" && (
        <span className="flex items-center gap-1.5">
          <input type="date" value={desde} max={hasta || undefined} aria-label="Desde"
            onChange={(e) => aplicar(e.target.value, hasta)}
            className="h-8 w-[132px] rounded-md border border-gray-200 bg-white px-2 text-xs" />
          <span className="text-[11px] text-gray-400">al</span>
          <input type="date" value={hasta} min={desde || undefined} aria-label="Hasta"
            onChange={(e) => aplicar(desde, e.target.value)}
            className="h-8 w-[132px] rounded-md border border-gray-200 bg-white px-2 text-xs" />
        </span>
      )}
      {problema && <span className="text-[11px] text-red-600">{problema}</span>}
      {actualizando && !problema && <span className="text-[11px] text-gray-400">actualizando…</span>}
    </div>
  );
}

function Numero({ icono: Icono, titulo, valor, ayuda, fuerte }: {
  icono: typeof Clock; titulo: string; valor: string; ayuda?: string; fuerte?: boolean;
}) {
  return (
    <div title={ayuda} className="min-w-0">
      <p className={cn("flex items-center gap-1 text-[10px] uppercase tracking-wide",
        fuerte ? "text-[#445EF2]" : "text-slate-500")}>
        <Icono className="h-3 w-3" /> {titulo}
      </p>
      <p className={cn("text-sm font-bold tabular-nums", fuerte ? "text-[#445EF2]" : "text-slate-800")}>{valor}</p>
    </div>
  );
}

const COLUMNAS: ColumnaExport<TramoDeUso>[] = [
  { titulo: "OT", tipo: "id", valor: (t) => t.numero_ot },
  { titulo: "Paso", tipo: "entero", valor: (t) => t.paso },
  { titulo: "Proceso", valor: (t) => t.proceso ?? "" },
  { titulo: "Persona", valor: (t) => t.operario ?? "" },
  { titulo: "Máquina", valor: (t) => origenTexto(t) },
  { titulo: "Inicio", tipo: "fechaHora", valor: (t) => t.inicio },
  { titulo: "Fin", tipo: "fechaHora", valor: (t) => t.fin },
  { titulo: "Horas efectivas", tipo: "numero", decimales: 2, valor: (t) => t.efectivo_min / 60 },
  { titulo: "Horas corridas", tipo: "numero", decimales: 2, valor: (t) => t.corrido_min / 60 },
  { titulo: "Suma", valor: (t) => (t.suma ? (t.en_curso ? "Sí (en curso)" : "Sí") : `No: ${t.no_suma ? NO_SUMA_CORTO[t.no_suma] : ""}`) },
];

function Renglon({ t }: { t: TramoDeUso }) {
  return (
    <li className={cn("py-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3",
      !t.suma && "opacity-70")}>
      <div className="min-w-0 text-xs space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono font-bold text-slate-700">OT {t.numero_ot}</span>
          <span className="font-medium text-gray-900 truncate">
            {t.paso != null ? `${t.paso}. ` : ""}{t.proceso || "Proceso"}
          </span>
          {t.en_curso && (
            <span className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-700">
              En curso
            </span>
          )}
          {!t.suma && t.no_suma && (
            <span title={t.no_suma_texto ?? undefined}
              className="rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide bg-amber-100 text-amber-800">
              No suma · {NO_SUMA_CORTO[t.no_suma]}
            </span>
          )}
          {t.origen_maquina === "PLAN" && (
            <span className="text-[10px] text-gray-400" title="Nadie eligió la máquina a mano en la OT: es la que le dio el último plan">
              según el plan
            </span>
          )}
        </p>
        <p className="text-[11px] text-gray-500 truncate">
          <span className="tabular-nums">
            {momentoCorto(t.inicio)}{t.fin ? ` → ${momentoCorto(t.fin)}` : " → sigue"}
          </span>
          {t.operario ? ` · ${t.operario}` : " · sin persona asignada"}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 shrink-0 sm:w-[170px] sm:text-right"
        title={`Corrido ${fmtMinutos(t.corrido_min)} (reloj, con noches y pausas); efectivo ${fmtMinutos(t.efectivo_min)} (jornada del taller, sin pausas).`}>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Corrido</p>
          <p className="tabular-nums text-xs text-gray-700">{fmtMinutos(t.corrido_min)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wide text-gray-400">Efectivo</p>
          <p className="tabular-nums text-xs font-bold text-slate-900">{fmtMinutos(t.efectivo_min)}</p>
        </div>
      </div>
    </li>
  );
}

export default function UsoMaquina({ uso, periodo, onPeriodo, nombreMaquina }: {
  uso: Uso;
  periodo: PeriodoRendimiento;
  onPeriodo: (p: PeriodoRendimiento) => void;
  nombreMaquina: string;
}) {
  const { datos, estado, actualizando, desde, hasta } = uso;

  if (estado === "cargando" && !datos) {
    return <p className="px-1 py-6 text-xs text-gray-400">Sumando las horas de uso…</p>;
  }
  if (estado === "error" && !datos) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        No se pudo leer el uso de la máquina. Probá de nuevo en un rato.
      </p>
    );
  }
  if (!datos) return null;
  const r = datos.resumen;
  const periodoTexto = textoDelPeriodo(periodo, desde, hasta);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SelectorPeriodo periodo={periodo} desdeActual={desde} hastaActual={hasta}
          onCambiar={onPeriodo} actualizando={actualizando} />
        <ExportarMenu
          titulo={`Uso de ${nombreMaquina}`}
          archivo={`uso_maquina_${nombreMaquina.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`}
          filas={datos.usos}
          columnas={COLUMNAS}
          filtros={() => [periodoTexto]}
          disabled={datos.usos.length === 0}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
        <Numero icono={Timer} titulo="Horas de uso" valor={fmtMinutos(r.efectivo_min)} fuerte
          ayuda="Adentro de la jornada del taller y sin las pausas, recortado al período. Si la máquina tenía dos pasos a la vez, esa hora cuenta una vez." />
        <Numero icono={Clock} titulo="Corridas" valor={fmtMinutos(r.corrido_min)}
          ayuda="El reloj, del arranque al fin: con noches, fines de semana y pausas." />
        <Numero icono={Wrench} titulo="Pasos" valor={String(r.pasos)} />
        <Numero icono={Timer} titulo="En curso" valor={String(r.en_curso)} />
      </div>

      {(r.superpuesto_min > 0 || (r.no_suman ?? 0) > 0) && (
        <p className="text-[11px] text-gray-500">
          {r.superpuesto_min > 0 && <>{fmtMinutos(r.superpuesto_min)} con dos pasos a la vez en esta máquina cuentan una sola vez. </>}
          {(r.no_suman ?? 0) > 0 && <>{r.no_suman} {r.no_suman === 1 ? "tramo no suma" : "tramos no suman"} (se ven marcados en la lista).</>}
        </p>
      )}
      {(r.fuera_de_servicio ?? 0) > 0 && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          En este período se arrancaron {r.fuera_de_servicio} {r.fuera_de_servicio === 1 ? "paso" : "pasos"} con la máquina
          fuera de servicio. Quedan registrados pero no suman horas: el planificador todavía no mira el estado de la máquina.
        </p>
      )}
      {!datos.pausas_disponibles && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          El servidor todavía no tiene las pausas de las OT: las horas efectivas no las descuentan.
        </p>
      )}

      {datos.usos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-gray-400">
          <Wrench className="h-8 w-8 mb-2 stroke-1" />
          <p className="text-xs">No se usó en este período.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white px-3">
          {datos.usos.map((t) => <Renglon key={t.id} t={t} />)}
        </ul>
      )}
      {datos.recortado && (
        <p className="text-[11px] text-gray-500">
          Se muestran los {datos.usos.length} más recientes: achicá el período para ver el resto. Los totales de arriba son de todos.
        </p>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        <span>
          El registro se escribe solo: al pasar un paso a <strong>En proceso</strong> con esta máquina
          (la elegida en la OT o, si no hay, la del plan) y al pasarlo a <strong>Terminado</strong>.
          Queda como pasó aunque después cambie el plan. La persona es la elegida en el paso o la del
          plan: el sistema no registra quién lo hizo de verdad. Jornada: {datos.jornada}.
        </span>
      </p>
    </div>
  );
}
