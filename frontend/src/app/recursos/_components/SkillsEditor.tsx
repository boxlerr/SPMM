"use client";

import { useMemo, useState } from "react";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Wrench, FileText, Power, ChevronDown, ChevronRight, X } from "lucide-react";

export type NivelSkill = 0 | 1 | 2;

/** Estado de una nativa: prioridad y si está apagada. Ejes independientes. */
export interface EstadoSkill {
    nivel: NivelSkill;
    habilitado: boolean;
}

export interface NativaItem {
    id: number;
    nombre: string;
}

interface SkillsEditorProps {
    /** SKILLS NATIVAS del operario, derivadas de los rangos seleccionados. */
    nativas: NativaItem[];
    /** Overrides por proceso. Lo que no está acá es nivel 0 / habilitado. */
    estados: Record<number, EstadoSkill>;
    onEstadosChange: (estados: Record<number, EstadoSkill>) => void;
    interpretaPlanos: boolean;
    onInterpretaPlanosChange: (valor: boolean) => void;
    /** Se muestra cuando el operario todavía no tiene rangos elegidos. */
    sinRangos?: boolean;
    /** No se pudo cargar el mapa rango -> procesos: no sabemos cuáles son las nativas. */
    fallo?: boolean;
}

const DROPPABLES: Record<string, NivelSkill> = {
    "nivel-0": 0,
    "nivel-1": 1,
    "nivel-2": 2,
};

const estadoDe = (estados: Record<number, EstadoSkill>, id: number): EstadoSkill =>
    estados[id] ?? { nivel: 0, habilitado: true };

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
    const [verApagadas, setVerApagadas] = useState(false);

    const patch = (id: number, cambio: Partial<EstadoSkill>) => {
        const actual = estadoDe(estados, id);
        onEstadosChange({ ...estados, [id]: { ...actual, ...cambio } });
    };

    // Sin acentos: los procesos están cargados en mayúsculas y con tildes inconsistentes
    // ("MECANIZADO" vs "AGUJEREADO EN FRESADORA"), así que buscar "fresa" tiene que
    // encontrarlos igual.
    const normalizar = (s: string) =>
        s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // El filtro es solo visual: nunca saca una skill del estado, así que buscar no
    // puede hacerte perder una prioridad ya asignada.
    const coincide = useMemo(() => {
        const q = normalizar(busqueda.trim());
        return (nombre: string) => !q || normalizar(nombre).includes(q);
    }, [busqueda]);

    const { porNivel, apagadas, totalVisible } = useMemo(() => {
        const porNivel: Record<NivelSkill, NativaItem[]> = { 0: [], 1: [], 2: [] };
        const apagadas: NativaItem[] = [];
        let totalVisible = 0;

        const ordenadas = [...nativas].sort((a, b) => a.nombre.localeCompare(b.nombre));
        for (const n of ordenadas) {
            if (!coincide(n.nombre)) continue;
            totalVisible++;
            const est = estadoDe(estados, n.id);
            if (!est.habilitado) apagadas.push(n);
            else porNivel[est.nivel].push(n);
        }
        return { porNivel, apagadas, totalVisible };
    }, [nativas, estados, coincide]);

    const onDragEnd = (result: DropResult) => {
        const destino = result.destination;
        if (!destino) return;
        const nivel = DROPPABLES[destino.droppableId];
        if (nivel === undefined) return;
        const id = parseInt(result.draggableId, 10);
        if (Number.isNaN(id)) return;
        // Soltar en una columna prende la skill: mover algo a SKILLS 1 y que siga
        // apagado sería una trampa silenciosa.
        patch(id, { nivel, habilitado: true });
    };

    const contarNivel = (nivel: NivelSkill) =>
        nativas.filter((n) => {
            const e = estadoDe(estados, n.id);
            return e.habilitado && e.nivel === nivel;
        }).length;

    const totalApagadas = nativas.filter((n) => !estadoDe(estados, n.id).habilitado).length;

    return (
        <div className="bg-white rounded-lg border shadow-sm p-4 md:col-span-2">
            <div className="flex items-center gap-2 mb-1">
                <div className="h-8 w-8 rounded-full bg-purple-50 flex items-center justify-center shrink-0">
                    <Wrench className="h-4 w-4 text-purple-600" />
                </div>
                <h3 className="text-base font-semibold text-gray-900">Habilidades</h3>
                <span className="ml-auto text-xs text-muted-foreground">
                    {nativas.length} skills nativas
                </span>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
                Las <strong>SKILLS NATIVAS</strong> salen de los rangos asignados en Información
                Laboral: son todo lo que el operario puede hacer. Arrastralas a{" "}
                <strong>SKILLS 1</strong> o <strong>SKILLS 2</strong> para decirle al planificador a
                quién preferir. Apagá una skill si no querés que se la asignen.
            </p>

            {/* Interpretación de planos: restricción dura del planificador, no una skill más. */}
            <label className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 px-3 py-2.5 cursor-pointer mb-4">
                <Checkbox
                    checked={interpretaPlanos}
                    onCheckedChange={(v) => onInterpretaPlanosChange(v === true)}
                    className="mt-0.5"
                />
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-amber-700 shrink-0" />
                        <span className="text-sm font-medium text-gray-800">
                            Interpretación de planos
                        </span>
                    </div>
                    <p className="text-[11px] text-amber-800/80 mt-0.5">
                        Si está apagado, el planificador no le asigna ningún proceso de una OT con
                        plano adjunto, aunque tenga la skill nativa.
                    </p>
                </div>
            </label>

            {fallo ? (
                <div className="rounded-lg border border-red-200 bg-red-50/60 px-4 py-6 text-center">
                    <p className="text-sm text-red-800 font-medium">
                        No se pudieron cargar las skills nativas
                    </p>
                    <p className="text-xs text-red-700/80 mt-1">
                        Las habilidades de este operario quedan como están: al guardar no se tocan.
                        Recargá la página o revisá que el backend esté al día.
                    </p>
                </div>
            ) : sinRangos ? (
                <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50/60 px-4 py-8 text-center">
                    <p className="text-sm text-gray-600 font-medium">Todavía no hay skills nativas</p>
                    <p className="text-xs text-muted-foreground mt-1">
                        Asigná al menos un rango en Información Laboral: las skills se derivan de ahí.
                    </p>
                </div>
            ) : (
                <>
                    <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
                        <Input
                            value={busqueda}
                            onChange={(e) => setBusqueda(e.target.value)}
                            placeholder="Buscar habilidad..."
                            className="pl-9 pr-9 bg-gray-50/50"
                        />
                        {busqueda && (
                            <button
                                type="button"
                                onClick={() => setBusqueda("")}
                                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                                aria-label="Limpiar búsqueda"
                            >
                                <X className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {busqueda && totalVisible === 0 && (
                        <p className="text-sm text-gray-500 italic py-6 text-center">
                            Ninguna habilidad coincide con “{busqueda}”.
                        </p>
                    )}

                    <DragDropContext onDragEnd={onDragEnd}>
                        <Columna
                            droppableId="nivel-0"
                            titulo="Sin prioridad"
                            subtitulo="Sabe hacerlas. El planificador las usa si no hay nadie priorizado."
                            items={porNivel[0]}
                            total={contarNivel(0)}
                            tono="slate"
                            estados={estados}
                            onPatch={patch}
                            filtrando={!!busqueda.trim()}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                            <Columna
                                droppableId="nivel-1"
                                titulo="SKILLS 1"
                                subtitulo="Primera opción del planificador."
                                items={porNivel[1]}
                                total={contarNivel(1)}
                                tono="emerald"
                                estados={estados}
                                onPatch={patch}
                                filtrando={!!busqueda.trim()}
                            />
                            <Columna
                                droppableId="nivel-2"
                                titulo="SKILLS 2"
                                subtitulo="Segunda opción, antes que las sin prioridad."
                                items={porNivel[2]}
                                total={contarNivel(2)}
                                tono="sky"
                                estados={estados}
                                onPatch={patch}
                                filtrando={!!busqueda.trim()}
                            />
                        </div>
                    </DragDropContext>

                    {totalApagadas > 0 && (
                        <div className="mt-3 rounded-lg border border-gray-200">
                            <button
                                type="button"
                                onClick={() => setVerApagadas((v) => !v)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left"
                            >
                                {verApagadas ? (
                                    <ChevronDown className="h-4 w-4 text-gray-500" />
                                ) : (
                                    <ChevronRight className="h-4 w-4 text-gray-500" />
                                )}
                                <span className="text-sm font-medium text-gray-700">
                                    Desactivadas ({totalApagadas})
                                </span>
                                <span className="text-[11px] text-muted-foreground ml-auto">
                                    El planificador no se las asigna
                                </span>
                            </button>
                            {verApagadas && (
                                <div className="px-3 pb-3 flex flex-wrap gap-1.5">
                                    {apagadas.length === 0 && (
                                        <p className="text-xs text-gray-500 italic">
                                            Ninguna coincide con la búsqueda.
                                        </p>
                                    )}
                                    {apagadas.map((n) => (
                                        <button
                                            key={n.id}
                                            type="button"
                                            onClick={() => patch(n.id, { habilitado: true })}
                                            title="Volver a activar"
                                            className="text-[11px] px-2 py-1 rounded-full border border-gray-200 bg-white text-gray-400 line-through hover:text-gray-700 hover:border-gray-400 hover:no-underline"
                                        >
                                            {n.nombre}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

const TONOS = {
    slate: {
        borde: "border-slate-200",
        fondo: "bg-slate-50/60",
        titulo: "text-slate-700",
        chip: "bg-white border-slate-200 text-slate-700",
        activo: "border-slate-400 bg-slate-100",
    },
    emerald: {
        borde: "border-emerald-200",
        fondo: "bg-emerald-50/50",
        titulo: "text-emerald-800",
        chip: "bg-white border-emerald-200 text-emerald-800",
        activo: "border-emerald-400 bg-emerald-100",
    },
    sky: {
        borde: "border-sky-200",
        fondo: "bg-sky-50/50",
        titulo: "text-sky-800",
        chip: "bg-white border-sky-200 text-sky-800",
        activo: "border-sky-400 bg-sky-100",
    },
} as const;

interface ColumnaProps {
    droppableId: string;
    titulo: string;
    subtitulo: string;
    items: NativaItem[];
    total: number;
    tono: keyof typeof TONOS;
    estados: Record<number, EstadoSkill>;
    onPatch: (id: number, cambio: Partial<EstadoSkill>) => void;
    filtrando: boolean;
}

function Columna({ droppableId, titulo, subtitulo, items, total, tono, estados, onPatch, filtrando }: ColumnaProps) {
    const t = TONOS[tono];
    const nivel = DROPPABLES[droppableId];

    // Con el buscador activo el contador tiene que decir cuántas se están viendo de
    // cuántas hay: mostrar solo el total al lado de una lista recortada se lee como
    // que se perdieron skills.
    const contador = filtrando ? `${items.length} de ${total}` : String(total);

    const vacio = filtrando
        ? "Ninguna coincide con la búsqueda"
        : "Arrastrá habilidades acá";

    return (
        <Droppable droppableId={droppableId} direction="horizontal" isDropDisabled={false}>
            {(provided, snapshot) => (
                <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`rounded-lg border transition-colors ${t.borde} ${
                        snapshot.isDraggingOver ? t.activo : t.fondo
                    }`}
                >
                    <div className="flex items-baseline gap-2 px-3 pt-2.5">
                        <span className={`text-sm font-semibold ${t.titulo}`}>{titulo}</span>
                        <span className="text-[11px] text-muted-foreground">{contador}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground px-3 pb-2">{subtitulo}</p>

                    <div className="flex flex-wrap gap-1.5 px-3 pb-3 min-h-[52px] content-start max-h-44 overflow-y-auto">
                        {items.length === 0 && (
                            <p className="text-[11px] text-gray-400 italic self-center w-full text-center py-2">
                                {snapshot.isDraggingOver ? "Soltar acá" : vacio}
                            </p>
                        )}
                        {items.map((item, index) => (
                            <Draggable key={item.id} draggableId={String(item.id)} index={index}>
                                {(dragProvided, dragSnapshot) => (
                                    <div
                                        ref={dragProvided.innerRef}
                                        {...dragProvided.draggableProps}
                                        {...dragProvided.dragHandleProps}
                                        className={`group inline-flex items-center gap-1 text-[11px] pl-2 pr-1 py-1 rounded-full border ${t.chip} ${
                                            dragSnapshot.isDragging ? "shadow-md ring-2 ring-offset-1 ring-gray-300" : ""
                                        }`}
                                    >
                                        <span className="truncate max-w-[220px]" title={item.nombre}>
                                            {item.nombre}
                                        </span>
                                        <BotonesNivel
                                            nivelActual={nivel}
                                            onNivel={(n) => onPatch(item.id, { nivel: n, habilitado: true })}
                                            onApagar={() => onPatch(item.id, { habilitado: false })}
                                        />
                                    </div>
                                )}
                            </Draggable>
                        ))}
                        {provided.placeholder}
                    </div>
                </div>
            )}
        </Droppable>
    );
}

/**
 * Alternativa por click al drag & drop: mover chips con el mouse es cómodo con 20
 * skills y un suplicio con 130, y además el drag no es accesible por teclado.
 */
function BotonesNivel({
    nivelActual,
    onNivel,
    onApagar,
}: {
    nivelActual: NivelSkill;
    onNivel: (n: NivelSkill) => void;
    onApagar: () => void;
}) {
    const opciones: { n: NivelSkill; label: string; title: string }[] = [
        { n: 1, label: "1", title: "Mover a SKILLS 1" },
        { n: 2, label: "2", title: "Mover a SKILLS 2" },
        { n: 0, label: "–", title: "Quitar prioridad" },
    ];
    return (
        <span className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
            {opciones
                .filter((o) => o.n !== nivelActual)
                .map((o) => (
                    <button
                        key={o.n}
                        type="button"
                        title={o.title}
                        aria-label={o.title}
                        onClick={() => onNivel(o.n)}
                        className="h-4 w-4 rounded-full bg-black/5 hover:bg-black/15 text-[9px] leading-none flex items-center justify-center"
                    >
                        {o.label}
                    </button>
                ))}
            <button
                type="button"
                title="Desactivar habilidad"
                aria-label="Desactivar habilidad"
                onClick={onApagar}
                className="h-4 w-4 rounded-full bg-black/5 hover:bg-red-100 hover:text-red-600 flex items-center justify-center"
            >
                <Power className="h-2.5 w-2.5" />
            </button>
        </span>
    );
}
