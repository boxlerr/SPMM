"use client";

/**
 * La sección «Mantenimiento» del detalle de una máquina (RF-10): el mantenimiento
 * preventivo, para tenerlo configurado aunque el taller todavía no lo lleve.
 *
 *  · Cada cuántos días (el dato de siempre de la máquina) y, opcional, cada cuántas horas
 *    de uso. Desde cuándo contar, si todavía no se registró ninguno.
 *  · «Registrar mantenimiento hecho» (día, quién, nota) y el historial.
 *  · A qué usuarios del sistema les llega el email del aviso. Por defecto, a nadie.
 *
 * El aviso lo dispara el servidor una vez por vencimiento (faltan N días, o vencido por
 * fecha o por horas): campanita + email a los elegidos. Las cuentas son del backend
 * (application/MantenimientoMaquinaService.py).
 *
 * Las reglas de siempre: lo que se guarda se ve al toque y vuelve como estaba si el
 * servidor dice que no; los controles de escritura sólo para quien edita Recurso
 * maquinaria (el backend pide lo mismo); si el backend no tiene la ruta, ni aparece.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CalendarCheck, Check, Info, Mail, Pencil, Plus, Trash2, Users, Wrench, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { API_URL } from "@/config";
import { useAuth } from "@/contexts/AuthContext";
import { type EstadoSeccion, fechaCorta, fmtMinutos, isoLocal, momentoCorto } from "@/lib/asistencia";
import { toast } from "@/lib/toast";
import {
  CHIP_MANTENIMIENTO,
  type Destinatario,
  EMAIL_ESTADO_TEXTO,
  type MantenimientoDeMaquina,
  type MantenimientoHecho,
  cuandoLeToca,
} from "@/lib/usoMaquina";
import { cn, parseApiError } from "@/lib/utils";

const cabeceras = (json = false): HeadersInit => {
  const h: Record<string, string> = {};
  if (json) h["Content-Type"] = "application/json";
  if (typeof window === "undefined") return h;
  const token = localStorage.getItem("access_token");
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
};

async function motivoDelError(res: Response, siNoHay: string): Promise<string> {
  const texto = await res.text().catch(() => "");
  return parseApiError(texto) || siNoHay;
}

/** El mantenimiento de una máquina. Se pide al abrir el detalle (para saber si el
 *  backend lo tiene). `poner` deja lo que contestó el servidor al guardar. */
export function useMantenimiento(idMaquina: number | undefined) {
  const [datos, setDatos] = useState<MantenimientoDeMaquina | null>(null);
  const [estado, setEstado] = useState<EstadoSeccion>("cargando");
  const pedido = useRef(0);

  const pedir = useCallback(async () => {
    if (!idMaquina) return;
    const este = ++pedido.current;
    try {
      const res = await fetch(`${API_URL}/maquinarias/${idMaquina}/mantenimiento`, { headers: cabeceras() });
      if (este !== pedido.current) return;
      if ([401, 403, 404, 405].includes(res.status)) {
        setEstado("no");
        return;
      }
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (este !== pedido.current) return;
      if (!body?.status || !body?.data?.estado) {
        setEstado((e) => (e === "si" ? e : "error"));
        return;
      }
      setDatos(body.data as MantenimientoDeMaquina);
      setEstado("si");
    } catch {
      if (este === pedido.current) setEstado((e) => (e === "si" ? e : "error"));
    }
  }, [idMaquina]);

  useEffect(() => {
    setDatos(null);
    setEstado("cargando");
    void pedir();
  }, [pedir]);

  const poner = useCallback((d: MantenimientoDeMaquina | null) => {
    pedido.current += 1; // lo que venía en camino ya no vale
    if (d) setDatos(d);
  }, []);

  return { datos, estado, poner, recargar: pedir };
}

type Mantenimiento = ReturnType<typeof useMantenimiento>;

const enteroONulo = (v: string): number | null => {
  const t = v.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n) : NaN;
};

// ─────────────────────────── el estado ───────────────────────────

function Estado({ d }: { d: MantenimientoDeMaquina }) {
  const e = d.estado;
  const cuando = cuandoLeToca(e);
  const horas = e.cada_horas
    ? e.usado_min != null
      ? `Lleva ${fmtMinutos(e.usado_min)} de uso de ${e.cada_horas} h`
      : `Cada ${e.cada_horas} h de uso`
    : null;
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50/60 px-3 py-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
          CHIP_MANTENIMIENTO[e.estado])}>
          <Wrench className="h-3 w-3" /> {e.estado_texto}
        </span>
        {cuando && <span className="text-xs text-slate-700">{cuando}</span>}
      </div>
      {horas && (
        <p className={cn("text-xs", e.vencido_por.includes("horas") ? "text-red-700" : "text-slate-600")}>{horas}</p>
      )}
      {e.base && (
        <p className="text-[11px] text-gray-500">
          {e.base_origen === "hecho"
            ? `Se cuenta desde el último mantenimiento, el ${fechaCorta(e.base)}.`
            : `Se cuenta desde el ${fechaCorta(e.base)} (no hay ninguno registrado).`}
        </p>
      )}
      {e.estado === "sin_configurar" && (
        <p className="text-[11px] text-gray-500">Poné cada cuántos días (o cada cuántas horas de uso) le toca.</p>
      )}
      {e.estado === "sin_base" && (
        <p className="text-[11px] text-gray-500">
          Falta desde cuándo contar: registrá el último mantenimiento que se hizo o poné una fecha
          en «Contar desde». Hasta entonces no hay próxima fecha ni aviso.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────── la configuración ───────────────────────────

interface Borrador {
  frecuencia: string;
  horas: string;
  diasAviso: string;
  contarDesde: string;
  destinatarios: number[];
}

function borradorDe(d: MantenimientoDeMaquina): Borrador {
  return {
    frecuencia: d.config.frecuencia_dias != null ? String(d.config.frecuencia_dias) : "",
    horas: d.config.cada_horas != null ? String(d.config.cada_horas) : "",
    diasAviso: String(d.config.dias_aviso ?? 3),
    contarDesde: d.config.contar_desde ?? "",
    destinatarios: d.destinatarios.map((x) => x.id_usuario),
  };
}

function problemaDe(b: Borrador): string | null {
  const f = enteroONulo(b.frecuencia);
  const h = enteroONulo(b.horas);
  const a = enteroONulo(b.diasAviso);
  if (Number.isNaN(f) || (f !== null && (f < 1 || f > 3650))) return "Los días tienen que ir de 1 a 3650.";
  if (Number.isNaN(h) || (h !== null && (h < 1 || h > 87600))) return "Las horas tienen que ir de 1 a 87600.";
  if (Number.isNaN(a) || (a !== null && (a < 0 || a > 60))) return "Avisar con 0 a 60 días de anticipación.";
  return null;
}

function Campo({ titulo, children, ayuda }: { titulo: string; children: React.ReactNode; ayuda?: string }) {
  return (
    <label className="text-[11px] font-medium text-gray-600 space-y-1 block" title={ayuda}>
      <span>{titulo}</span>
      {children}
    </label>
  );
}

const INPUT = "h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[#445EF2]";

function Configurar({ d, candidatos, cargandoCandidatos, onGuardar, onCancelar }: {
  d: MantenimientoDeMaquina;
  candidatos: Destinatario[] | null;
  cargandoCandidatos: boolean;
  onGuardar: (b: Borrador) => void;
  onCancelar: () => void;
}) {
  const [b, setB] = useState<Borrador>(() => borradorDe(d));
  const problema = problemaDe(b);
  const alternar = (id: number) =>
    setB((x) => ({ ...x, destinatarios: x.destinatarios.includes(id)
      ? x.destinatarios.filter((y) => y !== id) : [...x.destinatarios, id] }));
  // Los ya elegidos que no están entre los posibles (se desactivaron o les borraron el
  // email): se muestran para poder sacarlos.
  const lista: Destinatario[] = [
    ...(candidatos ?? []),
    ...d.destinatarios.filter((x) => !(candidatos ?? []).some((c) => c.id_usuario === x.id_usuario)),
  ];

  return (
    <div className="rounded-lg border border-[#445EF2]/30 bg-[#445EF2]/[0.03] p-3 space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Campo titulo="Cada cuántos días">
          <input type="number" inputMode="numeric" min={1} max={3650} value={b.frecuencia} placeholder="—"
            onChange={(e) => setB({ ...b, frecuencia: e.target.value })} className={INPUT} />
        </Campo>
        <Campo titulo="Cada cuántas horas de uso" ayuda="Opcional. Horas efectivas de uso (las de la sección Uso).">
          <input type="number" inputMode="numeric" min={1} value={b.horas} placeholder="opcional"
            onChange={(e) => setB({ ...b, horas: e.target.value })} className={INPUT} />
        </Campo>
        <Campo titulo="Avisar con (días)">
          <input type="number" inputMode="numeric" min={0} max={60} value={b.diasAviso}
            onChange={(e) => setB({ ...b, diasAviso: e.target.value })} className={INPUT} />
        </Campo>
        <Campo titulo="Contar desde" ayuda="Se usa mientras no haya ningún mantenimiento registrado (o si es más nuevo que el último).">
          <input type="date" value={b.contarDesde}
            onChange={(e) => setB({ ...b, contarDesde: e.target.value })} className={INPUT} />
        </Campo>
      </div>

      <div className="space-y-1.5">
        <p className="flex items-center gap-1 text-[11px] font-medium text-gray-600">
          <Users className="h-3.5 w-3.5" /> A quién le llega el email del aviso
        </p>
        {cargandoCandidatos && !candidatos ? (
          <p className="text-[11px] text-gray-400">Buscando los usuarios…</p>
        ) : lista.length === 0 ? (
          <p className="text-[11px] text-gray-500">No hay usuarios activos con email cargado.</p>
        ) : (
          <div className="max-h-44 overflow-y-auto rounded-md border border-gray-100 bg-white divide-y divide-gray-50">
            {lista.map((u) => {
              const elegido = b.destinatarios.includes(u.id_usuario);
              const noRecibe = u.recibe === false;
              return (
                <label key={u.id_usuario} className="flex items-center gap-2 px-2 py-1.5 text-xs cursor-pointer hover:bg-gray-50">
                  <input type="checkbox" checked={elegido} onChange={() => alternar(u.id_usuario)}
                    className="h-3.5 w-3.5 accent-[#445EF2]" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-gray-900">{u.nombre}</span>
                    {u.email && <span className="text-gray-400"> · {u.email}</span>}
                  </span>
                  {noRecibe && <span className="text-[10px] text-amber-700">no le llega</span>}
                </label>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-gray-500">
          {b.destinatarios.length === 0
            ? "Nadie elegido: el aviso sale sólo en la campanita."
            : `${b.destinatarios.length} ${b.destinatarios.length === 1 ? "elegido" : "elegidos"}.`}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {problema && <span className="mr-auto text-[11px] text-red-600">{problema}</span>}
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>Cancelar</Button>
        <Button type="button" size="sm" disabled={!!problema} onClick={() => onGuardar(b)}
          className="bg-[#445EF2] hover:bg-[#3a50d6] text-white">
          <Check className="h-3.5 w-3.5 mr-1" /> Guardar
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────── registrar uno hecho ───────────────────────────

function RegistrarHecho({ inicial, onGuardar, onCancelar }: {
  inicial: { fecha: string; hecho_por: string; nota: string };
  onGuardar: (v: { fecha: string; hecho_por: string; nota: string }) => void;
  onCancelar: () => void;
}) {
  const hoy = isoLocal(new Date());
  const [v, setV] = useState(inicial);
  const problema = !v.fecha ? "Falta el día." : v.fecha > hoy ? "No puede ser una fecha futura." : null;
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Campo titulo="Día en que se hizo">
          <input type="date" value={v.fecha} max={hoy} onChange={(e) => setV({ ...v, fecha: e.target.value })} className={INPUT} />
        </Campo>
        <Campo titulo="Quién lo hizo">
          <input type="text" maxLength={120} value={v.hecho_por} placeholder="Nombre o empresa"
            onChange={(e) => setV({ ...v, hecho_por: e.target.value })} className={INPUT} />
        </Campo>
        <Campo titulo="Nota (opcional)">
          <input type="text" maxLength={500} value={v.nota} placeholder="Qué se hizo"
            onChange={(e) => setV({ ...v, nota: e.target.value })} className={INPUT} />
        </Campo>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {problema && <span className="mr-auto text-[11px] text-red-600">{problema}</span>}
        <Button type="button" variant="ghost" size="sm" onClick={onCancelar}>Cancelar</Button>
        <Button type="button" size="sm" disabled={!!problema} onClick={() => onGuardar(v)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <CalendarCheck className="h-3.5 w-3.5 mr-1" /> Registrar
        </Button>
      </div>
    </div>
  );
}

// ─────────────────────────── la sección ───────────────────────────

export default function MantenimientoMaquina({ idMaquina, mantenimiento, edita, onCambio }: {
  idMaquina: number;
  mantenimiento: Mantenimiento;
  /** Puede editar la solapa Recurso maquinaria (el backend pide lo mismo). */
  edita: boolean;
  /** Algo cambió (la frecuencia, el estado): la tabla de máquinas lo vuelve a pedir. */
  onCambio?: (d: MantenimientoDeMaquina) => void;
}) {
  const { user } = useAuth();
  const { datos, estado, poner } = mantenimiento;
  const [configurando, setConfigurando] = useState(false);
  const [registrando, setRegistrando] = useState<{ fecha: string; hecho_por: string; nota: string } | null>(null);
  const [aBorrar, setABorrar] = useState<number | null>(null);
  const [candidatos, setCandidatos] = useState<Destinatario[] | null>(null);
  const [cargandoCandidatos, setCargandoCandidatos] = useState(false);

  // La lista de usuarios se pide recién al abrir la configuración, y sólo quien puede
  // editar (el backend no se la da a nadie más).
  useEffect(() => {
    if (!configurando || !edita || candidatos !== null) return;
    let vigente = true;
    setCargandoCandidatos(true);
    fetch(`${API_URL}/maquinarias-mantenimiento/destinatarios`, { headers: cabeceras() })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (vigente) setCandidatos(Array.isArray(b?.data) ? b.data : []); })
      .catch(() => { if (vigente) setCandidatos([]); })
      .finally(() => { if (vigente) setCargandoCandidatos(false); });
    return () => { vigente = false; };
  }, [configurando, edita, candidatos]);

  if (estado === "cargando" && !datos) {
    return <p className="px-1 py-6 text-xs text-gray-400">Leyendo el mantenimiento…</p>;
  }
  if (estado === "error" && !datos) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        No se pudo leer el mantenimiento de la máquina. Probá de nuevo en un rato.
      </p>
    );
  }
  if (!datos) return null;
  const d = datos;

  const guardarConfig = async (b: Borrador) => {
    const anterior = d;
    const nombres = new Map([...(candidatos ?? []), ...d.destinatarios].map((u) => [u.id_usuario, u]));
    // Se ve al toque: la configuración nueva, con los elegidos.
    poner({
      ...d,
      config: {
        ...d.config,
        frecuencia_dias: enteroONulo(b.frecuencia),
        cada_horas: enteroONulo(b.horas),
        dias_aviso: enteroONulo(b.diasAviso) ?? 3,
        contar_desde: b.contarDesde || null,
      },
      destinatarios: b.destinatarios.map((id) => nombres.get(id) ?? { id_usuario: id, nombre: `Usuario #${id}`, email: null }),
    });
    setConfigurando(false);
    try {
      const res = await fetch(`${API_URL}/maquinarias/${idMaquina}/mantenimiento`, {
        method: "PUT",
        headers: cabeceras(true),
        body: JSON.stringify({
          frecuencia_dias: enteroONulo(b.frecuencia),
          cada_horas: enteroONulo(b.horas),
          dias_aviso: enteroONulo(b.diasAviso) ?? 3,
          contar_desde: b.contarDesde || null,
          destinatarios: b.destinatarios,
        }),
      });
      if (!res.ok) {
        poner(anterior);
        setConfigurando(true);
        toast.error(await motivoDelError(res, "No se pudo guardar el mantenimiento; quedó como estaba."));
        return;
      }
      const body = await res.json().catch(() => null);
      if (body?.data?.estado) {
        poner(body.data as MantenimientoDeMaquina);
        onCambio?.(body.data as MantenimientoDeMaquina);
      }
      toast.success("Mantenimiento guardado.");
    } catch {
      poner(anterior);
      setConfigurando(true);
      toast.error("No se pudo conectar con el servidor: el mantenimiento quedó como estaba.");
    }
  };

  const registrar = async (v: { fecha: string; hecho_por: string; nota: string }) => {
    const anterior = d;
    const provisorio: MantenimientoHecho = {
      id: -Date.now(), fecha: v.fecha, hecho_por: v.hecho_por || null, nota: v.nota || null,
      cargado_en: null, usuario_carga: null, pendiente: true,
    };
    poner({ ...d, historial: [provisorio, ...d.historial].sort((a, b) => b.fecha.localeCompare(a.fecha)) });
    setRegistrando(null);
    try {
      const res = await fetch(`${API_URL}/maquinarias/${idMaquina}/mantenimientos`, {
        method: "POST",
        headers: cabeceras(true),
        body: JSON.stringify({ fecha: v.fecha, hecho_por: v.hecho_por || null, nota: v.nota || null }),
      });
      if (!res.ok) {
        poner(anterior);
        setRegistrando(v);
        toast.error(await motivoDelError(res, "No se pudo registrar el mantenimiento."));
        return;
      }
      const body = await res.json().catch(() => null);
      if (body?.data?.estado) {
        poner(body.data as MantenimientoDeMaquina);
        onCambio?.(body.data as MantenimientoDeMaquina);
      }
      toast.success(`Mantenimiento del ${fechaCorta(v.fecha)} registrado.`);
    } catch {
      poner(anterior);
      setRegistrando(v);
      toast.error("No se pudo conectar con el servidor: el mantenimiento no se registró.");
    }
  };

  const borrar = async (h: MantenimientoHecho) => {
    const anterior = d;
    poner({ ...d, historial: d.historial.filter((x) => x.id !== h.id) });
    setABorrar(null);
    try {
      const res = await fetch(`${API_URL}/maquinarias/${idMaquina}/mantenimientos/${h.id}`, {
        method: "DELETE",
        headers: cabeceras(),
      });
      if (!res.ok) {
        poner(anterior);
        toast.error(await motivoDelError(res, "No se pudo borrar; quedó como estaba."));
        return;
      }
      const body = await res.json().catch(() => null);
      if (body?.data?.estado) {
        poner(body.data as MantenimientoDeMaquina);
        onCambio?.(body.data as MantenimientoDeMaquina);
      }
    } catch {
      poner(anterior);
      toast.error("No se pudo conectar con el servidor: quedó como estaba.");
    }
  };

  const nombreUsuario = [user?.nombre, user?.apellido].filter(Boolean).join(" ");
  const c = d.config;

  return (
    <div className="flex flex-col gap-3">
      <Estado d={d} />

      {/* La configuración: en texto, y con «Cambiar» para quien edita. */}
      {configurando ? (
        <Configurar d={d} candidatos={candidatos} cargandoCandidatos={cargandoCandidatos}
          onGuardar={(b) => void guardarConfig(b)} onCancelar={() => setConfigurando(false)} />
      ) : (
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-800">Configuración</p>
            {edita && (
              <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => setConfigurando(true)}>
                <Pencil className="h-3 w-3 mr-1" /> Cambiar
              </Button>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
            <div><dt className="text-[10px] uppercase tracking-wide text-gray-400">Cada</dt>
              <dd>{c.frecuencia_dias ? `${c.frecuencia_dias} ${c.frecuencia_dias === 1 ? "día" : "días"}` : <span className="italic text-gray-400">sin cargar</span>}</dd></div>
            <div><dt className="text-[10px] uppercase tracking-wide text-gray-400">Por uso</dt>
              <dd>{c.cada_horas ? `cada ${c.cada_horas} h` : <span className="italic text-gray-400">no</span>}</dd></div>
            <div><dt className="text-[10px] uppercase tracking-wide text-gray-400">Avisar con</dt>
              <dd>{c.dias_aviso} {c.dias_aviso === 1 ? "día" : "días"}</dd></div>
            <div><dt className="text-[10px] uppercase tracking-wide text-gray-400">Contar desde</dt>
              <dd>{c.contar_desde ? fechaCorta(c.contar_desde) : <span className="italic text-gray-400">—</span>}</dd></div>
          </dl>
          <div className="pt-1">
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-gray-400">
              <Mail className="h-3 w-3" /> Email del aviso
            </p>
            {d.destinatarios.length === 0 ? (
              <p className="text-xs text-gray-500">A nadie: el aviso sale sólo en la campanita.</p>
            ) : (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {d.destinatarios.map((u) => (
                  <span key={u.id_usuario}
                    title={u.recibe === false ? "No le llega: está inactivo o no tiene email." : u.email ?? undefined}
                    className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]",
                      u.recibe === false ? "border-amber-300 bg-amber-50 text-amber-800 line-through" : "border-[#05c7f2]/40 bg-[#05c7f2]/10 text-[#010e26]")}>
                    {u.nombre}
                  </span>
                ))}
              </div>
            )}
          </div>
          {!d.email_configurado && (
            <p className="text-[11px] text-gray-500">
              El envío de emails todavía no está configurado en el servidor: por ahora el aviso llega
              a la campanita, y el email va a salir cuando se configure.
            </p>
          )}
        </div>
      )}

      {/* El historial. */}
      <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-slate-800">Mantenimientos hechos</p>
          {edita && !registrando && (
            <Button type="button" size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
              onClick={() => setRegistrando({ fecha: isoLocal(new Date()), hecho_por: nombreUsuario, nota: "" })}>
              <Plus className="h-3 w-3 mr-1" />
              <span className="sm:hidden">Registrar uno hecho</span>
              <span className="hidden sm:inline">Registrar mantenimiento hecho</span>
            </Button>
          )}
        </div>
        {registrando && (
          <RegistrarHecho inicial={registrando} onGuardar={(v) => void registrar(v)} onCancelar={() => setRegistrando(null)} />
        )}
        {d.historial.length === 0 ? (
          <p className="text-[11px] text-gray-500">Todavía no se registró ninguno.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {d.historial.map((h) => (
              <li key={h.id} className={cn("py-1.5 flex items-start justify-between gap-2 text-xs", h.pendiente && "opacity-60")}>
                <div className="min-w-0">
                  <p>
                    <span className="font-semibold tabular-nums text-slate-800">{fechaCorta(h.fecha)}</span>
                    {h.hecho_por && <span className="text-gray-700"> · {h.hecho_por}</span>}
                  </p>
                  {h.nota && <p className="text-gray-600 break-words">{h.nota}</p>}
                  {(h.usuario_carga || h.cargado_en) && (
                    <p className="text-[10px] text-gray-400">
                      Cargado{h.usuario_carga ? ` por ${h.usuario_carga}` : ""}{h.cargado_en ? ` el ${momentoCorto(h.cargado_en)}` : ""}
                    </p>
                  )}
                </div>
                {edita && !h.pendiente && (aBorrar === h.id ? (
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="text-[10px] text-gray-500 hidden sm:inline">Se vuelve a contar desde el anterior.</span>
                    <Button type="button" variant="destructive" size="sm" className="h-6 px-2 text-[11px]" onClick={() => void borrar(h)}>
                      Borrar
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5" aria-label="No borrar" onClick={() => setABorrar(null)}>
                      <X className="h-3 w-3" />
                    </Button>
                  </span>
                ) : (
                  <Button type="button" variant="ghost" size="sm" className="h-6 px-1.5 text-gray-400 hover:text-red-600"
                    aria-label={`Borrar el mantenimiento del ${fechaCorta(h.fecha)}`} title="Borrar (cargado por error)"
                    onClick={() => setABorrar(h.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                ))}
              </li>
            ))}
          </ul>
        )}
      </div>

      {d.avisos.length > 0 && (
        <div className="rounded-lg border border-gray-100 bg-white px-3 py-2 space-y-1">
          <p className="flex items-center gap-1 text-xs font-semibold text-slate-800"><BellRing className="h-3.5 w-3.5" /> Avisos que salieron</p>
          <ul className="space-y-0.5">
            {d.avisos.map((a) => (
              <li key={a.id} className="text-[11px] text-gray-600" title={a.email_detalle ?? undefined}>
                <span className="tabular-nums">{momentoCorto(a.creado_en)}</span> · {a.motivo_texto}
                {a.vence ? ` (${fechaCorta(a.vence)})` : ""} ·{" "}
                <span className={cn(a.email_estado === "ENVIADO" ? "text-emerald-700" :
                  a.email_estado === "FALLO" || a.email_estado === "PARCIAL" ? "text-red-700" : "text-gray-500")}>
                  {EMAIL_ESTADO_TEXTO[a.email_estado] ?? a.email_estado}
                  {a.email_enviados > 0 ? ` (${a.email_enviados})` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
        <span>
          El aviso sale una sola vez por vencimiento, a la campanita y por email a los elegidos: cuando
          faltan los días que pusiste o, si se pasó, vencido (por fecha o por horas de uso). Registrar el
          mantenimiento hecho vuelve a empezar la cuenta.
        </span>
      </p>
    </div>
  );
}
