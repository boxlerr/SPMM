"use client";

/**
 * «Registrar rechazo / no conformidad»: el formulario corto (RF-12).
 *
 * Lucas, 23/09: «si algo se rechazó, que quede el registro de que tuviste 10 piezas que
 * se rechazaron. Entonces, ¿quién la hizo? Tal empleado». Por eso el formulario pide,
 * en este orden, lo que se sabe parado al lado de la pieza:
 *
 *   1. la OT (desde su ficha ya viene; desde No conformidades se escribe el número);
 *   2. en qué paso — y con el paso se PRECARGA quién lo hizo, según la OT (elegida a
 *      mano) o el último plan: la misma regla que los tiempos de RF-06. Es una
 *      sugerencia y se cambia; lo que se guarda es lo que queda elegido;
 *   3. cuántas piezas se rechazaron y, si se sabe, de cuántas controladas;
 *   4. el tipo (arranca en «Pieza rechazada en control»), la gravedad y qué se hace con
 *      lo rechazado; y qué pasó, en texto libre.
 *
 * Quién la registra y cuándo NO se piden: los pone el servidor (del usuario y del
 * reloj del taller). Acá sólo se dice, para que se sepa.
 *
 * Al confirmar el formulario se cierra y la fila aparece al toque en la lista de quien
 * lo abrió (onRegistrar); si el servidor dice que no, quien lo abrió la saca y vuelve a
 * abrir esto con lo que se había cargado (`borrador`): no se pierde lo tipeado.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileWarning, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import {
  type Catalogos,
  type CuerpoRechazo,
  type OrdenParaRegistrar,
  ORIGEN_SUGERIDO,
  type PasoParaRegistrar,
  type Persona,
  nombreDePersona,
  nombreVisible,
  pedirPasos,
  pedirPersonas,
} from "@/lib/calidad";
import { cn } from "@/lib/utils";

/** Lo cargado en el formulario, tal cual (textos), para poder volver a abrirlo igual. */
export interface BorradorRechazo {
  nroOt: string;
  idOtp: string;
  piezas: string;
  controladas: string;
  idOperario: string;
  personaTocada: boolean;
  tipo: string;
  gravedad: string;
  disposicion: string;
  descripcion: string;
}

/** Lo que hace falta para dibujar la fila antes de que conteste el servidor. */
export interface VistaDelRechazo {
  nro_ot: number | null;
  paso: number | null;
  proceso: string | null;
  operario: string | null;
  usuario: string | null;
}

type EstadoPasos = "nada" | "cargando" | "ok" | "no_existe" | "sin_servidor" | "error";

const LARGO_DESCRIPCION = 500;

function vacio(catalogos: Catalogos, nroOt = ""): BorradorRechazo {
  return {
    nroOt,
    idOtp: "",
    piezas: "",
    controladas: "",
    idOperario: "",
    personaTocada: false,
    tipo: catalogos.tipo_del_formulario && catalogos.tipos[catalogos.tipo_del_formulario]
      ? catalogos.tipo_del_formulario
      : Object.keys(catalogos.tipos)[0] ?? "OTRO",
    gravedad: "",
    disposicion: "",
    descripcion: "",
  };
}

/** Un entero >= 0, o null si está vacío. NaN si no es un número entero no negativo. */
function entero(texto: string): number | null {
  const t = texto.trim();
  if (!t) return null;
  return /^\d+$/.test(t) ? Number(t) : NaN;
}

export function RegistrarRechazo({ open, onClose, catalogos, orden, borrador, onRegistrar }: {
  open: boolean;
  onClose: () => void;
  catalogos: Catalogos;
  /** Desde la ficha de la OT: la orden ya está elegida. Sin esto, se escribe el número. */
  orden?: { id: number; nro_ot: number | string | null } | null;
  /** Lo que se había cargado, para volver a abrir igual si el guardado falló. */
  borrador?: BorradorRechazo | null;
  onRegistrar: (cuerpo: CuerpoRechazo, vista: VistaDelRechazo, borrador: BorradorRechazo) => void;
}) {
  const { user } = useAuth();
  const [f, setF] = useState<BorradorRechazo>(() => borrador ?? vacio(catalogos));
  const [ordenLista, setOrdenLista] = useState<OrdenParaRegistrar | null>(null);
  const [pasos, setPasos] = useState<PasoParaRegistrar[]>([]);
  const [estadoPasos, setEstadoPasos] = useState<EstadoPasos>("nada");
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [intento, setIntento] = useState(false);
  const pedido = useRef(0);

  // Cada vez que se abre: de cero, o con lo que se había cargado.
  useEffect(() => {
    if (!open) return;
    setF(borrador ?? vacio(catalogos, orden?.nro_ot != null ? String(orden.nro_ot) : ""));
    setIntento(false);
    void pedirPersonas().then(setPersonas);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // La orden y sus pasos: por id desde la ficha; por número mientras se escribe.
  useEffect(() => {
    if (!open) return;
    const este = ++pedido.current;
    const nro = f.nroOt.trim();
    if (!orden?.id && !nro) {
      setOrdenLista(null);
      setPasos([]);
      setEstadoPasos("nada");
      return;
    }
    setEstadoPasos("cargando");
    const t = setTimeout(async () => {
      try {
        const r = await pedirPasos(orden?.id ? { id_orden: orden.id } : { nro_ot: nro });
        if (este !== pedido.current) return;
        setOrdenLista(r.orden);
        setPasos(r.pasos);
        setEstadoPasos(r.orden ? "ok" : "no_existe");
      } catch {
        if (este !== pedido.current) return;
        setOrdenLista(null);
        setPasos([]);
        // Desde la ficha la orden igual se conoce: se carga sin paso. Desde la pantalla,
        // sin el número resuelto no hay a qué orden colgarla.
        setEstadoPasos(orden?.id ? "sin_servidor" : "error");
      }
    }, orden?.id ? 0 : 300);
    return () => clearTimeout(t);
  }, [open, orden?.id, f.nroOt]); // eslint-disable-line react-hooks/exhaustive-deps

  const pasoElegido = pasos.find((p) => String(p.id_otp) === f.idOtp) ?? null;
  const sugeridos = pasoElegido?.sugeridos ?? [];

  const elegirPaso = (idOtp: string) => {
    const paso = pasos.find((p) => String(p.id_otp) === idOtp) ?? null;
    setF((x) => ({
      ...x,
      idOtp,
      // Se precarga quién lo hizo mientras nadie la haya elegido a mano. Sin sugerencia
      // se vacía: la persona del paso anterior no hizo éste.
      idOperario: x.personaTocada ? x.idOperario : String(paso?.sugeridos[0]?.id_operario ?? ""),
    }));
  };

  const opcionesPersonas = useMemo(
    () => personas.map((p) => ({ value: String(p.id), label: p.nombre })),
    [personas],
  );

  const piezas = entero(f.piezas);
  const controladas = entero(f.controladas);
  const problemas: string[] = [];
  if (Number.isNaN(piezas)) problemas.push("Las piezas rechazadas tienen que ser un número entero, 0 o más.");
  if (Number.isNaN(controladas)) problemas.push("Las controladas tienen que ser un número entero, 0 o más.");
  if (piezas !== null && controladas !== null && !Number.isNaN(piezas) && !Number.isNaN(controladas) && piezas > controladas) {
    problemas.push(`No se pueden rechazar más piezas (${piezas}) de las que se controlaron (${controladas}).`);
  }
  const idOrden = orden?.id ?? ordenLista?.id ?? null;
  if (!idOrden) problemas.push("Falta la orden de trabajo.");
  const listo = problemas.length === 0 && estadoPasos !== "cargando";

  const confirmar = () => {
    setIntento(true);
    if (!listo || !idOrden) return;
    const persona = personas.find((p) => String(p.id) === f.idOperario);
    const cuerpo: CuerpoRechazo = {
      id_orden_trabajo: idOrden,
      id_otp: pasoElegido?.id_otp ?? null,
      id_proceso: pasoElegido?.id_proceso ?? null,
      id_operario: f.idOperario ? Number(f.idOperario) : null,
      tipo: f.tipo,
      gravedad: f.gravedad || null,
      disposicion: f.disposicion || null,
      piezas_afectadas: piezas,
      piezas_controladas: controladas,
      descripcion: f.descripcion.trim() || null,
    };
    onRegistrar(cuerpo, {
      nro_ot: Number(ordenLista?.nro_ot ?? orden?.nro_ot) || null,
      paso: pasoElegido?.paso ?? null,
      proceso: pasoElegido?.proceso ?? null,
      operario: persona?.nombre ?? null,
      usuario: user ? nombreDePersona(user.nombre, user.apellido) || null : null,
    }, f);
    onClose();
  };

  const quien = user ? nombreDePersona(user.nombre, user.apellido) : "";
  const numero = ordenLista?.nro_ot ?? orden?.nro_ot;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[92vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="text-left">
          <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
            <FileWarning className="h-5 w-5 shrink-0 text-amber-600" />
            Registrar rechazo / no conformidad
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Qué se rechazó, cuántas piezas y quién las hizo. Queda en la OT y en la ficha de la persona.
          </DialogDescription>
        </DialogHeader>

        {/* Enter en un campo confirma; en la descripción, es un renglón nuevo. */}
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); confirmar(); }}
        >
          {/* 1. La orden */}
          {orden?.id ? (
            <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-mono font-bold text-slate-900">OT {numero}</span>
              {ordenLista && (ordenLista.cliente || ordenLista.producto) && (
                <span className="text-slate-500"> · {[ordenLista.cliente, ordenLista.producto].filter(Boolean).join(" · ")}</span>
              )}
            </p>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="nc-ot" className="text-xs font-medium text-gray-600">N° de OT</Label>
              <Input
                id="nc-ot"
                value={f.nroOt}
                inputMode="numeric"
                autoFocus
                placeholder="Ej: 7015"
                onChange={(e) => setF((x) => ({ ...x, nroOt: e.target.value.replace(/\D/g, ""), idOtp: "" }))}
                className="h-9"
              />
              <p className={cn("text-[11px]", estadoPasos === "no_existe" || estadoPasos === "error" ? "text-rose-600" : "text-gray-500")}>
                {estadoPasos === "cargando" && "Buscando la orden…"}
                {estadoPasos === "no_existe" && "No hay ninguna OT con ese número."}
                {estadoPasos === "error" && "No se pudo buscar la orden. Probá de nuevo en unos segundos."}
                {estadoPasos === "ok" && ordenLista && (
                  <>{[ordenLista.cliente, ordenLista.producto].filter(Boolean).join(" · ") || "Sin cliente ni producto"}
                    {ordenLista.unidades ? ` · ${ordenLista.unidades} unidades` : ""}</>
                )}
              </p>
            </div>
          )}

          {/* 2. El paso */}
          <div className="space-y-1">
            <Label htmlFor="nc-paso" className="text-xs font-medium text-gray-600">¿En qué paso de la OT?</Label>
            <select
              id="nc-paso"
              value={f.idOtp}
              onChange={(e) => elegirPaso(e.target.value)}
              disabled={estadoPasos !== "ok" || pasos.length === 0}
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm disabled:bg-gray-50 disabled:text-gray-400"
            >
              <option value="">{pasos.length ? "Sin paso / toda la orden" : estadoPasos === "ok" ? "La OT no tiene pasos cargados" : "—"}</option>
              {pasos.map((p) => (
                <option key={p.id_otp} value={p.id_otp}>
                  Paso {p.paso} · {p.proceso || "Proceso"}{p.estado ? ` (${p.estado})` : ""}
                </option>
              ))}
            </select>
            {estadoPasos === "sin_servidor" && (
              <p className="text-[11px] text-amber-700">No se pudieron traer los pasos: se carga para la OT entera.</p>
            )}
          </div>

          {/* 3. Las piezas. `items-end`: en el teléfono el rótulo de la derecha baja de
              renglón y, sin esto, los dos campos quedaban a distinta altura. */}
          <div className="grid grid-cols-2 gap-3 items-end">
            <div className="space-y-1">
              <Label htmlFor="nc-piezas" className="text-xs font-medium text-gray-600">Piezas rechazadas</Label>
              <Input id="nc-piezas" inputMode="numeric" placeholder="Ej: 10" value={f.piezas} className="h-9"
                     onChange={(e) => setF((x) => ({ ...x, piezas: e.target.value.replace(/[^\d]/g, "") }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="nc-controladas" className="text-xs font-medium text-gray-600">
                De cuántas controladas <span className="font-normal text-gray-400">(opcional)</span>
              </Label>
              <Input id="nc-controladas" inputMode="numeric"
                     placeholder={ordenLista?.unidades ? `Ej: ${ordenLista.unidades}` : "Ej: 50"}
                     value={f.controladas} className="h-9"
                     onChange={(e) => setF((x) => ({ ...x, controladas: e.target.value.replace(/[^\d]/g, "") }))} />
            </div>
          </div>

          {/* 4. Quién las hizo */}
          <div className="space-y-1">
            <Label className="text-xs font-medium text-gray-600">¿Quién las hizo?</Label>
            <SearchableSelect
              options={opcionesPersonas}
              value={f.idOperario}
              onValueChange={(v) => setF((x) => ({ ...x, idOperario: v, personaTocada: true }))}
              placeholder="No se sabe / nadie en particular"
              triggerClassName="h-9"
            />
            {sugeridos.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500">
                <span>Hizo el paso:</span>
                {sugeridos.map((s) => (
                  <button
                    key={s.id_operario}
                    type="button"
                    onClick={() => setF((x) => ({ ...x, idOperario: String(s.id_operario), personaTocada: true }))}
                    className={cn(
                      "rounded-full border px-2 py-0.5 transition-colors",
                      f.idOperario === String(s.id_operario)
                        ? "border-blue-300 bg-blue-50 text-blue-700"
                        : "border-gray-200 hover:bg-gray-50",
                    )}
                  >
                    {nombreVisible(s.nombre)} <span className="text-gray-400">· {ORIGEN_SUGERIDO[s.origen]}</span>
                  </button>
                ))}
              </div>
            )}
            {pasoElegido && sugeridos.length === 0 && (
              <p className="text-[11px] text-gray-500">
                Ni la OT ni el plan dicen quién hizo este paso: elegilo si lo sabés.
              </p>
            )}
          </div>

          {/* 5. Qué fue */}
          <div className="space-y-1">
            <Label htmlFor="nc-tipo" className="text-xs font-medium text-gray-600">Tipo</Label>
            <select
              id="nc-tipo"
              value={f.tipo}
              onChange={(e) => setF((x) => ({ ...x, tipo: e.target.value }))}
              className="h-9 w-full rounded-md border border-gray-200 bg-white px-2 text-sm"
            >
              {Object.entries(catalogos.tipos).map(([clave, rotulo]) => (
                <option key={clave} value={clave}>{rotulo}</option>
              ))}
            </select>
          </div>

          <Opciones
            titulo="Gravedad"
            lista={catalogos.gravedades}
            valor={f.gravedad}
            onCambiar={(v) => setF((x) => ({ ...x, gravedad: v }))}
            nada="Sin clasificar"
          />
          {catalogos.disposiciones && (
            <Opciones
              titulo="¿Qué se hace con lo rechazado?"
              lista={catalogos.disposiciones}
              valor={f.disposicion}
              onCambiar={(v) => setF((x) => ({ ...x, disposicion: v }))}
              nada="Todavía no se decidió"
            />
          )}

          <div className="space-y-1">
            <Label htmlFor="nc-descripcion" className="text-xs font-medium text-gray-600">
              Qué pasó <span className="font-normal text-gray-400">(opcional)</span>
            </Label>
            <Textarea
              id="nc-descripcion"
              rows={2}
              maxLength={LARGO_DESCRIPCION}
              placeholder="Diámetro pasado 0,2 mm, rebaba en el corte, soldadura porosa…"
              value={f.descripcion}
              onChange={(e) => setF((x) => ({ ...x, descripcion: e.target.value }))}
            />
          </div>

          {intento && problemas.length > 0 && (
            <ul className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 space-y-0.5">
              {problemas.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}

          <p className="text-[11px] text-gray-400">
            {quien ? `La registra ${quien}` : "Queda registrado quién la carga"}, con la fecha y la hora de ahora.
          </p>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={estadoPasos === "cargando"} className="bg-amber-600 text-white hover:bg-amber-700">
              {estadoPasos === "cargando" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Una fila de chips para elegir uno (o ninguno: tocar el elegido lo suelta). */
function Opciones({ titulo, lista, valor, onCambiar, nada }: {
  titulo: string;
  lista: Record<string, string>;
  valor: string;
  onCambiar: (v: string) => void;
  /** Qué quiere decir no elegir ninguno. */
  nada: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-gray-600">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(lista).map(([clave, rotulo]) => (
          <button
            key={clave}
            type="button"
            aria-pressed={valor === clave}
            onClick={() => onCambiar(valor === clave ? "" : clave)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              valor === clave
                ? "border-[#445EF2] bg-[#445EF2] text-white"
                : "border-gray-200 text-gray-600 hover:bg-gray-50",
            )}
          >
            {rotulo}
          </button>
        ))}
        {!valor && <span className="self-center text-[11px] text-gray-400">{nada}</span>}
      </div>
    </div>
  );
}
