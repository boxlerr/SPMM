"use client";

/**
 * La solapa «Asistencia» de la ficha de la persona (RF-06, versión simple).
 *
 * Qué muestra: las ausencias del período —las que abrió el Activo / Ausente de la ficha
 * y las que se cargaron a mano—, con el total de días (corridos y laborables) y quién
 * cargó cada una. Las fichadas con reloj son la v2.
 *
 * TRES REGLAS, las de siempre
 *
 *  · Se ve al toque. Cargar, corregir o borrar se pinta antes de que conteste el
 *    servidor; si dice que no, vuelve como estaba y se avisa. Los totales se piden de
 *    nuevo en silencio: ni recarga ni spinner tapando la lista.
 *  · Si el backend todavía no tiene la ruta (se deploya a mano y puede ir atrás del
 *    front), la solapa ni aparece: la ficha queda como antes.
 *  · Los botones de escritura sólo para quien puede editar a la persona (la solapa
 *    Recurso humano), igual que el backend.
 *
 * NO toca el plan: el planificador sigue mirando sólo el Activo / Ausente. Se dice en
 * la pantalla, para que nadie cargue unas vacaciones creyendo que con eso alcanza.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarOff, Check, Info, Pencil, Plus, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { API_URL } from "@/config";
import {
  type Ausencia,
  type ClavePeriodo,
  type EstadoSeccion,
  type HistorialAusencias,
  type MotivoAusencia,
  PERIODOS,
  diaCorto,
  diasEntre,
  fechaCorta,
  fmtDias,
  isoLocal,
  momentoCorto,
  rangoDePeriodo,
  sumarDias,
} from "@/lib/asistencia";
import { toast } from "@/lib/toast";
import { capitalizeName, cn, parseApiError } from "@/lib/utils";

const cabeceras = (json = false): HeadersInit => {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (typeof window === "undefined") return h;
  const token = localStorage.getItem("access_token");
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
};

// Por si el backend no los manda: los mismos de domain/AusenciaOperario.py.
const MOTIVOS_DE_RESPALDO: MotivoAusencia[] = [
  { codigo: "VACACIONES", texto: "Vacaciones" },
  { codigo: "ENFERMEDAD", texto: "Enfermedad" },
  { codigo: "LICENCIA", texto: "Licencia" },
  { codigo: "PERSONAL", texto: "Motivo personal" },
  { codigo: "OTRO", texto: "Otro" },
];

// Ids de los renglones que todavía no contestó el servidor: negativos, de un contador.
let proximoTemporal = -1;

async function motivoDelError(res: Response): Promise<string> {
  const motivo = parseApiError(await res.text().catch(() => ""));
  return motivo || `El servidor contestó ${res.status}`;
}

/**
 * El historial de ausencias de una persona y cómo cargarlas, corregirlas y borrarlas.
 *
 * `version` sube cuando la ficha cambia el Activo / Ausente: la ausencia abierta se
 * abre o se cierra en el backend, y hay que volver a pedirla (en silencio).
 */
export function useAsistencia(idOperario: number | undefined, periodo: ClavePeriodo, version: number) {
  const [datos, setDatos] = useState<HistorialAusencias | null>(null);
  const [estado, setEstado] = useState<EstadoSeccion>("cargando");
  const [actualizando, setActualizando] = useState(false);
  const pedido = useRef(0);
  const ultimos = useRef<HistorialAusencias | null>(null);
  useEffect(() => {
    ultimos.current = datos;
  }, [datos]);

  const pedir = useCallback(async (silencioso: boolean) => {
    if (!idOperario) return;
    const este = ++pedido.current;
    const { desde, hasta } = rangoDePeriodo(periodo);
    if (!silencioso) setActualizando(true);
    try {
      const res = await fetch(
        `${API_URL}/operarios/${idOperario}/ausencias?desde=${desde}&hasta=${hasta}`,
        { headers: cabeceras() },
      );
      if (este !== pedido.current) return;
      // 404/405: backend de antes de RF-06. 401/403: sin sesión o sin permiso, y de eso
      // ya se encarga el resto de la app. En los dos casos, como si no existiera.
      if ([401, 403, 404, 405].includes(res.status)) {
        setEstado("no");
        return;
      }
      if (!res.ok) {
        setEstado((e) => (e === "si" ? e : "error"));
        return;
      }
      const body = await res.json().catch(() => null);
      if (este !== pedido.current) return;
      if (!body?.status || !body.data || !Array.isArray(body.data.ausencias)) {
        setEstado((e) => (e === "si" ? e : "error"));
        return;
      }
      setDatos(body.data as HistorialAusencias);
      setEstado("si");
    } catch {
      if (este === pedido.current) setEstado((e) => (e === "si" ? e : "error"));
    } finally {
      if (este === pedido.current) setActualizando(false);
    }
  }, [idOperario, periodo]);

  // Otra persona: se arranca de cero.
  useEffect(() => {
    setDatos(null);
    setEstado("cargando");
  }, [idOperario]);

  useEffect(() => {
    void pedir(false);
  }, [pedir]);

  // El Activo / Ausente cambió: de nuevo, sin tapar nada.
  const primeraVersion = useRef(version);
  useEffect(() => {
    if (version !== primeraVersion.current) void pedir(true);
  }, [version, pedir]);

  const reemplazar = (fn: (lista: Ausencia[]) => Ausencia[]) =>
    setDatos((d) => (d ? { ...d, ausencias: fn(d.ausencias) } : d));

  const cargar = useCallback(async (nueva: {
    desde: string; hasta: string; motivo: string | null; observacion: string;
  }): Promise<boolean> => {
    if (!idOperario) return false;
    const motivos = ultimos.current?.motivos ?? MOTIVOS_DE_RESPALDO;
    const temporal: Ausencia = {
      id: proximoTemporal--,
      id_operario: idOperario,
      desde: nueva.desde,
      hasta: nueva.hasta,
      vuelve: sumarDias(nueva.hasta, 1),
      abierta: false,
      mismo_dia: false,
      programada: nueva.desde > isoLocal(new Date()),
      dias: diasEntre(nueva.desde, nueva.hasta),
      motivo: nueva.motivo,
      motivo_texto: motivos.find((m) => m.codigo === nueva.motivo)?.texto ?? null,
      observacion: nueva.observacion.trim() || null,
      origen: "CARGA",
      cargada_en: null,
      usuario_carga: null,
      cerrada_en: null,
      usuario_cierre: null,
      pendiente: true,
    };
    reemplazar((l) => [temporal, ...l]);
    try {
      const res = await fetch(`${API_URL}/operarios/${idOperario}/ausencias`, {
        method: "POST",
        headers: cabeceras(true),
        body: JSON.stringify({
          desde: nueva.desde,
          hasta: nueva.hasta,
          motivo: nueva.motivo,
          observacion: nueva.observacion.trim() || null,
        }),
      });
      if (!res.ok) throw new Error(await motivoDelError(res));
      const body = await res.json();
      const guardada = body?.data as Ausencia | undefined;
      if (!guardada || typeof guardada.id !== "number") throw new Error("Respuesta inesperada del servidor");
      reemplazar((l) => l.map((a) => (a.id === temporal.id ? guardada : a)));
      toast.success("Ausencia cargada", {
        description: `${guardada.hasta && guardada.hasta !== guardada.desde
          ? `Del ${fechaCorta(guardada.desde)} al ${fechaCorta(guardada.hasta)}`
          : `El ${fechaCorta(guardada.desde)}`}. Queda en el historial; no la saca del plan.`,
      });
      void pedir(true);
      return true;
    } catch (e) {
      reemplazar((l) => l.filter((a) => a.id !== temporal.id));
      toast.error("No se cargó la ausencia", { description: e instanceof Error ? e.message : undefined });
      return false;
    }
  }, [idOperario, pedir]);

  const corregir = useCallback(async (id: number, cambios: Partial<{
    desde: string; hasta: string; motivo: string | null; observacion: string | null;
  }>): Promise<boolean> => {
    if (!idOperario) return false;
    const antes = ultimos.current?.ausencias.find((a) => a.id === id);
    if (!antes) return false;
    const motivos = ultimos.current?.motivos ?? MOTIVOS_DE_RESPALDO;
    const parche: Partial<Ausencia> = { ...cambios, pendiente: true } as Partial<Ausencia>;
    if ("motivo" in cambios) {
      parche.motivo_texto = motivos.find((m) => m.codigo === cambios.motivo)?.texto ?? null;
    }
    if (cambios.desde || cambios.hasta) {
      const desde = cambios.desde ?? antes.desde;
      const hasta = cambios.hasta ?? antes.hasta;
      if (hasta) parche.dias = diasEntre(desde, hasta);
    }
    reemplazar((l) => l.map((a) => (a.id === id ? { ...a, ...parche } : a)));
    // El renglón abierto también se ve arriba, en «Hoy».
    if (antes.abierta) setDatos((d) => (d && d.abierta ? { ...d, abierta: { ...d.abierta, ...parche } } : d));
    try {
      const res = await fetch(`${API_URL}/operarios/${idOperario}/ausencias/${id}`, {
        method: "PUT",
        headers: cabeceras(true),
        body: JSON.stringify(cambios),
      });
      if (!res.ok) throw new Error(await motivoDelError(res));
      const body = await res.json();
      const guardada = body?.data as Ausencia | undefined;
      if (guardada && typeof guardada.id === "number") {
        reemplazar((l) => l.map((a) => (a.id === id ? guardada : a)));
        if (guardada.abierta) setDatos((d) => (d ? { ...d, abierta: guardada } : d));
      }
      void pedir(true);
      return true;
    } catch (e) {
      reemplazar((l) => l.map((a) => (a.id === id ? antes : a)));
      if (antes.abierta) setDatos((d) => (d ? { ...d, abierta: antes } : d));
      toast.error("No se guardó el cambio", { description: e instanceof Error ? e.message : undefined });
      return false;
    }
  }, [idOperario, pedir]);

  const borrar = useCallback(async (id: number): Promise<boolean> => {
    if (!idOperario) return false;
    const lista = ultimos.current?.ausencias ?? [];
    const posicion = lista.findIndex((a) => a.id === id);
    const antes = lista[posicion];
    if (!antes) return false;
    reemplazar((l) => l.filter((a) => a.id !== id));
    try {
      const res = await fetch(`${API_URL}/operarios/${idOperario}/ausencias/${id}`, {
        method: "DELETE",
        headers: cabeceras(),
      });
      if (!res.ok) throw new Error(await motivoDelError(res));
      toast.success("Ausencia borrada", { description: "Dejó de contar en el total." });
      void pedir(true);
      return true;
    } catch (e) {
      reemplazar((l) => {
        const copia = [...l];
        copia.splice(Math.min(posicion, copia.length), 0, antes);
        return copia;
      });
      toast.error("No se borró la ausencia", { description: e instanceof Error ? e.message : undefined });
      return false;
    }
  }, [idOperario, pedir]);

  return { datos, estado, actualizando, cargar, corregir, borrar };
}

// ─────────────────────────── la pantalla ───────────────────────────

type Asistencia = ReturnType<typeof useAsistencia>;

/** El período que se mira: el mismo selector en Asistencia y en Tiempos. */
export function SelectorPeriodo({ valor, onCambiar, actualizando }: {
  valor: ClavePeriodo; onCambiar: (c: ClavePeriodo) => void; actualizando?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        value={valor}
        onChange={(e) => onCambiar(e.target.value as ClavePeriodo)}
        aria-label="Período"
        className="h-7 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {PERIODOS.map((p) => <option key={p.clave} value={p.clave}>{p.texto}</option>)}
      </select>
      {actualizando && <span className="text-[11px] text-gray-400">actualizando…</span>}
    </div>
  );
}

/** El alta (y la corrección de fechas) en línea, sin abrir otra ventana. */
function FormularioAusencia({ motivos, inicial, abierta, onGuardar, onCancelar }: {
  motivos: MotivoAusencia[];
  inicial?: { desde: string; hasta: string; motivo: string | null; observacion: string };
  /** Corrigiendo la que sigue abierta: sólo se corre el arranque. */
  abierta?: boolean;
  onGuardar: (v: { desde: string; hasta: string; motivo: string | null; observacion: string }) => Promise<boolean>;
  onCancelar: () => void;
}) {
  const hoy = isoLocal(new Date());
  const [desde, setDesde] = useState(inicial?.desde ?? hoy);
  const [hasta, setHasta] = useState(inicial?.hasta ?? inicial?.desde ?? hoy);
  const [motivo, setMotivo] = useState<string>(inicial?.motivo ?? "");
  const [observacion, setObservacion] = useState(inicial?.observacion ?? "");
  const [guardando, setGuardando] = useState(false);

  const error = !desde
    ? "Falta desde qué día."
    : abierta
      ? desde > hoy ? "Sigue ausente: no puede empezar después de hoy." : null
      : !hasta || hasta < desde
        ? "El último día no puede ser anterior al primero."
        : diasEntre(desde, hasta) > 366 ? "Son más de 366 días: revisá el año." : null;

  const guardar = async () => {
    if (error || guardando) return;
    setGuardando(true);
    // Quien lo usa cierra el formulario al toque (el renglón ya se ve) y, si el
    // servidor dice que no, lo vuelve a abrir con lo tipeado.
    await onGuardar({ desde, hasta: abierta ? desde : hasta, motivo: motivo || null, observacion });
    setGuardando(false);
  };

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/40 p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="text-[11px] font-medium text-gray-600 space-y-1">
          <span>{abierta ? "Ausente desde" : "Desde"}</span>
          <input
            type="date"
            value={desde}
            max={abierta ? hoy : undefined}
            onChange={(e) => {
              const v = e.target.value;
              setDesde(v);
              // Un solo día es el caso más común: el hasta acompaña si quedó atrás.
              if (!abierta && v && (!hasta || hasta < v)) setHasta(v);
            }}
            className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs"
          />
        </label>
        {!abierta && (
          <label className="text-[11px] font-medium text-gray-600 space-y-1">
            <span>Hasta (último día)</span>
            <input
              type="date"
              value={hasta}
              min={desde || undefined}
              onChange={(e) => setHasta(e.target.value)}
              className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs"
            />
          </label>
        )}
        <label className="text-[11px] font-medium text-gray-600 space-y-1">
          <span>Motivo (opcional)</span>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            className="h-8 w-full rounded-md border border-gray-200 bg-white px-1.5 text-xs"
          >
            <option value="">Sin motivo</option>
            {motivos.map((m) => <option key={m.codigo} value={m.codigo}>{m.texto}</option>)}
          </select>
        </label>
        <label className={cn("text-[11px] font-medium text-gray-600 space-y-1", abierta ? "col-span-2 sm:col-span-2" : "col-span-2 sm:col-span-1")}>
          <span>Observación</span>
          <input
            value={observacion}
            maxLength={300}
            onChange={(e) => setObservacion(e.target.value)}
            placeholder="Opcional"
            className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-[11px]", error ? "text-red-600" : "text-gray-500")}>
          {error ?? (abierta
            ? "Se cierra poniéndola «Activo» en la ficha."
            : `${fmtDias(diasEntre(desde, hasta))} ${diasEntre(desde, hasta) === 1 ? "corrido" : "corridos"}. Queda registrada; no la saca del plan.`)}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancelar}>
            <X className="h-3.5 w-3.5 mr-1" /> Cancelar
          </Button>
          <Button type="button" size="sm" className="h-7 px-3 text-xs" disabled={!!error || guardando} onClick={guardar}>
            <Check className="h-3.5 w-3.5 mr-1" /> Guardar
          </Button>
        </div>
      </div>
    </div>
  );
}

function queDias(a: Ausencia): string {
  if (a.abierta) return `Desde el ${diaCorto(a.desde)}`;
  if (a.mismo_dia) return diaCorto(a.desde);
  if (a.hasta && a.hasta !== a.desde) return `${diaCorto(a.desde)} → ${diaCorto(a.hasta)}`;
  return diaCorto(a.desde);
}

function cuantos(a: Ausencia): string {
  if (a.mismo_dia) return "volvió el mismo día · no suma";
  if (a.abierta) return `sigue ausente · ${fmtDias(a.dias)}`;
  return fmtDias(a.dias);
}

function Renglon({ a, motivos, puedeEditar, asistencia }: {
  a: Ausencia; motivos: MotivoAusencia[]; puedeEditar: boolean; asistencia: Asistencia;
}) {
  const [editando, setEditando] = useState(false);
  // Lo tipeado: si el servidor dice que no, el formulario vuelve con esto y no con lo
  // que había antes.
  const [borrador, setBorrador] = useState<Parameters<typeof FormularioAusencia>[0]["inicial"]>(undefined);
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const quien = (n: string | null) => (n ? capitalizeName(n) : "alguien");
  const bloqueado = !puedeEditar || !!a.pendiente || a.id < 0;

  if (editando) {
    return (
      <li className="py-2">
        <FormularioAusencia
          motivos={motivos}
          abierta={a.abierta}
          inicial={borrador ?? { desde: a.desde, hasta: a.hasta ?? a.desde, motivo: a.motivo, observacion: a.observacion ?? "" }}
          onCancelar={() => { setEditando(false); setBorrador(undefined); }}
          onGuardar={async (v) => {
            setBorrador(v);
            setEditando(false);
            const cambios: Record<string, string | null> = {
              desde: v.desde, motivo: v.motivo, observacion: v.observacion.trim() || null,
            };
            if (!a.abierta) cambios.hasta = v.hasta;
            const ok = await asistencia.corregir(a.id, cambios);
            if (ok) setBorrador(undefined);
            else setEditando(true);
            return ok;
          }}
        />
      </li>
    );
  }

  return (
    <li className={cn("py-2 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between", a.pendiente && "opacity-60")}>
      <div className="min-w-0 text-xs space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="font-semibold tabular-nums text-gray-900">{queDias(a)}</span>
          <span className={cn("text-gray-500", a.abierta && "text-amber-700 font-medium")}>{cuantos(a)}</span>
          {a.programada && (
            <span className="rounded bg-blue-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-blue-700">Programada</span>
          )}
          {a.origen === "ESTADO" && (
            <span
              title="La abrió pasarla a «Ausente» en la ficha"
              className="rounded bg-gray-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-gray-600"
            >
              Activo / Ausente
            </span>
          )}
        </p>
        {a.observacion && <p className="break-words text-gray-600">{a.observacion}</p>}
        <p className="text-[11px] text-gray-400">
          {a.pendiente ? "guardando…" : a.origen === "ESTADO"
            ? <>
                Ausente: {quien(a.usuario_carga)} {momentoCorto(a.cargada_en)}
                {a.cerrada_en && <> · Activo: {quien(a.usuario_cierre)} {momentoCorto(a.cerrada_en)}</>}
              </>
            : <>Cargada por {quien(a.usuario_carga)} {momentoCorto(a.cargada_en)}</>}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0 sm:pl-2">
        {/* El motivo se cambia desde el renglón, sin abrir nada: es lo que se hace cuando
            a la mañana se marcó Ausente y a la tarde se sabe por qué. */}
        <select
          value={a.motivo ?? ""}
          disabled={bloqueado}
          onChange={(e) => void asistencia.corregir(a.id, { motivo: e.target.value || null })}
          aria-label="Motivo"
          className="h-7 max-w-[150px] rounded-md border border-gray-200 bg-white px-1.5 text-[11px] text-gray-700 disabled:cursor-default disabled:border-transparent disabled:bg-transparent disabled:appearance-none"
        >
          <option value="">Sin motivo</option>
          {motivos.map((m) => <option key={m.codigo} value={m.codigo}>{m.texto}</option>)}
        </select>
        {puedeEditar && !a.pendiente && a.id > 0 && (
          confirmarBorrado ? (
            <span className="flex items-center gap-1 text-[11px]">
              <span className="text-gray-600">¿Borrar?</span>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs text-red-600"
                onClick={() => { setConfirmarBorrado(false); void asistencia.borrar(a.id); }}>
                Sí
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs"
                onClick={() => setConfirmarBorrado(false)}>
                No
              </Button>
            </span>
          ) : (
            <>
              <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-500"
                title={a.abierta ? "Corregir desde cuándo" : "Corregir fechas u observación"}
                aria-label="Corregir" onClick={() => setEditando(true)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              {!a.abierta && (
                <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-gray-500 hover:text-red-600"
                  title="Borrar (si se cargó por error)" aria-label="Borrar" onClick={() => setConfirmarBorrado(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )
        )}
      </div>
    </li>
  );
}

export default function AsistenciaOperario({ asistencia, periodo, onPeriodo, puedeEditar, disponible }: {
  asistencia: Asistencia;
  periodo: ClavePeriodo;
  onPeriodo: (p: ClavePeriodo) => void;
  /** La solapa Recurso humano en «editar», la misma que pide el backend. */
  puedeEditar: boolean;
  /** Lo que dice la ficha ahora (Activo / Ausente). */
  disponible: boolean;
}) {
  const { datos, estado, actualizando } = asistencia;
  const [cargando, setCargando] = useState(false);
  // Lo tipeado en el alta, para que vuelva si el servidor la rechaza.
  const [borrador, setBorrador] = useState<Parameters<typeof FormularioAusencia>[0]["inicial"]>(undefined);

  if (estado === "cargando" && !datos) {
    return <p className="px-4 py-6 text-xs text-gray-400">Buscando las ausencias…</p>;
  }
  if (estado === "error" && !datos) {
    return (
      <p className="m-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        No se pudieron leer las ausencias. Puede que el servidor todavía no tenga la tabla: probá de nuevo en un rato.
      </p>
    );
  }
  if (!datos) return null;

  const motivos = datos.motivos?.length ? datos.motivos : MOTIVOS_DE_RESPALDO;
  const { resumen } = datos;

  return (
    <div className="flex flex-col gap-3 px-4 py-3">
      {/* Hoy */}
      <div className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        disponible ? "border-green-200 bg-green-50/60 text-green-900" : "border-amber-200 bg-amber-50/70 text-amber-900",
      )}>
        {disponible
          ? "Hoy está Activo."
          : datos.abierta
            ? <>Ausente desde el {fechaCorta(datos.abierta.desde)} ({fmtDias(datos.abierta.dias)})
                {datos.abierta.motivo_texto ? ` · ${datos.abierta.motivo_texto}` : ""}. Se cierra al ponerlo «Activo».</>
            : "Está Ausente desde antes de que se guardara la fecha: el historial empieza con el próximo cambio."}
      </div>

      {/* Período y total */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SelectorPeriodo valor={periodo} onCambiar={onPeriodo} actualizando={actualizando} />
        {puedeEditar && !cargando && (
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => setCargando(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Cargar ausencia
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="flex items-baseline gap-1.5">
          <span className="text-lg font-bold tabular-nums text-slate-800">{resumen.dias}</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-500">{resumen.dias === 1 ? "día de ausencia" : "días de ausencia"}</span>
        </span>
        <span className="flex items-baseline gap-1.5"
          title="Los que tenía que venir según sus días de trabajo, sin contar los feriados del calendario del taller">
          <span className="text-lg font-bold tabular-nums text-slate-800">{resumen.dias_laborables}</span>
          <span className="text-[11px] uppercase tracking-wide text-slate-500">laborables</span>
        </span>
        {resumen.por_motivo.length > 0 && (
          <span className="flex flex-wrap gap-1">
            {resumen.por_motivo.map((m) => (
              <span key={m.motivo} className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700">
                {m.texto} · {m.dias}
              </span>
            ))}
          </span>
        )}
      </div>
      <p className="-mt-1 text-[11px] text-gray-400">
        Del {fechaCorta(datos.periodo.desde)} al {fechaCorta(datos.periodo.hasta)}.
      </p>

      {cargando && (
        <FormularioAusencia
          motivos={motivos}
          inicial={borrador}
          onCancelar={() => { setCargando(false); setBorrador(undefined); }}
          onGuardar={async (v) => {
            setBorrador(v);
            setCargando(false);
            const ok = await asistencia.cargar(v);
            if (ok) setBorrador(undefined);
            else setCargando(true);
            return ok;
          }}
        />
      )}

      {datos.ausencias.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center text-gray-400">
          <CalendarOff className="h-8 w-8 mb-2 stroke-1" />
          <p className="text-xs">Sin ausencias en este período.</p>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white px-3">
          {datos.ausencias.map((a) => (
            <Renglon key={a.id} a={a} motivos={motivos} puedeEditar={puedeEditar} asistencia={asistencia} />
          ))}
        </ul>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        <span>
          Pasarlo a «Ausente» en la ficha guarda la fecha sola, y volverlo a «Activo» la cierra.
          Una ausencia cargada acá queda en el historial pero <strong>no lo saca del plan</strong>:
          para eso, «Ausente».
        </span>
      </p>
    </div>
  );
}
