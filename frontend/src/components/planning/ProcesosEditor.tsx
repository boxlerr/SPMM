"use client";

/**
 * ProcesosEditor — carga de procesos de una OT en formato "listado"
 * (rediseño pedido en la reunión 2-jul-2026 con Metlo).
 *
 * Reemplaza la carga por tarjetas / filas sueltas por un listado compacto tipo
 * "manejo de procesos" con las columnas: incluir (tilde) · # (orden) · proceso ·
 * minutos · máquina · cantidad de recurso humano.
 *
 * Es un componente CONTROLADO y presentacional: no hace fetch ni sabe de la OT.
 * El padre le pasa `rows` + `onChange` y los catálogos (`procesos`, `maquinarias`).
 * Así se puede reusar tanto en el alta de OT (CreateWorkOrderModal) como en el
 * alta inline sobre OTs existentes (AddProcessRow), y se puede previsualizar con
 * datos mock sin backend.
 *
 * Semántica de campos:
 *  - `incluido` (tilde): por defecto TRUE. Los procesos destildados NO se guardan.
 *    Pensado para el flujo "Traer historial": se trae la lista completa tildada y
 *    se destilda lo que esta vez no va.
 *  - `orden`: la secuencia = la posición en la lista (el backend recalcula el orden
 *    real como max(orden)+1). Acá se muestra como #n informativo.
 *  - `maquina_id`: '' = sin máquina preseleccionada (el planificador elige). Elegir
 *    una máquina ES la "preselección": se fuerza ese proceso a esa máquina.
 *  - `operario_id`: lo mismo para la persona (pedido de Lucas, 26-ago-2026: "al crear
 *    trabajo falta persona en proceso"). '' = el planificador elige. Elegir a alguien
 *    lo fuerza, y pisa el filtro por rango: es una decisión de quien carga la OT.
 */

import React, { useState } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Plus, Trash2, History, Lock, Settings, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProcesoRow {
    /** id temporal de UI (no es el id de proceso) */
    id: string;
    /** id de la PASADA en la base (orden_trabajo_proceso.id) si la fila ya existe.
     *  Vacío = línea nueva. Sin esto, al editar una OT con el mismo proceso repetido
     *  no se sabe cuál fila es cuál y se pierde el estado/avance de las pasadas. */
    id_otp?: number;
    /** id del proceso del catálogo (string para los selects) */
    proceso_id: string;
    /** tiempo estimado en minutos */
    tiempo: string;
    /** operarios que requiere el proceso en simultáneo */
    cant_operarios: string;
    /** máquina preseleccionada; '' = sin preselección (planificador libre) */
    maquina_id: string;
    /** persona preseleccionada; '' = sin preselección (planificador libre) */
    operario_id: string;
    /** tilde incluir/excluir: sólo se guardan los tildados */
    incluido: boolean;
}

/**
 * Lo que el PLANIFICADOR asignó para una pasada. Informativo: no se guarda ni se edita.
 *
 * Es OTRA cosa que la preselección (`maquina_id` / `operario_id` de la fila): la
 * preselección es lo que alguien fuerza a mano, y una OT planificada normalmente la
 * tiene vacía. Abrir una OT ya planificada mostraba "Sin máquina" y "Sin asignar" en
 * todas las filas y parecía que se habían perdido los datos — estaba mirando el campo
 * equivocado (Julián, 10/09: "si abro una planificada quiero ver lo que está
 * planificado ya asignado, así no duplico ni hubo errores").
 */
export interface PlanificadoDeLinea {
    operario: string | null;
    maquinaria: string | null;
    sin_asignar: boolean;
    sin_maquinaria: boolean;
    forzado: boolean;
    lote: string | null;
}

export interface ProcesoCatalogoItem { id: number; nombre: string; }
export interface MaquinaCatalogoItem { id: number; nombre: string; cod_maquina?: string; }
export interface OperarioCatalogoItem { id: number; nombre: string; apellido?: string; }

/**
 * La línea de abajo de la celda: lo que el planificador YA asignó.
 *
 * Va debajo del selector y no adentro, y en otro color, para que no se confunda con
 * la preselección: arriba es lo que uno ELIGE y el motor respeta; abajo es lo que el
 * motor DECIDIÓ. Sin esta separación, una OT planificada se leía como vacía.
 */
function ChipPlanificado({ texto, falta, faltaTexto, hay }: {
    texto?: string | null;
    falta: boolean;
    faltaTexto: string;
    hay: boolean;
}) {
    if (!hay) return null;   // la OT no está planificada: no hay nada que contar
    if (falta || !texto) {
        return (
            <div className="mt-0.5 truncate text-[10px] text-amber-700" title={`En el plan quedó ${faltaTexto}`}>
                ⚠ {faltaTexto}
            </div>
        );
    }
    return (
        <div className="mt-0.5 truncate text-[10px] text-emerald-700"
             title={`El planificador le asignó ${texto}`}>
            ✓ {texto}
        </div>
    );
}

export function makeEmptyRow(): ProcesoRow {
    return {
        id: Math.random().toString(36).slice(2),
        proceso_id: "",
        tiempo: "",
        cant_operarios: "1",
        maquina_id: "",
        operario_id: "",
        incluido: true,
    };
}

interface ProcesosEditorProps {
    rows: ProcesoRow[];
    onChange: (rows: ProcesoRow[]) => void;
    procesos: ProcesoCatalogoItem[];
    maquinarias: MaquinaCatalogoItem[];
    /** catálogo de personas; si no viene, la columna queda en "Sin asignar" */
    operarios?: OperarioCatalogoItem[];
    /** Lo que el planificador asignó, por id de pasada (`id_otp`). Sólo se muestra. */
    planificado?: Record<number, PlanificadoDeLinea>;
    disabled?: boolean;
    /** callback del botón "Traer historial" (opcional; si no viene, no se muestra) */
    onTraerHistorial?: () => void;
    historialLoading?: boolean;
    /**
     * Dar de alta un proceso que no está en el catálogo, sin salir de acá.
     *
     * Hasta ahora, si el trabajo que hay que cargar no existía como proceso había que
     * salir de la OT, ir a Recursos, crearlo y volver a empezar. Y desde el 2/9 el
     * catálogo ya no se llena solo desde el sistema viejo: si no se puede crear acá,
     * no se puede crear en el momento en que hace falta. Devuelve el proceso creado
     * para poder dejarlo elegido en la fila.
     */
    onCrearProceso?: (nombre: string) => Promise<ProcesoCatalogoItem | null>;
    /**
     * Borrar un proceso del catálogo desde el mismo desplegable.
     *
     * Julián, 2/9: «hay cosas mal escritas o chanchuyos». El catálogo se llenó de
     * variantes de tipeo que el sistema viejo daba de alta solas, y el momento en que
     * uno las ve es justo cuando busca el proceso bueno y aparece la basura al lado.
     */
    onEliminarProceso?: (id: string, nombre: string) => void | Promise<void>;
    /**
     * {proceso_id: [operario_id]} — quién puede hacer cada trabajo.
     *
     * Con el mismo criterio que usa el planificador: rango del operario × rangos del
     * proceso, más las habilidades a mano, menos las apagadas. Sirve para mostrar en
     * gris a quien no puede, NO para bloquearlo: elegirlo igual es una decisión válida
     * —si alguien se lesiona, el trabajo lo hace otro— y el sistema no es quién para
     * decir que no. Sin este dato, todos se ven normales, como hasta ahora.
     */
    quienPuede?: Record<string, number[]>;
}

/**
 * Las columnas del listado.
 *
 * PROCESO tiene un MÍNIMO de verdad (220px) y no `minmax(0,1fr)`.
 *
 * Con `0` de mínimo era la única columna elástica, así que absorbía todo el faltante
 * de ancho: adentro del modal de la OT —1200px menos el panel de planos— le quedaban
 * unos 60px y el nombre del proceso directamente no se veía. Quedaba una tabla donde
 * se editan minutos, máquina y persona de un paso que no se sabe cuál es, que es
 * justo lo que hay que mirar (Julián, 10/09: "tampoco se ve el proceso").
 *
 * Con un mínimo real, cuando no entra el que cede es el contenedor: la lista
 * scrollea de costado. Un scroll molesta; una columna invisible hace inservible la
 * pantalla.
 */
const GRID = "grid grid-cols-[24px_32px_32px_minmax(220px,1.4fr)_88px_minmax(150px,1fr)_minmax(150px,1fr)_76px_36px] gap-2 items-center";

/**
 * Mantiene sólo el desplazamiento vertical del drag (bloquea el eje X). Sin esto,
 * la fila sigue el cursor también en horizontal y se ve desalineada de las columnas.
 */
function lockDragAxisX(style?: React.CSSProperties): React.CSSProperties | undefined {
    if (!style?.transform) return style;
    const locked = style.transform.replace(/translate\(\s*[^,]+,/, "translate(0px,");
    return { ...style, transform: locked };
}

export function ProcesosEditor({
    rows,
    onChange,
    procesos,
    maquinarias,
    operarios = [],
    disabled = false,
    planificado,
    onTraerHistorial,
    historialLoading = false,
    onCrearProceso,
    onEliminarProceso,
    quienPuede,
}: ProcesosEditorProps) {
    const [creando, setCreando] = useState<string | null>(null);
    const procesoOptions = procesos.map((p) => ({ value: p.id.toString(), label: p.nombre }));
    const operarioOptions = [
        { value: "", label: "Sin asignar" },
        ...operarios.map((o) => ({
            value: o.id.toString(),
            label: [o.nombre, o.apellido].filter(Boolean).join(" ").trim(),
        })),
    ];
    const maquinaOptions = [
        { value: "", label: "Sin máquina" },
        ...maquinarias.map((m) => ({
            value: m.id.toString(),
            label: m.cod_maquina ? `${m.cod_maquina} — ${m.nombre}` : m.nombre,
        })),
    ];

    const update = (id: string, patch: Partial<ProcesoRow>) =>
        onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

    const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));

    const addRow = () => onChange([...rows, makeEmptyRow()]);

    // Reordenar por drag & drop: la posición en la lista = la secuencia del proceso.
    const onDragEnd = (result: DropResult) => {
        if (disabled || !result.destination) return;
        const from = result.source.index;
        const to = result.destination.index;
        if (from === to) return;
        const next = Array.from(rows);
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onChange(next);
    };

    /**
     * Las personas, marcando las que no pueden hacer ESE trabajo.
     *
     * No se sacan de la lista: se ordenan primero las que pueden y a las otras se les
     * agrega el motivo al lado. Sacarlas sería el sistema decidiendo por el encargado,
     * y hay días en que el que sabe no está.
     */
    const opcionesDePersonaPara = (procesoId: string) => {
        const habilitados = procesoId ? quienPuede?.[procesoId] : undefined;
        if (!habilitados) return operarioOptions;
        const puede = new Set(habilitados);
        const conMarca = operarios.map((o) => ({
            value: o.id.toString(),
            label: [o.nombre, o.apellido].filter(Boolean).join(" ").trim()
                + (puede.has(o.id) ? "" : "  · no lo tiene habilitado"),
            _puede: puede.has(o.id),
        }));
        conMarca.sort((a, b) => Number(b._puede) - Number(a._puede) || a.label.localeCompare(b.label));
        return [{ value: "", label: "Sin asignar" }, ...conMarca.map(({ _puede, ...o }) => o)];
    };

    const incluidos = rows.filter((r) => r.incluido).length;

    /**
     * Que toda la OT la haga una sola persona.
     *
     * Lucas: «tornea, hace la camisa y suelda el rodillo. No es lo ideal pero pasa».
     * El planificador nunca lo prohibió —nada impide que la misma persona haga todos
     * los procesos de una orden, mientras no se le pisen los horarios—, pero pedirlo
     * era elegir a la misma persona fila por fila. Esto lo copia a todas las tildadas
     * de un gesto; después se puede sacar de una fila suelta, como siempre.
     */
    const asignarATodos = (idOperario: string) => {
        onChange(rows.map((r) => (r.incluido ? { ...r, operario_id: idOperario } : r)));
    };
    const yaSonTodosLaMisma = (() => {
        const activos = rows.filter((r) => r.incluido);
        if (activos.length < 2) return "";
        const primera = activos[0].operario_id;
        return primera && activos.every((r) => r.operario_id === primera) ? primera : "";
    })();

    return (
        <div className="flex flex-col gap-3">
            {/* Barra de acciones */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Settings className="w-4 h-4 text-blue-500" />
                    <span className="font-medium">Procesos de la orden</span>
                    <span className="text-xs text-gray-400">
                        ({incluidos} {incluidos === 1 ? "activo" : "activos"} de {rows.length})
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {/* Sale sólo con dos procesos o más: con uno la pregunta no existe. */}
                    {incluidos > 1 && operarios.length > 0 && (
                        <div className="flex items-center gap-1.5">
                            {/* "La hace" no decía qué: parecía referirse a la fila de al lado y no
                                a la OT entera. Y el valor por defecto —"La reparte el planificador"—
                                no entraba en 190px y se leía "La reparte el pla…", o sea nada. */}
                            <span className="text-xs text-gray-500 whitespace-nowrap"
                                  title="Poner la misma persona en todos los pasos de esta orden, de una">
                                Toda la OT la hace
                            </span>
                            <SearchableSelect
                                value={yaSonTodosLaMisma}
                                onValueChange={asignarATodos}
                                options={[
                                    { value: "", label: "Lo decide el planificador" },
                                    ...operarioOptions.filter((o) => o.value !== ""),
                                ]}
                                placeholder="elegir una persona…"
                                disabled={disabled}
                                className="h-8 w-[220px] text-xs"
                            />
                        </div>
                    )}
                    {onTraerHistorial && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={disabled || historialLoading}
                            onClick={onTraerHistorial}
                            className="h-8 gap-1.5 text-xs border-blue-200 text-blue-700 hover:bg-blue-50"
                            title="Traer los procesos ya cargados de una OT anterior del mismo producto"
                        >
                            <History className="w-3.5 h-3.5" />
                            {historialLoading ? "Buscando..." : "Traer historial"}
                        </Button>
                    )}
                    <Button
                        type="button"
                        size="sm"
                        disabled={disabled}
                        onClick={addRow}
                        className="h-8 gap-1.5 text-xs bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200"
                    >
                        <Plus className="w-3.5 h-3.5" />
                        Agregar proceso
                    </Button>
                </div>
            </div>

            {/* Listado.
                `overflow-x-auto` con `min-w-max` adentro: si el ancho no alcanza, se
                scrollea de costado y las columnas mantienen su tamaño. Antes el
                contenedor no cedía nunca y el aplastón se lo comía la columna del
                nombre del proceso. */}
            <div className="border border-gray-200 rounded-xl overflow-x-auto bg-white shadow-sm">
             <div className="min-w-max">
                {/* Header */}
                <div className={cn(GRID, "px-3 py-2 bg-gray-50/80 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wider text-gray-500")}>
                    <div></div>
                    <div className="text-center" title="Incluir este proceso en la orden">Va</div>
                    <div className="text-center">#</div>
                    <div>Proceso</div>
                    <div className="text-center">Minutos</div>
                    <div>Máquina</div>
                    <div>Recurso humano</div>
                    <div className="text-center" title="Cantidad de recurso humano que hace falta en simultáneo">Cantidad</div>
                    <div></div>
                </div>

                {/* Filas */}
                {rows.length === 0 ? (
                    <div className="px-4 py-10 text-center">
                        <div className="w-11 h-11 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                            <Settings className="w-5 h-5 text-gray-400" />
                        </div>
                        <p className="text-sm text-gray-500 font-medium">No hay procesos cargados</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                            Agregá procesos o traé el historial de un producto ya fabricado.
                        </p>
                    </div>
                ) : (
                    <DragDropContext onDragEnd={onDragEnd}>
                        <Droppable droppableId="procesos-editor">
                            {(dropProvided) => (
                                <div
                                    ref={dropProvided.innerRef}
                                    {...dropProvided.droppableProps}
                                    className="divide-y divide-gray-100"
                                >
                                    {rows.map((row, idx) => {
                                        const conMaquina = !!row.maquina_id;
                                        // Lo que el planificador asignó a ESTA pasada. Sólo existe
                                        // si la OT está planificada; si no, no se muestra nada.
                                        const plan = row.id_otp ? planificado?.[row.id_otp] : undefined;
                                        return (
                                            <Draggable
                                                key={row.id}
                                                draggableId={row.id}
                                                index={idx}
                                                isDragDisabled={disabled}
                                            >
                                                {(dragProvided, dragSnapshot) => (
                                                    <div
                                                        ref={dragProvided.innerRef}
                                                        {...dragProvided.draggableProps}
                                                        style={lockDragAxisX(dragProvided.draggableProps.style)}
                                                        className={cn(
                                                            GRID,
                                                            "px-3 py-2 transition-colors bg-white",
                                                            row.incluido ? "hover:bg-blue-50/30" : "bg-gray-50/60 opacity-60",
                                                            dragSnapshot.isDragging && "shadow-lg ring-1 ring-blue-300 rounded-lg bg-white opacity-100"
                                                        )}
                                                    >
                                                        {/* Manija de arrastre */}
                                                        <div
                                                            {...dragProvided.dragHandleProps}
                                                            className={cn(
                                                                "flex justify-center text-gray-300",
                                                                disabled ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing hover:text-gray-500"
                                                            )}
                                                            title="Arrastrar para reordenar"
                                                        >
                                                            <GripVertical className="w-4 h-4" />
                                                        </div>

                                                        {/* Tilde: va / no va */}
                                                        <div className="flex justify-center">
                                                            <Checkbox
                                                                checked={row.incluido}
                                                                disabled={disabled}
                                                                onCheckedChange={(c) => update(row.id, { incluido: !!c })}
                                                                title={row.incluido ? "Este proceso va en la orden" : "Destildado: no se guardará"}
                                                            />
                                                        </div>

                                                        {/* Orden (posición) */}
                                                        <div className="flex justify-center">
                                                            <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-[11px] font-bold">
                                                                {idx + 1}
                                                            </span>
                                                        </div>

                                                        {/* Proceso. Si lo que buscás no está, se crea desde acá. */}
                                                        <div className="min-w-0">
                                                            <SearchableSelect
                                                                options={procesoOptions}
                                                                value={row.proceso_id}
                                                                onValueChange={(v) => update(row.id, { proceso_id: v })}
                                                                placeholder="Seleccionar proceso..."
                                                                disabled={disabled || creando === row.id}
                                                                onCreate={onCrearProceso ? async (nombre) => {
                                                                    setCreando(row.id);
                                                                    try {
                                                                        const creado = await onCrearProceso(nombre);
                                                                        if (creado) update(row.id, { proceso_id: String(creado.id) });
                                                                    } finally {
                                                                        setCreando(null);
                                                                    }
                                                                } : undefined}
                                                                createLabel="Crear proceso"
                                                                onDelete={onEliminarProceso}
                                                            />
                                                        </div>

                                                        {/* Minutos */}
                                                        <div>
                                                            <Input
                                                                type="number"
                                                                min={0}
                                                                value={row.tiempo}
                                                                disabled={disabled}
                                                                onChange={(e) => update(row.id, { tiempo: e.target.value })}
                                                                placeholder="0"
                                                                className="h-8 text-xs text-center bg-white"
                                                            />
                                                        </div>

                                                        {/* Máquina: arriba lo que se ELIGE (preselección),
                                                            abajo lo que el planificador YA asignó. */}
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1">
                                                                <div className="min-w-0 flex-1">
                                                                    <SearchableSelect
                                                                        options={maquinaOptions}
                                                                        value={row.maquina_id}
                                                                        onValueChange={(v) => update(row.id, { maquina_id: v })}
                                                                        placeholder="Sin máquina"
                                                                        disabled={disabled}
                                                                    />
                                                                </div>
                                                                {conMaquina && (
                                                                    <Lock
                                                                        className="w-3.5 h-3.5 shrink-0 text-amber-500"
                                                                        aria-label="Máquina forzada (preseleccionada)"
                                                                    />
                                                                )}
                                                            </div>
                                                            <ChipPlanificado
                                                                texto={plan?.maquinaria}
                                                                falta={!!plan && plan.sin_maquinaria}
                                                                faltaTexto="sin máquina reservada"
                                                                hay={!!plan}
                                                            />
                                                        </div>

                                                        {/* Persona: mismo criterio. */}
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1">
                                                                <div className="min-w-0 flex-1">
                                                                    <SearchableSelect
                                                                        options={opcionesDePersonaPara(row.proceso_id)}
                                                                        value={row.operario_id}
                                                                        onValueChange={(v) => update(row.id, { operario_id: v })}
                                                                        placeholder="Sin asignar"
                                                                        disabled={disabled}
                                                                    />
                                                                </div>
                                                                {!!row.operario_id && (
                                                                    <Lock
                                                                        className="w-3.5 h-3.5 shrink-0 text-amber-500"
                                                                        aria-label="Recurso humano forzado (preseleccionado)"
                                                                    />
                                                                )}
                                                            </div>
                                                            <ChipPlanificado
                                                                texto={plan?.operario}
                                                                falta={!!plan && plan.sin_asignar}
                                                                faltaTexto="nadie asignado"
                                                                hay={!!plan}
                                                            />
                                                        </div>

                                                        {/* Cantidad de empleados */}
                                                        <div>
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                value={row.cant_operarios}
                                                                disabled={disabled}
                                                                onChange={(e) => update(row.id, { cant_operarios: e.target.value })}
                                                                placeholder="1"
                                                                title="Cantidad de recurso humano que requiere el proceso en simultáneo"
                                                                className="h-8 text-xs text-center bg-white"
                                                            />
                                                        </div>

                                                        {/* Eliminar */}
                                                        <div className="flex justify-center">
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                disabled={disabled}
                                                                onClick={() => remove(row.id)}
                                                                className="h-7 w-7 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                                            >
                                                                <Trash2 className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                )}
                                            </Draggable>
                                        );
                                    })}
                                    {dropProvided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </DragDropContext>
                )}
             </div>
            </div>

            <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-amber-500" />
                Elegir máquina o persona fuerza que ese proceso se planifique así (preselección), aunque
                el rango no se lo habilite. Dejalo en <span className="font-medium">"Sin máquina"</span> y{" "}
                <span className="font-medium">"Sin asignar"</span> para que el planificador decida.
            </p>
        </div>
    );
}
