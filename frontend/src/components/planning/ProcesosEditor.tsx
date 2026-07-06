"use client";

/**
 * ProcesosEditor — carga de procesos de una OT en formato "listado"
 * (rediseño pedido en la reunión 2-jul-2026 con Metlo).
 *
 * Reemplaza la carga por tarjetas / filas sueltas por un listado compacto tipo
 * "manejo de procesos" con las columnas: incluir (tilde) · # (orden) · proceso ·
 * minutos · máquina · cantidad de empleados.
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
 */

import React from "react";
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
    /** id del proceso del catálogo (string para los selects) */
    proceso_id: string;
    /** tiempo estimado en minutos */
    tiempo: string;
    /** operarios que requiere el proceso en simultáneo */
    cant_operarios: string;
    /** máquina preseleccionada; '' = sin preselección (planificador libre) */
    maquina_id: string;
    /** tilde incluir/excluir: sólo se guardan los tildados */
    incluido: boolean;
}

export interface ProcesoCatalogoItem { id: number; nombre: string; }
export interface MaquinaCatalogoItem { id: number; nombre: string; cod_maquina?: string; }

export function makeEmptyRow(): ProcesoRow {
    return {
        id: Math.random().toString(36).slice(2),
        proceso_id: "",
        tiempo: "",
        cant_operarios: "1",
        maquina_id: "",
        incluido: true,
    };
}

interface ProcesosEditorProps {
    rows: ProcesoRow[];
    onChange: (rows: ProcesoRow[]) => void;
    procesos: ProcesoCatalogoItem[];
    maquinarias: MaquinaCatalogoItem[];
    disabled?: boolean;
    /** callback del botón "Traer historial" (opcional; si no viene, no se muestra) */
    onTraerHistorial?: () => void;
    historialLoading?: boolean;
}

const GRID = "grid grid-cols-[24px_36px_36px_minmax(0,1fr)_96px_minmax(0,200px)_110px_40px] gap-2 items-center";

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
    disabled = false,
    onTraerHistorial,
    historialLoading = false,
}: ProcesosEditorProps) {
    const procesoOptions = procesos.map((p) => ({ value: p.id.toString(), label: p.nombre }));
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

    const incluidos = rows.filter((r) => r.incluido).length;

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

            {/* Listado */}
            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
                {/* Header */}
                <div className={cn(GRID, "px-3 py-2 bg-gray-50/80 border-b border-gray-200 text-[10px] font-bold uppercase tracking-wider text-gray-500")}>
                    <div></div>
                    <div className="text-center" title="Incluir este proceso en la orden">Va</div>
                    <div className="text-center">#</div>
                    <div>Proceso</div>
                    <div className="text-center">Minutos</div>
                    <div>Máquina</div>
                    <div className="text-center">Cant. emp.</div>
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

                                                        {/* Proceso */}
                                                        <div className="min-w-0">
                                                            <SearchableSelect
                                                                options={procesoOptions}
                                                                value={row.proceso_id}
                                                                onValueChange={(v) => update(row.id, { proceso_id: v })}
                                                                placeholder="Seleccionar proceso..."
                                                                disabled={disabled}
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

                                                        {/* Máquina (elegir = preseleccionar) */}
                                                        <div className="min-w-0 flex items-center gap-1">
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

                                                        {/* Cantidad de empleados */}
                                                        <div>
                                                            <Input
                                                                type="number"
                                                                min={1}
                                                                value={row.cant_operarios}
                                                                disabled={disabled}
                                                                onChange={(e) => update(row.id, { cant_operarios: e.target.value })}
                                                                placeholder="1"
                                                                title="Operarios que requiere el proceso en simultáneo"
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

            <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-amber-500" />
                Elegir una máquina fuerza que ese proceso se planifique en esa máquina (preselección).
                Dejá <span className="font-medium">"Sin máquina"</span> para que el planificador decida.
            </p>
        </div>
    );
}
