"use client";

/**
 * Pausar y reanudar la OT o uno de sus pasos, desde la ficha de la OT (RF-03).
 *
 * Va arriba de todo en la ficha, debajo del título: una OT pausada es lo primero que hay
 * que saber al abrirla, y el botón «Reanudar» tiene que estar donde el aviso del
 * planificador dice que está.
 *
 *  · Lo pausado se ve como una franja ámbar por pausa: qué (la OT o el paso), por qué,
 *    desde cuándo y quién, con su «Reanudar».
 *  · «Pausar…» abre un formulario en línea: la OT entera o un paso que no esté
 *    terminado, el motivo de la lista cerrada y, con «Otro», por qué.
 *  · Se ve al toque: pausar y reanudar se pintan antes de que conteste el servidor; si
 *    dice que no (otra persona la pausó recién, el paso se terminó), vuelve como estaba y
 *    se muestra el porqué que manda el backend. El cartel de las listas cambia solo.
 *  · Los botones sólo para quien puede tocar la OT (la solapa Órdenes, igual que el
 *    backend). El que sólo mira ve la franja y el historial.
 *  · Con un backend de antes de RF-03 la ruta no existe y esto no dibuja nada.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { History, PauseCircle, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { API_URL } from "@/config";
import { usePermisos } from "@/hooks/usePermisos";
import { momentoCorto } from "@/lib/asistencia";
import {
  MOTIVOS_PAUSA,
  type MotivoPausa,
  type Pausa,
  aplicarPausa,
  cabecerasPausas,
  listaDePasos,
  pausar as pedirPausa,
  queSePauso,
  reanudar as pedirReanudar,
} from "@/lib/pausas";
import { toast } from "@/lib/toast";
import { capitalizeName, cn } from "@/lib/utils";

/** Lo que hace falta de cada paso de la OT: viene en la misma OT que abre la ficha. */
export interface PasoDeOT {
  id?: number;
  orden: number;
  proceso?: { nombre?: string } | null;
  estado_proceso?: { id?: number } | null;
}

type Estado = "cargando" | "si" | "no" | "error";

// Ids de las pausas que todavía no contestó el servidor: negativos, de un contador.
let proximoTemporal = -1;

const LARGO_OBSERVACION = 500;

function ahoraLocal(): string {
  const d = new Date();
  const dos = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}T${dos(d.getHours())}:${dos(d.getMinutes())}:00`;
}

function duracion(min: number): string {
  if (min < 60) return `${Math.max(0, min)} min`;
  if (min < 60 * 24) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const d = Math.floor(min / (60 * 24));
  return d === 1 ? "1 día" : `${d} días`;
}

export function PausasDeLaOT({ idOrden, numeroOT, pasos, entregada }: {
  idOrden: number;
  /** El número que conoce el taller. */
  numeroOT: number | string;
  pasos: PasoDeOT[];
  /** Ya se entregó al cliente: no hay nada que pausar. */
  entregada?: boolean;
}) {
  const { puedeSeccion } = usePermisos();
  const puedeEscribir = puedeSeccion("operaciones_ordenes", "write");

  const [estado, setEstado] = useState<Estado>("cargando");
  const [lista, setLista] = useState<Pausa[]>([]);
  const [formulario, setFormulario] = useState(false);
  const [historial, setHistorial] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const pedido = useRef(0);

  const pedir = useCallback(async () => {
    const este = ++pedido.current;
    try {
      const res = await fetch(`${API_URL}/ordenes/${idOrden}/pausas`, { headers: cabecerasPausas() });
      if (este !== pedido.current) return;
      // 404/405: backend de antes de RF-03. 401/403: sin sesión o sin permiso.
      if ([401, 403, 404, 405].includes(res.status)) {
        setEstado("no");
        return;
      }
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (este !== pedido.current) return;
      if (!body?.status || !Array.isArray(body.data)) {
        setEstado((e) => (e === "si" ? e : "error"));
        return;
      }
      setLista(body.data as Pausa[]);
      setEstado("si");
    } catch {
      if (este === pedido.current) setEstado((e) => (e === "si" ? e : "error"));
    }
  }, [idOrden]);

  useEffect(() => {
    setLista([]);
    setEstado("cargando");
    setFormulario(false);
    setHistorial(false);
    void pedir();
  }, [pedir]);

  const pasosOrdenados = useMemo(
    () => [...pasos].filter((p) => p.id).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || (a.id ?? 0) - (b.id ?? 0)),
    [pasos],
  );
  const abiertas = lista.filter((p) => p.abierta);
  const deLaOt = abiertas.find((p) => p.alcance === "ot") ?? null;
  const deLosPasos = abiertas.filter((p) => p.alcance === "paso");
  const cerradas = lista.filter((p) => !p.abierta);
  const pasosPausados = new Set(deLosPasos.map((p) => p.id_otp));
  const todosTerminados = pasosOrdenados.length > 0 && pasosOrdenados.every((p) => p.estado_proceso?.id === 3);
  const otPausable = !deLaOt && !entregada && !todosTerminados;
  // Con la OT entera pausada, un paso ya está parado: el backend no deja pausarlo aparte.
  const pasosPausables = deLaOt ? [] : pasosOrdenados.filter((p) => p.estado_proceso?.id !== 3 && !pasosPausados.has(p.id!));
  const sePuedePausar = otPausable || pasosPausables.length > 0;

  // ── Pausar ──────────────────────────────────────────────────────────────────
  const confirmarPausa = async (alcance: "ot" | number, motivo: MotivoPausa, observacion: string) => {
    const paso = alcance === "ot" ? null : pasosOrdenados.find((p) => p.id === alcance) ?? null;
    const temporal: Pausa = {
      id: proximoTemporal--,
      id_orden_trabajo: idOrden,
      numero_ot: Number(numeroOT) || idOrden,
      alcance: paso ? "paso" : "ot",
      id_otp: paso?.id ?? null,
      paso: paso?.orden ?? null,
      nombre_proceso: paso?.proceso?.nombre ?? null,
      motivo,
      motivo_texto: MOTIVOS_PAUSA.find((m) => m.codigo === motivo)?.texto ?? motivo,
      observacion: observacion.trim() || null,
      desde: ahoraLocal(),
      hasta: null,
      abierta: true,
      cierre: null,
      cierre_texto: null,
      usuario_pausa: null,
      usuario_reanuda: null,
      minutos: 0,
      pendiente: true,
    };
    setLista((l) => [temporal, ...l]);
    setFormulario(false);
    setEnviando(true);
    try {
      const guardada = await pedirPausa(idOrden, {
        motivo,
        observacion: observacion.trim() || null,
        id_otp: paso?.id ?? null,
      });
      setLista((l) => l.map((p) => (p.id === temporal.id ? guardada : p)));
      aplicarPausa(guardada);
      const siguen = guardada.pasos_en_proceso ?? [];
      toast.success(guardada.alcance === "ot" ? `OT ${numeroOT} pausada` : `Paso ${guardada.paso} pausado`, {
        description: [
          guardada.alcance === "ot"
            ? "No entra en los planes nuevos hasta que la reanuden."
            : "No entra en los planes nuevos, ni lo que va después, hasta que lo reanuden.",
          siguen.length
            ? `${listaDePasos(siguen).replace(/^./, (c) => c.toUpperCase())} ${siguen.length === 1 ? "sigue en proceso, parado" : "siguen en proceso, parados"}.`
            : "",
        ].filter(Boolean).join(" "),
      });
    } catch (e) {
      setLista((l) => l.filter((p) => p.id !== temporal.id));
      toast.error("No se pausó", { description: e instanceof Error ? e.message : undefined });
      // Lo más probable es que alguien la haya tocado recién: se trae como está.
      void pedir();
    } finally {
      setEnviando(false);
    }
  };

  // ── Reanudar ────────────────────────────────────────────────────────────────
  const confirmarReanudar = async (pausa: Pausa) => {
    const antes = pausa;
    setLista((l) => l.map((p) => (p.id === pausa.id ? { ...p, abierta: false, hasta: ahoraLocal(), pendiente: true } : p)));
    setEnviando(true);
    try {
      const cerrada = await pedirReanudar(idOrden, pausa.alcance === "paso" ? pausa.id_otp : null);
      setLista((l) => l.map((p) => (p.id === pausa.id ? cerrada : p)));
      aplicarPausa(cerrada);
      const siguen = cerrada.pasos_que_siguen_pausados ?? [];
      toast.success(cerrada.alcance === "ot" ? `OT ${numeroOT} reanudada` : `Paso ${cerrada.paso} reanudado`, {
        description: siguen.length
          ? `Ojo: ${listaDePasos(siguen)} ${siguen.length === 1 ? "tiene su propia pausa y sigue parado" : "tienen su propia pausa y siguen parados"}.`
          : "Vuelve a entrar en los planes nuevos.",
      });
    } catch (e) {
      setLista((l) => l.map((p) => (p.id === pausa.id ? antes : p)));
      toast.error("No se reanudó", { description: e instanceof Error ? e.message : undefined });
      void pedir();
    } finally {
      setEnviando(false);
    }
  };

  if (estado === "no" || estado === "cargando") return null;
  if (estado === "error" && !lista.length) return null;
  const hayAlgo = abiertas.length > 0 || cerradas.length > 0 || (puedeEscribir && sePuedePausar);
  if (!hayAlgo) return null;

  return (
    <div className="flex flex-col gap-1.5 border-b bg-white px-3 py-2 sm:px-6 flex-shrink-0">
      {[...(deLaOt ? [deLaOt] : []), ...deLosPasos].map((p) => (
        <FranjaPausada
          key={p.id}
          pausa={p}
          puedeReanudar={puedeEscribir && !p.pendiente && !enviando}
          onReanudar={() => void confirmarReanudar(p)}
        />
      ))}

      {formulario ? (
        <FormularioPausa
          otPausable={otPausable}
          pasos={pasosPausables}
          enviando={enviando}
          onCancelar={() => setFormulario(false)}
          onConfirmar={(alcance, motivo, observacion) => void confirmarPausa(alcance, motivo, observacion)}
        />
      ) : (
        (puedeEscribir && sePuedePausar) || cerradas.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {puedeEscribir && sePuedePausar && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
                disabled={enviando}
                onClick={() => setFormulario(true)}
              >
                <PauseCircle className="h-3.5 w-3.5" />
                Pausar…
              </Button>
            )}
            {cerradas.length > 0 && (
              <button
                type="button"
                onClick={() => setHistorial((v) => !v)}
                aria-expanded={historial}
                className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
              >
                <History className="h-3.5 w-3.5" />
                {historial ? "Ocultar pausas anteriores" : `Pausas anteriores (${cerradas.length})`}
              </button>
            )}
          </div>
        ) : null
      )}

      {historial && cerradas.length > 0 && (
        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-gray-50/60 px-3">
          {cerradas.map((p) => (
            <li key={p.id} className="py-1.5 text-[11px] text-gray-600">
              <span className="font-medium text-gray-800">
                {queSePauso(p).replace(/^./, (c) => c.toUpperCase())}
              </span>
              {" · "}{p.motivo_texto}{p.observacion ? `: «${p.observacion}»` : ""}
              {" · "}
              <span className="tabular-nums">
                {momentoCorto(p.desde)}{p.hasta ? ` → ${momentoCorto(p.hasta)}` : ""}
              </span>
              {p.hasta ? ` (${duracion(p.minutos)})` : ""}
              <span className="block text-gray-400">
                {p.usuario_pausa ? `La pausó ${capitalizeName(p.usuario_pausa)}` : "Pausada"}
                {p.cierre_texto
                  ? ` · ${p.cierre === "REANUDADA" && p.usuario_reanuda ? `reanudada por ${capitalizeName(p.usuario_reanuda)}` : p.cierre_texto.toLowerCase()}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FranjaPausada({ pausa, puedeReanudar, onReanudar }: {
  pausa: Pausa;
  puedeReanudar: boolean;
  onReanudar: () => void;
}) {
  const titulo = pausa.alcance === "ot"
    ? "OT pausada"
    : `Paso ${pausa.paso ?? ""}${pausa.nombre_proceso ? ` — ${pausa.nombre_proceso}` : ""} pausado`;
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900 ring-1 ring-amber-200",
        pausa.pendiente && "opacity-70",
      )}
      role="status"
    >
      <PauseCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden />
      <span className="font-semibold">{titulo}</span>
      <span className="min-w-0">
        {pausa.motivo_texto}{pausa.observacion ? `: «${pausa.observacion}»` : ""}
      </span>
      <span className="text-amber-800/80 tabular-nums">
        desde el {momentoCorto(pausa.desde)}
        {pausa.usuario_pausa ? ` · ${capitalizeName(pausa.usuario_pausa)}` : ""}
        {pausa.pendiente ? " · guardando…" : ""}
      </span>
      {puedeReanudar && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto h-7 px-2.5 text-xs border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
          onClick={onReanudar}
        >
          <Play className="h-3.5 w-3.5" />
          Reanudar
        </Button>
      )}
    </div>
  );
}

function FormularioPausa({ otPausable, pasos, enviando, onCancelar, onConfirmar }: {
  otPausable: boolean;
  pasos: PasoDeOT[];
  enviando: boolean;
  onCancelar: () => void;
  onConfirmar: (alcance: "ot" | number, motivo: MotivoPausa, observacion: string) => void;
}) {
  const [alcance, setAlcance] = useState<string>(otPausable ? "ot" : String(pasos[0]?.id ?? ""));
  const [motivo, setMotivo] = useState<MotivoPausa | "">("");
  const [observacion, setObservacion] = useState("");

  const falta = !alcance
    ? "Elegí qué se pausa."
    : !motivo
      ? "Elegí el motivo."
      : motivo === "OTRO" && !observacion.trim()
        ? "Con «Otro», contá en una línea por qué se pausa."
        : null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/40 p-2.5">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-[11px] font-medium text-gray-600">
          <span>Qué se pausa</span>
          <select
            value={alcance}
            onChange={(e) => setAlcance(e.target.value)}
            className="h-8 w-full rounded-md border border-gray-200 bg-white px-1.5 text-xs"
          >
            {otPausable && <option value="ot">La OT entera</option>}
            {pasos.map((p) => (
              <option key={p.id} value={String(p.id)}>
                Paso {p.orden}{p.proceso?.nombre ? ` — ${p.proceso.nombre}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-600">
          <span>Motivo</span>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as MotivoPausa | "")}
            className="h-8 w-full rounded-md border border-gray-200 bg-white px-1.5 text-xs"
          >
            <option value="">Elegí el motivo</option>
            {MOTIVOS_PAUSA.map((m) => <option key={m.codigo} value={m.codigo}>{m.texto}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-[11px] font-medium text-gray-600">
          <span>{motivo === "OTRO" ? "Por qué" : "Nota (opcional)"}</span>
          <input
            value={observacion}
            maxLength={LARGO_OBSERVACION}
            onChange={(e) => setObservacion(e.target.value)}
            placeholder={motivo === "OTRO" ? "Contá por qué se pausa" : "Por ejemplo: llega el lunes"}
            className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={cn("text-[11px]", falta ? "text-gray-500" : "text-gray-600")}>
          {falta ?? (alcance === "ot"
            ? "Queda registrado quién y cuándo. Los pasos en proceso siguen en proceso, parados; la OT sale de los planes nuevos."
            : "Queda registrado quién y cuándo. Ese paso y los que van después salen de los planes nuevos.")}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={onCancelar}>
            <X className="h-3.5 w-3.5" /> Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-xs bg-amber-600 hover:bg-amber-700 text-white"
            disabled={!!falta || enviando}
            onClick={() => onConfirmar(alcance === "ot" ? "ot" : Number(alcance), motivo as MotivoPausa, observacion)}
          >
            <PauseCircle className="h-3.5 w-3.5" /> Pausar
          </Button>
        </div>
      </div>
    </div>
  );
}
