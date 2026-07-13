import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Calendar, Clock, User, Cog, AlertCircle, CalendarClock, Edit2, RotateCcw,
    ChevronDown, ChevronRight, AlertTriangle, Search, X as XIcon,
    HelpCircle, Sparkles, RefreshCw, ListPlus, Info, Lightbulb,
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

interface PlanningPreviewModalProps {
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
}

export function PlanningPreviewModal({
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
}: PlanningPreviewModalProps) {

    // Zoom compartido (key 'plan_zoom' en localStorage).
    const [zoom, setZoom] = usePersistedZoom('plan_zoom', 100);

    // Local state for edits
    const [editedResults, setEditedResults] = React.useState<Record<string, PlanificacionResult>>({});
    const [expandedOrderIds, setExpandedOrderIds] = React.useState<number[]>([]);
    // Decisión por orden excedente: true = forzar (incluir igual), false = descartar (default)
    const [forzarOrdenIds, setForzarOrdenIds] = React.useState<Set<number>>(new Set());

    // D1 (feedback 06/07): agregar procesos SUELTOS. `pendingAddProcesos` mapea
    // orden_id -> set de proceso_ids elegidos; `expandedAddIds` = OTs expandidas en
    // el popover para ver sus procesos.
    const [pendingAddProcesos, setPendingAddProcesos] = React.useState<Record<number, Set<number>>>({});
    const [expandedAddIds, setExpandedAddIds] = React.useState<Set<number>>(new Set());

    // Reset decisiones de forzar SOLO cuando el modal se abre fresh — no en cada
    // cambio de excedentes (porque ahora recalculamos en cada toggle y eso cambia
    // `excedentes`, lo que borraría las decisiones del usuario).
    React.useEffect(() => {
        if (isOpen) setForzarOrdenIds(new Set());
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
    const businessDaysBetween = (fromIso?: string, toIso?: string): number => {
        if (!fromIso || !toIso) return 0;
        const start = new Date(fromIso);
        const end = new Date(toIso);
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

    // Cantidad de OTs distintas en el plan actual (no procesos), útil para mostrar al usuario.
    const uniqueOrdersInPlan = React.useMemo(
        () => new Set(results.map(r => r.orden_id)).size,
        [results]
    );

    return (
        <>
        <Dialog open={isOpen} onOpenChange={handleOpenChange}>
            <DialogContent
                showCloseButton={false}
                className="max-w-[95vw] w-[95vw] sm:max-w-[95vw] h-[90vh] flex flex-col p-0 gap-0"
                onPointerDownOutside={(e) => e.preventDefault()}
                onInteractOutside={(e) => e.preventDefault()}
                onEscapeKeyDown={(e) => e.preventDefault()}
            >
                {/* Header rediseñado: título, KPIs rápidos del plan, acciones (Agregar OTs / Recalcular) y X de cerrar. */}
                <DialogHeader className="px-6 py-4 border-b border-gray-100 bg-white shrink-0">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                            <DialogTitle className="text-xl font-bold flex items-center gap-2">
                                <CalendarClock className="w-5 h-5 text-blue-600" />
                                Vista Previa de Planificación
                            </DialogTitle>
                            <DialogDescription className="mt-0.5">
                                Revisá y ajustá la programación antes de confirmar. Podés agregar más OTs o recalcular sin salir de esta vista.
                            </DialogDescription>
                            {/* KPIs rápidos del plan */}
                            <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                                <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1">
                                    <Cog className="w-3 h-3" />
                                    {uniqueOrdersInPlan} OT{uniqueOrdersInPlan === 1 ? "" : "s"} en plan
                                </Badge>
                                <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200 gap-1">
                                    <Clock className="w-3 h-3" />
                                    {results.length} proceso{results.length === 1 ? "" : "s"} · {formatMinutesShort(totalDemandMinutes)}
                                </Badge>
                                {displayedExcedentes.length > 0 && (
                                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
                                        <AlertTriangle className="w-3 h-3" />
                                        {new Set(displayedExcedentes.map(e => e.orden_id)).size} sin lugar
                                    </Badge>
                                )}
                                {planningRange.fecha_desde && planningRange.fecha_hasta && (
                                    <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 gap-1">
                                        <Calendar className="w-3 h-3" />
                                        {formatDate(planningRange.fecha_desde)} → {formatDate(planningRange.fecha_hasta)}
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
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
                            {/* (Recalcular manual removido: ahora el recálculo es automático
                                cada vez que se agrega o se elimina una OT del plan.) */}
                            <ZoomControl value={zoom} onChange={setZoom} />
                            {/* X explícita: único cierre del modal (además del botón "Volver" del footer). */}
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                                onClick={onClose}
                                disabled={isConfirming || isCalculating}
                                title="Cerrar"
                            >
                                <XIcon className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>
                </DialogHeader>

                <div className="flex flex-1 overflow-hidden">
                    <div className="flex-1 flex flex-col min-w-0 bg-white">
                        {/* Scroll nativo en lugar de Radix ScrollArea: la versión Radix no rendea
                            scrollbar horizontal por default y la tabla (min-w 1000px) quedaba pisada
                            por el sidebar de Carga de Operarios. Con overflow-auto el navegador
                            maneja ambos ejes y muestra scrollbar cuando hace falta. */}
                        <div className="flex-1 overflow-auto">
                            <div className="min-w-[1000px] p-0 pr-2" style={{ zoom: zoom / 100 }}>
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

                                {/* Encabezado claro de la tabla de planificados: estas OTs SÍ entraron en
                                    el plan. Se va a confirmar exactamente esto al apretar "Confirmar y Guardar". */}
                                <div className="mx-4 mt-4 mb-2 flex items-center gap-2">
                                    <div className="h-5 w-1 bg-green-500 rounded-full" />
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[10px] uppercase tracking-widest bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-bold">
                                            En el plan
                                        </span>
                                        <span className="text-sm font-bold text-gray-800">
                                            {uniqueOrdersInPlan} OT{uniqueOrdersInPlan === 1 ? "" : "s"} planificada{uniqueOrdersInPlan === 1 ? "" : "s"}
                                        </span>
                                        <span className="text-xs text-gray-500">
                                            ({results.length} procesos · estas son las que se van a guardar al confirmar)
                                        </span>
                                    </div>
                                </div>
                                <table className="w-full text-sm text-left border-collapse">
                                    <thead className="bg-gray-50 text-gray-500 font-medium uppercase text-xs sticky top-0 z-10 shadow-sm">
                                        <tr>
                                            <th className="px-4 py-3 w-10"></th>
                                            <th className="px-4 py-3">ID</th>
                                            <th className="px-4 py-3">Entrada</th>
                                            <th className="px-4 py-3">Cliente</th>
                                            <th className="px-4 py-3">Código</th>
                                            <th className="px-4 py-3">Artículo</th>
                                            <th className="px-4 py-3 text-center">Cant.</th>
                                            <th className="px-4 py-3 text-center">Mat.</th>
                                            <th className="px-4 py-3 text-center">Progreso</th>
                                            <th className="px-4 py-3 text-center">Prioridad</th>
                                            <th className="px-4 py-3 text-center">Prometida</th>
                                            <th className="px-4 py-3 text-center">Alertas</th>
                                            <th className="px-4 py-3 text-center w-12"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {Object.entries(groupedResults).map(([ordenIdStr, items]) => {
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
                                                        <td className="px-4 py-3 text-inherit opacity-90">{formatDate(firstItem.fecha_entrada)}</td>
                                                        <td className="px-4 py-3 text-gray-500 italic">{firstItem.cliente || "-"}</td>
                                                        <td className="px-4 py-3 font-mono text-xs text-inherit opacity-80">{firstItem.codigo || "-"}</td>
                                                        <td className="px-4 py-3 text-inherit">{firstItem.articulo ? capitalize(firstItem.articulo) : "-"}</td>
                                                        <td className="px-4 py-3 text-center">
                                                            {firstItem.unidades ? <Badge variant="secondary" className="bg-white/50 text-inherit border-current/20">{firstItem.unidades}</Badge> : "-"}
                                                        </td>
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
                                                        <td className="px-4 py-3 text-center">
                                                            <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                                {getPriorityLabel(firstItem.id_prioridad, firstItem.prioridad_descripcion)}
                                                            </Badge>
                                                        </td>
                                                        <td className="px-4 py-3 text-center text-inherit opacity-90">{formatDate(firstItem.fecha_prometida)}</td>
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
                                                            <td colSpan={13} className="px-0 py-0 border-b shadow-inner">
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
                                                                                            </div>
                                                                                            {/* A1 (feedback 06/07): motivo SIEMPRE visible en procesos sin operario asignado,
                                                                                                aunque la orden se haya planificado (antes solo quedaba el selector vacío, sin explicación). */}
                                                                                            {!effectiveItem.id_operario && (() => {
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
                                                                                                <SelectTrigger className="h-8 text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-100">
                                                                                                    <SelectValue placeholder="Sin asignar" />
                                                                                                </SelectTrigger>
                                                                                                <SelectContent>
                                                                                                    <SelectItem value="0" className="text-gray-400 italic">Sin asignar</SelectItem>
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
                                                                                                    !effU.id_maquinaria ? "border-red-300 bg-red-50/40" : "border-green-300 bg-green-50/40"
                                                                                                )}>
                                                                                                    <SelectValue placeholder="Máquina" />
                                                                                                </SelectTrigger>
                                                                                                <SelectContent>
                                                                                                    <SelectItem value="0" className="text-gray-400 italic">Sin asignar</SelectItem>
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
                            </div >

                        </div>
                    </div >

                    {/* Operator Workload Sidebar */}
                    < div className="w-80 bg-gray-50 border-l border-gray-200 flex flex-col shrink-0" >
                        <div className="p-4 border-b border-gray-200 bg-white/50">
                            <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                <User className="w-4 h-4 text-gray-500" />
                                Carga de Operarios
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">Estimación basada en la semana de planificación.</p>
                        </div>
                        <ScrollArea className="flex-1 p-4">
                            <div className="space-y-4">
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
                                                        {rangosNombres.slice(0, 4).map((nombre, i) => (
                                                            <span key={i} className="text-[9px] uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded font-semibold">
                                                                {nombre}
                                                            </span>
                                                        ))}
                                                        {rangosNombres.length > 4 && (
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
                    </div >
                </div >

                <DialogFooter className="p-4 bg-white border-t mt-auto gap-3 shrink-0 sm:justify-between">
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
                            <>Confirmar y Guardar</>
                        )}
                    </Button>
                </DialogFooter>

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
            </DialogContent >
        </Dialog >
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
