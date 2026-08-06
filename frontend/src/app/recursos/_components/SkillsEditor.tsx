"use client";

import { useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Wrench, FileText, GripVertical, X, Sparkles } from "lucide-react";
import { aplicarMovimientoSkill, POOL, LISTA_1, LISTA_2 } from "../_reordenSkills";

export type NivelSkill = 0 | 1 | 2;

/**
 * Estado de una nativa.
 *  - `nivel`: 0 = sin priorizar (vive en el pool), 1 = SKILLS 1, 2 = SKILLS 2.
 *  - `habilitado`: false = apagada, el planificador no se la asigna.
 *  - `orden`: posición dentro de su lista (0 = primero = más preferido).
 */
export interface EstadoSkill {
    nivel: NivelSkill;
    habilitado: boolean;
    orden?: number | null;
}

export interface NativaItem {
    id: number;
    nombre: string;
}

interface SkillsEditorProps {
    nativas: NativaItem[];
    estados: Record<number, EstadoSkill>;
    onEstadosChange: (estados: Record<number, EstadoSkill>) => void;
    interpretaPlanos: boolean;
    onInterpretaPlanosChange: (valor: boolean) => void;
    sinRangos?: boolean;
    fallo?: boolean;
}

const NIVEL_DE: Record<string, NivelSkill> = { [POOL]: 0, [LISTA_1]: 1, [LISTA_2]: 2 };

const estadoDe = (estados: Record<number, EstadoSkill>, id: number): EstadoSkill =>
    estados[id] ?? { nivel: 0, habilitado: true, orden: null };

export default function SkillsEditor({
    nativas,
    estados,
    onEstadosChange,
    interpretaPlanos,
    onInterpretaPlanosChange,
    sinRangos = false,
    fallo = false,
}: SkillsEditorProps) {
    const [busqueda, setBusqueda] = useState("");

    // Sin acentos: los procesos vienen en mayúscula y con tildes inconsistentes.
    const normalizar = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    const coincide = useMemo(() => {
        const q = normalizar(busqueda.trim());
        return (nombre: string) => !q || normalizar(nombre).includes(q);
    }, [busqueda]);

    const nombreDe = useMemo(() => {
        const m = new Map<number, string>();
        for (const n of nativas) m.set(n.id, n.nombre);
        return m;
    }, [nativas]);

    /**
     * Reparte las nativas en las tres zonas.
     *
     * El pool va alfabético (es un catálogo, se busca por nombre); SKILLS 1 y 2 van
     * por `orden`, que es lo que el usuario dejó arrastrando. Las que no tienen orden
     * caen al final, alfabéticas entre sí — es el caso de las que se priorizaron
     * antes de que existiera la posición.
     */
    const zonas = useMemo(() => {
        const pool: NativaItem[] = [];
        const l1: (NativaItem & { orden: number })[] = [];
        const l2: (NativaItem & { orden: number })[] = [];

        for (const n of nativas) {
            const e = estadoDe(estados, n.id);
            if (e.nivel === 1) l1.push({ ...n, orden: e.orden ?? Number.MAX_SAFE_INTEGER });
            else if (e.nivel === 2) l2.push({ ...n, orden: e.orden ?? Number.MAX_SAFE_INTEGER });
            else pool.push(n);
        }

        const porOrden = (a: { orden: number; nombre: string }, b: { orden: number; nombre: string }) =>
            a.orden - b.orden || a.nombre.localeCompare(b.nombre);

        pool.sort((a, b) => a.nombre.localeCompare(b.nombre));
        l1.sort(porOrden);
        l2.sort(porOrden);
        return { pool, l1, l2 };
    }, [nativas, estados]);

    const aplicarMovimiento = (idMovido: number, destino: string, indiceDestino: number) => {
        onEstadosChange(
            aplicarMovimientoSkill(
                estados,
                zonas.l1.map((x) => x.id),
                zonas.l2.map((x) => x.id),
                idMovido,
                destino,
                indiceDestino
            )
        );
    };

    const onDragEnd = (result: DropResult) => {
        const destino = result.destination;
        if (!destino) return;
        if (NIVEL_DE[destino.droppableId] === undefined) return;
        const id = parseInt(result.draggableId, 10);
        if (Number.isNaN(id)) return;
        aplicarMovimiento(id, destino.droppableId, destino.index);
    };

    // Mover por click, para cuando arrastrar 74 chips es un suplicio.
    const mandarA = (id: number, nivel: NivelSkill) => {
        const destino = nivel === 1 ? LISTA_1 : nivel === 2 ? LISTA_2 : POOL;
        const largo = nivel === 1 ? zonas.l1.length : nivel === 2 ? zonas.l2.length : 0;
        aplicarMovimiento(id, destino, largo);
    };

    const alternarApagado = (id: number) => {
        const actual = estadoDe(estados, id);
        onEstadosChange({ ...estados, [id]: { ...actual, habilitado: !actual.habilitado } });
    };

    if (fallo) {
        return (
            <Marco nativas={nativas} interpretaPlanos={interpretaPlanos} onInterpretaPlanosChange={onInterpretaPlanosChange}>
                <div className="rounded-xl border border-red-200 bg-red-50/70 px-4 py-6 text-center">
                    <p className="text-sm font-semibold text-red-800">No se pudieron cargar las skills nativas</p>
                    <p className="mt-1 text-xs text-red-700/80">
                        Las habilidades quedan como están: al guardar no se tocan. Recargá la página.
                    </p>
                </div>
            </Marco>
        );
    }

    if (sinRangos) {
        return (
            <Marco nativas={nativas} interpretaPlanos={interpretaPlanos} onInterpretaPlanosChange={onInterpretaPlanosChange}>
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
                    <Sparkles className="mx-auto mb-2 h-5 w-5 text-slate-400" />
                    <p className="text-sm font-semibold text-slate-700">Todavía no hay skills nativas</p>
                    <p className="mt-1 text-xs text-slate-500">
                        Asigná al menos un rango en Información Laboral: las habilidades se derivan de ahí.
                    </p>
                </div>
            </Marco>
        );
    }

    const filtrando = !!busqueda.trim();

    return (
        <Marco nativas={nativas} interpretaPlanos={interpretaPlanos} onInterpretaPlanosChange={onInterpretaPlanosChange}>
            <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                    value={busqueda}
                    onChange={(e) => setBusqueda(e.target.value)}
                    placeholder="Buscar habilidad..."
                    className="border-slate-200 bg-white pl-9 pr-9 shadow-sm focus-visible:ring-violet-400"
                />
                {filtrando && (
                    <button
                        type="button"
                        onClick={() => setBusqueda("")}
                        aria-label="Limpiar búsqueda"
                        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                    >
                        <X className="h-3.5 w-3.5" />
                    </button>
                )}
            </div>

            <DragDropContext onDragEnd={onDragEnd}>
                <Pool
                    items={zonas.pool}
                    coincide={coincide}
                    filtrando={filtrando}
                    estados={estados}
                    onMandarA={mandarA}
                    onAlternar={alternarApagado}
                />

                <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
                    <ListaPrioridad
                        droppableId={LISTA_1}
                        titulo="SKILLS 1"
                        subtitulo="Primera opción. Cuanto más arriba, más preferido."
                        items={zonas.l1}
                        coincide={coincide}
                        filtrando={filtrando}
                        estados={estados}
                        tono="esmeralda"
                        onMandarA={mandarA}
                        onAlternar={alternarApagado}
                        nombreDe={nombreDe}
                    />
                    <ListaPrioridad
                        droppableId={LISTA_2}
                        titulo="SKILLS 2"
                        subtitulo="Segunda opción, antes que las del pool."
                        items={zonas.l2}
                        coincide={coincide}
                        filtrando={filtrando}
                        estados={estados}
                        tono="indigo"
                        onMandarA={mandarA}
                        onAlternar={alternarApagado}
                        nombreDe={nombreDe}
                    />
                </div>
            </DragDropContext>
        </Marco>
    );
}

/** Cabecera + toggle de planos, común a los tres estados de la pantalla. */
function Marco({
    nativas,
    interpretaPlanos,
    onInterpretaPlanosChange,
    children,
}: {
    nativas: NativaItem[];
    interpretaPlanos: boolean;
    onInterpretaPlanosChange: (v: boolean) => void;
    children: React.ReactNode;
}) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm md:col-span-2">
            <div className="mb-1 flex items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-sm">
                    <Wrench className="h-4 w-4 text-white" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Habilidades</h3>
                <span className="ml-auto rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                    {nativas.length} nativas
                </span>
            </div>
            <p className="mb-2.5 text-xs leading-relaxed text-slate-500">
                Todas salen de los rangos del operario. Arrastralas a{" "}
                <strong className="text-emerald-700">SKILLS 1</strong> o{" "}
                <strong className="text-indigo-700">SKILLS 2</strong> para decirle al planificador a
                quién preferir, y ordenalas dentro de cada lista: más arriba, más preferido.
            </p>

            <label className="mb-2.5 flex cursor-pointer items-start gap-3 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50/60 px-3 py-2.5 transition-colors hover:border-amber-300">
                <Checkbox
                    checked={interpretaPlanos}
                    onCheckedChange={(v) => onInterpretaPlanosChange(v === true)}
                    className="mt-0.5 data-[state=checked]:border-amber-600 data-[state=checked]:bg-amber-600"
                />
                <div className="min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                        Interpretación de planos
                    </span>
                    <p className="mt-0.5 text-[11px] leading-snug text-amber-800/80">
                        Si está apagado, el planificador no le asigna ningún proceso de una OT con
                        plano adjunto, aunque tenga la skill nativa.
                    </p>
                </div>
            </label>

            {children}
        </div>
    );
}

/** Pool de nativas sin priorizar: chips compactos, es un catálogo para buscar. */
function Pool({
    items,
    coincide,
    filtrando,
    estados,
    onMandarA,
    onAlternar,
}: {
    items: NativaItem[];
    coincide: (n: string) => boolean;
    filtrando: boolean;
    estados: Record<number, EstadoSkill>;
    onMandarA: (id: number, nivel: NivelSkill) => void;
    onAlternar: (id: number) => void;
}) {
    const visibles = items.filter((i) => coincide(i.nombre));

    return (
        <Droppable droppableId={POOL} direction="horizontal">
            {(provided, snapshot) => (
                <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`rounded-xl border transition-all ${
                        snapshot.isDraggingOver
                            ? "border-violet-400 bg-violet-50 ring-2 ring-violet-200"
                            : "border-slate-200 bg-slate-50/70"
                    }`}
                >
                    <div className="flex items-baseline gap-2 px-3 pt-2.5">
                        <span className="text-sm font-bold tracking-tight text-slate-700">
                            SKILLS NATIVAS
                        </span>
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                            {filtrando ? `${visibles.length} de ${items.length}` : items.length}
                        </span>
                        {/* Se aclara acá porque es el punto que más se malinterpreta:
                            estar en el pool NO es estar excluido. Para excluir hay
                            que apagar la skill con el switch. */}
                        <span className="ml-auto text-[11px] text-slate-400">
                            sin priorizar · se asignan si no hay nadie priorizado
                        </span>
                    </div>

                    <div className="flex max-h-40 flex-wrap content-start gap-1.5 overflow-y-auto px-3 pb-3 pt-2">
                        {visibles.length === 0 && (
                            <p className="w-full py-3 text-center text-[11px] italic text-slate-400">
                                {snapshot.isDraggingOver
                                    ? "Soltar acá para quitarle la prioridad"
                                    : filtrando
                                    ? "Ninguna coincide con la búsqueda"
                                    : "Todas las nativas están priorizadas"}
                            </p>
                        )}
                        {visibles.map((item, index) => {
                            const est = estadoDe(estados, item.id);
                            return (
                                <Draggable key={item.id} draggableId={String(item.id)} index={index}>
                                    {(dp, ds) => (
                                        <div
                                            ref={dp.innerRef}
                                            {...dp.draggableProps}
                                            {...dp.dragHandleProps}
                                            className={`group inline-flex items-center gap-1 rounded-full border py-1 pl-2.5 pr-1 text-[11px] font-medium transition-all ${
                                                est.habilitado
                                                    ? "border-slate-200 bg-white text-slate-700 hover:border-violet-300 hover:text-violet-800"
                                                    : "border-slate-200 bg-slate-100 text-slate-400 line-through"
                                            } ${ds.isDragging ? "scale-105 border-violet-400 shadow-lg ring-2 ring-violet-200" : ""}`}
                                        >
                                            <span className="max-w-[230px] truncate" title={item.nombre}>
                                                {item.nombre}
                                            </span>
                                            <Acciones
                                                nivelActual={0}
                                                habilitado={est.habilitado}
                                                onMandarA={(n) => onMandarA(item.id, n)}
                                                onAlternar={() => onAlternar(item.id)}
                                            />
                                        </div>
                                    )}
                                </Draggable>
                            );
                        })}
                        {provided.placeholder}
                    </div>
                </div>
            )}
        </Droppable>
    );
}

const TONOS = {
    esmeralda: {
        borde: "border-emerald-200",
        fondo: "bg-emerald-50/40",
        activo: "border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200",
        titulo: "text-emerald-800",
        fila: "border-emerald-100 bg-white hover:border-emerald-300",
        indice: "bg-emerald-100 text-emerald-800",
    },
    indigo: {
        borde: "border-indigo-200",
        fondo: "bg-indigo-50/40",
        activo: "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-200",
        titulo: "text-indigo-800",
        fila: "border-indigo-100 bg-white hover:border-indigo-300",
        indice: "bg-indigo-100 text-indigo-800",
    },
} as const;

/** SKILLS 1 / SKILLS 2: lista vertical ordenada, se suelta en la posición exacta. */
function ListaPrioridad({
    droppableId,
    titulo,
    subtitulo,
    items,
    coincide,
    filtrando,
    estados,
    tono,
    onMandarA,
    onAlternar,
}: {
    droppableId: string;
    titulo: string;
    subtitulo: string;
    items: NativaItem[];
    coincide: (n: string) => boolean;
    filtrando: boolean;
    estados: Record<number, EstadoSkill>;
    tono: keyof typeof TONOS;
    onMandarA: (id: number, nivel: NivelSkill) => void;
    onAlternar: (id: number) => void;
    nombreDe: Map<number, string>;
}) {
    const t = TONOS[tono];
    const nivel = NIVEL_DE[droppableId];

    return (
        <Droppable droppableId={droppableId}>
            {(provided, snapshot) => (
                <div
                    className={`overflow-hidden rounded-xl border transition-all ${
                        snapshot.isDraggingOver ? t.activo : `${t.borde} ${t.fondo}`
                    }`}
                >
                    <div className="flex items-baseline gap-2 px-3 pt-2.5">
                        <span className={`text-sm font-bold tracking-tight ${t.titulo}`}>{titulo}</span>
                        <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">
                            {items.length}
                        </span>
                    </div>
                    <p className="px-3 pb-2 pt-0.5 text-[11px] text-slate-500">{subtitulo}</p>

                    {/* El ref del droppable va en el contenedor que scrollea y contiene
                        las filas: si envuelve también al encabezado, los índices que
                        calcula la librería no coinciden con lo que se ve. */}
                    <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="flex max-h-64 min-h-[64px] flex-col gap-1 overflow-y-auto px-2 pb-2"
                    >
                        {items.length === 0 && (
                            <p className="py-5 text-center text-[11px] italic text-slate-400">
                                {snapshot.isDraggingOver ? "Soltar acá" : "Arrastrá habilidades acá"}
                            </p>
                        )}
                        {items.map((item, index) => {
                            const est = estadoDe(estados, item.id);
                            const atenuado = filtrando && !coincide(item.nombre);
                            return (
                                <Draggable key={item.id} draggableId={String(item.id)} index={index}>
                                    {(dp, ds) => (
                                        <div
                                            ref={dp.innerRef}
                                            {...dp.draggableProps}
                                            className={`group flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5 transition-all ${t.fila} ${
                                                ds.isDragging ? "scale-[1.02] shadow-lg ring-2 ring-slate-300" : ""
                                            } ${atenuado ? "opacity-30" : ""} ${
                                                est.habilitado ? "" : "bg-slate-50"
                                            }`}
                                        >
                                            <span
                                                {...dp.dragHandleProps}
                                                className="flex cursor-grab items-center text-slate-300 transition-colors hover:text-slate-500 active:cursor-grabbing"
                                                aria-label="Arrastrar para reordenar"
                                            >
                                                <GripVertical className="h-3.5 w-3.5" />
                                            </span>
                                            <span
                                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold ${t.indice}`}
                                            >
                                                {index + 1}
                                            </span>
                                            <span
                                                className={`min-w-0 flex-1 truncate text-[11px] font-medium ${
                                                    est.habilitado ? "text-slate-800" : "text-slate-400 line-through"
                                                }`}
                                                title={item.nombre}
                                            >
                                                {item.nombre}
                                            </span>
                                            <Acciones
                                                nivelActual={nivel}
                                                habilitado={est.habilitado}
                                                onMandarA={(n) => onMandarA(item.id, n)}
                                                onAlternar={() => onAlternar(item.id)}
                                            />
                                        </div>
                                    )}
                                </Draggable>
                            );
                        })}
                        {provided.placeholder}
                    </div>
                </div>
            )}
        </Droppable>
    );
}

/**
 * Alternativa por click al arrastrar (74 chips a mano es un suplicio y el drag no es
 * accesible por teclado) + el switch de apagado, que es lo que saca la skill del plan.
 */
function Acciones({
    nivelActual,
    habilitado,
    onMandarA,
    onAlternar,
}: {
    nivelActual: NivelSkill;
    habilitado: boolean;
    onMandarA: (n: NivelSkill) => void;
    onAlternar: () => void;
}) {
    const destinos: { n: NivelSkill; label: string; title: string; clase: string }[] = [
        { n: 1, label: "1", title: "Mover a SKILLS 1", clase: "hover:bg-emerald-100 hover:text-emerald-700" },
        { n: 2, label: "2", title: "Mover a SKILLS 2", clase: "hover:bg-indigo-100 hover:text-indigo-700" },
        { n: 0, label: "↑", title: "Quitar prioridad (vuelve a nativas)", clase: "hover:bg-slate-200 hover:text-slate-700" },
    ];

    return (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            {destinos
                .filter((d) => d.n !== nivelActual)
                .map((d) => (
                    <button
                        key={d.n}
                        type="button"
                        title={d.title}
                        aria-label={d.title}
                        onClick={() => onMandarA(d.n)}
                        className={`flex h-5 w-5 items-center justify-center rounded-md bg-slate-100 text-[10px] font-bold leading-none text-slate-500 transition-colors ${d.clase}`}
                    >
                        {d.label}
                    </button>
                ))}
            <button
                type="button"
                role="switch"
                aria-checked={habilitado}
                title={habilitado ? "Desactivar habilidad" : "Activar habilidad"}
                aria-label={habilitado ? "Desactivar habilidad" : "Activar habilidad"}
                onClick={onAlternar}
                className={`relative ml-0.5 inline-flex h-4 w-7 shrink-0 items-center rounded-full opacity-100 transition-colors ${
                    habilitado ? "bg-emerald-500" : "bg-slate-300"
                }`}
            >
                <span
                    className={`pointer-events-none block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                        habilitado ? "translate-x-3.5" : "translate-x-0.5"
                    }`}
                />
            </button>
        </span>
    );
}
