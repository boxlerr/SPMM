"use client";

/**
 * La solapa «Tiempos» de la ficha de la persona (RF-06): cada paso de OT que hizo, con
 * lo estimado, el tiempo corrido y el EFECTIVO.
 *
 * Las cuentas son del backend (application/TiempoEfectivo.py): efectivo = lo que cae
 * adentro de la jornada del taller, menos lo que el paso estuvo en pausa (RF-03). El
 * desglose se muestra entero —corrido = efectivo + pausas + fuera de jornada— para que
 * nada quede escondido.
 *
 * Quién hizo cada paso no se registra: se atribuye a la persona elegida a mano en la OT
 * o, si no hay, a la del último plan. La pantalla lo dice en cada renglón.
 *
 * Si el backend todavía no tiene la ruta, la solapa ni aparece.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Info, PauseCircle, Timer } from "lucide-react";

import { API_URL } from "@/config";
import {
  type ClavePeriodo,
  type EstadoSeccion,
  type TareaConTiempo,
  type TiemposOperario as DatosTiempos,
  fmtMinutos,
  momentoCorto,
  rangoDePeriodo,
} from "@/lib/asistencia";
import { cn } from "@/lib/utils";
import { SelectorPeriodo } from "./AsistenciaOperario";

const cabeceras = (): HeadersInit => {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Los tiempos de una persona en un período. `version` sube cuando algo de la ficha
 * pudo cambiarlos (el estado de un paso): se vuelven a pedir en silencio.
 */
export function useTiempos(idOperario: number | undefined, periodo: ClavePeriodo, version: number) {
  const [datos, setDatos] = useState<DatosTiempos | null>(null);
  const [estado, setEstado] = useState<EstadoSeccion>("cargando");
  const [actualizando, setActualizando] = useState(false);
  const pedido = useRef(0);

  const pedir = useCallback(async (silencioso: boolean) => {
    if (!idOperario) return;
    const este = ++pedido.current;
    const { desde, hasta } = rangoDePeriodo(periodo);
    if (!silencioso) setActualizando(true);
    try {
      const res = await fetch(
        `${API_URL}/operarios/${idOperario}/tiempos?desde=${desde}&hasta=${hasta}`,
        { headers: cabeceras() },
      );
      if (este !== pedido.current) return;
      if ([401, 403, 404, 405].includes(res.status)) {
        setEstado("no");
        return;
      }
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (este !== pedido.current) return;
      if (!body?.status || !body.data || !Array.isArray(body.data.tareas)) {
        setEstado((e) => (e === "si" ? e : "error"));
        return;
      }
      setDatos(body.data as DatosTiempos);
      setEstado("si");
    } catch {
      if (este === pedido.current) setEstado((e) => (e === "si" ? e : "error"));
    } finally {
      if (este === pedido.current) setActualizando(false);
    }
  }, [idOperario, periodo]);

  useEffect(() => {
    setDatos(null);
    setEstado("cargando");
  }, [idOperario]);

  useEffect(() => {
    void pedir(false);
  }, [pedir]);

  const primeraVersion = useRef(version);
  useEffect(() => {
    if (version !== primeraVersion.current) void pedir(true);
  }, [version, pedir]);

  return { datos, estado, actualizando };
}

type Tiempos = ReturnType<typeof useTiempos>;

function Numero({ titulo, valor, fuerte, alerta }: {
  titulo: string; valor: string; fuerte?: boolean;
  /** Se pasó de lo estimado. */
  alerta?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{titulo}</p>
      <p className={cn(
        "tabular-nums text-xs",
        fuerte ? "font-bold" : "",
        alerta ? "text-amber-700" : fuerte ? "text-slate-900" : "text-gray-700",
      )}>{valor}</p>
    </div>
  );
}

function desglose(t: TareaConTiempo): string {
  if (t.sin_datos) return "Terminado sin fin registrado: no se puede medir.";
  const partes = [`Corrido ${fmtMinutos(t.corrido_min)}`, `= efectivo ${fmtMinutos(t.efectivo_min)}`];
  if (t.pausa_min) partes.push(`+ en pausa ${fmtMinutos(t.pausa_min)}`);
  if (t.fuera_de_jornada_min) partes.push(`+ fuera de jornada ${fmtMinutos(t.fuera_de_jornada_min)}`);
  return partes.join(" ");
}

function Renglon({ t }: { t: TareaConTiempo }) {
  const pasado = t.estimado_min != null && t.efectivo_min != null && t.efectivo_min > t.estimado_min;
  return (
    <li className="py-2 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
      <div className="min-w-0 text-xs space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-mono font-bold text-slate-700">OT {t.numero_ot}</span>
          <span className="font-medium text-gray-900 truncate">
            {t.paso != null ? `${t.paso}. ` : ""}{t.proceso || "Proceso"}
          </span>
          <span className={cn(
            "rounded px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide",
            t.en_curso ? "bg-blue-100 text-blue-700" : t.id_estado === 3 ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600",
          )}>
            {t.en_curso ? "En curso" : t.estado}
          </span>
          {t.origen === "plan" && (
            <span className="text-[10px] text-gray-400" title="Nadie la eligió a mano en la OT: se la cuenta por el último plan">
              según el plan
            </span>
          )}
        </p>
        {/* Las fechas primero: el artículo es largo y se corta él, no el cuándo. */}
        <p className="text-[11px] text-gray-500 truncate">
          <span className="tabular-nums">
            {momentoCorto(t.inicio_real)}
            {t.fin_real ? ` → ${momentoCorto(t.fin_real)}` : t.en_curso ? " → sigue" : ""}
          </span>
          {t.sin_datos && <span className="text-amber-700"> · sin fin registrado</span>}
          {t.articulo ? ` · ${t.articulo}` : ""}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 shrink-0 sm:w-[260px] sm:text-right" title={desglose(t)}>
        <Numero titulo="Estimado" valor={fmtMinutos(t.estimado_min)} />
        <Numero titulo="Corrido" valor={t.sin_datos ? "—" : fmtMinutos(t.corrido_min)} />
        <Numero
          titulo="Efectivo"
          valor={t.sin_datos ? "—" : fmtMinutos(t.efectivo_min)}
          fuerte
          alerta={pasado}
        />
      </div>
      {!t.sin_datos && (t.pausa_min || 0) > 0 && (
        <p className="text-[11px] text-gray-500 sm:hidden flex items-center gap-1">
          <PauseCircle className="h-3 w-3" /> {fmtMinutos(t.pausa_min)} en pausa
        </p>
      )}
    </li>
  );
}

export default function TiemposOperario({ tiempos, periodo, onPeriodo }: {
  tiempos: Tiempos;
  periodo: ClavePeriodo;
  onPeriodo: (p: ClavePeriodo) => void;
}) {
  const { datos, estado, actualizando } = tiempos;

  if (estado === "cargando" && !datos) {
    return <p className="px-4 py-6 text-xs text-gray-400">Midiendo los tiempos…</p>;
  }
  if (estado === "error" && !datos) {
    return (
      <p className="m-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        No se pudieron leer los tiempos. Probá de nuevo en un rato.
      </p>
    );
  }
  if (!datos) return null;
  const r = datos.resumen;

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SelectorPeriodo valor={periodo} onCambiar={onPeriodo} actualizando={actualizando} />
        <span className="text-[11px] text-gray-500">
          {r.tareas} {r.tareas === 1 ? "paso" : "pasos"} · {r.terminadas} {r.terminadas === 1 ? "terminado" : "terminados"}
          {r.en_curso ? ` · ${r.en_curso} en curso` : ""}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2 rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2">
        <div>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500"><Clock className="h-3 w-3" /> Estimado</p>
          <p className="text-sm font-bold tabular-nums text-slate-800">{fmtMinutos(r.estimado_min)}</p>
        </div>
        <div title={`Del arranque al fin, con noches, fines de semana y pausas. Fuera de jornada: ${fmtMinutos(r.fuera_de_jornada_min)}; en pausa: ${fmtMinutos(r.pausa_min)}.`}>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500"><Timer className="h-3 w-3" /> Corrido</p>
          <p className="text-sm font-bold tabular-nums text-slate-800">{fmtMinutos(r.corrido_min)}</p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-blue-600"><Timer className="h-3 w-3" /> Efectivo</p>
          <p className="text-sm font-bold tabular-nums text-blue-700">{fmtMinutos(r.efectivo_min)}</p>
        </div>
      </div>

      {!datos.pausas_disponibles && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
          El servidor todavía no tiene las pausas de las OT: el efectivo no las descuenta.
        </p>
      )}

      {datos.tareas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-gray-400">
          <Timer className="h-8 w-8 mb-2 stroke-1" />
          <p className="text-xs">Ningún paso trabajado en este período.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white px-3">
          {datos.tareas.map((t) => <Renglon key={t.id_otp} t={t} />)}
        </ul>
      )}
      {datos.recortado && (
        <p className="text-[11px] text-gray-500">Se muestran los {datos.tareas.length} más recientes: achicá el período para ver el resto.</p>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        <span>
          <strong>Efectivo</strong> = lo trabajado dentro de la jornada del taller ({datos.jornada}),
          menos lo que el paso o su OT estuvieron en pausa. Lo que cae fuera de ese horario queda
          en el corrido. Cada paso se le cuenta a quien lo tiene elegido en la OT o, si no hay, a
          quien le dio el último plan: el sistema no registra quién lo hizo de verdad.
        </span>
      </p>
    </div>
  );
}
