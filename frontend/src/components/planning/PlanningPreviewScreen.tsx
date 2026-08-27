import React from 'react';
import { PantallaPlanificador, CifraPlan } from "./PantallaPlanificador";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Calendar, Clock, User, Cog, AlertCircle, CalendarClock, Edit2, RotateCcw,
    ChevronDown, ChevronRight, AlertTriangle, Search, X as XIcon,
    HelpCircle, Sparkles, RefreshCw, ListPlus, Info, Lightbulb,
    Columns3, Layers, ListFilter, LogOut, Users,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ZoomControl, usePersistedZoom } from "@/components/ui/zoom-control";
import type { WorkOrder } from "@/lib/types";
import { toast } from "sonner";
import { API_URL } from "@/config";
import { DiagnosticosPlan, type Diagnostico } from "@/components/planning/DiagnosticosPlan";
import { huellaRecursos } from "@/lib/huellaRecursos";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

interface PlanificacionResult {
    orden_id: number;
    proceso_id: number;
    nombre_proceso: string;
    inicio_min: number;
    fin_min: number;
    duracion_min: number;
    prioridad_peso: number;
    id_operario?: number;
    id_rango_operario?: number;
    id_maquinaria?: number;
    rangos_permitidos_proceso?: number[];
    fecha_prometida?: string | null;
    sin_asignar: boolean;
    sin_maquinaria: boolean;
    /** Lo hace un tercero: va sin operario y sin máquina a propósito. */
    tercerizado?: boolean;
    /** false = proceso manual (embalado, pintura, soldadura...): no usa máquina
     *  y el "sin máquina" NO es un hueco. Se muestra "No necesita" en vez de
     *  "Sin asignar", con el desplegable disponible por si igual quieren una. */
    usa_maquina?: boolean;
    secuencia?: number;
    fecha_inicio_estimada?: string;
    fecha_fin_estimada?: string;
    // Enriched fields
    id_otvieja?: number;
    cliente?: string;
    articulo?: string;
    codigo?: string;
    operario_nombre?: string | null;
    maquinaria_nombre?: string | null;
    fecha_inicio_texto?: string;
    fecha_fin_texto?: string;
    unidades?: number;
    cantidad_entregada?: number;
    estado_material?: string;
    fecha_entrada?: string | null;
    id_prioridad?: number;
    prioridad_descripcion?: string;
    all_finalized?: boolean;
    any_process_started?: boolean;
}

interface PlanningPreviewScreenProps {
    isOpen: boolean;
    onClose: () => void;
    onBack?: () => void;
    onConfirm: (payload?: any) => void;
    results: PlanificacionResult[];
    excedentes?: PlanificacionResult[];
    operatorLoads?: Record<number, number>; // Current load in minutes
    isConfirming: boolean;
    availableOperators: any[]; // Resource[] or any
    availableMachines: any[];

    /** OTs no planificadas disponibles para agregar al plan en vivo. */
    unplannedOrders?: WorkOrder[];
    /** IDs de OTs actualmente en el plan (para evitar mostrarlas como "agregables"). */
    selectedOrderIds?: number[];
    /** Rango de fechas elegido en el modal anterior (para recalcular con el mismo). */
    planningRange?: { fecha_desde?: string; fecha_hasta?: string };
    /** Recalcula el plan con un nuevo set de OTs + el mismo rango + las decisiones de forzar. */
    onRecalculate?: (ids: number[], range: { fecha_desde?: string; fecha_hasta?: string }, forzarIds: number[], procesosPorOrden?: Record<number, number[]>) => void;
    /** True mientras se está recalculando (para mostrar spinner). */
    isCalculating?: boolean;
    /** Qué traba este plan y cómo se destraba (lo calcula el backend). */
    diagnosticos?: Diagnostico[];
    /** Avisa de cada retoque hecho a mano para que se guarde en el borrador.
     *  Sin esto el autoguardado solo vería el plan que devolvió el solver, y el
     *  trabajo de acomodar máquinas y operarios se perdería igual. */
    onEdicionesChange?: (ediciones: Record<string, any>, forzarOrdenIds: number[]) => void;
    /** Cuándo se calculó este plan (ISO). Un borrador retomado puede ser de ayer. */
    calculadoEn?: string;
    /**
     * Cómo estaban los datos de Recursos cuando se calculó este plan.
     *
     * Es lo que permite saber, al volver a la pantalla, si lo que dicen los avisos
     * ya se arregló — sin tener que recalcular a lo bruto para averiguarlo. Viaja
     * DENTRO del borrador y no se recalcula al retomarlo: si se tomara la foto de
     * ahora, un borrador de ayer nunca detectaría lo que se cambió anoche, que es
     * justo el caso. Ver `lib/huellaRecursos`.
     */
    huellaAlCalcular?: string | null;
    /** Retoques a mano que traía el borrador que se está retomando. */
    edicionesIniciales?: Record<string, any>;
    /** OTs excedentes que ya venían forzadas en el borrador. */
    forzarIdsIniciales?: number[];
}

export function PlanningPreviewScreen({
    isOpen,
    onClose,
    onBack,
    onConfirm,
    results,
    excedentes = [],
    operatorLoads = {},
    isConfirming,
    availableOperators = [],
    availableMachines = [],
    unplannedOrders = [],
    selectedOrderIds = [],
    planningRange = {},
    onRecalculate,
    isCalculating = false,
    diagnosticos = [],
    onEdicionesChange,
    calculadoEn,
    huellaAlCalcular,
    edicionesIniciales,
    forzarIdsIniciales,
}: PlanningPreviewScreenProps) {

    // Zoom compartido (key 'plan_zoom' en localStorage).
    const [zoom, setZoom] = usePersistedZoom('plan_zoom', 100);

    // Local state for edits
    const [editedResults, setEditedResults] = React.useState<Record<string, PlanificacionResult>>({});
    const [expandedOrderIds, setExpandedOrderIds] = React.useState<number[]>([]);
    // Decisión por orden excedente: true = forzar (incluir igual), false = descartar (default)
    const [forzarOrdenIds, setForzarOrdenIds] = React.useState<Set<number>>(new Set());

    // Cada retoque sube al borrador. Va en un efecto y no dentro de cada setter
    // porque los cambios entran por varios lados (celda, popover, atajo) y con un
    // solo lugar no hay forma de que alguno se olvide de avisar.
    React.useEffect(() => {
        onEdicionesChange?.(editedResults, Array.from(forzarOrdenIds));
    }, [editedResults, forzarOrdenIds, onEdicionesChange]);

    // D1 (feedback 06/07): agregar procesos SUELTOS. `pendingAddProcesos` mapea
    // orden_id -> set de proceso_ids elegidos; `expandedAddIds` = OTs expandidas en
    // el popover para ver sus procesos.
    const [pendingAddProcesos, setPendingAddProcesos] = React.useState<Record<number, Set<number>>>({});
    const [expandedAddIds, setExpandedAddIds] = React.useState<Set<number>>(new Set());

    /**
     * Al entrar a la pantalla se retoma lo que traiga el borrador.
     *
     * El comentario de `handleAbrirBorrador` decía que al retomar un plan "se
     * restauran los retoques hechos a mano", pero no era cierto: el borrador
     * guardaba `ediciones` y `forzarOrdenIds` y esta pantalla nunca los recibía.
     * Retomar un plan de ayer devolvía las asignaciones del solver y tiraba a la
     * basura cada máquina y cada horario que alguien hubiera acomodado a mano —
     * que es la mitad del trabajo de revisar un plan.
     *
     * Va acá y no en un `useState` inicial porque la pantalla queda montada entre
     * plan y plan: el inicializador corre una sola vez en la vida del componente.
     *
     * Cuando el plan es nuevo, el padre manda los dos vacíos y esto los limpia,
     * que es lo que hacía antes con `forzarOrdenIds`.
     */
    React.useEffect(() => {
        if (!isOpen) return;
        setForzarOrdenIds(new Set(forzarIdsIniciales ?? []));
        setEditedResults((edicionesIniciales ?? {}) as Record<string, PlanificacionResult>);
        // Solo al entrar: adentro de la pantalla mandan los cambios del usuario.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    /**
     * "Sticky" excedentes: los conservamos en estado local para sobrevivir al
     * recálculo que se dispara al apretar Forzar. Cuando el backend recibe
     * `forzar_ordenes_ids` no vacío, amplía el horizonte y devuelve `excedentes=[]`,
     * con lo cual perderíamos de vista las OTs que NO forzamos. Mantenemos la
     * última lista "real" (cuando forzar estaba vacío) y filtramos las forzadas
     * para mostrar el resto.
     */
    const [stickyExcedentes, setStickyExcedentes] = React.useState<PlanificacionResult[]>([]);
    React.useEffect(() => {
        // Solo actualizamos la fuente de verdad cuando NO hay forzar activo, porque
        // en ese caso el backend nos devuelve los excedentes "reales" respetando el horizonte.
        if (forzarOrdenIds.size === 0) {
            setStickyExcedentes(excedentes);
        }
    }, [excedentes, forzarOrdenIds.size]);

    /** Excedentes a mostrar en el cartel amarillo: los sticky menos los que ya
     *  fueron forzados (esos ahora están en la tabla "EN EL PLAN"). */
    const displayedExcedentes = React.useMemo(
        () => stickyExcedentes.filter(e => !forzarOrdenIds.has(e.orden_id)),
        [stickyExcedentes, forzarOrdenIds]
    );

    const excedentesPorOrden = React.useMemo(() => {
        const groups: Record<number, PlanificacionResult[]> = {};
        for (const item of displayedExcedentes) {
            if (!groups[item.orden_id]) groups[item.orden_id] = [];
            groups[item.orden_id].push(item);
        }
        return groups;
    }, [displayedExcedentes]);

    /**
     * OTs forzadas con procesos que el solver no pudo asignar.
     * El backend puede devolver procesos como `excedente` aun con horizonte=None si:
     *   - Ningún operario/máquina cumple los requisitos del proceso.
     *   - El solver agotó su tiempo (60s) sin encontrar asignación.
     * El usuario los completa manualmente en el desplegable de la OT.
     */
    const forcedPartialMap = React.useMemo(() => {
        const map = new Map<number, { unfit: PlanificacionResult[]; fitCount: number; totalCount: number }>();
        for (const oid of forzarOrdenIds) {
            const unfit = excedentes.filter(e => e.orden_id === oid);
            const fitCount = results.filter(r => r.orden_id === oid).length;
            const totalCount = fitCount + unfit.length;
            if (unfit.length > 0) {
                map.set(oid, { unfit, fitCount, totalCount });
            }
        }
        return map;
    }, [forzarOrdenIds, excedentes, results]);

    /** Catálogo de rangos cargado bajo demanda (al abrir el modal) para mostrar
     *  nombres legibles en vez de IDs cuando explicamos los motivos de excedentes. */
    const [rangosCatalog, setRangosCatalog] = React.useState<Array<{ id: number; nombre: string }>>([]);
    React.useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_URL}/rangos`, { headers: getAuthHeaders() });
                if (!res.ok) return;
                const data = await res.json();
                const list = Array.isArray(data) ? data : (data?.data || []);
                if (!cancelled) {
                    setRangosCatalog(list.map((r: any) => ({ id: r.id, nombre: r.nombre })));
                }
            } catch {
                // Silencioso: si falla, mostramos los IDs como fallback.
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen]);

    /** Mapea una lista de IDs de rango a una string con sus nombres legibles. */
    const formatRangoIds = (ids: number[]): string => {
        if (!ids || ids.length === 0) return "—";
        return ids
            .map(id => rangosCatalog.find(r => r.id === id)?.nombre || `#${id}`)
            .join(", ");
    };

    /**
     * Diagnostica POR QUÉ un proceso quedó sin asignar (excedente de OT forzada).
     * Esto le da al usuario un motivo accionable en vez de un error genérico.
     */
    const diagnoseUnfitProcess = (item: PlanificacionResult): { code: string; label: string; hint: string; rangos: number[] } => {
        const rangos = item.rangos_permitidos_proceso || [];
        if (rangos.length === 0) {
            return {
                code: "no_rango",
                label: "Sin rango configurado",
                hint: "Este proceso no tiene rango asignado en el sistema. Asignale uno en Recursos → Procesos para que el motor pueda elegir operario.",
                rangos: [],
            };
        }
        return {
            code: "no_match",
            label: "Sin operario/máquina compatible",
            hint: `Ningún operario o máquina disponible cumple los requisitos. Rangos requeridos: ${formatRangoIds(rangos)}. Asigná operarios a estos rangos en Recursos → Operarios.`,
            rangos,
        };
    };

    /** Convierte un datetime-local (YYYY-MM-DDTHH:mm) a `inicio_min` relativo a ahora.
     *  Se usa cuando el usuario asigna manualmente un proceso que quedó afuera. */
    const datetimeToInicioMin = (dtStr: string): number => {
        if (!dtStr) return 0;
        const target = new Date(dtStr).getTime();
        const now = Date.now();
        return Math.max(0, Math.round((target - now) / 60000));
    };

    /** Devuelve true si el proceso "unfit" fue completado a mano por el usuario
     *  (operario + maquinaria + horario). En ese caso lo incluimos en el plan al confirmar. */
    const isUnfitManuallyAssigned = (item: PlanificacionResult): boolean => {
        const key = `${item.orden_id}-${item.proceso_id}`;
        const edit = editedResults[key];
        if (!edit) return false;
        return !!edit.id_operario && edit.id_operario > 0
            && !!edit.id_maquinaria && edit.id_maquinaria > 0
            && !!edit.fecha_inicio_estimada;
    };

    /**
     * Calcula qué `ordenes_ids` mandar al backend en una recalculación.
     *
     * Lógica clave para evitar bug "fuerzo una y entran todas":
     *   - Si `forced` está VACÍO → backend respeta horizonte → mandamos planificadas
     *     + TODAS las excedentes conocidas (sticky) para que el solver vuelva a
     *     evaluarlas dentro de ese horizonte.
     *   - Si `forced` tiene algo → backend ampliará el horizonte (lo dropea por
     *     completo). En ese caso solo mandamos planificadas + las EXACTAS que el
     *     usuario eligió forzar. Si mandáramos también las no-forzadas, entrarían
     *     en el plan sin querer (porque sin horizonte todo entra).
     */
    const buildOrdenIdsForRecalc = (forced: number[], extras: number[] = []) => {
        const planned = Array.from(new Set(results.map(r => r.orden_id)));
        if (forced.length > 0) {
            return Array.from(new Set([...planned, ...forced, ...extras]));
        }
        const allExcedentes = Array.from(new Set(stickyExcedentes.map(e => e.orden_id)));
        return Array.from(new Set([...planned, ...allExcedentes, ...extras]));
    };

    /** Toggle "Forzar" para una OT excedente. Además de marcar la decisión, dispara
     *  un recálculo inmediato para que el usuario vea cómo impacta:
     *   - Si la fuerza → la OT pasa a la tabla "EN EL PLAN" con operario/horario reales.
     *   - Si la des-fuerza → vuelve a aparecer como excedente.
     *  Sin esto, el usuario apretaba Forzar y "no pasaba nada visible" hasta confirmar. */
    const toggleForzar = (ordenId: number) => {
        const next = new Set(forzarOrdenIds);
        const wasForzar = next.has(ordenId);
        if (wasForzar) next.delete(ordenId);
        else next.add(ordenId);
        setForzarOrdenIds(next);

        if (!onRecalculate) return;
        const forcedArr = Array.from(next);
        const mergedIds = buildOrdenIdsForRecalc(forcedArr);
        onRecalculate(mergedIds, planningRange, forcedArr);
    };

    /**
     * Al confirmar, decidimos entre dos rutas:
     *
     *  - **Modo forzar (default)**: si el usuario NO asignó manualmente ningún
     *    proceso "unfit", se confirma como antes — el backend re-corre el solver
     *    con `forzar_ordenes_ids` y guarda lo que pueda asignar automáticamente.
     *    Los procesos que el solver no pudo ubicar quedan fuera (no se guardan).
     *
     *  - **Modo manual+forzar**: si el usuario asignó a mano al menos un proceso
     *    unfit (operario+maquinaria+horario), armamos un `plan` manual que incluye:
     *      • Procesos auto-asignados (con cualquier edit del usuario)
     *      • Procesos unfit completamente asignados a mano
     *    Los procesos unfit que el usuario NO completó se omiten (no se guardan).
     *    Esto le da control total sin obligar a completar todo.
     */
    const handleConfirmWithDecisions = () => {
        // ¿Hay al menos un unfit completamente asignado a mano?
        let anyManuallyAssigned = false;
        for (const info of forcedPartialMap.values()) {
            if (info.unfit.some(u => isUnfitManuallyAssigned(u))) {
                anyManuallyAssigned = true;
                break;
            }
        }

        if (!anyManuallyAssigned) {
            // Flujo original: el backend usa el solver con forzar_ordenes_ids.
            onConfirm({ forzarOrdenIds: Array.from(forzarOrdenIds) });
            return;
        }

        // Modo manual: armamos plan completo.
        const manualPlan: any[] = [];

        // 1. Procesos auto-asignados (con edits del usuario aplicados).
        for (const r of results) {
            const eff = getEffectiveItem(r);
            manualPlan.push({
                ...eff,
                forzado_fuera_rango: forzarOrdenIds.has(r.orden_id),
            });
        }

        // 2. Procesos unfit que el usuario completó a mano.
        for (const info of forcedPartialMap.values()) {
            for (const u of info.unfit) {
                if (!isUnfitManuallyAssigned(u)) continue;
                const eff = getEffectiveItem(u);
                const inicioMin = datetimeToInicioMin(eff.fecha_inicio_estimada || "");
                const finMin = inicioMin + (eff.duracion_min || 0);
                manualPlan.push({
                    ...eff,
                    inicio_min: inicioMin,
                    fin_min: finMin,
                    sin_asignar: false,
                    sin_maquinaria: false,
                    forzado_fuera_rango: true,
                });
            }
        }

        (onConfirm as any)(manualPlan);
    };

    // Cartel de aviso al forzar: si al confirmar quedan OT excedentes SIN forzar,
    // avisamos antes de guardar (esas OT no se van a incluir en el plan).
    const [showForzarWarn, setShowForzarWarn] = React.useState(false);
    const onClickConfirmar = () => {
        if (displayedExcedentes.length > 0) { setShowForzarWarn(true); return; }
        handleConfirmWithDecisions();
    };

    const handleConfirmWithEdits = () => {
        // Devuelve al padre los resultados combinados (originales + edits del usuario).
        const finalResults = results.map(item => {
            const key = `${item.orden_id}-${item.proceso_id}`;
            return editedResults[key] || item;
        });
        (onConfirm as any)(finalResults);
    };

    // ---------- Estado nuevo: agregar OTs en vivo + recalcular ----------

    /** OTs marcadas en el popover "Agregar OTs" (todavía no enviadas al solver). */
    const [pendingAddIds, setPendingAddIds] = React.useState<Set<number>>(new Set());
    const [addSearchTerm, setAddSearchTerm] = React.useState("");
    const [addPopoverOpen, setAddPopoverOpen] = React.useState(false);
    /** UI: orden expandida en el panel de excedentes para mostrar la explicación. */
    const [expandedExcedenteId, setExpandedExcedenteId] = React.useState<number | null>(null);

    // Limpiar selección "para agregar" cuando cambia el set de resultados (ya fueron incluidas).
    React.useEffect(() => {
        setPendingAddIds(new Set());
        setPendingAddProcesos({});
        setExpandedAddIds(new Set());
    }, [results.length, isOpen]);

    /** Lista de OTs disponibles para agregar: no están en el plan actual, no son excedentes,
     *  y tienen al menos un proceso cargado (sin procesos el solver no las puede ubicar). */
    const addableOrders = React.useMemo(() => {
        const inPlanIds = new Set([
            ...selectedOrderIds,
            ...results.map(r => r.orden_id),
            ...stickyExcedentes.map(e => e.orden_id),
        ]);
        return unplannedOrders.filter(o =>
            !inPlanIds.has(o.id) &&
            Array.isArray(o.procesos) && o.procesos.length > 0
        );
    }, [unplannedOrders, selectedOrderIds, results, stickyExcedentes]);

    const filteredAddableOrders = React.useMemo(() => {
        const term = addSearchTerm.toLowerCase();
        if (!term) return addableOrders;
        return addableOrders.filter(o =>
            String(o.id_otvieja || o.id).includes(term) ||
            (o.cliente?.nombre || "").toLowerCase().includes(term) ||
            (o.articulo?.descripcion || "").toLowerCase().includes(term) ||
            (o.articulo?.cod_articulo || "").toLowerCase().includes(term) ||
            // D1: también buscar por nombre de proceso.
            (Array.isArray(o.procesos) && o.procesos.some((p: any) => (p.proceso?.nombre || "").toLowerCase().includes(term)))
        );
    }, [addableOrders, addSearchTerm]);

    const togglePendingAdd = (id: number) => {
        setPendingAddIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // D1: seleccionar/deseleccionar un proceso suelto de una OT.
    const togglePendingProceso = (ordenId: number, procesoId: number) => {
        setPendingAddProcesos(prev => {
            const next = { ...prev };
            const set = new Set(next[ordenId] || []);
            if (set.has(procesoId)) set.delete(procesoId);
            else set.add(procesoId);
            if (set.size === 0) delete next[ordenId];
            else next[ordenId] = set;
            return next;
        });
    };

    const toggleExpandAdd = (ordenId: number) => {
        setExpandedAddIds(prev => {
            const next = new Set(prev);
            if (next.has(ordenId)) next.delete(ordenId);
            else next.add(ordenId);
            return next;
        });
    };

    // Total de ítems seleccionados para el label del botón (OTs enteras + procesos sueltos
    // de OTs que NO se agregan enteras).
    const totalPendingAdd = React.useMemo(() => {
        let n = pendingAddIds.size;
        for (const [oidStr, set] of Object.entries(pendingAddProcesos)) {
            if (!pendingAddIds.has(Number(oidStr))) n += set.size;
        }
        return n;
    }, [pendingAddIds, pendingAddProcesos]);

    /** Recalcula el plan con las OTs actuales + las nuevas pendientes + decisiones de forzar. */
    const handleRecalculate = (extraIds: number[] = [], procesosPorOrden?: Record<number, number[]>) => {
        if (!onRecalculate) {
            toast.error("Recalcular no está disponible en este contexto.");
            return;
        }
        const forcedArr = Array.from(forzarOrdenIds);
        const mergedIds = buildOrdenIdsForRecalc(forcedArr, extraIds);
        onRecalculate(mergedIds, planningRange, forcedArr, procesosPorOrden);
    };

    const handleAddSelectedAndRecalculate = () => {
        const wholeOts = Array.from(pendingAddIds);
        // OTs de las que se eligieron procesos SUELTOS (excluyendo las que ya van enteras).
        const procOrdenIds = Object.keys(pendingAddProcesos)
            .map(Number)
            .filter(oid => !pendingAddIds.has(oid) && (pendingAddProcesos[oid]?.size || 0) > 0);
        const extras = Array.from(new Set([...wholeOts, ...procOrdenIds]));
        if (extras.length === 0) {
            toast.error("No seleccionaste ninguna OT ni proceso para agregar.");
            return;
        }
        // procesos_por_orden solo para las OTs de las que se eligieron procesos sueltos.
        const procesosPorOrden: Record<number, number[]> = {};
        for (const oid of procOrdenIds) {
            procesosPorOrden[oid] = Array.from(pendingAddProcesos[oid]);
        }
        // Limpiamos inmediatamente la selección y cerramos el popover ANTES de
        // disparar el recálculo, para que cuando vuelva a abrir esté vacío.
        setPendingAddIds(new Set());
        setPendingAddProcesos({});
        setExpandedAddIds(new Set());
        setAddSearchTerm("");
        setAddPopoverOpen(false);
        handleRecalculate(extras, Object.keys(procesosPorOrden).length > 0 ? procesosPorOrden : undefined);
    };

    /** Saca una OT del plan y recalcula (sin esa OT). Pensado para el botón "x"
     *  de cada fila en la tabla de resultados. */
    const handleRemoveOrderAndRecalculate = (ordenId: number) => {
        if (!onRecalculate) {
            toast.error("Eliminar no está disponible en este contexto.");
            return;
        }
        // También quitamos la decisión de forzar si la tenía y la sacamos de los excedentes sticky.
        const newForzar = Array.from(forzarOrdenIds).filter(id => id !== ordenId);
        setForzarOrdenIds(new Set(newForzar));
        setStickyExcedentes(prev => prev.filter(e => e.orden_id !== ordenId));

        const planned = Array.from(new Set(results.map(r => r.orden_id))).filter(id => id !== ordenId);
        const stickyIds = Array.from(new Set(stickyExcedentes.map(e => e.orden_id))).filter(id => id !== ordenId);
        const mergedIds = newForzar.length > 0
            ? Array.from(new Set([...planned, ...newForzar]))
            : Array.from(new Set([...planned, ...stickyIds]));

        if (mergedIds.length === 0) {
            toast.error("No podés quitar la última OT del plan. Cerrá la vista previa con la X.");
            return;
        }
        onRecalculate(mergedIds, planningRange, newForzar);
    };

    const toggleRow = (ordenId: number) => {
        setExpandedOrderIds(prev =>
            prev.includes(ordenId)
                ? prev.filter(id => id !== ordenId)
                : [...prev, ordenId]
        );
    };

    const getEffectiveItem = (item: PlanificacionResult) => {
        const key = `${item.orden_id}-${item.proceso_id}`;
        return editedResults[key] || item;
    };

    const handleUpdate = (item: PlanificacionResult, field: keyof PlanificacionResult, value: any) => {
        const key = `${item.orden_id}-${item.proceso_id}`;
        const currentEffective = getEffectiveItem(item);
        const updated = { ...currentEffective, [field]: value };
        setEditedResults(prev => ({ ...prev, [key]: updated }));
    };

    const handleDateChange = (item: PlanificacionResult, dateStr: string) => {
        // dateStr is usually "YYYY-MM-DDTHH:mm" from datetime-local input
        // we might want to store it as string or convert to whatever format backend needs.
        // The interface says `fecha_inicio_estimada?: string`.
        // We'll store exactly what the input gives for now (ISO like).
        handleUpdate(item, 'fecha_inicio_estimada', dateStr);
    };

    // Formatters
    const formatDate = (dateStr?: string | null) => {
        if (!dateStr) return "-";
        try {
            const date = new Date(dateStr);
            return date.toLocaleDateString("es-AR", {
                day: "2-digit",
                month: "2-digit",
            });
        } catch (e) {
            return dateStr;
        }
    };

    const capitalize = (s: string) => {
        if (!s) return "";
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    };

    const getPriorityLabel = (id?: number, desc?: string) => {
        if (desc) return capitalize(desc);
        if (id === 1) return "Baja";
        if (id === 2) return "Media";
        if (id === 3) return "Alta";
        if (id === 4) return "Urgente";
        return "Normal";
    };

    const getDateFromMin = (min: number) => {
        // This is a placeholder. 
        // Realistically we need the "base date" for the plan to convert minutes to date.
        // If `fecha_inicio_estimada` is missing, we can't easily guess.
        // We'll return undefined or empty string if no date field exists.
        return "";
    };

    const getRowColor = (item: PlanificacionResult) => {
        // 1. Finalizada Total (Violeta)
        if (item.all_finalized) return "bg-purple-200 hover:bg-purple-300 text-purple-900";

        // 2. Finalizada Parcial / Entregada Parcial (Gris)
        const cantidadEntregada = item.cantidad_entregada || 0;
        const unidades = item.unidades || 0;
        if (cantidadEntregada > 0 && cantidadEntregada < unidades) {
            return "bg-gray-200 hover:bg-gray-300 text-gray-900";
        }

        // 3. En Producción (Naranja)
        if (item.any_process_started) return "bg-orange-200 hover:bg-orange-300 text-orange-900";

        // 4. Programada (Verde)
        // In the modal, EVERYTHING is effectively "Scheduled" because it's a planning preview.
        // So this is the fallback for items not in the above states.
        // However, we should check material logic below? 
        // Hierarchy: If none of the above, it IS "Programada" because it is here.
        // But "Material Available" (Amber) is usually for UN-scheduled items. 
        // Once scheduled, they become Green. 
        // So Green is the correct baseline for this Modal.
        return "bg-green-100 hover:bg-green-200 text-green-900";
    };

    // ... (rest of helpers) ...

    // Helper to group by Order ID
    const groupedResults = React.useMemo(() => {
        const groups: Record<number, PlanificacionResult[]> = {};
        for (const item of results) {
            if (!groups[item.orden_id]) groups[item.orden_id] = [];
            groups[item.orden_id].push(item);
        }
        return groups;
    }, [results]);

    // Placeholder for conflicts if missing (can be refined later)
    const conflicts = { details: [] as any[] };

    // ---------- Análisis de excedentes (¿por qué no entra?) ----------
    //
    // El backend marca una OT como "excedente" cuando el solver no pudo ubicar
    // ninguno de sus procesos dentro del horizonte (fecha_desde → fecha_hasta).
    // No nos devuelve el motivo exacto, pero podemos *inferirlo* del dato disponible:
    //
    //   1) Duración total de los procesos vs. capacidad teórica del rango.
    //   2) Fecha prometida posterior al rango (la OT no debería entrar todavía).
    //   3) Prioridad baja (el solver coloca primero las urgentes / críticas).
    //
    // Devuelve una lista de strings amigables que el usuario puede leer y accionar.

    /** Calcula días hábiles entre dos fechas YYYY-MM-DD (excluye sábados/domingos). */
    /**
     * "2026-08-17" → Date del 17 a las 00:00 LOCALES.
     *
     * `new Date("2026-08-17")` se parsea como medianoche UTC, que en Argentina
     * (UTC-3) es el día ANTERIOR a las 21:00. Con eso getDay() devolvía el día de
     * semana corrido: el conteo de hábiles terminaba salteando lunes y contando
     * domingos. Toda fecha "sólo día" que venga como texto tiene que entrar por acá.
     */
    const fechaLocal = (iso: string): Date => {
        const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
        return new Date(a, (m || 1) - 1, d || 1);
    };

    const businessDaysBetween = (fromIso?: string, toIso?: string): number => {
        if (!fromIso || !toIso) return 0;
        const start = fechaLocal(fromIso);
        const end = fechaLocal(toIso);
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 0;
        let count = 0;
        const cur = new Date(start);
        while (cur <= end) {
            const dow = cur.getDay();
            if (dow !== 0 && dow !== 6) count++;
            cur.setDate(cur.getDate() + 1);
        }
        return count;
    };

    /** Estimación grosera de capacidad del rango: días hábiles × 8h × operarios disponibles. */
    const rangeCapacityMinutes = React.useMemo(() => {
        const bizDays = businessDaysBetween(planningRange.fecha_desde, planningRange.fecha_hasta);
        if (bizDays === 0) return 0;
        const activeOperators = availableOperators.filter(op => op.disponible).length || 1;
        return bizDays * 8 * 60 * activeOperators;
    }, [planningRange.fecha_desde, planningRange.fecha_hasta, availableOperators]);

    /** Suma de duraciones de procesos planificados (+ excedentes) — lo que el plan "intenta" colocar. */
    const totalDemandMinutes = React.useMemo(() => {
        const fromResults = results.reduce((acc, r) => acc + (r.duracion_min || 0), 0);
        const fromExcedentes = displayedExcedentes.reduce((acc, e) => acc + (e.duracion_min || 0), 0);
        return fromResults + fromExcedentes;
    }, [results, excedentes]);

    /** Devuelve razones humanas de por qué la OT con ID `ordenId` quedó como excedente. */
    const getExcedenteReasons = (ordenId: number): string[] => {
        const procesosOT = excedentes.filter(e => e.orden_id === ordenId);
        if (procesosOT.length === 0) return ["No hay datos disponibles del solver."];
        const first = procesosOT[0];
        const reasons: string[] = [];

        // 1) Duración total OT vs. capacidad del rango
        const otDurationMin = procesosOT.reduce((a, p) => a + (p.duracion_min || 0), 0);
        if (rangeCapacityMinutes > 0) {
            const occupancyRatio = totalDemandMinutes / rangeCapacityMinutes;
            if (occupancyRatio > 0.9) {
                reasons.push(
                    `El rango seleccionado tiene poca capacidad libre (${Math.round(occupancyRatio * 100)}% ocupado por otras OTs). Esta OT requiere ${formatMinutesShort(otDurationMin)} adicionales.`
                );
            }
        }

        // 2) Fecha prometida posterior al rango
        if (first.fecha_prometida && planningRange.fecha_hasta) {
            const prom = new Date(first.fecha_prometida);
            const hasta = new Date(planningRange.fecha_hasta);
            if (prom > hasta) {
                const days = Math.ceil((prom.getTime() - hasta.getTime()) / (1000 * 60 * 60 * 24));
                reasons.push(
                    `La fecha prometida (${formatDate(first.fecha_prometida)}) está ${days} día${days === 1 ? "" : "s"} después del fin del rango. El motor priorizó OTs con vencimiento dentro del rango.`
                );
            }
        }

        // 3) Prioridad baja
        if ((first.id_prioridad || 0) <= 2) {
            reasons.push(
                `Prioridad ${getPriorityLabel(first.id_prioridad, first.prioridad_descripcion).toLowerCase()}: el motor coloca primero las OTs urgentes y críticas dentro del rango disponible.`
            );
        }

        // 4) Demasiados procesos en la OT
        if (procesosOT.length >= 5) {
            reasons.push(
                `Esta OT tiene ${procesosOT.length} procesos secuenciales, lo que requiere una ventana de tiempo más larga que la disponible.`
            );
        }

        // Fallback
        if (reasons.length === 0) {
            reasons.push(
                "El motor de planificación no encontró una ventana laboral viable dentro del rango para todos los procesos de esta OT."
            );
        }

        return reasons;
    };

    const formatMinutesShort = (mins: number): string => {
        if (mins <= 0) return "0 min";
        if (mins < 60) return `${Math.round(mins)} min`;
        const h = Math.floor(mins / 60);
        const m = Math.round(mins % 60);
        return m === 0 ? `${h} h` : `${h}h ${m}m`;
    };

    // Bloqueo de cierre por click afuera / Escape: el modal solo se cierra con la X
    // del header o el botón "Volver". Esto evita perder los ajustes por error.
    const handleOpenChange = (open: boolean) => {
        // No cerramos automáticamente; el cierre lo controlan los botones explícitos.
        if (!open) return;
    };

    /** Lo rojo del plan: lo que quedó sin resolver y hay que ir a arreglar. */
    const trabasSinResolver = React.useMemo(
        () => diagnosticos.filter(d => d.severidad === "bloqueante").length,
        [diagnosticos]
    );

    // Cantidad de OTs distintas en el plan actual (no procesos), útil para mostrar al usuario.
    const uniqueOrdersInPlan = React.useMemo(
        () => new Set(results.map(r => r.orden_id)).size,
        [results]
    );

    /**
     * Cuándo arranca y cuándo termina REALMENTE este plan, y cuántos días hábiles
     * ocupa. Se saca de las fechas que calculó el planificador, no del rango que
     * eligió el usuario: si no eligió ninguno igual hay un período — el que hizo
     * falta — y hasta ahora no se veía por ningún lado (Julián, 18/08: "por más
     * que no esté marcado ahí el rango de fechas, igual debe decírtelo").
     */
    const spanPlan = React.useMemo(() => {
        const inicios = results.map(r => r.fecha_inicio_estimada).filter(Boolean) as string[];
        const fines = results.map(r => r.fecha_fin_estimada).filter(Boolean) as string[];
        if (inicios.length === 0 || fines.length === 0) return null;
        const desde = inicios.reduce((a, b) => (a < b ? a : b));
        const hasta = fines.reduce((a, b) => (a > b ? a : b));
        // Días hábiles entre ambas puntas (sin domingos; el sábado puede o no
        // trabajarse según los horarios de cada uno, así que se cuenta).
        const d0 = fechaLocal(desde);
        const d1 = fechaLocal(hasta);
        let habiles = 0;
        for (const d = new Date(d0); d <= d1; d.setDate(d.getDate() + 1)) {
            if (d.getDay() !== 0) habiles++;  // el sábado puede trabajarse: cuenta
        }
        return { desde, hasta, habiles };
    }, [results]);

    /**
     * "18/8 07:00 → 27/8 10:30" para una OT. Toma la primera fecha de arranque y
     * la última de fin entre sus procesos; el año se omite a propósito (la
     * planificación es siempre a semanas vista y el año solo ocupa lugar).
     */
    const spanDeOT = (items: PlanificacionResult[]) => {
        const inicios = items.map(i => i.fecha_inicio_estimada).filter(Boolean) as string[];
        const fines = items.map(i => i.fecha_fin_estimada).filter(Boolean) as string[];
        if (inicios.length === 0 || fines.length === 0) return "—";
        const corta = (iso: string) => {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return "";
            return `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        };
        return `${corta(inicios.reduce((a, b) => (a < b ? a : b)))} → ${corta(fines.reduce((a, b) => (a > b ? a : b)))}`;
    };

    /** Suma días a una fecha "YYYY-MM-DD" y la devuelve en el mismo formato. */
    const sumarDias = (iso: string, dias: number) => {
        const d = fechaLocal(iso);
        d.setDate(d.getDate() + dias);
        // Formateo local: toISOString() vuelve a UTC y restaría un día.
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    /** Recalcula el mismo plan con dos semanas más de margen. */
    const ampliarRango = () => {
        if (!onRecalculate) return;
        const base = planningRange.fecha_hasta || spanPlan?.hasta?.slice(0, 10);
        if (!base) return;
        // Las OTs excedentes SON el motivo del botón: mandarlas es el punto.
        // Con `results` solo (las planificadas) se caían de la lista, el backend
        // devolvía excedentes: [] y el cartel ámbar desaparecía como si se hubiera
        // resuelto. Y hay que respetar los "forzar" que el usuario ya marcó, o la
        // pantalla queda mostrando algo distinto de lo que se va a guardar.
        const forcedArr = Array.from(forzarOrdenIds);
        onRecalculate(
            buildOrdenIdsForRecalc(forcedArr),
            { fecha_desde: planningRange.fecha_desde, fecha_hasta: sumarDias(base, 14) },
            forcedArr,
        );
    };

    // ---------- Revisión automática al volver de Recursos ----------

    /**
     * "Fui a las alertas, fui a Recursos, arreglé las que decía, y al volver al
     * borrador sigue apareciendo" (Julián, 19/08).
     *
     * Los diagnósticos son la foto del momento del cálculo y la ÚNICA forma de
     * refrescarlos es recalcular: se arman con lo que el solver realmente hizo, no
     * con una consulta a la base. Hasta ahora eso obligaba a un botón —"Volver a
     * revisar"— y el aviso resuelto seguía en rojo hasta que alguien se acordaba
     * de tocarlo.
     *
     * Ahora, al volver a esta pantalla, se compara la huella de los datos de
     * Recursos contra la que tenía el plan cuando se calculó (`lib/huellaRecursos`,
     * tres GET chicos). Si no cambió nada, no se molesta a nadie. Si cambió, se
     * recalcula solo y los avisos que desaparecieron quedan tachados en verde.
     *
     * Lo que NO se hace solo: recalcular cuando hay retoques a mano en el plan. El
     * recálculo rehace las asignaciones automáticas, y perder de golpe las máquinas
     * y horarios que alguien acomodó a mano —sin haber pedido nada— es peor que un
     * aviso viejo. En ese caso se avisa y la decisión queda en el botón.
     */
    const [revisionAuto, setRevisionAuto] = React.useState<
        "mirando" | "recalculando" | "con-retoques" | "no-disponible" | null
    >(null);
    const revisionEnCurso = React.useRef(false);

    // Cada plan nuevo (o recalculado) limpia el estado del cartel: la foto que se
    // está mirando pasó a ser la de recién.
    React.useEffect(() => {
        setRevisionAuto(null);
    }, [calculadoEn]);

    const revisarSiCambioAlgo = async () => {
        if (!isOpen || !onRecalculate) return;
        if (isCalculating || isConfirming) return;
        if (diagnosticos.length === 0) return;      // no hay nada que pueda haberse resuelto
        if (revisionEnCurso.current) return;
        if (!huellaAlCalcular) {
            // Borrador viejo (guardado antes de que esto existiera) o Recursos caído
            // cuando se calculó: no hay contra qué comparar. Queda el botón.
            setRevisionAuto("no-disponible");
            return;
        }

        revisionEnCurso.current = true;
        setRevisionAuto("mirando");
        const ahora = await huellaRecursos();
        revisionEnCurso.current = false;

        if (ahora === null) { setRevisionAuto("no-disponible"); return; }
        if (ahora === huellaAlCalcular) { setRevisionAuto(null); return; }

        if (Object.keys(editedResults).length > 0) {
            setRevisionAuto("con-retoques");
            return;
        }

        setRevisionAuto("recalculando");
        toast.info("Cambió algo en Recursos", {
            description: "Recalculando el plan para ver qué avisos quedaron resueltos.",
        });
        handleRecalculate();
    };

    /**
     * La función se guarda en una ref y el efecto depende SOLO de `isOpen`.
     *
     * Si el efecto dependiera de la función, se volvería a montar con cada retoque
     * a mano (cada cambio de `editedResults` la recrea) y volvería a consultar
     * Recursos: tres GET por cada desplegable que alguien toca. La ref además evita
     * lo contrario —quedarse con una versión vieja de `handleRecalculate`—, porque
     * se actualiza en cada render.
     */
    const revisarRef = React.useRef(revisarSiCambioAlgo);
    React.useEffect(() => { revisarRef.current = revisarSiCambioAlgo; });

    /**
     * Cuándo se dispara: al entrar a la pantalla y cada vez que la pestaña vuelve a
     * estar visible. Los dos casos son el mismo movimiento —"me fui a Recursos y
     * volví"—: se vaya por el menú de la app o abriendo Recursos en otra pestaña,
     * que es lo que ofrecen los links de los avisos.
     */
    React.useEffect(() => {
        if (!isOpen) return;
        void revisarRef.current();
        const alVolver = () => {
            // La pestaña oculta no es "volver": el `focus` de una ventana que sigue
            // atrás no debería disparar un recálculo.
            if (document.visibilityState === "visible") void revisarRef.current();
        };
        document.addEventListener("visibilitychange", alVolver);
        window.addEventListener("focus", alVolver);
        return () => {
            document.removeEventListener("visibilitychange", alVolver);
            window.removeEventListener("focus", alVolver);
        };
    }, [isOpen]);

    // ---------- Filtros y columnas de la tabla del plan ----------

    /**
     * Con 40 OTs y 300 procesos la tabla no entra en la pantalla, y lo que se busca
     * casi siempre es un subconjunto: las que llegan tarde, las que quedaron sin
     * operario, las de un cliente. Los filtros son sobre la OT entera: si una de
     * sus líneas cumple, la OT se muestra completa — filtrar procesos sueltos
     * dejaría OTs a medias y el plan no se lee así.
     */
    const [filtroTexto, setFiltroTexto] = React.useState("");
    const [filtros, setFiltros] = React.useState({
        atrasadas: false,
        forzadas: false,
        sinOperario: false,
        sinMaquina: false,
    });
    const [filtrosAbiertos, setFiltrosAbiertos] = React.useState(false);
    const filtrosActivos = (filtroTexto ? 1 : 0) + Object.values(filtros).filter(Boolean).length;

    const gruposFiltrados = React.useMemo(() => {
        if (filtrosActivos === 0) return groupedResults;
        const term = filtroTexto.trim().toLowerCase();
        const salida: Record<number, PlanificacionResult[]> = {};
        for (const [oidStr, items] of Object.entries(groupedResults)) {
            const oid = Number(oidStr);
            const efectivos = items.map(i => getEffectiveItem(i));
            const primero = items[0];

            if (term) {
                const heno = [
                    String(primero.id_otvieja ?? oid),
                    String(oid),
                    primero.cliente || "",
                    primero.codigo || "",
                    primero.articulo || "",
                    ...items.map(i => i.nombre_proceso || ""),
                ].join(" ").toLowerCase();
                if (!heno.includes(term)) continue;
            }
            if (filtros.forzadas && !forzarOrdenIds.has(oid)) continue;
            if (filtros.atrasadas && !efectivos.some(i =>
                i.fecha_fin_estimada && i.fecha_prometida &&
                new Date(i.fecha_fin_estimada) > new Date(i.fecha_prometida))) continue;
            // Un tercerizado sin operario no es un hueco: lo hace un tercero.
            if (filtros.sinOperario && !efectivos.some(i => !i.id_operario && !i.tercerizado)) continue;
            // Idem un proceso manual sin máquina: no la necesita.
            if (filtros.sinMaquina && !efectivos.some(i => !i.id_maquinaria && i.usa_maquina !== false && !i.tercerizado)) continue;

            salida[oid] = items;
        }
        return salida;
    }, [groupedResults, filtroTexto, filtros, filtrosActivos, forzarOrdenIds, editedResults]);

    const otsFiltradas = Object.keys(gruposFiltrados).length;
    const procesosFiltrados = Object.values(gruposFiltrados).reduce((a, xs) => a + xs.length, 0);

    /**
     * Qué columnas se ven. Trece columnas entran en un monitor de escritorio y en
     * ninguna otra cosa; el que planifica desde una notebook mira siempre las
     * mismas cuatro o cinco. Queda guardado en el navegador para no re-elegirlo
     * cada vez.
     */
    const COLUMNAS = React.useMemo(() => ([
        { clave: "entrada", titulo: "Entrada" },
        { clave: "cliente", titulo: "Cliente" },
        { clave: "codigo", titulo: "Código" },
        { clave: "articulo", titulo: "Artículo" },
        { clave: "cantidad", titulo: "Cant." },
        { clave: "material", titulo: "Mat." },
        { clave: "progreso", titulo: "Progreso" },
        { clave: "prioridad", titulo: "Prioridad" },
        { clave: "prometida", titulo: "Prometida" },
        { clave: "trabajo", titulo: "Trabajo" },
        { clave: "alertas", titulo: "Alertas" },
    ] as const), []);
    const CLAVE_COLUMNAS = "plan_preview_columnas";
    const [ocultas, setOcultas] = React.useState<Set<string>>(new Set());
    React.useEffect(() => {
        try {
            const crudo = localStorage.getItem(CLAVE_COLUMNAS);
            if (crudo) setOcultas(new Set(JSON.parse(crudo)));
        } catch { /* si no se puede leer, se ven todas */ }
    }, []);
    const alternarColumna = (clave: string) => {
        setOcultas(prev => {
            const next = new Set(prev);
            if (next.has(clave)) next.delete(clave);
            else next.add(clave);
            try { localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify(Array.from(next))); } catch { /* nada */ }
            return next;
        });
    };
    const ve = (clave: string) => !ocultas.has(clave);
    // Expandir + ID + acciones son fijas: sin ellas la fila no se puede ni abrir ni sacar.
    const totalColumnas = 3 + COLUMNAS.filter(c => ve(c.clave)).length;

    /** Panel de carga ancho: dos columnas y sin recortar los rangos. */
    const [cargaCompleta, setCargaCompleta] = React.useState(false);

    /**
     * El panel de operarios se pliega a un riel y vuelve.
     *
     * "Me gustaría que me acompañe el side de la derecha con los operarios"
     * (Julián, 26/08). Con 320px fijos no acompaña: la tabla pide min-w ~1036px y
     * en una notebook de 1366 no entra, aparece scroll horizontal — la otra mitad
     * del "tantos scroll dentro". Se descartó overlay (vuelve al modal flotando
     * que ya se sacó el 19/08, y hay que abrirlo y cerrarlo: eso no es acompañar)
     * y ancho fluido solo (no devuelve nada justo en la pantalla chica, que es
     * donde duele). Queda plegable: sigue SIEMPRE en pantalla como columna, y
     * plegado le devuelve 276px de ancho a la tabla.
     *
     * Se guarda en el navegador, igual que las columnas: el panel queda como uno
     * lo dejó la vez pasada.
     */
    const CLAVE_CARGA = "plan_preview_carga_abierta";
    const [cargaAbierta, setCargaAbierta] = React.useState(true);
    React.useEffect(() => {
        try { if (localStorage.getItem(CLAVE_CARGA) === "0") setCargaAbierta(false); } catch { /* queda abierto */ }
    }, []);
    const alternarCarga = () => setCargaAbierta(v => {
        try { localStorage.setItem(CLAVE_CARGA, v ? "0" : "1"); } catch { /* nada */ }
        return !v;
    });

    /** Cuántos operarios quedan pasados de las 44h si se confirma este plan.
     *  Es lo que hace que plegar el panel resuma en vez de esconder: el riel lo
     *  sigue mostrando en rojo. */
    const sobrecargados = React.useMemo(() => availableOperators.filter(op => {
        const propio = results
            .map(r => getEffectiveItem(r))
            .filter(r => r.id_operario === op.id)
            .reduce((s, r) => s + (r.duracion_min || 0), 0);
        return ((operatorLoads[op.id] || 0) + propio) / 60 > 44;
    }).length, [availableOperators, operatorLoads, results, editedResults]);

    /**
     * La tira de avisos arranca PLEGADA — pero sólo si el plan no tiene trabas.
     *
     * "Quiero poder ver más OT también en la preview": desplegada se come ~290px,
     * o sea 5 filas de OT, antes de que empiece la tabla. Pero una traba sin
     * resolver puede cambiar la decisión de guardar, así que eso NO se pliega
     * solo. Y aun plegada quedan a la vista la barra de color con el resumen
     * ("2 avisos"), el chevron y la cifra del riel: no se esconde nada sin rastro.
     *
     * Se decide UNA sola vez, al abrir la pantalla con los diagnósticos ya
     * cargados. Si después se resuelve algo, el panel no se vuelve a plegar solo:
     * justo ahí es cuando aparecen los tachados en verde, que son la devolución
     * de que el arreglo funcionó.
     */
    const [avisosColapsados, setAvisosColapsados] = React.useState(false);
    const colapsoDecidido = React.useRef(false);
    React.useEffect(() => {
        if (!isOpen || colapsoDecidido.current || diagnosticos.length === 0) return;
        colapsoDecidido.current = true;
        setAvisosColapsados(trabasSinResolver === 0);
    }, [isOpen, diagnosticos.length, trabasSinResolver]);

    /** Para que "Ver detalles" de la cifra de trabas lleve al panel de avisos.
     *  Despliega ANTES de scrollear: llevar a un panel plegado sería mandar a la
     *  nada, el consejo muerto de siempre. El rAF espera al re-render para que el
     *  scroll apunte al panel ya abierto. */
    const panelAvisos = React.useRef<HTMLDivElement | null>(null);
    const irAAvisos = () => {
        setAvisosColapsados(false);
        requestAnimationFrame(() => panelAvisos.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    };

    return (
        <>
        <PantallaPlanificador
            visible={isOpen}
            cabecera={
                <>
                    {/* Una sola línea. El alto de esta fila ya lo fija el h-8 de los
                        botones de la derecha, así que el título se achica gratis:
                        text-xl (28px de línea) → text-[17px] (24px) no cambia nada de
                        lo que se ve y el `items-center` deja de reservar alto para una
                        bajada que ya no existe. */}
                    <div className="px-6 py-2 flex items-center justify-between gap-4">
                        <div className="min-w-0 flex-1">
                            <h1 className="text-[17px] font-bold text-gray-900 flex items-center gap-2 whitespace-nowrap">
                                <CalendarClock className="w-4 h-4 text-blue-600 shrink-0" />
                                Vista previa de planificación
                                {/* Que se lea que esto TODAVÍA no es el plan: es lo que
                                    distingue esta pantalla de Operaciones, que se le
                                    parece bastante y sí muestra lo ya guardado. */}
                                <span className="text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                                    En revisión
                                </span>
                            </h1>

                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            {/* Lo que quedó afuera, y el botón para arreglarlo, compartiendo
                                fila con las acciones. Antes eran una TERCERA fila de chips de
                                11px bajo el título: 30px de alto reservados siempre para dos
                                cosas que aparecen a veces. Acá no cuestan un píxel, porque la
                                fila ya mide lo que mide un botón h-8.

                                El período del plan se fue al riel de cifras, con el peso que
                                pedía Julián el 26/08 ("la fecha, que es algo re importante, no
                                se le da nada de importancia ahí chiquito"), y el "Tope elegido"
                                se pliega adentro de esa misma celda: repetirlo suelto cuando
                                coincide con el cierre real del plan era leer dos veces lo mismo. */}
                            {displayedExcedentes.length > 0 && (
                                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1 text-[11px]">
                                    <AlertTriangle className="w-3 h-3" />
                                    {new Set(displayedExcedentes.map(e => e.orden_id)).size} sin lugar
                                </Badge>
                            )}
                            {displayedExcedentes.length > 0 && onRecalculate && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={ampliarRango}
                                    disabled={isCalculating}
                                    className="h-8 px-2.5 text-xs gap-1 border-amber-300 text-amber-800 hover:bg-amber-50"
                                    title="Recalcula el mismo plan con dos semanas más de margen"
                                >
                                    <Calendar className="w-3.5 h-3.5" />
                                    Ampliar 2 semanas
                                </Button>
                            )}
                            {/* Botón Agregar OTs (abre popover con OTs disponibles) */}

                            {unplannedOrders.length > 0 && onRecalculate && (
                                <Popover open={addPopoverOpen} onOpenChange={setAddPopoverOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 gap-1.5 border-blue-200 text-blue-700 hover:bg-blue-50 hover:border-blue-300"
                                            disabled={isCalculating || isConfirming}
                                        >
                                            <ListPlus className="w-3.5 h-3.5" />
                                            Agregar OTs
                                            <Badge className="ml-1 bg-blue-100 text-blue-700 border-0 px-1.5 py-0 text-[10px] tabular-nums">
                                                {addableOrders.length}
                                            </Badge>
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[420px] p-0" align="end">
                                        <div className="p-3 border-b bg-slate-50">
                                            <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                                <ListPlus className="w-4 h-4 text-blue-600" />
                                                Agregar OTs al plan
                                            </div>
                                            <p className="text-[11px] text-gray-500 mt-1">
                                                Tildá la OT entera, o expandí (▸) para elegir <strong>procesos sueltos</strong>. Al agregar, el plan se recalcula.
                                            </p>
                                        </div>
                                        <div className="p-2 border-b bg-white">
                                            <div className="relative">
                                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                                <Input
                                                    placeholder="Buscar por OT, cliente, código..."
                                                    value={addSearchTerm}
                                                    onChange={(e) => setAddSearchTerm(e.target.value)}
                                                    className="pl-8 h-8 text-xs"
                                                />
                                            </div>
                                        </div>
                                        {/* Lista scrolleable: overflow-auto nativo en vez de ScrollArea de Radix
                                            (que dentro de un Popover a veces no respeta max-height y bloquea el scroll). */}
                                        <div className="max-h-[320px] overflow-y-auto overscroll-contain">
                                            {filteredAddableOrders.length === 0 ? (
                                                <div className="p-6 text-center text-xs text-gray-400">
                                                    {addableOrders.length === 0
                                                        ? "No hay OTs pendientes disponibles para agregar."
                                                        : "Ninguna OT coincide con la búsqueda."}
                                                </div>
                                            ) : (
                                                <div className="divide-y">
                                                    {filteredAddableOrders.map(o => {
                                                        const checked = pendingAddIds.has(o.id);
                                                        const expanded = expandedAddIds.has(o.id);
                                                        const procs: any[] = Array.isArray(o.procesos) ? o.procesos : [];
                                                        const selProcs = pendingAddProcesos[o.id] || new Set<number>();
                                                        return (
                                                            <div key={o.id} className={cn("text-xs", checked && "bg-blue-50")}>
                                                                <div className={cn("flex items-start gap-2 px-3 py-2 transition-colors", !checked && "hover:bg-gray-50")}>
                                                                    <Checkbox
                                                                        className="mt-0.5"
                                                                        checked={checked}
                                                                        onCheckedChange={() => togglePendingAdd(o.id)}
                                                                    />
                                                                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => togglePendingAdd(o.id)}>
                                                                        <div className="flex items-center gap-1.5 font-medium text-gray-800">
                                                                            <span className="font-mono">#{o.id_otvieja || o.id}</span>
                                                                            <span className="text-gray-300">·</span>
                                                                            <span className="truncate">{o.cliente?.nombre || "Sin cliente"}</span>
                                                                        </div>
                                                                        <div className="text-[11px] text-gray-500 line-clamp-1 mt-0.5">
                                                                            {o.articulo?.cod_articulo} · {o.articulo?.descripcion || "—"}
                                                                        </div>
                                                                        <div className="flex items-center gap-1.5 mt-1">
                                                                            <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4 border-gray-300 text-gray-600">
                                                                                {getPriorityLabel(o.id_prioridad, o.prioridad?.descripcion)}
                                                                            </Badge>
                                                                            {selProcs.size > 0 && !checked && (
                                                                                <Badge className="text-[9px] py-0 px-1.5 h-4 bg-blue-100 text-blue-700 border-0">
                                                                                    {selProcs.size} proceso{selProcs.size === 1 ? "" : "s"}
                                                                                </Badge>
                                                                            )}
                                                                            {o.fecha_prometida && (
                                                                                <span className="text-[10px] text-gray-400">
                                                                                    Prom. {formatDate(o.fecha_prometida)}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {/* D1: expandir para elegir procesos sueltos */}
                                                                    {procs.length > 0 && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => { e.stopPropagation(); toggleExpandAdd(o.id); }}
                                                                            className="mt-0.5 p-1 rounded hover:bg-gray-200 text-gray-500 shrink-0"
                                                                            title="Elegir procesos sueltos de esta OT"
                                                                        >
                                                                            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {/* Sublista de procesos (D1) */}
                                                                {expanded && procs.length > 0 && (
                                                                    <div className={cn("pl-9 pr-3 pb-2 space-y-1", checked && "opacity-50 pointer-events-none")}>
                                                                        {checked && (
                                                                            <div className="text-[10px] text-blue-600 italic">La OT completa ya está seleccionada.</div>
                                                                        )}
                                                                        {[...procs].sort((a, b) => (a.orden || 0) - (b.orden || 0)).map((p) => {
                                                                            const pid = p.proceso?.id;
                                                                            const psel = selProcs.has(pid);
                                                                            return (
                                                                                <label key={pid} className={cn("flex items-center gap-2 px-2 py-1 rounded cursor-pointer", psel ? "bg-blue-100/60" : "hover:bg-gray-100")}>
                                                                                    <Checkbox checked={psel} onCheckedChange={() => togglePendingProceso(o.id, pid)} />
                                                                                    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 text-gray-600 text-[9px] font-bold shrink-0">{p.orden}</span>
                                                                                    <span className="truncate flex-1 text-gray-700">{capitalize(p.proceso?.nombre || "")}</span>
                                                                                    {p.tiempo_proceso != null && <span className="text-[10px] text-gray-400 shrink-0">{p.tiempo_proceso}m</span>}
                                                                                </label>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-2 border-t bg-slate-50 flex items-center justify-between gap-2">
                                            <span className="text-[11px] text-gray-500">
                                                {totalPendingAdd} seleccionado{totalPendingAdd === 1 ? "" : "s"}
                                                <span className="text-gray-400"> ({pendingAddIds.size} OT{pendingAddIds.size === 1 ? "" : "s"} + procesos sueltos)</span>
                                            </span>
                                            <div className="flex items-center gap-1.5">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 text-xs"
                                                    onClick={() => { setPendingAddIds(new Set()); setPendingAddProcesos({}); setAddSearchTerm(""); }}
                                                    disabled={totalPendingAdd === 0}
                                                >
                                                    Limpiar
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                                                    onClick={handleAddSelectedAndRecalculate}
                                                    disabled={totalPendingAdd === 0 || isCalculating}
                                                >
                                                    <RefreshCw className={cn("w-3 h-3 mr-1", isCalculating && "animate-spin")} />
                                                    Agregar {totalPendingAdd > 0 ? `(${totalPendingAdd})` : ""}
                                                </Button>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
                            <ZoomControl value={zoom} onChange={setZoom} />
                            {/* Salida del planificador. Ya no cierra un modal: deja la
                                pantalla y vuelve a Operaciones. El borrador se guarda,
                                así que no es un "descartar" y no tiene por qué asustar. */}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5 text-gray-500 hover:text-gray-800"
                                onClick={onClose}
                                disabled={isConfirming || isCalculating}
                                title="Volver a Operaciones. El plan queda guardado como borrador."
                            >
                                <LogOut className="w-3.5 h-3.5" />
                                Salir
                            </Button>
                        </div>
                    </div>

                    {/* El riel de cifras: el tamaño del plan de un vistazo.

                        Por qué "flotaban" (Julián, 26/08). Eran cuatro bloques sobre
                        blanco puro, sin fondo, sin borde y sin nada abajo; el separador
                        era `divide-x` sobre un contenedor con `flex-wrap`, que le pone
                        borde izquierdo al primer item de la segunda fila — un separador
                        colgando de la nada — y la celda de trabas era la única con
                        `rounded-lg ring-1`, una tarjetita suelta en el medio.

                        Ahora es una grilla exacta de una sola fila. Los separadores no
                        son bordes: son el `bg-gray-200` del contenedor asomando por el
                        `gap-px`, así que no puede quedar ninguno colgando ni sobrar
                        ninguno. Va sin `px-2 pb-2`: llega a los dos bordes y se apoya en
                        el `border-b` que ya pone PantallaPlanificador. Eso es lo que lo
                        ancla — un riel, no cuatro cosas al aire. */}
                    <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1.3fr] gap-px bg-gray-200 border-t border-gray-200">
                        {/* La fecha primero y la celda más ancha del riel.

                            Estaba en un Badge de 11px perdido entre otros tres chips.
                            Acá tiene la MISMA tipografía que las otras cifras: el peso
                            que pidió el cliente sale de la posición (primera), del ancho
                            (1.5fr) y del acento azul, no de píxeles nuevos de alto —
                            reusa una fila que ya estaba. El tope elegido se cuenta en la
                            etiqueta sólo cuando NO coincide con el cierre real del plan,
                            que es el único caso en que dice algo ("pediste hasta el 5/9
                            pero el plan cierra el 31/8"); si coincide, va en el title. */}
                        <CifraPlan
                            tono="fecha"
                            icono={<Calendar className="w-4 h-4" />}
                            valor={spanPlan
                                ? <>{formatDate(spanPlan.desde)} <span className="text-gray-400 font-normal">→</span> {formatDate(spanPlan.hasta)}</>
                                : "—"}
                            etiqueta={spanPlan
                                ? (planningRange.fecha_hasta && planningRange.fecha_hasta.slice(0, 10) !== spanPlan.hasta.slice(0, 10)
                                    ? `${spanPlan.habiles} días hábiles · tope ${formatDate(planningRange.fecha_hasta)}`
                                    : `${spanPlan.habiles} días hábiles`)
                                : "Período del plan"}
                            title={planningRange.fecha_hasta
                                ? `Período que ocupa el plan. Tope elegido al planificar: ${formatDate(planningRange.fecha_hasta)}`
                                : "Período que ocupa el plan"}
                        />
                        <CifraPlan
                            icono={<Cog className="w-4 h-4" />}
                            valor={uniqueOrdersInPlan}
                            etiqueta={uniqueOrdersInPlan === 1 ? "OT en plan" : "OTs en plan"}
                        />
                        <CifraPlan
                            icono={<Layers className="w-4 h-4" />}
                            valor={results.length}
                            etiqueta={results.length === 1 ? "Proceso" : "Procesos"}
                        />
                        <CifraPlan
                            icono={<Clock className="w-4 h-4" />}
                            valor={formatMinutesShort(totalDemandMinutes)}
                            etiqueta="Carga total"
                        />
                        <CifraPlan
                            icono={<AlertTriangle className="w-4 h-4" />}
                            valor={trabasSinResolver}
                            etiqueta={trabasSinResolver === 1 ? "Traba sin resolver" : "Trabas sin resolver"}
                            tono={trabasSinResolver > 0 ? "alerta" : "ok"}
                            accion={diagnosticos.length > 0 ? (
                                <button
                                    type="button"
                                    onClick={irAAvisos}
                                    className="text-[12px] font-medium text-gray-600 hover:text-gray-900 whitespace-nowrap"
                                >
                                    Ver detalles <span className="text-gray-400">›</span>
                                </button>
                            ) : undefined}
                        />
                    </div>

                </>
            }
            pie={
                <div className="px-6 py-4 flex items-center justify-between gap-3">
                    {/* Lado izquierdo: contexto + Volver */}
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                        <Button variant="outline" onClick={onBack} disabled={isConfirming || isCalculating} className="border-gray-300 text-gray-700 hover:bg-gray-50">
                            Volver
                        </Button>
                        {forzarOrdenIds.size > 0 && (
                            <span className="text-amber-700">
                                <strong>{forzarOrdenIds.size}</strong> excedente{forzarOrdenIds.size === 1 ? "" : "s"} forzada{forzarOrdenIds.size === 1 ? "" : "s"}
                            </span>
                        )}
                    </div>
                    {/* Lado derecho: confirmar */}
                    <Button
                        onClick={onClickConfirmar}
                        disabled={isConfirming || isCalculating || (results.length === 0 && displayedExcedentes.length === 0)}
                        className="bg-blue-600 hover:bg-blue-700 shadow-md px-6"
                    >
                        {isConfirming ? (
                            <span className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                Confirmando...
                            </span>
                        ) : (
                            <>Confirmar y guardar planificación</>
                        )}
                    </Button>
                </div>
            }
        >
                <div className="flex flex-1 items-start">
                    <div className="flex-1 flex flex-col min-w-0 bg-white">
                        {/* Scroll nativo en lugar de Radix ScrollArea: la versión Radix no rendea
                            scrollbar horizontal por default y la tabla (min-w 1000px) quedaba pisada
                            por el sidebar de Carga de Operarios. Con overflow-auto el navegador
                            maneja ambos ejes y muestra scrollbar cuando hace falta. */}
                        {/* Sin overflow propio: el scroll es el de la página. Antes esta
                            columna scrolleaba adentro del shell y el shell adentro del layout,
                            y revisar 11 OTs era pelear con tres barras. */}
                        <div className="flex-1 min-w-0">
                            {/* Qué traba el plan y cómo se destraba. Va primero de todo: es lo que
                                puede cambiar la decisión de guardar o de ir a arreglar un dato antes
                                de planificar.

                                Queda AFUERA del contenedor de la tabla a propósito: ese fuerza
                                min-w 1000px para las columnas, y adentro los párrafos se estiraban
                                hasta ahí y quedaban cortados por el panel de Carga de Operarios.
                                `sticky left-0` lo mantiene a la vista cuando la tabla se scrollea
                                en horizontal. */}
                            <div ref={panelAvisos} className="sticky left-0 w-full">
                                <DiagnosticosPlan
                                    diagnosticos={diagnosticos}
                                    /* El plegado lo maneja la pantalla, no la tira: la cifra
                                       "Trabas sin resolver" tiene que poder desplegarla. */
                                    colapsado={avisosColapsados}
                                    onColapsadoChange={setAvisosColapsados}
                                    /* Aplicado el cambio de rangos, se recalcula el mismo
                                       plan al toque: el aviso desaparece solo si de verdad
                                       se resolvió, y las fechas se actualizan con el dato
                                       nuevo sin salir de la vista previa. */
                                    onResuelto={() => {
                                        if (!onRecalculate) return;
                                        const forcedArr = Array.from(forzarOrdenIds);
                                        onRecalculate(buildOrdenIdsForRecalc(forcedArr), planningRange, forcedArr);
                                    }}
                                    /* Mismo recálculo, pero pedido a mano: el caso es
                                       "fui a Recursos, arreglé lo que pedía el aviso y
                                       volví". Los diagnósticos son la foto del momento
                                       del cálculo, así que sin esto el aviso sigue rojo
                                       aunque el problema ya no exista — y con un
                                       borrador retomado puede ser la foto de ayer. */
                                    onRevisar={onRecalculate ? () => handleRecalculate() : undefined}
                                    revisando={isCalculating}
                                    calculadoEn={calculadoEn}
                                    revisionAuto={revisionAuto}
                                />
                            </div>

                            <div className="p-0 pr-2" style={{ zoom: zoom / 100 }}>
                                {/* Aviso compacto: hay OTs forzadas con procesos que el solver no pudo asignar.
                                    Explicamos el motivo real (datos faltantes) en vez de mostrarlo como "parcial". */}
                                {forcedPartialMap.size > 0 && (() => {
                                    const allUnfit = Array.from(forcedPartialMap.values()).flatMap(v => v.unfit);
                                    const sinRangoCount = allUnfit.filter(u => (u.rangos_permitidos_proceso || []).length === 0).length;
                                    const sinMatchCount = allUnfit.length - sinRangoCount;
                                    return (
                                        <div className="m-4 border border-blue-200 bg-blue-50 rounded-lg p-3 flex items-start gap-2.5">
                                            <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                                            <div className="text-xs text-blue-900 flex-1 leading-relaxed">
                                                <strong>Hay {allUnfit.length} proceso(s) en OT forzada(s) que el motor no pudo asignar.</strong> Abrí cada OT en la tabla para ver cuáles son y por qué.
                                                <div className="mt-1 text-blue-800 flex flex-wrap gap-x-3 gap-y-0.5">
                                                    {sinRangoCount > 0 && <span>• <strong>{sinRangoCount}</strong> sin rango configurado en el sistema</span>}
                                                    {sinMatchCount > 0 && <span>• <strong>{sinMatchCount}</strong> sin operario/máquina compatible</span>}
                                                </div>
                                                <div className="mt-1 text-blue-700/90">
                                                    Estos procesos no se van a guardar al confirmar. Para resolverlo: configurá los rangos faltantes en <strong>Recursos → Procesos</strong> y volvé a planificar.
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {displayedExcedentes.length > 0 && (
                                    <div className="m-4 border-2 border-amber-300 bg-amber-50 rounded-lg overflow-hidden shadow-sm">
                                        {/* Bandera lateral roja + título más explícito para que no se confunda con la
                                            tabla de OTs planificadas. La tabla de abajo tiene OTs DISTINTAS — las que SÍ
                                            entraron. */}
                                        <div className="px-4 py-3 bg-amber-100/70 border-b-2 border-amber-300 flex items-start gap-3 relative">
                                            <div className="absolute top-0 left-0 h-full w-1 bg-amber-500" />
                                            <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5 shrink-0" />
                                            <div className="flex-1">
                                                <div className="font-bold text-amber-900 flex items-center gap-2 flex-wrap">
                                                    <span className="text-[10px] uppercase tracking-widest bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full">
                                                        Fuera del plan
                                                    </span>
                                                    {Object.keys(excedentesPorOrden).length} OT{Object.keys(excedentesPorOrden).length === 1 ? "" : "s"} no entran en el rango
                                                </div>
                                                <div className="text-xs text-amber-800/90 mt-1">
                                                    Estas OTs no caben en la ventana <strong>{planningRange.fecha_desde ? formatDate(planningRange.fecha_desde) : "—"} → {planningRange.fecha_hasta ? formatDate(planningRange.fecha_hasta) : "—"}</strong> con la capacidad disponible. <strong>No están incluidas en la tabla de abajo.</strong>
                                                </div>
                                                <div className="text-xs text-amber-700/90 mt-1">
                                                    Decidí qué hacer con cada una. Por defecto se <strong>descartan</strong> (quedan disponibles para la próxima planificación).
                                                    Si la <strong>forzás</strong>, el motor la incluirá aunque eso amplíe el rango o sobrecargue operarios.
                                                </div>
                                            </div>
                                        </div>
                                        <div className="divide-y divide-amber-200">
                                            {Object.entries(excedentesPorOrden).map(([oidStr, items]) => {
                                                const oid = parseInt(oidStr);
                                                const first = items[0];
                                                const forzar = forzarOrdenIds.has(oid);
                                                const isExpanded = expandedExcedenteId === oid;
                                                const reasons = isExpanded ? getExcedenteReasons(oid) : [];
                                                const otDurationMin = items.reduce((a, p) => a + (p.duracion_min || 0), 0);
                                                return (
                                                    <div key={oid} className="bg-white/60">
                                                        {/* Fila principal */}
                                                        <div className="px-4 py-3 flex items-center justify-between gap-4">
                                                            <div className="flex items-start gap-3 min-w-0 flex-1">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setExpandedExcedenteId(isExpanded ? null : oid)}
                                                                    className="mt-0.5 p-1 hover:bg-amber-100 rounded transition-colors text-amber-700"
                                                                    title={isExpanded ? "Ocultar explicación" : "Ver por qué no entra"}
                                                                >
                                                                    {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                                </button>
                                                                <div className="flex flex-col min-w-0 flex-1">
                                                                    <div className="text-sm font-medium text-gray-800 truncate">
                                                                        #{first.id_otvieja || oid} · {first.cliente || "—"} · {first.articulo ? capitalize(first.articulo) : "—"}
                                                                    </div>
                                                                    <div className="text-xs text-gray-500 mt-0.5 flex flex-wrap items-center gap-x-2">
                                                                        <span>{items.length} proceso(s) · {formatMinutesShort(otDurationMin)}</span>
                                                                        {first.fecha_prometida && (
                                                                            <span>· Prometida {formatDate(first.fecha_prometida)}</span>
                                                                        )}
                                                                        <Badge variant="outline" className="border-gray-300 text-gray-700 text-[10px]">
                                                                            {getPriorityLabel(first.id_prioridad, first.prioridad_descripcion)}
                                                                        </Badge>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                                {!isExpanded && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setExpandedExcedenteId(oid)}
                                                                        className="text-[11px] text-amber-700 hover:text-amber-900 font-medium flex items-center gap-1 underline-offset-2 hover:underline"
                                                                    >
                                                                        <HelpCircle className="w-3 h-3" />
                                                                        ¿Por qué no entra?
                                                                    </button>
                                                                )}
                                                                <Button
                                                                    size="sm"
                                                                    variant={forzar ? "outline" : "default"}
                                                                    className={!forzar ? "bg-gray-700 hover:bg-gray-800 text-white h-8" : "border-gray-300 text-gray-700 h-8"}
                                                                    onClick={() => { if (forzar) toggleForzar(oid); }}
                                                                    disabled={isCalculating || isConfirming}
                                                                    title="Dejar esta OT fuera del plan"
                                                                >
                                                                    Descartar
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    variant={forzar ? "default" : "outline"}
                                                                    className={forzar ? "bg-amber-600 hover:bg-amber-700 text-white h-8" : "border-amber-400 text-amber-800 hover:bg-amber-100 h-8"}
                                                                    onClick={() => { if (!forzar) toggleForzar(oid); }}
                                                                    disabled={isCalculating || isConfirming}
                                                                    title="Incluir esta OT aunque amplíe el rango. Se recalculará automáticamente."
                                                                >
                                                                    Forzar
                                                                </Button>
                                                            </div>
                                                        </div>
                                                        {/* Explicación expandida */}
                                                        {isExpanded && (
                                                            <div className="px-4 pb-4 -mt-1 ml-9">
                                                                <div className="bg-white border border-amber-200 rounded-md p-3 shadow-sm">
                                                                    <div className="flex items-start gap-2 mb-2">
                                                                        <Lightbulb className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                                                                        <div className="text-xs font-bold text-gray-800 uppercase tracking-wider">
                                                                            Motivos posibles
                                                                        </div>
                                                                    </div>
                                                                    <ul className="space-y-1.5 text-xs text-gray-700 ml-6 list-disc list-outside">
                                                                        {reasons.map((r, i) => (
                                                                            <li key={i}>{r}</li>
                                                                        ))}
                                                                    </ul>
                                                                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-start gap-2">
                                                                        <Info className="w-3.5 h-3.5 text-blue-500 mt-0.5 shrink-0" />
                                                                        <div className="text-[11px] text-gray-600 leading-relaxed">
                                                                            <strong className="text-gray-700">Cómo resolverlo:</strong> ampliá el rango de fechas
                                                                            (volvé a la selección con "Volver"), subí la prioridad de esta OT en el listado, asegurate
                                                                            que haya operarios disponibles, o usá <strong className="text-amber-700">Forzar</strong> si
                                                                            es indispensable que entre.
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                            </div>

                            {/* Encabezado de la tabla de planificados: estas OTs SÍ entraron en el
                                plan y es exactamente esto lo que se guarda al confirmar.

                                `sticky left-0` y fuera del contenedor de 1000px, igual que el panel
                                de avisos: si va adentro, al scrollear la tabla en horizontal los
                                botones de Filtros y Columnas se van de pantalla — y Columnas existe
                                justamente para no tener que scrollear. */}
                            <div className="sticky left-0 w-full bg-white z-20" style={{ zoom: zoom / 100 }}>
                                <div className="mx-4 mt-3 mb-1.5 flex items-center gap-2.5 flex-wrap">
                                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0" />
                                    <span className="text-[15px] font-bold text-gray-900">
                                        OTs planificadas ({filtrosActivos > 0 ? `${otsFiltradas} de ${uniqueOrdersInPlan}` : uniqueOrdersInPlan})
                                    </span>
                                    <span className="text-xs text-gray-600 bg-slate-100 rounded-full px-2.5 py-1 tabular-nums">
                                        {filtrosActivos > 0 ? procesosFiltrados : results.length} procesos
                                    </span>
                                    {filtrosActivos > 0 && (
                                        <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                                            Filtrado — al confirmar se guarda el plan entero
                                        </span>
                                    )}

                                    <span className="flex-1" />

                                    {/* Filtros: con 40 OTs la tabla no entra en la pantalla y lo que se
                                        busca casi siempre es un subconjunto. Filtran la VISTA, no el
                                        plan: lo dice el chip de arriba, porque un filtro que además
                                        borrara OTs del plan sería una trampa. */}
                                    <Popover open={filtrosAbiertos} onOpenChange={setFiltrosAbiertos}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className={cn(
                                                    "h-8 gap-1.5 text-xs",
                                                    filtrosActivos > 0 && "border-blue-300 bg-blue-50 text-blue-800"
                                                )}
                                            >
                                                <ListFilter className="w-3.5 h-3.5" />
                                                Filtros
                                                {filtrosActivos > 0 && (
                                                    <Badge className="ml-0.5 bg-blue-600 text-white border-0 px-1.5 py-0 text-[10px] tabular-nums">
                                                        {filtrosActivos}
                                                    </Badge>
                                                )}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[300px] p-0" align="end">
                                            <div className="p-3 border-b bg-slate-50 text-sm font-semibold text-gray-800">
                                                Filtrar la vista
                                            </div>
                                            <div className="p-3 space-y-3">
                                                <div className="relative">
                                                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                                                    <Input
                                                        placeholder="OT, cliente, código, artículo o proceso"
                                                        value={filtroTexto}
                                                        onChange={(e) => setFiltroTexto(e.target.value)}
                                                        className="pl-8 h-8 text-xs"
                                                    />
                                                </div>
                                                {([
                                                    ["atrasadas", "Solo las que llegan tarde", "Terminan después de la fecha prometida."],
                                                    ["sinOperario", "Solo con procesos sin operario", "Sin contar los tercerizados."],
                                                    ["sinMaquina", "Solo con procesos sin máquina", "Sin contar los que no necesitan."],
                                                    ["forzadas", "Solo las forzadas", "Las que entraron ampliando el rango."],
                                                ] as const).map(([clave, titulo, ayuda]) => (
                                                    <label key={clave} className="flex items-start gap-2 cursor-pointer">
                                                        <Checkbox
                                                            className="mt-0.5"
                                                            checked={filtros[clave]}
                                                            onCheckedChange={() => setFiltros(f => ({ ...f, [clave]: !f[clave] }))}
                                                        />
                                                        <span className="min-w-0">
                                                            <span className="block text-xs font-medium text-gray-800">{titulo}</span>
                                                            <span className="block text-[11px] text-gray-500">{ayuda}</span>
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                            <div className="p-2 border-t bg-slate-50 flex justify-between items-center">
                                                <span className="text-[11px] text-gray-500">
                                                    {otsFiltradas} de {uniqueOrdersInPlan} OTs
                                                </span>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 text-xs"
                                                    disabled={filtrosActivos === 0}
                                                    onClick={() => {
                                                        setFiltroTexto("");
                                                        setFiltros({ atrasadas: false, forzadas: false, sinOperario: false, sinMaquina: false });
                                                    }}
                                                >
                                                    Limpiar
                                                </Button>
                                            </div>
                                        </PopoverContent>
                                    </Popover>

                                    {/* Columnas: trece entran en un monitor de escritorio y en ninguna
                                        otra cosa. Lo elegido queda guardado en el navegador. */}
                                    <Popover>
                                        <PopoverTrigger asChild>
                                            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                                                <Columns3 className="w-3.5 h-3.5" />
                                                Columnas
                                                {ocultas.size > 0 && (
                                                    <Badge className="ml-0.5 bg-slate-200 text-slate-700 border-0 px-1.5 py-0 text-[10px] tabular-nums">
                                                        −{ocultas.size}
                                                    </Badge>
                                                )}
                                            </Button>
                                        </PopoverTrigger>
                                        <PopoverContent className="w-[240px] p-0" align="end">
                                            <div className="p-3 border-b bg-slate-50">
                                                <div className="text-sm font-semibold text-gray-800">Columnas a mostrar</div>
                                                <p className="text-[11px] text-gray-500 mt-0.5">
                                                    OT y acciones van siempre.
                                                </p>
                                            </div>
                                            <div className="p-2 max-h-[300px] overflow-y-auto">
                                                {COLUMNAS.map(c => (
                                                    <label
                                                        key={c.clave}
                                                        className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 cursor-pointer"
                                                    >
                                                        <Checkbox checked={ve(c.clave)} onCheckedChange={() => alternarColumna(c.clave)} />
                                                        <span className="text-xs text-gray-800">{c.titulo}</span>
                                                    </label>
                                                ))}
                                            </div>
                                            <div className="p-2 border-t bg-slate-50 flex justify-end">
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 text-xs"
                                                    disabled={ocultas.size === 0}
                                                    onClick={() => {
                                                        setOcultas(new Set());
                                                        try { localStorage.removeItem(CLAVE_COLUMNAS); } catch { /* nada */ }
                                                    }}
                                                >
                                                    Mostrar todas
                                                </Button>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </div>
                            </div>

                            {/* El ancho mínimo sigue a las columnas que quedaron: con las trece
                                puestas la tabla no entra y se scrollea, que para eso está; pero si
                                alguien apagó la mitad no tiene sentido seguir forzando 1000px y
                                hacerlo scrollear igual. */}
                            <div className="w-full overflow-x-auto scrollbar-horizontal-visible">
                            <div
                                className="p-0 pr-2"
                                style={{ zoom: zoom / 100, minWidth: `${200 + COLUMNAS.filter(c => ve(c.clave)).length * 76}px` }}
                            >
                                <table className="w-full text-sm text-left border-collapse">
                                    <thead className="bg-gray-50 text-gray-500 font-medium uppercase text-xs sticky top-0 z-10 shadow-sm [&_th]:py-2">
                                        <tr>
                                            <th className="px-4 py-3 w-10"></th>
                                            <th className="px-4 py-3">ID</th>
                                            {ve("entrada") && <th className="px-4 py-3">Entrada</th>}
                                            {ve("cliente") && <th className="px-4 py-3">Cliente</th>}
                                            {ve("codigo") && <th className="px-4 py-3">Código</th>}
                                            {ve("articulo") && <th className="px-4 py-3 min-w-[220px]">Artículo</th>}
                                            {ve("cantidad") && <th className="px-4 py-3 text-center">Cant.</th>}
                                            {ve("material") && <th className="px-4 py-3 text-center">Mat.</th>}
                                            {ve("progreso") && <th className="px-4 py-3 text-center">Progreso</th>}
                                            {ve("prioridad") && <th className="px-4 py-3 text-center">Prioridad</th>}
                                            {ve("prometida") && <th className="px-4 py-3 text-center">Prometida</th>}
                                            {ve("trabajo") && <th className="px-4 py-3 text-center">Trabajo</th>}
                                            {ve("alertas") && <th className="px-4 py-3 text-center">Alertas</th>}
                                            <th className="px-4 py-3 text-center w-12"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {Object.entries(gruposFiltrados).map(([ordenIdStr, items]) => {
                                            const ordenId = parseInt(ordenIdStr);
                                            const firstItem = items[0];
                                            const isExpanded = expandedOrderIds.includes(ordenId);

                                            // Calculate alerts (Lateness)
                                            const effectiveItems = items.map(i => getEffectiveItem(i));
                                            const lateItems = effectiveItems.filter(i => {
                                                if (!i.fecha_fin_estimada || !i.fecha_prometida) return false;
                                                return new Date(i.fecha_fin_estimada) > new Date(i.fecha_prometida);
                                            });
                                            const isOrderLate = lateItems.length > 0;

                                            // Calculate max delay + cache the worst-case item so el tooltip
                                            // pueda mostrar fechas reales (fin estimado vs prometida).
                                            let maxDelayDays = 0;
                                            let worstLateItem: PlanificacionResult | null = null;
                                            if (isOrderLate) {
                                                let maxDiff = -Infinity;
                                                for (const i of lateItems) {
                                                    const fin = new Date(i.fecha_fin_estimada!);
                                                    const prom = new Date(i.fecha_prometida!);
                                                    const diff = fin.getTime() - prom.getTime();
                                                    if (diff > maxDiff) {
                                                        maxDiff = diff;
                                                        worstLateItem = i;
                                                    }
                                                }
                                                maxDelayDays = Math.ceil(maxDiff / (1000 * 60 * 60 * 24));
                                            }
                                            // Detecta placeholder 1950 (significa "sin fecha prometida real"):
                                            const promesaEsPlaceholder = worstLateItem?.fecha_prometida
                                                ? new Date(worstLateItem.fecha_prometida).getFullYear() <= 1950
                                                : false;
                                            // Formato dd/MM/yyyy HH:mm para el tooltip.
                                            const formatFull = (dStr?: string | null) => {
                                                if (!dStr) return "—";
                                                try {
                                                    const d = new Date(dStr);
                                                    return d.toLocaleString("es-AR", {
                                                        day: "2-digit", month: "2-digit", year: "numeric",
                                                        hour: "2-digit", minute: "2-digit",
                                                    });
                                                } catch { return dStr; }
                                            };

                                            const percentage = firstItem.unidades ? ((firstItem.cantidad_entregada || 0) / firstItem.unidades) * 100 : 0;

                                            return (
                                                <React.Fragment key={ordenId}>
                                                    <tr
                                                        className={`transition-colors cursor-pointer group ${getRowColor(firstItem)}`}
                                                        onClick={() => toggleRow(ordenId)}
                                                    >
                                                        <td className="px-4 py-3">
                                                            <button className="p-1 hover:bg-black/10 rounded transition-colors text-inherit opacity-70 hover:opacity-100">
                                                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-3 font-medium text-inherit">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span>#{firstItem.id_otvieja || ordenId}</span>
                                                                {forzarOrdenIds.has(ordenId) && (
                                                                    <span
                                                                        className="text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded-full font-bold"
                                                                        title="OT forzada — el motor amplió el rango para incluirla"
                                                                    >
                                                                        Forzada
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        {ve("entrada") && <td className="px-4 py-3 text-inherit opacity-90">{formatDate(firstItem.fecha_entrada)}</td>}
                                                        {ve("cliente") && <td className="px-4 py-3 text-gray-500 italic">{firstItem.cliente || "-"}</td>}
                                                        {ve("codigo") && <td className="px-4 py-3 font-mono text-xs text-inherit opacity-80">{firstItem.codigo || "-"}</td>}
                                                        {ve("articulo") && (
                                                            <td className="px-4 py-2 text-inherit max-w-[320px]">
                                                                <span
                                                                    className="line-clamp-2 leading-snug"
                                                                    title={firstItem.articulo || ""}
                                                                >
                                                                    {firstItem.articulo ? capitalize(firstItem.articulo) : "-"}
                                                                </span>
                                                            </td>
                                                        )}
                                                        {ve("cantidad") && (
                                                        <td className="px-4 py-3 text-center">
                                                            {firstItem.unidades ? <Badge variant="secondary" className="bg-white/50 text-inherit border-current/20">{firstItem.unidades}</Badge> : "-"}
                                                        </td>
                                                        )}
                                                        {ve("material") && (
                                                        <td className="px-4 py-3 text-center">
                                                            {firstItem.estado_material === 'sin_stock' ? (
                                                                <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-200">Sin Stock</Badge>
                                                            ) : firstItem.estado_material === 'pedido' ? (
                                                                <Badge className="bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100">Pedido</Badge>
                                                            ) : firstItem.estado_material === 'ok' ? (
                                                                <Badge className="bg-green-50 text-green-700 border-green-200 hover:bg-green-100">OK</Badge>
                                                            ) : (
                                                                <span className="text-gray-400">-</span>
                                                            )}
                                                        </td>
                                                        )}
                                                        {ve("progreso") && (
                                                        <td className="px-4 py-3 text-center">
                                                            {firstItem.unidades ? (
                                                                <div className="flex flex-col items-center gap-1">
                                                                    <span className="text-xs font-medium text-gray-600">{firstItem.cantidad_entregada || 0} / {firstItem.unidades}</span>
                                                                    <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                                                        <div className="h-full bg-green-500" style={{ width: `${percentage}%` }} />
                                                                    </div>
                                                                </div>
                                                            ) : "-"}
                                                        </td>
                                                        )}
                                                        {ve("prioridad") && (
                                                        <td className="px-4 py-3 text-center">
                                                            <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                                {getPriorityLabel(firstItem.id_prioridad, firstItem.prioridad_descripcion)}
                                                            </Badge>
                                                        </td>
                                                        )}
                                                        {ve("prometida") && <td className="px-4 py-3 text-center text-inherit opacity-90">{formatDate(firstItem.fecha_prometida)}</td>}
                                                        {/* Cuándo se toca esta OT: de la primera pieza a la última.
                                                            Estaba solo dentro de cada proceso (12 fechas por OT) y
                                                            no había forma de ver de un vistazo cuándo arranca y
                                                            cuándo se termina — pedido de Julián el 18/08. */}
                                                        {ve("trabajo") && (
                                                        <td className="px-4 py-3 text-center text-inherit opacity-90 whitespace-nowrap">
                                                            {spanDeOT(effectiveItems)}
                                                        </td>
                                                        )}
                                                        {ve("alertas") && (
                                                        <td className="px-4 py-3 text-center">
                                                            {isOrderLate ? (
                                                                <TooltipProvider delayDuration={150}>
                                                                    <Tooltip>
                                                                        <TooltipTrigger asChild>
                                                                            <button
                                                                                type="button"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                                className="flex items-center justify-center gap-1 text-red-700 bg-red-100 px-2 py-1 rounded border border-red-200 text-xs font-bold whitespace-nowrap hover:bg-red-200 transition-colors cursor-help"
                                                                            >
                                                                                <AlertTriangle className="w-3 h-3" />
                                                                                <span>+{maxDelayDays.toLocaleString("es-AR")} días</span>
                                                                            </button>
                                                                        </TooltipTrigger>
                                                                        <TooltipContent side="left" className="max-w-[320px] p-0 bg-white border border-red-200 shadow-xl text-gray-800">
                                                                            <div className="px-3 py-2 bg-red-50 border-b border-red-200 flex items-center gap-2">
                                                                                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                                                                                <span className="text-xs font-bold text-red-900 uppercase tracking-wider">OT atrasada según el plan</span>
                                                                            </div>
                                                                            <div className="p-3 space-y-2 text-xs">
                                                                                <div className="grid grid-cols-[120px_1fr] gap-x-2 gap-y-1">
                                                                                    <span className="text-gray-500">Fecha prometida</span>
                                                                                    <span className={cn("font-semibold tabular-nums", promesaEsPlaceholder ? "text-amber-700" : "text-gray-900")}>
                                                                                        {promesaEsPlaceholder ? "Sin definir" : formatFull(worstLateItem?.fecha_prometida)}
                                                                                    </span>
                                                                                    <span className="text-gray-500">Fin estimado</span>
                                                                                    <span className="font-semibold text-gray-900 tabular-nums">
                                                                                        {formatFull(worstLateItem?.fecha_fin_estimada)}
                                                                                    </span>
                                                                                    <span className="text-gray-500">Proceso que rompe</span>
                                                                                    <span className="font-medium text-gray-700 truncate" title={worstLateItem?.nombre_proceso || ""}>
                                                                                        {worstLateItem?.nombre_proceso ? capitalize(worstLateItem.nombre_proceso) : "—"}
                                                                                    </span>
                                                                                    <span className="text-gray-500">Diferencia</span>
                                                                                    <span className="font-bold text-red-700 tabular-nums">+{maxDelayDays.toLocaleString("es-AR")} días</span>
                                                                                </div>
                                                                                {promesaEsPlaceholder ? (
                                                                                    <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-[11px] text-amber-800 leading-snug">
                                                                                        <strong>⚠ Sin fecha prometida real:</strong> esta OT tiene <code className="bg-amber-100 px-1 rounded">1950-01-01</code> como placeholder. Por eso la diferencia es absurda. Cargá la fecha de entrega real en el editor de la OT.
                                                                                    </div>
                                                                                ) : (
                                                                                    <div className="mt-2 text-[11px] text-gray-500 leading-snug">
                                                                                        El motor calculó que el último proceso de esta OT termina <strong className="text-red-700">después</strong> de la fecha que le prometiste al cliente.
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        </TooltipContent>
                                                                    </Tooltip>
                                                                </TooltipProvider>
                                                            ) : null}
                                                        </td>
                                                        )}
                                                        {/* Acciones: quitar OT del plan. Click no debe expandir la fila. */}
                                                        <td className="px-2 py-3 text-center">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleRemoveOrderAndRecalculate(ordenId);
                                                                }}
                                                                disabled={isCalculating || isConfirming || !onRecalculate}
                                                                title="Quitar esta OT del plan y recalcular"
                                                            >
                                                                <XIcon className="w-4 h-4" />
                                                            </Button>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr className="bg-gray-50/50">
                                                            <td colSpan={totalColumnas} className="px-0 py-0 border-b shadow-inner">
                                                                <div className="px-4 py-4 md:px-8 md:py-6 bg-gray-50/50">
                                                                    <div className="text-xs font-semibold uppercase text-gray-400 mb-2 pl-1">Procesos Planificados</div>
                                                                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
                                                                        <div className="grid grid-cols-[auto_1fr_200px_200px_180px] gap-0 text-sm">
                                                                            {/* Inner Header */}
                                                                            <div className="contents text-xs font-bold text-gray-500 uppercase bg-gray-100/50">
                                                                                <div className="px-4 py-2 border-b">#</div>
                                                                                <div className="px-4 py-2 border-b">Proceso</div>
                                                                                <div className="px-4 py-2 border-b">Operario</div>
                                                                                <div className="px-4 py-2 border-b">Maquinaria</div>
                                                                                <div className="px-4 py-2 border-b">Inicio Estimado</div>
                                                                            </div>

                                                                            {/* Inner Body: procesos auto-asignados (editables) */}
                                                                            {items.map((item, idx) => {
                                                                                const effectiveItem = getEffectiveItem(item);
                                                                                return (
                                                                                    <div key={`${item.orden_id}-${item.proceso_id}`} className="contents group/row">
                                                                                        <div className="px-4 py-3 border-b flex items-center text-gray-400 font-mono text-xs">
                                                                                            {idx + 1}
                                                                                        </div>
                                                                                        <div className="px-4 py-3 border-b flex flex-col justify-center">
                                                                                            <span className="font-medium text-gray-800">{capitalize(effectiveItem.nombre_proceso)}</span>
                                                                                            <div className="flex items-center gap-2 mt-0.5">
                                                                                                <span className="text-xs text-gray-500 bg-gray-100 px-1.5 rounded">{effectiveItem.duracion_min}m</span>
                                                                                                {/* Tercerizado: sale sin operario y sin máquina a propósito, porque
                                                                                                    lo hace un tercero. Sin esta marca se lee como un hueco por
                                                                                                    falta de rango, que es un problema distinto. */}
                                                                                                {effectiveItem.tercerizado && (
                                                                                                    <span
                                                                                                        className="text-xs text-violet-700 bg-violet-50 border border-violet-200 px-1.5 rounded font-medium"
                                                                                                        title="Lo hace un tercero. Ocupa lugar en la secuencia de la OT, pero no lo hace nadie del taller: por eso va sin operario y sin máquina."
                                                                                                    >
                                                                                                        Tercerizado
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                            {/* A1 (feedback 06/07): motivo SIEMPRE visible en procesos sin operario asignado,
                                                                                                aunque la orden se haya planificado (antes solo quedaba el selector vacío, sin explicación).

                                                                                                En los tercerizados no va: ahí no falta nadie ni falta un rango, lo
                                                                                                hace un tercero. Marcarlo en rojo como si fuera un problema manda a
                                                                                                buscar un rango que no hay que cargar. */}
                                                                                            {!effectiveItem.id_operario && !effectiveItem.tercerizado && (() => {
                                                                                                const diag = diagnoseUnfitProcess(item);
                                                                                                return (
                                                                                                    <div className="mt-1 flex items-start gap-1 text-[11px] text-red-600 leading-tight" title={diag.hint}>
                                                                                                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                                                                                                        <span>
                                                                                                            Sin operario asignado
                                                                                                            {diag.rangos.length > 0
                                                                                                                ? <span className="text-gray-500"> · requiere rango {formatRangoIds(diag.rangos)}</span>
                                                                                                                : <span className="text-gray-500"> · el proceso no tiene rango configurado en Recursos</span>}
                                                                                                        </span>
                                                                                                    </div>
                                                                                                );
                                                                                            })()}
                                                                                        </div>

                                                                                        <div className="px-4 py-2 border-b flex items-center">
                                                                                            <Select
                                                                                                value={effectiveItem.id_operario?.toString() || "0"}
                                                                                                onValueChange={(val) => handleUpdate(item, 'id_operario', val === "0" ? null : parseInt(val))}
                                                                                            >
                                                                                                <SelectTrigger className="h-8 text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-100">
                                                                                                    <SelectValue placeholder="Sin asignar" />
                                                                                                </SelectTrigger>
                                                                                                <SelectContent>
                                                                                                    <SelectItem value="0" className="text-gray-400 italic">Sin asignar</SelectItem>
                                                                                                    {availableOperators.map(op => {
                                                                                                        const isPruebas = op.sector?.toUpperCase() === 'PRUEBAS';
                                                                                                        return (
                                                                                                            <SelectItem
                                                                                                                key={op.id}
                                                                                                                value={op.id.toString()}
                                                                                                                disabled={!op.disponible && !isPruebas}
                                                                                                                className={(!op.disponible && !isPruebas) ? "text-gray-400 italic" : ""}
                                                                                                            >
                                                                                                                {op.nombre} {op.apellido} {(!op.disponible && !isPruebas) && "(Ausente)"}
                                                                                                            </SelectItem>
                                                                                                        );
                                                                                                    })}
                                                                                                </SelectContent>
                                                                                            </Select>
                                                                                        </div>

                                                                                        <div className="px-4 py-2 border-b flex items-center">
                                                                                            <Select
                                                                                                value={effectiveItem.id_maquinaria?.toString() || "0"}
                                                                                                onValueChange={(val) => handleUpdate(item, 'id_maquinaria', val === "0" ? null : parseInt(val))}
                                                                                            >
                                                                                                <SelectTrigger
                                                                                                    className="h-8 text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-100"
                                                                                                    title={effectiveItem.usa_maquina === false
                                                                                                        ? "Proceso manual: no usa máquina. Podés asignarle una igual si querés."
                                                                                                        : undefined}
                                                                                                >
                                                                                                    <SelectValue placeholder="Sin asignar" />
                                                                                                </SelectTrigger>
                                                                                                <SelectContent>
                                                                                                    {/* "No necesita" ≠ "Sin asignar": embalado o pintura sin máquina
                                                                                                        no es un hueco a resolver, es lo normal (pedido de Julián 16/08). */}
                                                                                                    <SelectItem value="0" className="text-gray-400 italic">
                                                                                                        {effectiveItem.usa_maquina === false ? "No necesita" : "Sin asignar"}
                                                                                                    </SelectItem>
                                                                                                    {availableMachines.map(m => (
                                                                                                        <SelectItem key={m.id} value={m.id.toString()}>
                                                                                                            {m.nombre}
                                                                                                        </SelectItem>
                                                                                                    ))}
                                                                                                </SelectContent>
                                                                                            </Select>
                                                                                        </div>

                                                                                        <div className="px-4 py-2 border-b flex items-center">
                                                                                            <Input
                                                                                                type="datetime-local"
                                                                                                className="h-8 text-xs px-2 border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-amber-200"
                                                                                                value={effectiveItem.fecha_inicio_estimada ? effectiveItem.fecha_inicio_estimada.slice(0, 16) : getDateFromMin(effectiveItem.inicio_min)}
                                                                                                onChange={(e) => handleDateChange(item, e.target.value)}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    </div>

                                                                    {/* Sub-sección "Procesos sin asignar" — solo cuando esta OT está forzada y
                                                                        tiene procesos que el solver no pudo ubicar. Mostramos:
                                                                          - El motivo concreto (con nombres de rangos, no IDs).
                                                                          - Selects para asignar manualmente operario, máquina y horario.
                                                                          - Botón para abrir Recursos en otra pestaña y corregir el dato faltante. */}
                                                                    {(forcedPartialMap.get(ordenId)?.unfit?.length || 0) > 0 && (
                                                                        <div className="mt-3 bg-red-50/70 border border-red-200 rounded-md overflow-hidden">
                                                                            {/* Header compacto con links a Recursos y a editar OT (para procesos duplicados / mal cargados) */}
                                                                            <div className="px-3 py-1.5 bg-red-100/70 border-b border-red-200 flex items-center justify-between gap-2 flex-wrap">
                                                                                <div className="flex items-center gap-1.5">
                                                                                    <AlertTriangle className="w-3.5 h-3.5 text-red-700" />
                                                                                    <span className="text-[11px] font-bold text-red-900 uppercase tracking-wider">
                                                                                        {forcedPartialMap.get(ordenId)!.unfit.length} sin asignar — completá a mano u omití
                                                                                    </span>
                                                                                </div>
                                                                                <div className="flex items-center gap-3 text-[11px] font-medium">
                                                                                    <a
                                                                                        href={`/operaciones?edit_ot=${ordenId}`}
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        className="text-red-700 hover:text-red-900 underline underline-offset-2"
                                                                                        title="Abrir editor de la OT en otra pestaña (procesos duplicados, etc.)"
                                                                                    >
                                                                                        Editar OT ↗
                                                                                    </a>
                                                                                    <a
                                                                                        href="/recursos"
                                                                                        target="_blank"
                                                                                        rel="noopener noreferrer"
                                                                                        className="text-red-700 hover:text-red-900 underline underline-offset-2"
                                                                                        title="Configurar rangos/operarios en Recursos"
                                                                                    >
                                                                                        Recursos ↗
                                                                                    </a>
                                                                                </div>
                                                                            </div>
                                                                            {/* Tabla compacta: una fila por proceso, todo en una línea horizontal.
                                                                                Grid: # | Proceso | Motivo (compactado) | Operario | Máquina | Inicio */}
                                                                            <div className="divide-y divide-red-200/70">
                                                                                {forcedPartialMap.get(ordenId)!.unfit.map((u, idx) => {
                                                                                    const diag = diagnoseUnfitProcess(u);
                                                                                    const fitCount = forcedPartialMap.get(ordenId)!.fitCount;
                                                                                    const effU = getEffectiveItem(u);
                                                                                    const assigned = isUnfitManuallyAssigned(u);
                                                                                    return (
                                                                                        <div
                                                                                            key={`unfit-${u.proceso_id}-${idx}`}
                                                                                            className={cn(
                                                                                                "px-3 py-1.5 grid grid-cols-[26px_180px_1fr_140px_140px_150px] gap-2 items-center text-xs",
                                                                                                assigned ? "bg-green-50/60" : "bg-white/60"
                                                                                            )}
                                                                                        >
                                                                                            <span className="text-[10px] text-gray-400 font-mono">#{fitCount + idx + 1}</span>
                                                                                            <div className="flex items-center gap-1 min-w-0">
                                                                                                <span className="font-medium text-gray-800 truncate" title={capitalize(u.nombre_proceso)}>{capitalize(u.nombre_proceso)}</span>
                                                                                                <span className="text-[10px] text-gray-500 bg-gray-100 px-1 rounded shrink-0">{u.duracion_min}m</span>
                                                                                            </div>
                                                                                            <div className="min-w-0 text-[11px]" title={diag.hint}>
                                                                                                {assigned ? (
                                                                                                    <span className="text-green-700 font-semibold">✓ Asignado a mano</span>
                                                                                                ) : (
                                                                                                    <span className={cn(
                                                                                                        "truncate block",
                                                                                                        diag.code === "no_rango" ? "text-red-700" : "text-orange-700"
                                                                                                    )}>
                                                                                                        {diag.label}
                                                                                                        {diag.rangos.length > 0 && (
                                                                                                            <span className="text-gray-500 ml-1">· rangos: {formatRangoIds(diag.rangos)}</span>
                                                                                                        )}
                                                                                                    </span>
                                                                                                )}
                                                                                            </div>
                                                                                            <Select
                                                                                                value={effU.id_operario?.toString() || "0"}
                                                                                                onValueChange={(val) => handleUpdate(u, 'id_operario', val === "0" ? null : parseInt(val))}
                                                                                            >
                                                                                                <SelectTrigger className={cn(
                                                                                                    "h-7 text-[11px] px-2",
                                                                                                    !effU.id_operario ? "border-red-300 bg-red-50/40" : "border-green-300 bg-green-50/40"
                                                                                                )}>
                                                                                                    <SelectValue placeholder="Operario" />
                                                                                                </SelectTrigger>
                                                                                                <SelectContent>
                                                                                                    <SelectItem value="0" className="text-gray-400 italic">Sin asignar</SelectItem>
                                                                                                    {availableOperators.map(op => {
                                                                                                        const isPruebas = op.sector?.toUpperCase() === 'PRUEBAS';
                                                                                                        return (
                                                                                                            <SelectItem
                                                                                                                key={op.id}
                                                                                                                value={op.id.toString()}
                                                                                                                disabled={!op.disponible && !isPruebas}
                                                                                                                className={(!op.disponible && !isPruebas) ? "text-gray-400 italic" : ""}
                                                                                                            >
                                                                                                                {op.nombre} {op.apellido}
                                                                                                            </SelectItem>
                                                                                                        );
                                                                                                    })}
                                                                                                </SelectContent>
                                                                                            </Select>
                                                                                            <Select
                                                                                                value={effU.id_maquinaria?.toString() || "0"}
                                                                                                onValueChange={(val) => handleUpdate(u, 'id_maquinaria', val === "0" ? null : parseInt(val))}
                                                                                            >
                                                                                                <SelectTrigger className={cn(
                                                                                                    "h-7 text-[11px] px-2",
                                                                                                    // Un manual sin máquina no es un pendiente: no va en rojo.
                                                                                                    effU.usa_maquina === false && !effU.id_maquinaria
                                                                                                        ? "border-gray-200 bg-gray-50/50"
                                                                                                        : !effU.id_maquinaria ? "border-red-300 bg-red-50/40" : "border-green-300 bg-green-50/40"
                                                                                                )}>
                                                                                                    <SelectValue placeholder="Máquina" />
                                                                                                </SelectTrigger>
                                                                                                <SelectContent>
                                                                                                    <SelectItem value="0" className="text-gray-400 italic">
                                                                                                        {effU.usa_maquina === false ? "No necesita" : "Sin asignar"}
                                                                                                    </SelectItem>
                                                                                                    {availableMachines.map(m => (
                                                                                                        <SelectItem key={m.id} value={m.id.toString()}>{m.nombre}</SelectItem>
                                                                                                    ))}
                                                                                                </SelectContent>
                                                                                            </Select>
                                                                                            <Input
                                                                                                type="datetime-local"
                                                                                                className={cn(
                                                                                                    "h-7 text-[11px] px-1.5",
                                                                                                    !effU.fecha_inicio_estimada ? "border-red-300 bg-red-50/40" : "border-green-300 bg-green-50/40"
                                                                                                )}
                                                                                                value={effU.fecha_inicio_estimada ? effU.fecha_inicio_estimada.slice(0, 16) : ""}
                                                                                                onChange={(e) => handleDateChange(u, e.target.value)}
                                                                                            />
                                                                                        </div>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                            <div className="px-3 py-1 bg-red-100/30 border-t border-red-200 text-[10px] text-red-700/80 italic">
                                                                                Los que completes a mano se guardan. Los vacíos se omiten al confirmar.
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </React.Fragment>
                                            );
                                        })}
                                    </tbody>
                                </table >
                                {otsFiltradas === 0 && uniqueOrdersInPlan > 0 && (
                                    <div className="px-4 py-10 text-center">
                                        <p className="text-sm text-gray-600">
                                            Ninguna de las <strong>{uniqueOrdersInPlan}</strong> OTs del plan coincide con el filtro.
                                        </p>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="mt-3 h-8 text-xs"
                                            onClick={() => {
                                                setFiltroTexto("");
                                                setFiltros({ atrasadas: false, forzadas: false, sinOperario: false, sinMaquina: false });
                                            }}
                                        >
                                            Limpiar filtros
                                        </Button>
                                    </div>
                                )}
                            </div >
                            </div>

                        </div>
                    </div >

                    {/* Carga de operarios: cómo queda cada uno SI se confirma este plan.

                        Plegable y de ancho fluido, para que "acompañe" (Julián, 26/08).
                        Un panel fijo de 320px no acompaña: la tabla pide min-w ~1036px y
                        en 1366 no entra, así que aparece scroll horizontal ADENTRO del
                        scroll vertical. Plegado son 44px y la tabla entra entera.

                        Lo que NO se hizo: overlay/drawer sobre la tabla — es volver al
                        modal flotando que se sacó el 19/08 y obliga a abrir y cerrar cada
                        vez, que es lo contrario de acompañar. Ni ancho fluido a secas:
                        en la pantalla chica, que es donde duele, no devuelve nada. */}
                    <div className={cn(
                        "bg-gray-50 border-l border-gray-200 flex flex-col shrink-0 transition-[width] duration-200",
                        // Sticky con alto propio: la carga de operarios queda a la vista
                        // mientras la lista corre al lado, en vez de irse para arriba a los
                        // dos scrolls. `top-[136px]` la deja justo abajo de la cabecera
                        // sticky (título + riel de cifras).
                        "sticky top-[136px] max-h-[calc(100svh-14rem)] self-start overflow-y-auto",
                        !cargaAbierta ? "w-11"
                            : cargaCompleta ? "w-[min(34vw,520px)]"
                                : "w-[min(24vw,380px)] min-w-[300px]"
                    )}>
                        {!cargaAbierta ? (
                            /* El riel plegado no es una franja muerta: sigue diciendo
                               cuántos operarios quedan pasados de las 44h. Plegar resume,
                               no esconde. */
                            <button
                                type="button"
                                onClick={alternarCarga}
                                title="Mostrar la carga de operarios"
                                className="flex-1 w-full flex flex-col items-center gap-3 py-3 hover:bg-gray-100 transition-colors"
                            >
                                <ChevronRight className="w-4 h-4 text-gray-400 rotate-180 shrink-0" />
                                <User className="w-4 h-4 text-gray-500 shrink-0" />
                                {sobrecargados > 0 && (
                                    <span className="rounded-full bg-rose-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center tabular-nums shrink-0">
                                        {sobrecargados}
                                    </span>
                                )}
                                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 [writing-mode:vertical-rl]">
                                    Carga de operarios
                                </span>
                            </button>
                        ) : (
                        <>
                        <div className="px-4 py-3 border-b border-gray-200 bg-white/50 flex items-start gap-2">
                            <div className="min-w-0 flex-1">
                                <h3 className="font-bold text-gray-800 flex items-center gap-2 flex-wrap">
                                    <User className="w-4 h-4 text-gray-500" />
                                    Carga de operarios
                                    {sobrecargados > 0 && (
                                        <span className="rounded-full bg-rose-100 text-rose-700 text-[11px] font-bold px-2 py-0.5 tabular-nums">
                                            {sobrecargados} pasados
                                        </span>
                                    )}
                                </h3>
                                <p className="text-xs text-gray-500 mt-1">Estimación basada en la semana de planificación.</p>
                            </div>
                            <button
                                type="button"
                                onClick={alternarCarga}
                                title="Plegar el panel y darle el ancho a la tabla"
                                className="p-1 -mr-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 shrink-0"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                        <ScrollArea className="flex-1 p-4">
                            <div className={cn(cargaCompleta ? "grid grid-cols-2 gap-3" : "space-y-4")}>
                                {availableOperators
                                    .filter(op => op.sector?.toUpperCase() !== 'PRUEBAS') // Filter 'PRUEBAS' if hidden
                                    .sort((a, b) => {
                                        // Sort by Total Load DESC
                                        const loadA = (operatorLoads[a.id] || 0) + results.map(r => getEffectiveItem(r)).filter(r => r.id_operario === a.id).reduce((sum, r) => sum + (r.duracion_min || 0), 0);
                                        const loadB = (operatorLoads[b.id] || 0) + results.map(r => getEffectiveItem(r)).filter(r => r.id_operario === b.id).reduce((sum, r) => sum + (r.duracion_min || 0), 0);
                                        return loadB - loadA;
                                    })
                                    .map(op => {
                                        // Calculate Load
                                        const currentLoadMin = operatorLoads[op.id] || 0;
                                        const sessionLoadMin = results
                                            .map(r => getEffectiveItem(r))
                                            .filter(r => r.id_operario === op.id)
                                            .reduce((sum, r) => sum + (r.duracion_min || 0), 0);

                                        const totalLoadMin = currentLoadMin + sessionLoadMin;
                                        const totalLoadHours = (totalLoadMin / 60);

                                        // Assuming 44h weekly capacity
                                        const maxCapacityHours = 44;
                                        const percentage = Math.min((totalLoadHours / maxCapacityHours) * 100, 100);

                                        const isOverloaded = totalLoadHours > maxCapacityHours;

                                        // Rangos del operario: pueden venir como [{id, nombre}] o como [id]. Manejamos ambos.
                                        const rawRangos: any[] = op.rangos || [];
                                        const rangosNombres: string[] = rawRangos
                                            .map(r => {
                                                if (typeof r === "object" && r !== null) return r.nombre || (r.id ? formatRangoIds([r.id]) : "");
                                                return formatRangoIds([Number(r)]);
                                            })
                                            .filter(Boolean);
                                        const horario = (op.hora_inicio && op.hora_fin)
                                            ? `${op.hora_inicio.slice(0, 5)} – ${op.hora_fin.slice(0, 5)}`
                                            : null;
                                        return (
                                            <div key={op.id} className="bg-white p-3 rounded-lg border shadow-sm">
                                                <div className="flex justify-between items-start mb-1.5 gap-2">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm font-medium text-gray-800 truncate">{op.nombre} {op.apellido}</div>
                                                        {/* Subtítulo uniforme: sector → si no hay, rango principal → si no, "Sin sector".
                                                            Antes se ocultaba cuando el operario no tenía sector, dejando tarjetas sin subtítulo. */}
                                                        {op.sector ? (
                                                            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold truncate">{op.sector}</div>
                                                        ) : rangosNombres.length > 0 ? (
                                                            <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold truncate">{rangosNombres[0]}</div>
                                                        ) : (
                                                            <div className="text-[10px] uppercase tracking-wide text-gray-300 font-semibold italic truncate">Sin sector</div>
                                                        )}
                                                    </div>
                                                    <span className={cn(
                                                        "text-xs font-bold px-1.5 py-0.5 rounded tabular-nums shrink-0",
                                                        isOverloaded ? "bg-red-100 text-red-700" : percentage > 80 ? "bg-amber-100 text-amber-700" : "bg-gray-100 text-gray-600"
                                                    )}>
                                                        {Math.round(percentage)}%
                                                    </span>
                                                </div>
                                                <div className="h-2 w-full bg-gray-100 rounded-full overflow-hidden mb-1.5">
                                                    <div
                                                        className={cn(
                                                            "h-full transition-all duration-500 rounded-full",
                                                            isOverloaded ? "bg-red-500" :
                                                                percentage > 80 ? "bg-amber-500" : "bg-green-500"
                                                        )}
                                                        style={{ width: `${percentage}%` }}
                                                    />
                                                </div>
                                                <div className="flex justify-between items-center text-xs text-gray-500 mb-1.5">
                                                    <span className="tabular-nums">{totalLoadHours.toFixed(1)}h / {maxCapacityHours}h</span>
                                                    {sessionLoadMin > 0 && (
                                                        <span className="text-blue-600 font-medium">+{Math.round(sessionLoadMin / 60 * 10) / 10}h nuevas</span>
                                                    )}
                                                </div>
                                                {/* Rangos del operario: chips compactos para ver qué procesos puede hacer. */}
                                                {rangosNombres.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 pt-1 border-t border-gray-100">
                                                        {(cargaCompleta ? rangosNombres : rangosNombres.slice(0, 4)).map((nombre, i) => (
                                                            <span key={i} className="text-[9px] uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded font-semibold">
                                                                {nombre}
                                                            </span>
                                                        ))}
                                                        {!cargaCompleta && rangosNombres.length > 4 && (
                                                            <span className="text-[9px] text-gray-400 px-1 py-0.5" title={rangosNombres.slice(4).join(", ")}>
                                                                +{rangosNombres.length - 4}
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                                {/* Horario laboral del operario */}
                                                {horario && (
                                                    <div className="flex items-center gap-1 mt-1 text-[10px] text-gray-400">
                                                        <Clock className="w-2.5 h-2.5" />
                                                        <span className="tabular-nums">{horario}</span>
                                                        {op.disponible === false && (
                                                            <span className="ml-auto text-red-600 font-bold uppercase">Ausente</span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                }
                            </div>
                        </ScrollArea>
                        {/* "Ver carga completa": ensancha el panel y deja de recortar. Los
                            chips de rangos se cortaban en 4 y las tarjetas de 320px no
                            dejan comparar a dos personas sin scrollear. No manda a otra
                            pantalla a propósito: la carga de OTRA pantalla es la del plan
                            YA guardado, no la de este borrador. */}
                        <div className="p-3 border-t border-gray-200 bg-white/60">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setCargaCompleta(v => !v)}
                                className="w-full h-8 gap-1.5 text-xs text-gray-600 hover:text-gray-900"
                            >
                                <Users className="w-3.5 h-3.5" />
                                {cargaCompleta ? "Ver compacto" : "Ver carga completa"}
                            </Button>
                        </div>
                        </>
                        )}
                    </div>
                </div >


                {/* Overlay durante recalculo: bloquea la UI pero la deja visible para contexto. */}
                {isCalculating && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-sm flex items-center justify-center z-50 pointer-events-none">
                        <div className="bg-white border border-gray-200 rounded-lg shadow-xl px-6 py-4 flex items-center gap-3 pointer-events-auto">
                            <Sparkles className="w-5 h-5 text-purple-600 animate-pulse" />
                            <div>
                                <div className="text-sm font-bold text-gray-800">Recalculando planificación</div>
                                <div className="text-[11px] text-gray-500">El motor está distribuyendo procesos en operarios y horarios disponibles...</div>
                            </div>
                        </div>
                    </div>
                )}
        </PantallaPlanificador>
        <ConfirmationDialog
            isOpen={showForzarWarn}
            onClose={() => setShowForzarWarn(false)}
            onConfirm={() => { setShowForzarWarn(false); handleConfirmWithDecisions(); }}
            title="Hay OT sin forzar"
            description={`Quedaron ${Object.keys(excedentesPorOrden).length} OT fuera del plan que no forzaste. Si guardás ahora, esas OT NO se incluyen. Cerrá este aviso para forzarlas, o guardá igual.`}
            confirmText="Guardar igual"
            cancelText="Volver a revisar"
        />
        </>
    );
}
