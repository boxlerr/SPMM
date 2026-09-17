"use client";

/**
 * Las celdas editables de «Procesos planificados», en la vista previa del plan.
 *
 * Son cuatro piezas chicas y no un componente de fila entera a propósito: la fila del
 * plan ya existe —con sus chips de «A mano», «Tercerizado», el aviso de sin recurso
 * humano y los desplegables de persona y máquina— y lo que hacía falta era volver
 * editables el NOMBRE y los MINUTOS, más poder sacar, mover y agregar pasos. Envolver
 * todo eso en un componente nuevo era rehacer lo que ya funciona.
 *
 * El que guarda es el padre (`useProcesosEnPlan`): acá sólo está la pantalla. Ver ahí
 * por qué el plan no se recalcula solo y qué significan las marcas.
 */

import React from "react";
import { ArrowDown, ArrowUp, Check, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import type { CambioDeLinea } from "@/components/planning/useProcesosEnPlan";

export interface ProcesoDelCatalogo { id: number; nombre: string; }

/**
 * El desplegable de procesos, que nace abierto.
 *
 * `SearchableSelect` se despliega con un click en su caja y no tiene forma de venir
 * abierto. Sin esto, cambiarle el proceso a una fila son tres clicks: el lápiz, la
 * caja y la opción. Si el truco no encuentra la caja (cambió el componente), no se
 * rompe nada: queda el desplegable cerrado y se abre con un click, como siempre.
 */
function DesplegableDeProcesos({
    procesos, valor, onElegir, deshabilitado,
}: {
    procesos: ProcesoDelCatalogo[];
    valor?: number;
    onElegir: (id: number, nombre: string) => void;
    deshabilitado?: boolean;
}) {
    const caja = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        const disparador = caja.current?.firstElementChild?.firstElementChild as HTMLElement | null;
        disparador?.click();
    }, []);

    const opciones = React.useMemo(
        () => procesos.map(p => ({ value: String(p.id), label: p.nombre })),
        [procesos],
    );

    return (
        <div ref={caja} className="min-w-0 flex-1">
            <SearchableSelect
                options={opciones}
                value={valor ? String(valor) : ""}
                onValueChange={(v) => {
                    if (!v) return;
                    const elegido = procesos.find(p => String(p.id) === v);
                    if (elegido) onElegir(elegido.id, elegido.nombre);
                }}
                placeholder={procesos.length === 0 ? "Buscando procesos…" : "Buscar proceso…"}
                disabled={deshabilitado || procesos.length === 0}
                triggerClassName="h-7 text-xs px-2"
            />
        </div>
    );
}

/**
 * El nombre del proceso de la fila: se lee, y con el lápiz se cambia por otro.
 *
 * Cambiar el proceso NO es lo mismo que corregir un tipeo: la fila pasa a ser otro
 * trabajo, con otros rangos y otras máquinas. Por eso la persona y la máquina que
 * muestra el plan quedan marcadas como viejas hasta que se recalcule.
 */
export function NombreDeProcesoEditable({
    texto, idProceso, procesos, cambio, esNueva, bloqueado, motivoBloqueo, trabajando, onCambiar,
}: {
    /** El nombre ya presentado (capitalizado) por la tabla. */
    texto: string;
    idProceso?: number;
    procesos: ProcesoDelCatalogo[];
    cambio?: CambioDeLinea;
    esNueva?: boolean;
    bloqueado?: boolean;
    motivoBloqueo?: string;
    trabajando?: boolean;
    onCambiar: (idProceso: number, nombre: string) => void;
}) {
    const [editando, setEditando] = React.useState(false);

    if (editando) {
        return (
            <div className="flex min-w-0 flex-1 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <DesplegableDeProcesos
                    procesos={procesos}
                    valor={idProceso}
                    deshabilitado={trabajando}
                    onElegir={(id, nombre) => {
                        setEditando(false);
                        if (id !== idProceso) onCambiar(id, nombre);
                    }}
                />
                <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setEditando(false)}
                    className="shrink-0 rounded p-1 text-gray-400 hover:bg-gray-100"
                    title="Dejarlo como estaba"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            </div>
        );
    }

    return (
        <span className="flex min-w-0 items-baseline gap-1">
            <span
                className={cn(
                    "truncate font-medium text-gray-800",
                    cambio?.proceso && "text-amber-900 underline decoration-amber-400 decoration-dotted underline-offset-2",
                )}
                title={cambio?.proceso ? `Antes era «${cambio.proceso.antes}»` : texto}
            >
                {texto}
            </span>
            {trabajando ? (
                <Loader2 className="h-3 w-3 shrink-0 animate-spin text-gray-400" />
            ) : (
                <button
                    type="button"
                    disabled={bloqueado}
                    onClick={(e) => { e.stopPropagation(); setEditando(true); }}
                    className={cn(
                        "shrink-0 rounded p-0.5 text-gray-300 transition-colors",
                        bloqueado ? "cursor-not-allowed opacity-40" : "hover:bg-blue-50 hover:text-blue-600 group-hover/row:text-gray-500",
                    )}
                    title={bloqueado
                        ? (motivoBloqueo || "No se puede editar ahora")
                        : "Cambiar este paso por otro proceso"}
                >
                    <Pencil className="h-3 w-3" />
                </button>
            )}
            {esNueva && (
                <span
                    className="shrink-0 rounded border border-emerald-200 bg-emerald-50 px-1.5 text-xs font-medium text-emerald-700"
                    title="Se agregó desde acá. Está en la OT, pero todavía no tiene lugar en el plan: recalculá."
                >
                    Nuevo
                </span>
            )}
        </span>
    );
}

/**
 * Los minutos de la fila: se leen, no se tocan.
 *
 * Estuvieron editables un rato el 17/09 y Julián los sacó el mismo día: *"ya hablamos
 * del tema de los minutos, no se pueden cambiar de ahí, tienen que venir bien desde
 * antes"*. El tiempo de un proceso es un dato de la orden —se carga cuando se carga la
 * OT y de ahí sale el plan—, así que corregirlo mientras se mira el plan es tapar el
 * agujero por donde entró mal. El globito dice DÓNDE se corrige y no sólo que acá no
 * se puede: si no, el que encuentra el error igual se queda sin saber adónde ir.
 */
export function MinutosDelProceso({ minutos }: { minutos: number }) {
    return (
        <span
            className="shrink-0 rounded bg-gray-100 px-1.5 text-xs tabular-nums text-gray-500"
            title={`${minutos} minutos estimados. Es un dato de la orden: si está mal, se corrige en la ficha de la OT (o en el catálogo de procesos) y se vuelve a planificar. Desde acá no se cambia.`}
        >
            {minutos}m
        </span>
    );
}

/**
 * Subir, bajar y sacar el paso.
 *
 * Los botones se ven siempre, apenas marcados: escondidos atrás del hover no hay forma
 * de saber que la fila se puede tocar salvo tropezársela (misma decisión que en la
 * lista de Operaciones).
 */
export function AccionesDeProcesoEnPlan({
    nombre, esPrimero, esUltimo, sinMover, bloqueado, motivoBloqueo, trabajando,
    onSubir, onBajar, onBorrar,
}: {
    nombre: string;
    esPrimero: boolean;
    esUltimo: boolean;
    /** Sin flechitas: el paso recién agregado va al final hasta que se recalcule, y
     *  moverlo antes de que el plan lo ubique no significa nada. */
    sinMover?: boolean;
    bloqueado?: boolean;
    motivoBloqueo?: string;
    trabajando?: boolean;
    onSubir: () => void;
    onBajar: () => void;
    onBorrar: () => void;
}) {
    const [confirmando, setConfirmando] = React.useState(false);
    const apagado = bloqueado || trabajando;

    const boton = "rounded p-1 text-current transition-colors disabled:cursor-not-allowed disabled:opacity-30";

    return (
        <>
            <ConfirmationDialog
                isOpen={confirmando}
                onClose={() => setConfirmando(false)}
                onConfirm={onBorrar}
                title="Sacar el proceso de la OT"
                description={`Se va a sacar «${nombre}» de la orden, con el trabajo que tenga cargado (estado y avance). Se va también del plan que estás mirando y, si esta OT ya estaba planificada, del plan guardado. Para recuperarlo hay que volver a agregarlo.`}
                confirmText="Sí, sacarlo"
                cancelText="Volver"
                variant="destructive"
            />
            <div
                className="flex items-center justify-end gap-0.5 text-gray-300 transition-colors group-hover/row:text-gray-500"
                onClick={(e) => e.stopPropagation()}
            >
                {!sinMover && (
                    <>
                        <button
                            type="button"
                            className={cn(boton, "hover:bg-blue-50 hover:text-blue-600")}
                            disabled={apagado || esPrimero}
                            onClick={onSubir}
                            title={esPrimero ? "Ya es el primer paso" : (motivoBloqueo || "Subir un paso")}
                        >
                            <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                            type="button"
                            className={cn(boton, "hover:bg-blue-50 hover:text-blue-600")}
                            disabled={apagado || esUltimo}
                            onClick={onBajar}
                            title={esUltimo ? "Ya es el último paso" : (motivoBloqueo || "Bajar un paso")}
                        >
                            <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                    </>
                )}
                <button
                    type="button"
                    className={cn(boton, "hover:bg-red-50 hover:text-red-600")}
                    disabled={apagado}
                    onClick={() => setConfirmando(true)}
                    title={motivoBloqueo || "Sacar este paso de la OT"}
                >
                    {trabajando
                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        : <Trash2 className="h-3.5 w-3.5" />}
                </button>
            </div>
        </>
    );
}

/**
 * Agregar un paso a la OT sin salir del plan.
 *
 * Es el caso de Lucas mirando la prensa: *"acá puedo agregar proceso… pone preparación
 * de máquina, entonces pone un oficial que la prepare y después lo sigue haciendo un
 * pasante"*. Se agrega al final; el paso se acomoda con las flechitas de la fila.
 *
 * Sólo pide proceso y minutos: la persona y la máquina las elige el planificador al
 * recalcular, que es lo que hay que hacer después de agregarlo.
 */
export function AgregarProcesoEnPlan({
    procesos, bloqueado, trabajando, onAbrir, onAgregar,
}: {
    procesos: ProcesoDelCatalogo[];
    bloqueado?: boolean;
    trabajando?: boolean;
    onAbrir?: () => void;
    onAgregar: (idProceso: number, nombre: string, minutos: number) => void;
}) {
    const [abierto, setAbierto] = React.useState(false);
    const [elegido, setElegido] = React.useState<ProcesoDelCatalogo | null>(null);
    const [minutos, setMinutos] = React.useState("");

    const cerrar = () => { setAbierto(false); setElegido(null); setMinutos(""); };

    const agregar = () => {
        const min = parseInt(minutos, 10);
        if (!elegido || isNaN(min) || min <= 0) return;
        onAgregar(elegido.id, elegido.nombre, min);
        cerrar();
    };

    if (!abierto) {
        return (
            <button
                type="button"
                disabled={bloqueado}
                onClick={() => { setAbierto(true); onAbrir?.(); }}
                className={cn(
                    "flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 transition-colors",
                    bloqueado ? "cursor-not-allowed opacity-40" : "hover:bg-blue-50",
                )}
            >
                <Plus className="h-3.5 w-3.5" />
                Agregar proceso a la OT
            </button>
        );
    }

    return (
        <div className="flex flex-wrap items-center gap-2 bg-blue-50/60 px-3 py-2">
            <div className="w-[260px]">
                <SearchableSelect
                    options={procesos.map(p => ({ value: String(p.id), label: p.nombre }))}
                    value={elegido ? String(elegido.id) : ""}
                    onValueChange={(v) => setElegido(procesos.find(p => String(p.id) === v) ?? null)}
                    placeholder={procesos.length === 0 ? "Buscando procesos…" : "Buscar proceso…"}
                    disabled={trabajando || procesos.length === 0}
                    triggerClassName="h-7 text-xs px-2"
                />
            </div>
            <Input
                value={minutos}
                inputMode="numeric"
                placeholder="min"
                disabled={trabajando}
                onChange={(e) => setMinutos(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") agregar(); if (e.key === "Escape") cerrar(); }}
                className="h-7 w-16 px-1 text-center text-xs tabular-nums"
                aria-label="Minutos del proceso nuevo"
            />
            <Button
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={trabajando || !elegido || !minutos}
                onClick={agregar}
            >
                {trabajando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
                Agregar
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={cerrar} disabled={trabajando}>
                Cancelar
            </Button>
            <span className="text-[11px] text-gray-500">
                Va al final de la OT. Recalculá para que le busque horario, persona y máquina.
            </span>
        </div>
    );
}
