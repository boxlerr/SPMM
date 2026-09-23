"use client";

/**
 * «Control de calidad» en la ficha de la OT (RF-12).
 *
 * Una franja debajo del título, como la de pausas y fuera del formulario de la OT (sus
 * botones no guardan la OT): cuántas no conformidades tiene, cuántas siguen abiertas y
 * cuántas piezas se rechazaron. «Ver» despliega la lista, con cerrar cada una anotando
 * qué se hizo; «Registrar rechazo» abre el formulario corto.
 *
 *  · Se ve al toque: lo cargado aparece en la lista antes de que conteste el servidor y
 *    lo cerrado se pinta cerrado; si el servidor dice que no, vuelve como estaba y se
 *    dice por qué (y el formulario se reabre con lo tipeado).
 *  · Cargar y cerrar, sólo con No conformidades en escritura (lo mismo que pide el
 *    backend). El que sólo mira ve la franja y la lista.
 *  · Con un servidor de antes del 23/09 no hay botón de cargar (guardar un tipo nuevo
 *    fallaría); con uno sin la ruta de la OT, la franja no aparece.
 *
 * EL ENGANCHE CON RF-11 (la casilla «Controlado», otra rama): esto escucha
 * `ofrecerRegistrarRechazos(idOrden)` de lib/calidad.ts. Al tildar «Controlado», RF-11
 * lo llama y acá aparece «¿Hubo piezas rechazadas?» con «Sí, cargarlas» / «No».
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Plus, RotateCcw, ShieldCheck, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { API_URL } from "@/config";
import { usePermisos } from "@/hooks/usePermisos";
import {
  type Catalogos,
  type CuerpoRechazo,
  EVENTO_OT_CONTROLADA,
  type NoConformidad,
  type ResumenNC,
  cabecerasCalidad,
  filaProvisoria,
  guardarNoConformidad,
  momentoNC,
  nombreVisible,
  pasoTexto,
  pedirCatalogos,
  piezasTexto,
  porcentajeTexto,
  registrarRechazo,
  sabeCargarRechazos,
} from "@/lib/calidad";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

import { type BorradorRechazo, RegistrarRechazo } from "./RegistrarRechazo";

type Estado = "cargando" | "si" | "no" | "error";

let proximoTemporal = -1;

/**
 * El resumen, contado de la lista. Se cuenta acá y no se usa el del servidor porque la
 * lista de UNA orden viene entera, y así lo que se carga o se cierra en pantalla mueve
 * los números al toque (con la misma regla del servidor: el porcentaje, sólo de las que
 * dicen de cuántas controladas).
 */
function recontar(filas: NoConformidad[]): ResumenNC {
  const abiertas = filas.filter((f) => f.estado !== "CERRADA").length;
  const conLosDos = filas.filter((f) => f.piezas_afectadas != null && f.piezas_controladas != null);
  const controladas = conLosDos.reduce((s, f) => s + (f.piezas_controladas ?? 0), 0);
  const rechazadas = conLosDos.reduce((s, f) => s + (f.piezas_afectadas ?? 0), 0);
  return {
    total: filas.length,
    abiertas,
    cerradas: filas.length - abiertas,
    minutos_perdidos: filas.reduce((s, f) => s + (f.minutos_perdidos || 0), 0),
    piezas_afectadas: filas.reduce((s, f) => s + (f.piezas_afectadas ?? 0), 0),
    piezas_controladas: filas.reduce((s, f) => s + (f.piezas_controladas ?? 0), 0),
    porcentaje_rechazo: controladas ? Math.round((1000 * rechazadas) / controladas) / 10 : null,
  };
}

export function ControlDeCalidadOT({ idOrden, numeroOT }: {
  idOrden: number;
  /** El número que conoce el taller. */
  numeroOT: number | string;
}) {
  const { puede } = usePermisos();
  const puedeCargar = puede("no_conformidades", "write");

  const [estado, setEstado] = useState<Estado>("cargando");
  const [filas, setFilas] = useState<NoConformidad[]>([]);
  const [catalogos, setCatalogos] = useState<Catalogos | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [formulario, setFormulario] = useState(false);
  const [borrador, setBorrador] = useState<BorradorRechazo | null>(null);
  const [preguntar, setPreguntar] = useState(false);
  const pedido = useRef(0);

  const pedir = useCallback(async () => {
    const este = ++pedido.current;
    try {
      const res = await fetch(`${API_URL}/ordenes/${idOrden}/incidencias`, { headers: cabecerasCalidad() });
      if (este !== pedido.current) return;
      // 404/405: servidor sin la ruta. 401/403: sin sesión o sin permiso.
      if ([401, 403, 404, 405].includes(res.status)) {
        setEstado("no");
        return;
      }
      const body = res.ok ? await res.json().catch(() => null) : null;
      if (este !== pedido.current) return;
      if (!body?.status || !Array.isArray(body.data?.no_conformidades)) {
        setEstado((e) => (e === "si" ? e : "error"));
        return;
      }
      setFilas(body.data.no_conformidades);
      setEstado("si");
    } catch {
      if (este === pedido.current) setEstado((e) => (e === "si" ? e : "error"));
    }
  }, [idOrden]);

  useEffect(() => {
    setFilas([]);
    setEstado("cargando");
    setAbierto(false);
    setPreguntar(false);
    void pedir();
    void pedirCatalogos().then(setCatalogos);
  }, [pedir]);

  // RF-11: al tildar «Controlado», la pregunta.
  useEffect(() => {
    const escuchar = (e: Event) => {
      const detalle = (e as CustomEvent<{ idOrden?: number }>).detail;
      if (detalle?.idOrden === idOrden) setPreguntar(true);
    };
    window.addEventListener(EVENTO_OT_CONTROLADA, escuchar);
    return () => window.removeEventListener(EVENTO_OT_CONTROLADA, escuchar);
  }, [idOrden]);

  const sabeCargar = sabeCargarRechazos(catalogos);
  const habilitaCarga = puedeCargar && sabeCargar;

  const abrirFormulario = () => {
    setBorrador(null);
    setPreguntar(false);
    setFormulario(true);
  };

  // ── Registrar: se ve al toque ────────────────────────────────────────────────
  const registrar = async (cuerpo: CuerpoRechazo, vista: Parameters<typeof filaProvisoria>[1], lo: BorradorRechazo) => {
    const temporal = filaProvisoria(cuerpo, vista, proximoTemporal--);
    setFilas((l) => [temporal, ...l]);
    setAbierto(true);
    try {
      const guardada = await registrarRechazo(cuerpo);
      setFilas((l) => l.map((f) => (f.id === temporal.id ? guardada : f)));
      toast.success(`Rechazo registrado en la OT ${numeroOT}`);
    } catch (e) {
      setFilas((l) => l.filter((f) => f.id !== temporal.id));
      toast.error("No se registró", { description: e instanceof Error ? e.message : undefined });
      // Lo tipeado no se pierde: el formulario vuelve con lo mismo.
      setBorrador(lo);
      setFormulario(true);
    }
  };

  // ── Cerrar / volver a abrir: se ve al toque ─────────────────────────────────
  const cambiarEstado = async (nc: NoConformidad, cerrar: boolean, accion: string) => {
    const antes = nc;
    const provisoria: NoConformidad = cerrar
      ? { ...nc, estado: "CERRADA", accion_correctiva: accion.trim() || nc.accion_correctiva, fecha_cierre: new Date().toISOString(), pendiente: true }
      : { ...nc, estado: "ABIERTA", fecha_cierre: null, pendiente: true };
    const poner = (fila: NoConformidad) => setFilas((l) => l.map((f) => (f.id === nc.id ? fila : f)));
    poner(provisoria);
    try {
      const guardada = cerrar
        ? await guardarNoConformidad(nc.id, "/cerrar", { accion_correctiva: accion.trim() || null })
        : await guardarNoConformidad(nc.id, "", { estado: "ABIERTA" });
      poner({ ...antes, ...guardada, pendiente: false });
      toast.success(cerrar ? "No conformidad cerrada" : "Se volvió a abrir");
      return true;
    } catch (e) {
      poner(antes);
      toast.error(cerrar ? "No se cerró" : "No se volvió a abrir", { description: e instanceof Error ? e.message : undefined });
      return false;
    }
  };

  if (estado === "no" || estado === "cargando") return null;
  if (estado === "error" && !filas.length) return null;

  const r = recontar(filas);
  const hay = filas.length > 0;

  return (
    <div className="flex flex-col gap-1.5 border-b bg-white px-3 py-2 sm:px-6 flex-shrink-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-800">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#445EF2]" />
          Control de calidad
        </span>
        {hay ? (
          <button
            type="button"
            onClick={() => setAbierto((a) => !a)}
            aria-expanded={abierto}
            className="order-last sm:order-none w-full sm:w-auto inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1 text-left text-xs text-gray-600 hover:bg-gray-50"
          >
            <span>
              {r.total} {r.total === 1 ? "no conformidad" : "no conformidades"}
              {r.abiertas > 0 && <span className="font-semibold text-amber-700"> · {r.abiertas} {r.abiertas === 1 ? "abierta" : "abiertas"}</span>}
            </span>
            <span className="font-semibold text-rose-700 tabular-nums">
              {r.piezas_afectadas} {r.piezas_afectadas === 1 ? "pieza rechazada" : "piezas rechazadas"}
              {r.porcentaje_rechazo != null && <span className="font-normal text-gray-500"> ({porcentajeTexto(r.porcentaje_rechazo)} de las controladas)</span>}
            </span>
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", abierto && "rotate-180")} />
            <span className="sr-only">{abierto ? "Ocultar" : "Ver"}</span>
          </button>
        ) : (
          <span className="order-last sm:order-none w-full sm:w-auto text-xs text-gray-500">Sin rechazos registrados</span>
        )}
        {habilitaCarga ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={abrirFormulario}
            className="ml-auto h-7 px-2.5 text-xs border-amber-300 text-amber-800 hover:bg-amber-50"
          >
            {/* En el teléfono, corto: así entra en el renglón del título y la franja
                ocupa dos renglones y no tres. */}
            <Plus className="mr-1 h-3.5 w-3.5" /> Registrar<span className="hidden sm:inline">&nbsp;rechazo</span>
          </Button>
        ) : puedeCargar && catalogos && !sabeCargar ? (
          <span className="ml-auto text-[11px] text-gray-400">Para cargar rechazos falta actualizar el servidor.</span>
        ) : null}
      </div>

      {/* RF-11: se tildó «Controlado». */}
      {preguntar && habilitaCarga && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs text-slate-800">
          <span className="font-medium">La OT quedó controlada. ¿Hubo piezas rechazadas?</span>
          <span className="ml-auto flex gap-1.5">
            <Button type="button" size="sm" className="h-7 px-2.5 text-xs bg-[#445EF2] hover:bg-[#3a51d6]" onClick={abrirFormulario}>
              Sí, cargarlas
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => setPreguntar(false)}>
              No
            </Button>
          </span>
        </div>
      )}

      {abierto && hay && (
        <ul className="max-h-[40vh] overflow-y-auto divide-y rounded-md border border-gray-100">
          {filas.map((nc) => (
            <FilaNC key={nc.id} nc={nc} catalogos={catalogos} puedeEditar={puedeCargar} onEstado={cambiarEstado} />
          ))}
        </ul>
      )}

      {catalogos && habilitaCarga && (
        <RegistrarRechazo
          open={formulario}
          onClose={() => setFormulario(false)}
          catalogos={catalogos}
          orden={{ id: idOrden, nro_ot: numeroOT }}
          borrador={borrador}
          onRegistrar={(cuerpo, vista, lo) => void registrar(cuerpo, vista, lo)}
        />
      )}
    </div>
  );
}

function FilaNC({ nc, catalogos, puedeEditar, onEstado }: {
  nc: NoConformidad;
  catalogos: Catalogos | null;
  puedeEditar: boolean;
  onEstado: (nc: NoConformidad, cerrar: boolean, accion: string) => Promise<boolean>;
}) {
  const [cerrando, setCerrando] = useState(false);
  const [accion, setAccion] = useState(nc.accion_correctiva ?? "");
  const cerrada = nc.estado === "CERRADA";
  const tipo = catalogos?.tipos[nc.tipo] ?? nc.tipo;
  const disposicion = nc.disposicion ? (catalogos?.disposiciones?.[nc.disposicion] ?? nc.disposicion) : null;
  const gravedad = nc.gravedad ? (catalogos?.gravedades[nc.gravedad] ?? nc.gravedad) : null;

  return (
    <li className={cn("px-3 py-2 text-xs", nc.pendiente && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {cerrada
          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
          : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" />}
        <span className="font-medium text-slate-900">{pasoTexto(nc)}</span>
        <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-px text-[11px] text-gray-700">{tipo}</span>
        {gravedad && (
          <span className={cn(
            "rounded-full border px-2 py-px text-[11px]",
            nc.gravedad === "GRAVE" ? "border-rose-200 bg-rose-50 text-rose-700"
              : nc.gravedad === "MEDIA" ? "border-amber-200 bg-amber-50 text-amber-700"
                : "border-sky-200 bg-sky-50 text-sky-700",
          )}>{gravedad}</span>
        )}
        <span className="ml-auto text-[11px] tabular-nums text-gray-400">{nc.pendiente ? "guardando…" : momentoNC(nc.fecha_registro)}</span>
      </div>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-600">
        {nc.piezas_afectadas != null && (
          <span className="font-semibold text-rose-700 tabular-nums">
            {piezasTexto(nc.piezas_afectadas, nc.piezas_controladas)} {nc.piezas_controladas != null ? "rechazadas" : nc.piezas_afectadas === 1 ? "pieza rechazada" : "piezas rechazadas"}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <User className="h-3 w-3" /> {nc.operario ? `Las hizo ${nombreVisible(nc.operario)}` : "Sin decir quién las hizo"}
        </span>
        {disposicion && <span>{disposicion}</span>}
        {nc.usuario && <span className="text-gray-400">La registró {nc.usuario}</span>}
      </p>
      {nc.descripcion && <p className="mt-1 whitespace-pre-wrap text-gray-700">{nc.descripcion}</p>}

      {cerrada ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
          <span>
            Cerrada el {momentoNC(nc.fecha_cierre)}
            {nc.accion_correctiva ? <> · Qué se hizo: <span className="text-gray-700">{nc.accion_correctiva}</span></> : null}
          </span>
          {puedeEditar && !nc.pendiente && (
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-[11px]"
                    onClick={() => void onEstado(nc, false, "")}>
              <RotateCcw className="mr-1 h-3 w-3" /> Volver a abrirla
            </Button>
          )}
        </div>
      ) : puedeEditar && !nc.pendiente && nc.id > 0 ? (
        cerrando ? (
          <div className="mt-1.5 space-y-1.5">
            <Textarea
              rows={2}
              value={accion}
              autoFocus
              onChange={(e) => setAccion(e.target.value)}
              placeholder="Acción correctiva: qué se hizo para que no vuelva a pasar"
              className="text-xs"
            />
            <div className="flex flex-wrap gap-1.5">
              <Button type="button" size="sm" className="h-7 px-2.5 text-xs"
                      onClick={async () => { if (await onEstado(nc, true, accion)) setCerrando(false); }}>
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Darla por resuelta
              </Button>
              <Button type="button" size="sm" variant="ghost" className="h-7 px-2.5 text-xs" onClick={() => setCerrando(false)}>
                Cancelar
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="sm" className="mt-1 h-6 px-2 text-[11px] text-slate-700"
                  onClick={() => setCerrando(true)}>
            Cerrar con la acción correctiva…
          </Button>
        )
      ) : null}
    </li>
  );
}
