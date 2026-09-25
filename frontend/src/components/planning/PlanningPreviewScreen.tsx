import React from 'react';
import { PantallaPlanificador, CifraPlan } from "./PantallaPlanificador";
import { SelectorFechasPlan } from "./SelectorFechasPlan";
import { rangoParaElPlan, type FechasDelPlan } from "@/lib/fechasDelPlan";
import { CalendarRange } from "lucide-react";
import { nombreLindo, nombrePersona } from "@/lib/nombres";
import { limitacionDeMaquina } from "@/lib/maquinas";
import { Button } from "@/components/ui/button";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Badge } from "@/components/ui/badge";
import {
    Calendar, Clock, User, Cog, AlertCircle, CalendarClock, Edit2, RotateCcw,
    ChevronDown, ChevronRight, AlertTriangle, Search, X as XIcon,
    HelpCircle, Sparkles, RefreshCw, ListPlus, Info, Lightbulb,
    Columns3, Layers, ListFilter, ListChecks, LogOut, Printer, ArrowLeft, Pencil} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ZoomControl, usePersistedZoom } from "@/components/ui/zoom-control";
import type { WorkOrder } from "@/lib/types";
import { toast } from "@/lib/toast";
import { API_URL } from "@/config";
import { HORA_APERTURA, inicioDelPlan, minutosDesdeFecha } from "@/lib/plan-fechas";
import {
    capacidadEnElPeriodo, contarDiasHabiles, describirDias, diasQueTrabajaElTaller, jornadaDelOperario,
    type CapacidadEnElPeriodo,
} from "@/lib/diasHabiles";
import { DiagnosticosPlan, type Diagnostico } from "@/components/planning/DiagnosticosPlan";
import { PanelCargaRecursoHumano } from "@/components/planning/PanelCargaRecursoHumano";
import { unificarPreparaciones } from "@/lib/unificarAvisos";
import { huellaRecursos } from "@/lib/huellaRecursos";
import type { TandaManual } from "@/lib/borradorPlan";
import {
    payloadDeAjustes, descripcionDeAccion, claveDeAjuste, objetivosDeAjuste,
    ajustesParaElProximo, ajustesDelPlanMostrado, estadoDeAjuste,
    type AjusteDelPlan, type AjustesDelPlanPayload, type AccionDeSolucion, type GuardadoSinRecalcular,
} from "@/lib/ajustesPlan";
import { duracionEstimada } from "@/components/planning/ProgresoPlanificacion";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MaterialChip } from "@/components/common/MaterialChip";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { AvisoPausadasEnElPlan } from "@/components/pausas/AvisoPausadasEnElPlan";
import { filtroBusqueda, type ColumnaExport } from "@/lib/exportar";
import {
    useProcesosEnPlan, contarCambios, resumirCambios, filasVisiblesDeOT, pasadasEnOrden,
} from "@/components/planning/useProcesosEnPlan";
import {
    NombreDeProcesoEditable, MinutosDelProceso, AccionesDeProcesoEnPlan,
    PasoEnPlanEditable, AgregarProcesoEnPlan, type ProcesoDelCatalogo,
} from "@/components/planning/ProcesoEnPlanEditable";

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
    /** Operario ADICIONAL del mismo proceso (cant_operarios > 1). Comparte
     *  (OT, proceso, secuencia) con la fila principal: es otra persona en el
     *  mismo trabajo, no otro trabajo. */
    slot_extra?: boolean;
    /** false = proceso manual (embalado, pintura, soldadura...): no usa máquina
     *  y el "sin máquina" NO es un hueco. Se muestra "No necesita" en vez de
     *  "Sin asignar", con el desplegable disponible por si igual quieren una. */
    usa_maquina?: boolean;
    secuencia?: number;
    /** Qué PASADA de la OT es esta fila (orden_trabajo_proceso.id).
     *  Es lo único que distingue las 13 pasadas de TORNO CNC de la 7497 entre sí,
     *  y por eso es lo que se tilda al agregar procesos sueltos a mano. */
    id_orden_trabajo_proceso?: number | null;
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
    /** Recalcula el plan con un nuevo set de OTs + el mismo rango + las decisiones de
     *  forzar + las soluciones que se aplicaron sólo a este plan (ver `lib/ajustesPlan`). */
    onRecalculate?: (
        ids: number[],
        range: { fecha_desde?: string; fecha_hasta?: string },
        forzarIds: number[],
        lineasPorOrden?: Record<number, number[]>,
        ajustes?: AjustesDelPlanPayload,
    ) => void;
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
     * Desde cuándo arranca el plan (el T=0 del planificador), tal como lo devolvió el
     * backend. Hace falta para la vuelta: cuando alguien le escribe un horario a mano
     * a un proceso que quedó afuera, lo que se guarda es el MINUTO, y ese minuto se
     * cuenta desde acá. Ver `lib/plan-fechas`.
     */
    inicioBase?: string;
    /** Días que el taller no trabaja. Se usan en la vuelta de fecha a minutos, para que
     *  cuente los mismos días que el backend. */
    feriados?: string[];
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
    /** Lo que se había agregado a mano en el borrador que se está retomando. */
    tandasIniciales?: TandaManual[];
    /** Avisa de cada cambio en lo agregado a mano para que se guarde en el borrador.
     *  Es lo que hace que las pasadas elegidas de a una sobrevivan a retomar el plan:
     *  sin ellas el recálculo siguiente le devuelve a la OT todos sus procesos. */
    onTandasChange?: (tandas: TandaManual[]) => void;
    /**
     * Las soluciones aplicadas "solo para este plan" que traía el borrador retomado.
     *
     * No están en Recursos ni en el plan que devolvió el solver: si no vuelven por
     * acá, el primer recálculo devuelve el plan a lo que dicen los datos y la traba
     * que alguien había destrabado reaparece sola.
     */
    ajustesIniciales?: AjusteDelPlan[];
    /** Avisa de cada ajuste aplicado o deshecho, para que se guarde en el borrador. */
    onAjustesChange?: (ajustes: AjusteDelPlan[]) => void;
}

/**
 * Hasta qué paso de la OT se puede agregar un proceso suelto a mano.
 *
 * Regla de Lucas (28/08): "para poder ir, los procesos manuales tienen que estar
 * en el proceso uno o dos". El motivo es físico, no informático: el fresado va
 * después del torneado porque la pieza no está lista para fresar antes. Agregar
 * el paso 6 sin haber cortado ni preparado el torno no significa nada en el taller.
 *
 * Es una limitación de la CARGA MANUAL, no del algoritmo: el solver sigue
 * planificando la OT entera cuando se la agrega entera, con todos sus pasos.
 *
 * Y es a propósito que la salida sea ir a arreglar la OT: cuando el paso 3 debería
 * ser el 1, lo que está mal es la OT (Lucas mostró la 15670 con los pasos cambiados
 * y repetidos), y quedaba escondido hasta que alguien lo miraba a ojo.
 */
const PASO_MAXIMO_A_MANO = 2;

/**
 * La lista vacía por defecto, UNA sola para siempre.
 *
 * Con `diagnosticos = []` en la firma cada render estrenaba un array, el `useMemo`
 * que une las preparaciones se recalculaba y el panel de avisos —que limpia la
 * confirmación de «Guardar en Recursos» cada vez que cambia la identidad de la
 * lista— la borraba en el render siguiente.
 */
const SIN_AVISOS: Diagnostico[] = [];

/**
 * Las pasadas de una OT en orden de trabajo, cada una con su paso y si se puede
 * elegir a mano.
 *
 * `paso` sale de `orden`, que es lo que se ve en la OT y lo que Lucas señaló en
 * pantalla. Cuando viene vacío se cae a la posición en la lista: sin eso una OT
 * con el campo sin cargar no dejaría agregar nada y el aviso sería incomprensible.
 */
const pasadasParaAgregar = (procs: any[]) =>
    [...(procs || [])]
        .sort((a, b) => (a.orden || 0) - (b.orden || 0) || (a.id || 0) - (b.id || 0))
        .map((p, i) => {
            const paso = Number(p.orden) > 0 ? Number(p.orden) : i + 1;
            return { rel: p, paso, habilitada: paso <= PASO_MAXIMO_A_MANO };
        });

/** Todas las OTs que tocaron estas tandas (enteras o por procesos sueltos). */
const otsDeTandas = (tandas: TandaManual[]) => {
    const s = new Set<number>();
    for (const t of tandas) {
        t.ots.forEach(id => s.add(id));
        Object.keys(t.lineas).forEach(id => s.add(Number(id)));
    }
    return s;
};

/** Las pasadas sueltas de estas tandas, juntas y por OT. */
const lineasDeTandas = (tandas: TandaManual[]) => {
    const acc: Record<number, number[]> = {};
    for (const t of tandas) {
        for (const [oid, ids] of Object.entries(t.lineas)) {
            acc[Number(oid)] = [...(acc[Number(oid)] || []), ...ids];
        }
    }
    return acc;
};

/** Las mismas tandas sin rastro de estas OTs. Se usa al quitar una OT del plan. */
const tandasSinOTs = (tandas: TandaManual[], quitar: Set<number>): TandaManual[] =>
    tandas
        .map(t => ({
            ots: t.ots.filter(id => !quitar.has(id)),
            lineas: Object.fromEntries(
                Object.entries(t.lineas).filter(([oid]) => !quitar.has(Number(oid)))
            ) as Record<number, number[]>,
        }))
        .filter(t => t.ots.length > 0 || Object.keys(t.lineas).length > 0);

/**
 * Con qué clave se guarda un retoque a mano de una fila del plan.
 *
 * Lleva la `secuencia` y no sólo (OT, proceso): desde que una OT puede repetir el
 * mismo proceso (la 7497 tiene TORNO CNC 13 veces), `55-812` es la misma clave
 * para las 13 pasadas — elegirle la persona a una se la ponía a todas y el
 * desplegable de las otras doce se movía solo. La secuencia es la posición dentro
 * de la OT y sí es única.
 */
const claveBase = (item: { orden_id: number; proceso_id: number; secuencia?: number }) =>
    `${item.orden_id}-${item.proceso_id}-${item.secuencia ?? 0}`;

/** La clave que se usaba antes de que existieran las pasadas repetidas. Sólo para
 *  leer borradores viejos: lo que se guarda de ahora en más va con `claveDeEdicion`. */
const claveVieja = (item: { orden_id: number; proceso_id: number }) =>
    `${item.orden_id}-${item.proceso_id}`;

/** Misma forma que acepta `partesDeFecha` en lib/exportar: «2026-10-02», con hora o sin
 *  ella, y con zona (grupo 7) sólo si la trae. */
const RE_FECHA_BACKEND = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * El día de calendario de una fecha del backend, como número de días corridos (para
 * restar dos y saber cuántos días hay entre ellas).
 *
 * Las fechas del sistema son hora local de Argentina sin zona ([[fechas-todas-sin-zona]]):
 * «2026-10-02T12:35:00» es el 2/10 y «2026-10-02» también. Por eso se leen los dígitos
 * tal cual y no con `new Date()`, que a un «2026-10-02» pelado lo toma como medianoche
 * UTC, y acá eso ya es el 1/10 a las 21. Sólo lo que trae zona explícita se pasa a la
 * hora de esta computadora. No descarta la marca 1950: de eso se ocupa quien la usa.
 */
const diaDeCalendario = (valor: string | null | undefined): number | null => {
    if (!valor) return null;
    const texto = valor.trim();
    const m = RE_FECHA_BACKEND.exec(texto);
    if (m && !m[7]) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86_400_000;
    const d = new Date(texto);
    if (isNaN(d.getTime())) return null;
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
};

/**
 * Cuántos días llega tarde un proceso a la fecha prometida; 0 si llega a tiempo o si
 * falta alguna de las dos fechas. Es la ÚNICA cuenta de atraso de esta pantalla: la
 * usan el filtro «Solo las que llegan tarde», la columna «Termina tarde» del exportado
 * y la alerta roja de la fila, así que no pueden decir cosas distintas.
 *
 * Lo que se promete es un DÍA, no una hora. La prometida viene como medianoche y antes
 * se comparaba el fin contra esa medianoche y se redondeaba para arriba: la 14570
 * termina el 2/10 a las 12:35, se prometió para el 2/10 y salía «+1 días». Terminar
 * el día prometido es cumplir; el atraso es la resta de días de calendario (terminar
 * el 3/10 a las 8 es +1, no +0,3 redondeado).
 *
 * La prometida 1950-01-01 (la marca del sistema viejo para «sin fecha») sigue dando
 * atraso como hasta ahora, a propósito: así la OT aparece en el filtro y la alerta de
 * la fila explica que la promesa está sin definir y que hay que cargarla.
 */
const diasDeAtraso = (fin: string | null | undefined, prometida: string | null | undefined): number => {
    const diaFin = diaDeCalendario(fin);
    const diaPrometido = diaDeCalendario(prometida);
    if (diaFin === null || diaPrometido === null) return 0;
    return Math.max(0, diaFin - diaPrometido);
};

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
    diagnosticos: diagnosticosCrudos = SIN_AVISOS,
    onEdicionesChange,
    calculadoEn,
    inicioBase,
    feriados = [],
    huellaAlCalcular,
    edicionesIniciales,
    forzarIdsIniciales,
    tandasIniciales,
    onTandasChange,
    ajustesIniciales,
    onAjustesChange,
}: PlanningPreviewScreenProps) {

    // Zoom compartido (key 'plan_zoom' en localStorage).
    const [zoom, setZoom] = usePersistedZoom('plan_zoom', 100);

    /**
     * Los avisos con cada preparación adentro del de su producción, cuando son la
     * misma traba (ver `lib/unificarAvisos`). Se unen ACÁ y no en el panel porque la
     * cifra «Trabas sin resolver» de arriba tiene que contar lo mismo que se ve abajo.
     *
     * El `useMemo` no es optimización: el panel limpia la confirmación de «Guardar en
     * Recursos» cada vez que cambia la identidad de la lista, y sin memo la lista es
     * nueva en cada render y el botón nunca pasa de «Mirá y confirmá».
     */
    const diagnosticos = React.useMemo(() => unificarPreparaciones(diagnosticosCrudos), [diagnosticosCrudos]);

    // Local state for edits
    const [editedResults, setEditedResults] = React.useState<Record<string, PlanificacionResult>>({});
    const [expandedOrderIds, setExpandedOrderIds] = React.useState<number[]>([]);
    // Decisión por orden excedente: true = forzar (incluir igual), false = descartar (default)
    const [forzarOrdenIds, setForzarOrdenIds] = React.useState<Set<number>>(new Set());

    /**
     * Las soluciones que se aplicaron SOLO a este plan, sin tocar Recursos.
     *
     * Pedido de Julián (17/09/2026): destrabar un aviso para esta tanda sin dejar la
     * máquina abierta para siempre. El ajuste no se escribe en ningún lado: viaja en
     * el body de cada `/planificar` y el backend lo aplica en memoria. Ver
     * `lib/ajustesPlan`.
     *
     * Vive acá y no adentro de `DiagnosticosPlan` porque el array `diagnosticos` se
     * reemplaza entero en cada recálculo —y el panel limpia su estado con él—, así que
     * el ajuste se perdería justo cuando vuelve el plan que produjo. Acá sobrevive al
     * recálculo, igual que los retoques y las tandas.
     */
    const [ajustesDelPlan, setAjustesDelPlan] = React.useState<AjusteDelPlan[]>(ajustesIniciales ?? []);

    /**
     * Lo guardado en Recursos desde el panel de avisos que el plan de la pantalla
     * todavía no tiene.
     *
     * Hasta el 25/09/2026 «Guardar en Recursos» recalculaba en el mismo click, igual
     * que «Solo en este plan», y con 48 OT cada vuelta son unos 4 minutos. Julián:
     * *"cada vez que hago un cambio de alguna traba se replanifica todo, cuando tendría
     * que dejarme terminar de verlas y ahí se replanifique; es una paja esperar con
     * cada una"*. Ahora los arreglos se juntan y se recalcula una vez, con el botón
     * del pie. Esta lista es la mitad de lo que ese botón cuenta; la otra mitad son
     * los ajustes con estado pendiente.
     */
    const [guardadosSinRecalcular, setGuardadosSinRecalcular] = React.useState<GuardadoSinRecalcular[]>([]);
    const idGuardado = React.useRef(0);
    /**
     * Qué se mandó en el último recálculo, para pasarlo a «calculado» recién cuando
     * vuelve el plan que lo incluyó. Si el recálculo falla, `calculadoEn` no cambia y
     * lo marcado sigue pendiente, que es lo cierto. `null` = no hay nada en viaje: así
     * abrir un borrador (que también cambia `calculadoEn`) no da por calculado lo que
     * quedó marcado en él.
     */
    const enviadosRef = React.useRef<{ agregados: Set<string>; sacados: Set<string>; guardados: Set<number> } | null>(null);

    // Cada retoque sube al borrador. Va en un efecto y no dentro de cada setter
    // porque los cambios entran por varios lados (celda, popover, atajo) y con un
    // solo lugar no hay forma de que alguno se olvide de avisar.
    React.useEffect(() => {
        onEdicionesChange?.(editedResults, Array.from(forzarOrdenIds));
    }, [editedResults, forzarOrdenIds, onEdicionesChange]);

    // Lo mismo con los ajustes de este plan: son lo único del borrador que no tiene
    // copia en ningún lado —ni en Recursos ni en el plan que devolvió el solver—, así
    // que si alguno no sube, se pierde sin dejar rastro.
    React.useEffect(() => {
        onAjustesChange?.(ajustesDelPlan);
    }, [ajustesDelPlan, onAjustesChange]);

    // D1 (feedback 06/07): agregar procesos SUELTOS. `pendingAddLineas` mapea
    // orden_id -> set de ids de PASADA (orden_trabajo_proceso.id) elegidas;
    // `expandedAddIds` = OTs expandidas en el popover para ver sus procesos.
    // Antes guardaba proceso_ids: no alcanza desde que el mismo proceso puede ir
    // varias veces en la OT (la 7497 tiene TORNO CNC 13 veces) — tildar "torno cnc"
    // habría metido las 13 pasadas de una.
    const [pendingAddLineas, setPendingAddLineas] = React.useState<Record<number, Set<number>>>({});
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
     * Cuando el plan es nuevo, el padre manda los tres vacíos y esto los limpia,
     * que es lo que hacía antes con `forzarOrdenIds`.
     */
    React.useEffect(() => {
        if (!isOpen) return;
        setForzarOrdenIds(new Set(forzarIdsIniciales ?? []));
        setEditedResults((edicionesIniciales ?? {}) as Record<string, PlanificacionResult>);
        // Los ajustes "solo para este plan" vuelven por el mismo camino. Un plan nuevo
        // manda la lista vacía y eso los limpia: valen para el plan en el que se
        // aplicaron y no para el siguiente.
        setAjustesDelPlan(ajustesIniciales ?? []);
        // Lo guardado en Recursos no viaja en el borrador: al retomarlo, la huella de
        // Recursos lo detecta como «cambió algo». Y nada está en viaje: el `calculadoEn`
        // del borrador que llega no es la vuelta de ningún recálculo de esta pantalla.
        setGuardadosSinRecalcular([]);
        enviadosRef.current = null;
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
     *   - Ningún recurso humano ni recurso maquinaria cumple los requisitos del proceso.
     *   - El solver agotó su tiempo sin encontrar asignación (el presupuesto ya no es
     *     un número fijo: crece con el tamaño del lote, así que no vale escribirlo acá).
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
                hint: "Este proceso no tiene rango asignado en el sistema. Asignale uno en Recursos → Procesos para que el motor pueda elegir el recurso humano.",
                rangos: [],
            };
        }
        return {
            code: "no_match",
            label: "Sin recurso humano/maquinaria compatible",
            hint: `Ningún recurso humano ni recurso maquinaria disponible cumple los requisitos. Rangos requeridos: ${formatRangoIds(rangos)}. Asigná recurso humano a estos rangos en Recursos → Recurso humano.`,
            rangos,
        };
    };

    /**
     * Convierte un datetime-local (YYYY-MM-DDTHH:mm) al `inicio_min` del plan.
     *
     * Se usa cuando alguien asigna a mano un proceso que quedó afuera. Los minutos del
     * planificador son minutos TRABAJADOS contados desde el arranque del plan, no
     * minutos de reloj contados desde ahora: acá se hacía `(fecha - ahora) / 60000`,
     * así que poner un proceso el jueves a las 8 guardaba mil y pico de minutos —los
     * de reloj, noches y fin de semana incluidos— y el proceso aterrizaba donde nadie
     * lo había puesto. Ver `lib/plan-fechas`.
     */
    const datetimeToInicioMin = (dtStr: string): number => {
        if (!dtStr) return 0;
        const destino = new Date(dtStr);
        if (isNaN(destino.getTime())) return 0;
        const base = inicioBase
            ? new Date(inicioBase)
            : inicioDelPlan(new Date(), feriados, planningRange?.fecha_desde);
        return minutosDesdeFecha(base, destino, feriados);
    };

    /** Devuelve true si el proceso "unfit" fue completado a mano por el usuario
     *  (operario + maquinaria + horario). En ese caso lo incluimos en el plan al confirmar. */
    const isUnfitManuallyAssigned = (item: PlanificacionResult): boolean => {
        const edit = editedResults[claveDeEdicion(item)] || editedResults[claveVieja(item)];
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
        onRecalculate(mergedIds, planningRange, forcedArr, lineasParaEnviar(mergedIds), ajustesParaEnviar());
    };

    /**
     * Guardar = guardar LO QUE ESTÁ EN PANTALLA. No se vuelve a calcular.
     *
     * Antes había dos rutas y la de todos los días era la mala: si nadie había
     * asignado a mano un proceso "unfit", el backend re-corría el solver con
     * `forzar_ordenes_ids` y guardaba lo que ese segundo cálculo devolviera.
     *
     * Dos problemas, y el segundo es el grave:
     *
     *  1. Tardaba. Guardar 5 OT se llevaba 62 segundos (10/09) porque estaba
     *     resolviendo todo de nuevo, y encima sin mostrar nada en pantalla.
     *
     *  2. Podías aprobar un plan y guardar otro. El solver no devuelve siempre lo
     *     mismo —medido el 10/09 sobre 40 OT: con distinto presupuesto de tiempo
     *     reparte el trabajo distinto—, así que el plan mirado y el guardado podían
     *     no coincidir. Nadie se iba a dar cuenta.
     *
     * Recalcular no hacía falta: forzar una OT, quitarla o agregar procesos YA
     * disparan su recálculo en el momento. Lo que NO recalcula solo desde el
     * 25/09/2026 —los arreglos de las trabas, lo guardado en Recursos, los procesos
     * editados de una OT— queda contado en el pie («Recalcular con N cambios») y, si
     * se guarda sin recalcular, el primer eslabón de la cadena lo avisa.
     *
     * Qué se guarda: los procesos del plan con los retoques hechos a mano, más los
     * unfit que se completaron. Los unfit a medio completar se omiten, como antes.
     */
    const handleConfirmWithDecisions = () => {
        const manualPlan: any[] = [];

        // 1. Procesos auto-asignados (con edits del usuario aplicados).
        for (const r of results) {
            // Las pasadas que se sacaron de la OT desde acá ya no existen: guardar su
            // fila dejaría el plan apuntando a un paso borrado.
            if (procesosEnPlan.fueBorrada(r.id_orden_trabajo_proceso)) continue;
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
                // Mismo motivo que arriba: si esa pasada ya no está en la OT, su fila
                // del plan no puede guardarse.
                if (procesosEnPlan.fueBorrada(u.id_orden_trabajo_proceso)) continue;
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

    /**
     * Aviso al guardar con procesos editados y sin recalcular.
     *
     * Lo que se guarda es el plan que está en pantalla, y ese plan se calculó ANTES de
     * los cambios: el paso que se agregó no tiene lugar y el que se cambió sigue con la
     * persona y la máquina del proceso anterior. No se bloquea —el criterio de siempre
     * es avisar, no frenar: guardar así puede ser justo lo que se quiere— pero tiene
     * que estar dicho, porque es la diferencia entre guardar el plan que uno mira y
     * guardar uno que ya no existe.
     *
     * Es el primer eslabón de una cadena: cada aviso, al seguir, llama al SIGUIENTE
     * (`seguirGuardando`) y nunca a `handleConfirmWithDecisions` directo. Saltearse un
     * eslabón se ve igual que guardar bien, y por eso no se nota hasta que ya está
     * guardado.
     */
    const [showDesactualizadoWarn, setShowDesactualizadoWarn] = React.useState(false);

    /**
     * Aviso al guardar un plan que se calculó con arreglos «Solo en este plan».
     *
     * Esos arreglos no se escribieron en ningún lado: el plan salió como si la
     * máquina aceptara ese rango, pero en Recursos la máquina sigue cerrada. Mientras
     * se mira la vista previa eso está a la vista en la tira de ajustes; una vez
     * guardado, el plan queda repartiendo trabajo que, según los datos del taller,
     * esa persona o esa máquina no puede tomar, y en pantalla ya no hay nada que lo
     * diga.
     *
     * Avisa y deja seguir, como todos los de esta cadena: aplicar el arreglo sólo a
     * esta tanda puede ser exactamente lo que se quiso hacer. Lo que no puede pasar
     * es que se guarde sin que nadie lo haya leído.
     */
    const [showAjustesWarn, setShowAjustesWarn] = React.useState(false);

    /** El último tramo: excedentes sin forzar y, si no hay, se guarda. */
    const seguirDespuesDeAjustes = () => {
        if (displayedExcedentes.length > 0) { setShowForzarWarn(true); return; }
        handleConfirmWithDecisions();
    };
    /**
     * El eslabón de los ajustes va ACÁ y no en `onClickConfirmar` a propósito: por
     * `seguirGuardando` pasan los dos caminos —el click directo y el «Guardar igual»
     * del aviso de procesos—, así que ninguno lo puede saltear. Puesto en el click, el
     * aviso de procesos seguiría derecho al de excedentes y se lo saltearía, que es
     * justo la forma de romper la cadena que advierte el comentario de arriba.
     */
    const seguirGuardando = () => {
        // Los que el plan de la pantalla YA tiene: si se guarda sin recalcular, los
        // recién marcados no están en lo que se guarda.
        if (ajustesDelPlanMostrado(ajustesDelPlan).length > 0) { setShowAjustesWarn(true); return; }
        seguirDespuesDeAjustes();
    };
    /**
     * El primer eslabón: cambios marcados que el plan todavía no tiene.
     *
     * Era sólo el de procesos editados; desde que los arreglos de las trabas se
     * juntan y se recalculan una vez (25/09/2026) son uno más de la misma lista, y un
     * solo aviso los cuenta a todos. Avisa y deja seguir, como el resto de la cadena.
     */
    const onClickConfirmar = () => {
        if (cantidadPendientes > 0) { setShowDesactualizadoWarn(true); return; }
        seguirGuardando();
    };

    const handleConfirmWithEdits = () => {
        // Devuelve al padre los resultados combinados (originales + edits del usuario).
        const finalResults = results.map(item => getEffectiveItem(item));
        (onConfirm as any)(finalResults);
    };

    // ---------- Estado nuevo: agregar OTs en vivo + recalcular ----------

    /** OTs marcadas en el popover "Agregar OTs" (todavía no enviadas al solver). */
    const [pendingAddIds, setPendingAddIds] = React.useState<Set<number>>(new Set());
    const [addSearchTerm, setAddSearchTerm] = React.useState("");
    const [addPopoverOpen, setAddPopoverOpen] = React.useState(false);
    /** UI: orden expandida en el panel de excedentes para mostrar la explicación. */
    const [expandedExcedenteId, setExpandedExcedenteId] = React.useState<number | null>(null);

    // ---------- Lo que se agregó A MANO al plan ----------

    /**
     * Cada tanda de "Agregar OTs" queda anotada acá, en orden.
     *
     * Son tres cosas que Lucas pidió el 28/08 mirando la pantalla y que necesitan
     * el mismo dato: "que te aparezca qué cosas agregaste y que puedas volver para
     * atrás, para que si te equivocaste…". Sin esta anotación el plan que vuelve
     * del solver es indistinguible del que salió solo: no hay color que poner ni
     * nada que deshacer.
     *
     * Una OT no puede aparecer en dos tandas: apenas entra al plan desaparece de
     * `addableOrders`, así que cada OT pertenece a lo sumo a una.
     */
    const [tandasManuales, setTandasManuales] = React.useState<TandaManual[]>(tandasIniciales ?? []);

    /**
     * Al entrar a la pantalla se retoma lo que traiga el borrador.
     *
     * Antes acá se vaciaba siempre, y retomar un borrador pasa por acá: se perdía la
     * barrita de lo agregado a mano, el botón de deshacer y —lo grave— las pasadas
     * elegidas de a una. El primer recálculo después de retomar mandaba la OT pelada
     * y volvía con sus 13 procesos en vez de los 2 que alguien había elegido.
     *
     * Un plan nuevo manda la lista vacía, que es lo que la limpia. Va sólo con
     * `isOpen` y no con `results`: un recálculo NO borra lo que se agregó, es justo
     * lo contrario.
     */
    React.useEffect(() => {
        if (!isOpen) return;
        const retomadas = tandasIniciales ?? [];
        setTandasManuales(retomadas);
        // Retomar NO es agregar. El aviso de "a quién le saltó la carga" se dispara
        // cuando crece la cantidad de tandas (ver `tandasPreviasRef`, más abajo), y
        // sin esto abrir un borrador con tandas adentro lo dejaba armado: el primer
        // cambio de carga posterior —cambiarle el recurso humano a una fila, sin ir
        // más lejos— salía con el cartel "con lo que acabás de agregar" sin que
        // nadie hubiera agregado nada. Es el mismo falso positivo que el comentario
        // de allá abajo explica por qué se evitó.
        tandasPreviasRef.current = retomadas.length;
        esperandoSalto.current = null;
        // Solo al entrar: adentro de la pantalla mandan los cambios del usuario.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Cada cambio de lo agregado a mano sube al borrador, igual que los retoques.
    // Mismo motivo que allá: entra por demasiados lados (agregar, deshacer, quitar
    // una OT, quitar una pasada, editar los procesos de una OT) como para que cada
    // uno se acuerde de avisar.
    React.useEffect(() => {
        onTandasChange?.(tandasManuales);
    }, [tandasManuales, onTandasChange]);

    /** OTs que entraron al plan a mano (enteras o por procesos sueltos). */
    const ordenesAMano = React.useMemo(() => otsDeTandas(tandasManuales), [tandasManuales]);

    /** Pasadas sueltas que entraron a mano, para pintarlas en la OT desplegada. */
    const lineasAMano = React.useMemo(() => {
        const s = new Set<number>();
        for (const t of tandasManuales) {
            for (const ids of Object.values(t.lineas)) ids.forEach(id => s.add(id));
        }
        return s;
    }, [tandasManuales]);

    /**
     * El `lineas_por_orden` que hay que mandar en CUALQUIER recálculo.
     *
     * Es acumulado a propósito. Antes cada recálculo mandaba sólo las pasadas de
     * esa tanda —y "Forzar", "Volver a revisar" o quitar una OT no mandaban
     * ninguna—, así que una OT de la que se habían elegido 2 de 13 pasadas volvía
     * con las 13 al siguiente recálculo, sin avisar y sin que nadie lo pidiera.
     */
    const lineasVigentes = React.useMemo(() => lineasDeTandas(tandasManuales), [tandasManuales]);

    /** Minutos a horas, con la coma que usa todo el resto de la pantalla en español. */
    const horasEs = (min: number) => (min / 60).toFixed(1).replace(".", ",");

    /** Está abierta la lista de lo agregado a mano. */
    const [verAMano, setVerAMano] = React.useState(false);

    // Limpiar selección "para agregar" cuando cambia el set de resultados (ya fueron incluidas).
    React.useEffect(() => {
        setPendingAddIds(new Set());
        setPendingAddLineas({});
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
    const togglePendingLinea = (ordenId: number, lineaId: number) => {
        setPendingAddLineas(prev => {
            const next = { ...prev };
            const set = new Set(next[ordenId] || []);
            if (set.has(lineaId)) set.delete(lineaId);
            else set.add(lineaId);
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
        for (const [oidStr, set] of Object.entries(pendingAddLineas)) {
            if (!pendingAddIds.has(Number(oidStr))) n += set.size;
        }
        return n;
    }, [pendingAddIds, pendingAddLineas]);

    /**
     * Las pasadas sueltas que van en un recálculo: las que ya estaban vigentes más
     * las de la tanda nueva, y sólo de OTs que siguen en el plan.
     *
     * Toda llamada a `onRecalculate` tiene que pasar por acá. Mandar `undefined`
     * significa "planificá las OTs enteras", y ése era el bug: cualquier recálculo
     * que no fuera el de agregar (forzar, quitar, volver a revisar) le devolvía a
     * la OT los procesos que nadie había elegido.
     */
    const lineasParaEnviar = (ids: number[], extra?: Record<number, number[]>) => {
        const enPlan = new Set(ids);
        const acc: Record<number, number[]> = {};
        for (const [oid, ls] of Object.entries(lineasVigentes)) {
            if (enPlan.has(Number(oid))) acc[Number(oid)] = [...ls];
        }
        for (const [oid, ls] of Object.entries(extra || {})) {
            if (enPlan.has(Number(oid))) acc[Number(oid)] = [...(acc[Number(oid)] || []), ...ls];
        }
        return Object.keys(acc).length > 0 ? acc : undefined;
    };

    /**
     * Los ajustes "solo para este plan" que van en un recálculo.
     *
     * Toda llamada a `onRecalculate` tiene que pasar por acá, igual que por
     * `lineasParaEnviar` y por el mismo motivo: el recálculo entra por ocho puertas
     * distintas (forzar una OT, agregar, deshacer una tanda, quitar una OT, quitar
     * una pasada, editar los procesos de una OT, ampliar el rango, la revisión
     * automática al volver de Recursos) y a la que se olvide de mandarlos el plan
     * vuelve en silencio a lo que dice la base, con la tira de ajustes todavía en
     * pantalla diciendo que están aplicados.
     *
     * El `override` no es una comodidad: aplicar o deshacer un ajuste recalcula en el
     * mismo tick en que hace el `setAjustesDelPlan`, y ahí el estado todavía tiene la
     * lista VIEJA. Sin el override, el primer ajuste se aplicaría mandando la lista
     * vacía y el deshecho se volvería a mandar.
     */
    const ajustesParaEnviar = (override?: AjusteDelPlan[]) => {
        // Los que se están sacando no viajan; los recién marcados sí. Y se anota qué
        // salió, para pasarlo a «calculado» cuando vuelva ESTE plan (efecto sobre
        // `calculadoEn`). Por acá pasa cualquier recálculo —Forzar, Agregar, Quitar
        // una OT, el botón del pie—, así que cualquiera vacía la cola de pendientes.
        const todos = override ?? ajustesDelPlan;
        enviadosRef.current = {
            agregados: new Set(todos.filter(a => estadoDeAjuste(a) === "por-agregar").map(a => a.clave)),
            sacados: new Set(todos.filter(a => estadoDeAjuste(a) === "por-quitar").map(a => a.clave)),
            guardados: new Set(guardadosSinRecalcular.map(g => g.id)),
        };
        return payloadDeAjustes(ajustesParaElProximo(todos));
    };

    /** Recalcula el plan con las OTs actuales + las nuevas pendientes + decisiones de forzar. */
    const handleRecalculate = (
        extraIds: number[] = [],
        lineasPorOrden?: Record<number, number[]>,
        ajustesOverride?: AjusteDelPlan[],
    ) => {
        if (!onRecalculate) {
            toast.error("Recalcular no está disponible en este contexto.");
            return;
        }
        const forcedArr = Array.from(forzarOrdenIds);
        const mergedIds = buildOrdenIdsForRecalc(forcedArr, extraIds);
        onRecalculate(
            mergedIds,
            planningRange,
            forcedArr,
            lineasParaEnviar(mergedIds, lineasPorOrden),
            ajustesParaEnviar(ajustesOverride),
        );
    };

    /**
     * El nombre del rango, para los avisos que proponen una solución sin traer los
     * nombres puestos.
     *
     * Los que traen `accion` ya vienen con los nombres desde el backend (`suma` /
     * `tenia`). Los avisos Media no traen acción —qué rango va lo sabe el taller, no
     * el planificador— y de ahí sólo salen ids. Sin traducirlos, la tira de ajustes
     * diría «rangos 3, 7», que es exactamente la jerga que se pidió sacar. El
     * catálogo ya está cargado en la pantalla; si falló, se muestra el resto igual.
     */
    const nombreDeRango = React.useCallback(
        (id: number) => rangosCatalog.find(r => r.id === id)?.nombre ?? "",
        [rangosCatalog],
    );

    /**
     * Marca una solución para aplicarla SOLO a este cálculo, sin escribir nada en
     * Recursos.
     *
     * Pedido de Julián (17/09/2026), copiado tal cual se escribió —tipeos incluidos, y
     * por lo mismo que en `lib/ajustesPlan`: una cita "arreglada" ya no se puede buscar
     * ni verificar contra el original—: *"si por ejemplo esas medianas solo se quieren
     * solucionar para esa planificacion un boton para aplicar la solucion solo para
     * esta pla ificacion y no me cambie todo en la base de datos"*. El botón de al
     * lado —el permanente— sigue estando y sigue pidiendo confirmación en dos pasos,
     * porque ése sí deja la máquina abierta para todos los planes que vengan.
     *
     * Éste es de un click a propósito: no toca ningún dato y se deshace con un botón,
     * así que pedir confirmación sería sólo un paso más para nada.
     *
     * NO recalcula (25/09/2026): queda «por agregar» y entra en el próximo recálculo,
     * que se pide una sola vez con el botón del pie cuando se terminó de revisar.
     */
    const aplicarAjusteDelPlan = (ajuste: AjusteDelPlan) => {
        const existente = ajustesDelPlan.find(a => a.clave === ajuste.clave);
        if (existente) {
            // Se estaba sacando y se vuelve a poner: queda como estaba, calculado.
            if (estadoDeAjuste(existente) === "por-quitar") {
                setAjustesDelPlan(ajustesDelPlan.map(a => a.clave === ajuste.clave ? { ...a, estado: "calculado" } : a));
            }
            // Dos veces el mismo ajuste no suma nada —los rangos son un conjunto final,
            // no una suma— y dejaría dos líneas iguales en la tira.
            return;
        }
        // Sobre algo que se acaba de guardar en Recursos y todavía no se recalculó, el
        // ajuste REEMPLAZA en memoria el conjunto de la base: el plan saldría sin lo
        // recién guardado. El panel ya deja el botón apagado con el motivo; esto es la
        // red por si llega igual.
        const tocados = new Set(objetivosDeAjuste(ajuste.accion));
        const pisa = guardadosSinRecalcular.find(g => objetivosDeAjuste(g.accion).some(o => tocados.has(o)));
        if (pisa) {
            toast.error(`Ya guardaste un cambio en ${pisa.accion.nombre}: recalculá primero`);
            return;
        }

        // Dos ajustes sobre la misma máquina CONVIVEN, no se pisan.
        //
        // Acá antes el segundo reemplazaba al primero. Se apoyaba en que el backend
        // armaba cada solución mirando los rangos ya ajustados, o sea que el segundo
        // traía adentro lo que había puesto el primero. Eso dejó de ser cierto cuando
        // las acciones pasaron a calcularse contra lo que dice Recursos —para que el
        // botón que guarda no escriba el rango temporal de un ajuste—: desde entonces
        // reemplazar borraba en silencio el primero, con los dos renglones en la tira.
        //
        // Ahora la identidad incluye los rangos propuestos (`claveDeAjuste`), así que
        // dos soluciones distintas sobre la misma fresadora son dos ajustes distintos,
        // y quien los junta es `payloadDeAjustes`, sumando los conjuntos. Lo único que
        // se corta es aplicar dos veces exactamente lo mismo, arriba.
        const conTexto: AjusteDelPlan = {
            ...ajuste,
            // El texto se rearma ACÁ aunque el panel mande el suyo, y no al revés.
            // Es la misma función para los dos, pero de este lado está el catálogo de
            // rangos: el panel sólo puede decir "al proceso X le cambio quién lo puede
            // hacer" y desde acá sale "al proceso X lo puede hacer OFICIAL CNC", que es
            // el dato que se necesita para decidir si ese ajuste se deshace o se deja.
            // El del panel queda de red por si la acción viene sin nada que traducir.
            descripcion: descripcionDeAccion(ajuste.accion, nombreDeRango) || ajuste.descripcion?.trim() || "",
            estado: "por-agregar",
        };
        setAjustesDelPlan([...ajustesDelPlan, conTexto]);
        toast.info("Marcado para el próximo recálculo", {
            description: `${conTexto.descripcion}. Solo para este plan, en Recursos no se guarda nada. Seguí revisando y recalculá una vez al terminar.`,
        });
    };

    /**
     * Deshace un ajuste, sin recalcular.
     *
     * Según dónde esté: el recién marcado se va (nunca entró al plan); el que ya está
     * en el plan queda «se saca al recalcular»; y el que se estaba sacando vuelve a
     * quedar («No, dejarlo»). Saca ESE y nada más: cada ajuste es independiente de los
     * otros desde que las acciones se calculan contra lo que dice Recursos, y
     * `payloadDeAjustes` los suma.
     */
    const quitarAjusteDelPlan = (clave: string) => {
        const a = ajustesDelPlan.find(x => x.clave === clave);
        if (!a) return;
        const estado = estadoDeAjuste(a);
        if (estado === "por-agregar") {
            setAjustesDelPlan(ajustesDelPlan.filter(x => x.clave !== clave));
            return;
        }
        setAjustesDelPlan(ajustesDelPlan.map(x => x.clave === clave
            ? { ...x, estado: estado === "por-quitar" ? "calculado" : "por-quitar" }
            : x));
    };

    /**
     * Los ajustes que quedan pisados cuando un cambio se guarda EN SERIO en Recursos.
     *
     * El caso: hay un ajuste sobre una fresadora y después, desde el mismo panel, se
     * usa «Guardar en Recursos» sobre esa misma fresadora. El ajuste tiene un conjunto
     * final armado antes de ese guardado, y como el conjunto REEMPLAZA (no suma), el
     * próximo recálculo lo mandaría y le pisaría a la máquina lo que se acaba de
     * dejar cargado — en silencio y con el ajuste diciendo que sólo vale para este
     * plan. Lo permanente manda: el recién marcado se va y el que ya estaba en el plan
     * queda «se saca al recalcular» (sigue en el plan de la pantalla hasta entonces).
     *
     * `accion` es opcional porque el panel puede no mandarla (versión anterior del
     * componente): sin ella no hay forma de saber qué se tocó.
     */
    const olvidarAjustesPisadosPor = (accion?: AccionDeSolucion) => {
        if (!accion) return;
        const tocados = new Set(objetivosDeAjuste(accion));
        const pisa = (a: AjusteDelPlan) =>
            estadoDeAjuste(a) !== "por-quitar" && objetivosDeAjuste(a.accion).some(o => tocados.has(o));
        const sacados = ajustesDelPlan.filter(pisa).length;
        if (sacados === 0) return;
        setAjustesDelPlan(ajustesDelPlan
            .filter(a => !(pisa(a) && estadoDeAjuste(a) === "por-agregar"))
            .map(a => pisa(a) ? { ...a, estado: "por-quitar" as const } : a));
        toast.info("Se da de baja el ajuste temporal", {
            description: `Lo acabás de dejar cargado en Recursos, así que ${sacados === 1 ? "el ajuste que tenías" : `los ${sacados} ajustes que tenías`} sobre eso ${sacados === 1 ? "sale" : "salen"} al recalcular: si ${sacados === 1 ? "se quedaba" : "se quedaban"}, el próximo cálculo te pisaba lo que guardaste.`,
        });
    };

    /** «Guardar en Recursos» del panel: anota el cambio para el próximo recálculo. */
    const anotarGuardado = (accion?: AccionDeSolucion, titulo?: string) => {
        olvidarAjustesPisadosPor(accion);
        if (!accion) return;
        idGuardado.current += 1;
        const nuevo: GuardadoSinRecalcular = {
            id: idGuardado.current,
            titulo: titulo ?? "",
            descripcion: descripcionDeAccion(accion, nombreDeRango),
            accion,
        };
        setGuardadosSinRecalcular(prev => [...prev, nuevo]);
    };

    /**
     * Los ajustes vigentes, en una línea, para contarlos en el aviso de guardado.
     *
     * Se cortan en tres: el diálogo es un párrafo, y diez renglones de fresadoras no
     * se leen — el que quiere el detalle lo tiene en la tira, que es donde están todos.
     */
    const resumenDeAjustes = React.useMemo(() => {
        // Los del plan que se va a guardar, no los recién marcados (ver `seguirGuardando`).
        const textos = ajustesDelPlanMostrado(ajustesDelPlan).map(a => a.descripcion?.trim()).filter(Boolean) as string[];
        if (textos.length === 0) return "";
        const muestra = textos.slice(0, 3).join("; ");
        const resto = textos.length - 3;
        return resto > 0 ? `${muestra}; y ${resto} más` : muestra;
    }, [ajustesDelPlan]);

    const handleAddSelectedAndRecalculate = () => {
        const wholeOts = Array.from(pendingAddIds);
        // OTs de las que se eligieron procesos SUELTOS (excluyendo las que ya van enteras).
        const procOrdenIds = Object.keys(pendingAddLineas)
            .map(Number)
            .filter(oid => !pendingAddIds.has(oid) && (pendingAddLineas[oid]?.size || 0) > 0);
        const extras = Array.from(new Set([...wholeOts, ...procOrdenIds]));
        if (extras.length === 0) {
            toast.error("No seleccionaste ninguna OT ni proceso para agregar.");
            return;
        }
        // lineas_por_orden solo para las OTs de las que se eligieron procesos sueltos.
        const lineasPorOrden: Record<number, number[]> = {};
        for (const oid of procOrdenIds) {
            lineasPorOrden[oid] = Array.from(pendingAddLineas[oid]);
        }
        // Limpiamos inmediatamente la selección y cerramos el popover ANTES de
        // disparar el recálculo, para que cuando vuelva a abrir esté vacío.
        setPendingAddIds(new Set());
        setPendingAddLineas({});
        setExpandedAddIds(new Set());
        setAddSearchTerm("");
        setAddPopoverOpen(false);
        // Queda anotado qué entró en esta tanda: es lo que después se pinta distinto
        // y lo que deshace el botón "Deshacer".
        setTandasManuales(prev => [...prev, { ots: wholeOts, lineas: lineasPorOrden }]);
        handleRecalculate(extras, Object.keys(lineasPorOrden).length > 0 ? lineasPorOrden : undefined);
    };

    /**
     * Vuelve atrás la última tanda agregada a mano.
     *
     * "Que puedas volver para atrás, para que si te equivocaste…" (Lucas, 28/08).
     * Saca del plan las OTs que entraron en esa tanda y recalcula con las que
     * quedan; lo que ya estaba antes no se toca. Se puede seguir apretando hasta
     * volver al plan que salió del cálculo original.
     */
    const deshacerTandas = (alcance: "ultima" | "todas" = "ultima") => {
        if (!onRecalculate || tandasManuales.length === 0) return;
        // "Todas" es el mismo camino con otro corte: en vez de la última tanda se
        // sacan todas, y no queda ninguna. Lucas pidió poder volver al plan original
        // sin tener que apretar Deshacer una vez por cada cosa que agregó.
        const aQuitar = alcance === "todas" ? tandasManuales : [tandasManuales[tandasManuales.length - 1]];
        const restantes = alcance === "todas" ? [] : tandasManuales.slice(0, -1);
        const quitar = otsDeTandas(aQuitar);

        const planned = Array.from(new Set(results.map(r => r.orden_id)));
        const stickyIds = Array.from(new Set(stickyExcedentes.map(e => e.orden_id)));
        const newForzar = Array.from(forzarOrdenIds).filter(id => !quitar.has(id));
        const mergedIds = Array.from(new Set([
            ...planned,
            ...(newForzar.length > 0 ? newForzar : stickyIds),
        ])).filter(id => !quitar.has(id));

        if (mergedIds.length === 0) {
            toast.error("Deshacer dejaría el plan vacío. Salí de la vista previa si querés descartarlo.");
            return;
        }

        setTandasManuales(restantes);
        setForzarOrdenIds(new Set(newForzar));
        setStickyExcedentes(prev => prev.filter(e => !quitar.has(e.orden_id)));

        const lineas = lineasDeTandas(restantes);
        const enPlan = new Set(mergedIds);
        const lineasFiltradas = Object.fromEntries(
            Object.entries(lineas).filter(([oid]) => enPlan.has(Number(oid)))
        ) as Record<number, number[]>;

        toast.info(`Deshecho: ${quitar.size} OT${quitar.size === 1 ? "" : "s"} fuera del plan`, {
            description: alcance === "todas"
                ? "Recalculando sin nada de lo que se agregó a mano."
                : "Recalculando sin lo último que se agregó a mano.",
        });
        onRecalculate(
            mergedIds,
            planningRange,
            newForzar,
            Object.keys(lineasFiltradas).length > 0 ? lineasFiltradas : undefined,
            ajustesParaEnviar(),
        );
    };

    /** Saca una OT del plan y recalcula (sin esa OT). Pensado para el botón "x"
     *  de cada fila en la tabla de resultados. */

    /**
     * Lo mismo, pero sobre la fila que estás mirando (Julián, 17/09).
     *
     * Acá se edita el renglón: el nombre, los minutos, el orden, y se agrega o se saca.
     * Se guarda en la OT y el plan NO se recalcula solo: ver el comentario largo en
     * `useProcesosEnPlan`.
     *
     * Había un botón más que abría la OT entera en un modal (EditarProcesosOTModal), y
     * se fue el 17/09/2026 con el archivo entero: *"ese botón ya no nos sirve, es lo
     * mismo de modificarla con todo lo que armamos"*. Hacía lo mismo que la fila pero
     * con un viaje de más, y encima su «Deshacer» iba contra versiones que los
     * endpoints de a una pasada no escriben — o sea que restauraba de más.
     */
    const procesosEnPlan = useProcesosEnPlan();
    // Suelta para el efecto que limpia las marcas: en el array de dependencias,
    // `procesosEnPlan.olvidarTodo` es una expresión y el linter de hooks la rechaza.
    const olvidarCambiosDeProcesos = procesosEnPlan.olvidarTodo;

    /**
     * El catálogo de procesos, para el desplegable de nombre.
     *
     * Se pide una sola vez y recién cuando alguien despliega una OT: la vista previa
     * trabaja con el plan ya resuelto y no lo necesita para mostrarse. Son ~400 filas
     * que la mayoría de las veces no hacen falta.
     */
    const [catalogoProcesos, setCatalogoProcesos] = React.useState<ProcesoDelCatalogo[]>([]);
    const pidiendoCatalogo = React.useRef(false);
    const pedirCatalogoProcesos = React.useCallback(async () => {
        if (pidiendoCatalogo.current || catalogoProcesos.length > 0) return;
        pidiendoCatalogo.current = true;
        try {
            const r = await fetch(`${API_URL.replace(/\/$/, "")}/procesos`, { headers: getAuthHeaders() });
            const json = await r.json();
            const lista = Array.isArray(json) ? json : (json?.data ?? []);
            setCatalogoProcesos(lista.map((p: any) => ({ id: p.id, nombre: p.nombre })));
        } catch {
            // Sin catálogo se puede todo lo demás —minutos, orden, sacar un paso—; lo
            // único que no se puede es cambiar un paso por otro proceso.
        } finally {
            pidiendoCatalogo.current = false;
        }
    }, [catalogoProcesos.length]);

    /**
     * La X de la fila saca una OT del plan, y hasta el 17/09/2026 lo hacía de una.
     *
     * Es el botón más caro de la pantalla —se lleva la OT y dispara un recálculo de
     * varios minutos— y está a un click del que despliega la fila. Julián: *"si toco
     * la X para eliminar una OT quiero que me aparezca un cartel de si estoy seguro y
     * la posibilidad de deshacerlo"*. Las dos cosas: se pregunta antes, y después queda
     * un «Deshacer» en el aviso por si igual no era ésa.
     */
    const [quitandoOT, setQuitandoOT] = React.useState<{ id: number; numero: string } | null>(null);

    const handleRemoveOrderAndRecalculate = (ordenId: number) => {
        if (!onRecalculate) {
            toast.error("Eliminar no está disponible en este contexto.");
            return;
        }
        // Todo lo que hay que poder devolver si se arrepiente. Se saca ANTES de tocar
        // nada: después de los setState de abajo ya no se puede reconstruir.
        const antesDeQuitar = {
            forzar: Array.from(forzarOrdenIds),
            sticky: stickyExcedentes,
            tandas: tandasManuales,
        };
        const numeroVisible = String(
            results.find(r => r.orden_id === ordenId)?.id_otvieja ?? ordenId);

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
            toast.error("No podés quitar la última OT del plan. Salí de la vista previa con «Salir».");
            return;
        }
        // Si la OT había entrado a mano, deja de estar agregada: sale del registro
        // (y con ella sus pasadas sueltas, que ya no restringen nada).
        const restantes = tandasSinOTs(tandasManuales, new Set([ordenId]));
        setTandasManuales(restantes);
        const lineas = lineasDeTandas(restantes);
        const enPlan = new Set(mergedIds);
        const lineasFiltradas = Object.fromEntries(
            Object.entries(lineas).filter(([oid]) => enPlan.has(Number(oid)))
        ) as Record<number, number[]>;
        onRecalculate(
            mergedIds,
            planningRange,
            newForzar,
            Object.keys(lineasFiltradas).length > 0 ? lineasFiltradas : undefined,
            ajustesParaEnviar(),
        );

        // Deshacer: vuelve el plan al lote de antes y recalcula. No es "cancelar" —el
        // recálculo ya salió—, es volver a pedirlo con la OT adentro; por eso el aviso
        // dura más de lo normal, que es lo que tarda alguien en darse cuenta de que no
        // era ésa.
        const idsConLaOT = Array.from(new Set([...mergedIds, ordenId]));
        toast.success(`La OT #${numeroVisible} salió del plan`, {
            duration: 12000,
            description: "Se está recalculando sin ella. La orden no se tocó: sigue disponible para planificar.",
            action: {
                label: "Deshacer",
                onClick: () => {
                    setForzarOrdenIds(new Set(antesDeQuitar.forzar));
                    setStickyExcedentes(antesDeQuitar.sticky);
                    setTandasManuales(antesDeQuitar.tandas);
                    toast.info(`Vuelve la OT #${numeroVisible} al plan`, { description: "Recalculando…" });
                    onRecalculate(
                        idsConLaOT,
                        planningRange,
                        antesDeQuitar.forzar,
                        lineasParaEnviar(idsConLaOT),
                        ajustesParaEnviar(),
                    );
                },
            },
        });
    };

    /**
     * Saca UNA pasada suelta agregada a mano y recalcula.
     *
     * Es el caso de la reunión: "se había seleccionado una fresadora de otra OT por
     * error". Sin esto la única salida era tirar la OT entera y volver a elegir sus
     * procesos uno por uno. Si era la última pasada de esa OT, la OT se va con ella.
     */
    const quitarLineaAMano = (ordenId: number, lineaId: number) => {
        if (!onRecalculate) {
            toast.error("Quitar no está disponible en este contexto.");
            return;
        }
        const restantes = tandasManuales
            .map(t => ({
                ots: t.ots,
                lineas: Object.fromEntries(
                    Object.entries(t.lineas)
                        .map(([oid, ids]) => [
                            oid,
                            Number(oid) === ordenId ? ids.filter(id => id !== lineaId) : ids,
                        ])
                        .filter(([, ids]) => (ids as number[]).length > 0)
                ) as Record<number, number[]>,
            }))
            .filter(t => t.ots.length > 0 || Object.keys(t.lineas).length > 0);

        const lineas = lineasDeTandas(restantes);
        const seQuedaSinProcesos = !lineas[ordenId];

        const planned = Array.from(new Set(results.map(r => r.orden_id)))
            .filter(id => !(seQuedaSinProcesos && id === ordenId));
        const newForzar = Array.from(forzarOrdenIds).filter(id => !(seQuedaSinProcesos && id === ordenId));
        const stickyIds = Array.from(new Set(stickyExcedentes.map(e => e.orden_id)))
            .filter(id => !(seQuedaSinProcesos && id === ordenId));
        const mergedIds = Array.from(new Set([
            ...planned,
            ...(newForzar.length > 0 ? newForzar : stickyIds),
        ]));

        if (mergedIds.length === 0) {
            toast.error("Era el último proceso del plan. Salí de la vista previa si querés descartarlo.");
            return;
        }

        setTandasManuales(restantes);
        setForzarOrdenIds(new Set(newForzar));
        if (seQuedaSinProcesos) setStickyExcedentes(prev => prev.filter(e => e.orden_id !== ordenId));

        const enPlan = new Set(mergedIds);
        const lineasFiltradas = Object.fromEntries(
            Object.entries(lineas).filter(([oid]) => enPlan.has(Number(oid)))
        ) as Record<number, number[]>;
        onRecalculate(
            mergedIds,
            planningRange,
            newForzar,
            Object.keys(lineasFiltradas).length > 0 ? lineasFiltradas : undefined,
            ajustesParaEnviar(),
        );
    };

    const toggleRow = (ordenId: number) => {
        setExpandedOrderIds(prev => {
            const abriendo = !prev.includes(ordenId);
            // Los desplegables de proceso de adentro lo necesitan cargado. Se pide una
            // sola vez en toda la pantalla, y sólo si alguien abre una OT.
            if (abriendo) void pedirCatalogoProcesos();
            return abriendo ? [...prev, ordenId] : prev.filter(id => id !== ordenId);
        });
    };

    /**
     * La clave de cada fila del plan, ya desempatada.
     *
     * `claveBase` alcanza para casi todo, pero no para los operarios adicionales:
     * un proceso de dos personas devuelve DOS filas con la misma OT, el mismo
     * proceso y la misma secuencia, porque son dos personas en el mismo trabajo.
     * Compartiendo clave, elegirle la persona a una se la ponía también a la otra
     * y el segundo desplegable se movía solo. Se numeran por aparición.
     */
    const clavesPorFila = React.useMemo(() => {
        const mapa = new Map<PlanificacionResult, string>();
        const vistas = new Map<string, number>();
        for (const item of [...results, ...excedentes]) {
            const base = claveBase(item);
            const n = vistas.get(base) ?? 0;
            vistas.set(base, n + 1);
            mapa.set(item, n === 0 ? base : `${base}#${n}`);
        }
        return mapa;
    }, [results, excedentes]);

    const claveDeEdicion = (item: PlanificacionResult) => clavesPorFila.get(item) ?? claveBase(item);

    const getEffectiveItem = (item: PlanificacionResult) => {
        // El fallback a la clave vieja es por los borradores guardados antes de que
        // la clave llevara la secuencia: sin esto, retomar uno de esos perdía todos
        // los retoques a mano. En una OT con el proceso repetido el borrador viejo
        // no distinguía las pasadas, así que ahí devuelve lo que ya devolvía antes.
        return editedResults[claveDeEdicion(item)] || editedResults[claveVieja(item)] || item;
    };

    const handleUpdate = (item: PlanificacionResult, field: keyof PlanificacionResult, value: any) => {
        const currentEffective = getEffectiveItem(item);
        const updated = { ...currentEffective, [field]: value };
        setEditedResults(prev => {
            const next = { ...prev, [claveDeEdicion(item)]: updated };
            // Si el retoque venía de un borrador viejo, la clave vieja tiene que
            // irse: si no, queda tapando a la nueva en el `||` de arriba.
            delete next[claveVieja(item)];
            return next;
        });
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
            // Un "YYYY-MM-DD" pelado (el tope del rango) se lee LOCAL: `new Date` lo
            // toma como medianoche UTC, que acá es el día anterior a las 21, y el
            // «tope 6/10» salía «tope 05/10».
            const soloDia = /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
            const date = soloDia ? fechaLocal(dateStr) : new Date(dateStr);
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

    /**
     * Qué se agregó a mano, en una lista que se puede leer.
     *
     * Lucas, 28/08, después de agregar seis cosas seguidas: *"ya no sé qué pusimos…
     * ni me acuerdo qué agregué"*. El violeta te dice cuál es a mano cuando lo tenés
     * delante, pero no te deja repasar el conjunto sin recorrer la tabla entera.
     *
     * De la más nueva a la más vieja, que es el orden en el que uno se acuerda. Una OT
     * "entera" no tiene pasadas elegidas; si las tiene, se listan sólo esas.
     */
    const detalleAMano = React.useMemo(() => {
        const salida: {
            ordenId: number; numeroOT: number; cliente: string;
            entera: boolean; minutos: number;
            filas: { lineaId: number | null; proceso: string; persona: string; minutos: number }[];
        }[] = [];
        const vistas = new Set<number>();
        for (const t of [...tandasManuales].reverse()) {
            for (const ordenId of [...t.ots, ...Object.keys(t.lineas).map(Number)]) {
                if (vistas.has(ordenId)) continue;
                vistas.add(ordenId);
                const delPlan = groupedResults[ordenId] || [];
                const deLaLista = unplannedOrders.find(o => o.id === ordenId) as any;
                const elegidas = lineasVigentes[ordenId] || [];
                const filas = (elegidas.length > 0
                    ? delPlan.filter(r => r.id_orden_trabajo_proceso != null
                        && elegidas.includes(r.id_orden_trabajo_proceso))
                    : delPlan
                ).map(r => {
                    const efectivo = getEffectiveItem(r);
                    return {
                        lineaId: r.id_orden_trabajo_proceso ?? null,
                        proceso: r.nombre_proceso,
                        persona: efectivo.operario_nombre || "Sin asignar",
                        minutos: r.duracion_min || 0,
                    };
                });
                salida.push({
                    ordenId,
                    // Si la OT quedó afuera del plan no está en `groupedResults`, así que
                    // el número visible y el cliente salen de la lista de OT de la
                    // pantalla. Sin esto se dibujaba el id interno de la base, que no
                    // figura en ningún papel del taller — y la misma OT aparecía con dos
                    // números distintos entre este popover y el panel de excedentes.
                    numeroOT: delPlan[0]?.id_otvieja ?? deLaLista?.id_otvieja ?? ordenId,
                    cliente: delPlan[0]?.cliente
                        || (typeof deLaLista?.cliente === "object" ? deLaLista?.cliente?.nombre : deLaLista?.cliente)
                        || "",
                    entera: elegidas.length === 0,
                    minutos: filas.reduce((s, f) => s + f.minutos, 0),
                    filas,
                });
            }
        }
        return salida;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tandasManuales, groupedResults, lineasVigentes, editedResults, unplannedOrders]);

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
    }, [results, displayedExcedentes]);

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

    // Bloqueo de cierre por click afuera / Escape: el modal solo se cierra con
    // «Salir» o el botón "Volver". Esto evita perder los ajustes por error.
    const handleOpenChange = (open: boolean) => {
        // No cerramos automáticamente; el cierre lo controlan los botones explícitos.
        if (!open) return;
    };

    /**
     * Los avisos que alguien dio por resueltos a mano en el panel.
     *
     * Vive acá y no adentro del panel porque la cifra "Trabas sin resolver" del
     * encabezado tiene que contar lo mismo que se ve abajo: marcar cinco y seguir
     * viendo "5 trabas sin resolver" arriba es peor que no poder marcarlas.
     */
    const [avisosMarcados, setAvisosMarcados] = React.useState<Set<string>>(new Set());

    /** Lo rojo del plan: lo que quedó sin resolver y hay que ir a arreglar. */
    const trabasSinResolver = React.useMemo(
        () => diagnosticos.filter(d => d.severidad === "bloqueante" && !avisosMarcados.has(d.id)).length,
        [diagnosticos, avisosMarcados]
    );

    // Cantidad de OTs distintas en el plan actual (no procesos), útil para mostrar al usuario.
    const uniqueOrdersInPlan = React.useMemo(
        () => new Set(results.map(r => r.orden_id)).size,
        [results]
    );

    /**
     * Los días de la semana en que trabaja alguien del taller, según el `dias_trabajo`
     * de cada operario. Es lo que hace que un día sea hábil: hoy nadie trabaja los
     * sábados, así que un sábado en el medio del plan no es un día de trabajo.
     */
    const diasDelTaller = React.useMemo(() => diasQueTrabajaElTaller(availableOperators), [availableOperators]);

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
        // Días hábiles entre ambas puntas, las dos incluidas: los días en que trabaja
        // alguien, sin feriados. Hasta el 23/9 sólo se sacaban los domingos «porque el
        // sábado puede trabajarse»: el plan de Lucas del jue 24/9 al mar 6/10 decía 11
        // días hábiles y eran 9, porque nadie tiene el sábado cargado.
        const habiles = contarDiasHabiles(desde, hasta, feriados, diasDelTaller);
        return { desde, hasta, habiles };
    }, [results, feriados, diasDelTaller]);

    /**
     * De dónde sale el período del riel, dicho en palabras.
     *
     * El riel decía «28/09 → 26/10 · 21 días hábiles» y se leía como el rango
     * elegido. No lo era: Julián quería ver sólo la semana del piloto y no sabía de
     * dónde salía el 26/10 (25/9). El 26/10 es donde termina el último proceso de
     * todo lo tildado, porque sin fecha «hasta» el plan no tiene tope; y el 28/9 no
     * lo eligió nadie: el plan arranca al día hábil siguiente si la jornada ya había
     * empezado (`inicio_del_plan` en el backend). La etiqueta va corta porque la
     * celda trunca; la explicación larga va en el Popover.
     */
    const periodoDelPlan = React.useMemo(() => {
        if (!spanPlan) return null;
        const claveDia = (d: Date) =>
            `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        // «lun 26/10»: el día de la semana sólo donde hay lugar.
        const conDia = (iso: string) => {
            const dia = fechaLocal(iso).toLocaleDateString("es-AR", { weekday: "short" }).replace(".", "");
            return `${dia} ${formatDate(iso.slice(0, 10))}`;
        };
        const tope = planningRange.fecha_hasta?.slice(0, 10) || null;
        const fin = spanPlan.hasta.slice(0, 10);
        const dias = `${spanPlan.habiles} ${spanPlan.habiles === 1 ? "día hábil" : "días hábiles"}`;
        const forzadas = forzarOrdenIds.size;

        let etiqueta: string;
        let pasado = false;
        let comoTermina: string;
        if (!tope) {
            etiqueta = `Termina el ${conDia(fin)} · ${dias} · sin fecha tope`;
            comoTermina = `Termina el ${conDia(fin)}, cuando termina el último proceso de lo que tildaste. Sin fecha «hasta», el plan dura lo que tarda todo lo tildado; para ver solo una semana, tocá «Cambiar» y elegí las fechas.`;
        } else if (fin === tope) {
            etiqueta = `Elegiste hasta el ${formatDate(tope)} · ${dias}`;
            comoTermina = `Elegiste hasta el ${formatDate(tope)} en el Paso 1. Lo que no entra hasta ese día queda en «Fuera del plan».`;
        } else if (fin < tope) {
            etiqueta = `Termina el ${formatDate(fin)} · elegiste hasta el ${formatDate(tope)}`;
            comoTermina = `Elegiste hasta el ${formatDate(tope)}, pero todo lo tildado termina antes: el ${conDia(fin)}.`;
        } else {
            pasado = true;
            etiqueta = forzadas > 0
                ? `Se pasó del ${formatDate(tope)}: forzaste ${forzadas} OT`
                : `Se pasó del ${formatDate(tope)} · termina el ${formatDate(fin)}`;
            comoTermina = forzadas > 0
                ? `Elegiste hasta el ${formatDate(tope)}, pero forzaste ${forzadas} OT. Con una sola forzada el plan se recalcula entero sin fecha tope, así que termina el ${conDia(fin)}.`
                : `Elegiste hasta el ${formatDate(tope)}, pero el plan termina el ${conDia(fin)}.`;
        }

        // Cómo arranca. `inicioBase` es el T=0 que usó el backend; el motivo sólo se
        // dice en el caso que se puede afirmar: se calculó un día de trabajo con la
        // jornada ya empezada. (Un borrador trae la hora en que se guardó, no la del
        // cálculo, y esa hora puede ser un sábado: ahí no se inventa el porqué.)
        let comoArranca: string | null = null;
        const inicio = inicioBase ? new Date(inicioBase) : new Date(spanPlan.desde);
        if (!isNaN(inicio.getTime())) {
            const hora = `${String(inicio.getHours()).padStart(2, "0")}:${String(inicio.getMinutes()).padStart(2, "0")}`;
            const diaInicio = claveDia(inicio);
            let porque = "";
            const calc = calculadoEn ? new Date(calculadoEn) : null;
            const desdeElegido = planningRange.fecha_desde?.slice(0, 10);
            if (inicioBase && calc && !isNaN(calc.getTime())) {
                const diaCalc = claveDia(calc);
                const laborable = calc.getDay() !== 0 && calc.getDay() !== 6 && !feriados.includes(diaCalc);
                if (desdeElegido && desdeElegido > diaCalc && desdeElegido === diaInicio) {
                    porque = " porque elegiste arrancar ese día";
                } else if (diaInicio > diaCalc && laborable && calc.getHours() >= HORA_APERTURA) {
                    const cuando = diaCalc === claveDia(new Date()) ? "hoy" : `el ${conDia(diaCalc)}, cuando lo calculaste,`;
                    porque = ` porque ${cuando} la jornada ya había empezado`;
                }
            }
            comoArranca = `Arranca el ${conDia(diaInicio)} a las ${hora}${porque}.`;
        }

        return { etiqueta, pasado, comoTermina, comoArranca };
    }, [spanPlan, planningRange.fecha_desde, planningRange.fecha_hasta, forzarOrdenIds.size, inicioBase, calculadoEn, feriados]);

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
        const ids = buildOrdenIdsForRecalc(forcedArr);
        onRecalculate(
            ids,
            { fecha_desde: planningRange.fecha_desde, fecha_hasta: sumarDias(base, 14) },
            forcedArr,
            lineasParaEnviar(ids),
            ajustesParaEnviar(),
        );
    };

    /**
     * Cambiar el período desde la cabecera (Julián, 25/9: que las fechas «estén arriba
     * en el planificador»). Abre el mismo selector del Paso 1 y, al confirmar, recalcula
     * con el rango nuevo: es un recálculo pedido a propósito, como «Ampliar rango», con
     * las mismas OT, las mismas forzadas y los mismos ajustes.
     */
    const [selectorFechasAbierto, setSelectorFechasAbierto] = React.useState(false);
    const fechasDelPlanActual: FechasDelPlan = planningRange.fecha_hasta
        ? { desde: planningRange.fecha_desde?.slice(0, 10), hasta: planningRange.fecha_hasta.slice(0, 10) }
        : { desde: planningRange.fecha_desde?.slice(0, 10), atajo: "sin-tope" };
    const recalcularConFechas = (f: FechasDelPlan) => {
        if (!onRecalculate) return;
        const forcedArr = Array.from(forzarOrdenIds);
        const ids = buildOrdenIdsForRecalc(forcedArr);
        onRecalculate(
            ids,
            rangoParaElPlan(f, inicioDelPlan(new Date(), feriados)),
            forcedArr,
            lineasParaEnviar(ids),
            ajustesParaEnviar(),
        );
    };
    /** Las OT que entrarían en el recálculo, con su prometida (para el atajo del selector). */
    const prometidasDelPlan = (ids: number[]) => ids.map(id => {
        const ot = unplannedOrders.find(o => o.id === id);
        const fila = ot ? undefined : results.find(r => r.orden_id === id);
        return {
            numero: String(ot?.id_otvieja ?? fila?.id_otvieja ?? id),
            fecha: ot?.fecha_prometida ?? fila?.fecha_prometida ?? null,
        };
    });

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
     * Al volver a esta pantalla se compara la huella de los datos de Recursos
     * contra la que tenía el plan cuando se calculó (`lib/huellaRecursos`, tres GET
     * chicos). Si no cambió nada, no se molesta a nadie. Si cambió, queda anotado
     * como un cambio pendiente más, y se recalcula cuando se termina de revisar.
     *
     * Hasta el 25/09/2026 acá se recalculaba solo, y era la mitad de la queja de
     * Julián (*"cada vez que hago un cambio de alguna traba se replanifica todo"*):
     * cada ida y vuelta a Recursos —o a «Ver cómo quedó ↗», que abre otra pestaña—
     * eran 4 minutos de pantalla tapada. Y la huella mira a TODO el taller: un cambio
     * de otra persona en Recursos recalculaba la vista previa abierta de uno. Ahora
     * nunca recalcula solo.
     */
    const [revisionAuto, setRevisionAuto] = React.useState<
        "mirando" | "cambios-en-recursos" | "no-disponible" | null
    >(null);
    const revisionEnCurso = React.useRef(false);

    // Cada plan nuevo (o recalculado) limpia el estado del cartel: la foto que se
    // está mirando pasó a ser la de recién.
    //
    // Con las marcas de procesos editados pasa lo mismo, y por eso se limpian acá: el
    // cálculo que acaba de volver ya salió con los minutos, el orden y los pasos nuevos
    // de la OT, así que no hay nada viejo que marcar.
    //
    // Y lo marcado para el recálculo que acaba de volver pasa a «calculado»: sólo si
    // ESTA pantalla mandó algo (`enviadosRef`), porque abrir un borrador también cambia
    // `calculadoEn` y lo que quedó marcado en él sigue sin estar en el plan.
    React.useEffect(() => {
        setRevisionAuto(null);
        olvidarCambiosDeProcesos();
        const enviados = enviadosRef.current;
        if (!enviados) return;
        enviadosRef.current = null;
        // Sólo lo que estaba así AL MANDAR: lo que se hubiera marcado después sigue
        // pendiente, porque este plan no lo tiene.
        setAjustesDelPlan(prev => prev
            .filter(a => !(estadoDeAjuste(a) === "por-quitar" && enviados.sacados.has(a.clave)))
            .map(a => estadoDeAjuste(a) === "por-agregar" && enviados.agregados.has(a.clave) ? { ...a, estado: "calculado" } : a));
        setGuardadosSinRecalcular(prev => prev.filter(g => !enviados.guardados.has(g.id)));
    }, [calculadoEn, olvidarCambiosDeProcesos]);

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
        // Si ya estaba anotado, se queda anotado mientras mira: si no, el contador del
        // pie bajaba y subía de nuevo cada vez que se volvía a la pestaña.
        setRevisionAuto(prev => prev === "cambios-en-recursos" ? prev : "mirando");
        const ahora = await huellaRecursos();
        revisionEnCurso.current = false;

        if (ahora === null) { setRevisionAuto("no-disponible"); return; }
        if (ahora === huellaAlCalcular) { setRevisionAuto(null); return; }

        // Nunca recalcula solo: queda como un pendiente más, en la franja y en el pie.
        setRevisionAuto("cambios-en-recursos");
    };

    /**
     * La función se guarda en una ref y el efecto depende SOLO de `isOpen`.
     *
     * Si el efecto dependiera de la función, se volvería a montar con cada retoque
     * a mano (cada cambio de `editedResults` la recrea) y volvería a consultar
     * Recursos: tres GET por cada desplegable que alguien toca. La ref además evita
     * lo contrario —quedarse con una versión vieja de la huella o de los avisos—, porque
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

    /**
     * La hoja del pañol: el plan en papel, día por día.
     *
     * Pedido de la reunión del 10/09. Mientras no esté decidido cómo se finaliza una
     * OT —programada → en proceso → controlado → cerrada—, lo que el pañol necesita
     * para trabajar es más simple: saber qué se va a hacer mañana para tener el
     * material y las herramientas listas cuando el operario llegue a buscarlos.
     *
     * POR DÍA Y NO POR OT, que es lo que la diferencia de la hoja que ya existe.
     *
     * La hoja de la OT (el botón Imprimir del modal) sirve para seguir UNA orden de
     * principio a fin: la lleva el que la fabrica. El pañol trabaja al revés — no le
     * importa la orden, le importa el día: «el martes salen estas ocho cosas, y para
     * eso tengo que tener esto preparado». Imprimir el plan agrupado por OT lo
     * obligaría a leer veinte hojas y armar el martes a mano.
     *
     * Va del plan que está EN PANTALLA, con los retoques hechos a mano incluidos, no
     * del que está guardado: es la misma regla que el botón de guardar.
     */
    const imprimirParaPanol = () => {
        const esc = (v: unknown) => String(v ?? "")
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Una fila por proceso, con los retoques de la persona ya aplicados.
        const filas = results.map(r => getEffectiveItem(r));

        // Agrupar por día. Sin fecha van al final: son las que el plan no ubicó.
        const porDia = new Map<string, any[]>();
        for (const f of filas) {
            const dia = (f.fecha_inicio_estimada || "").slice(0, 10) || "sin-fecha";
            if (!porDia.has(dia)) porDia.set(dia, []);
            porDia.get(dia)!.push(f);
        }
        const dias = [...porDia.keys()].sort((a, b) =>
            a === "sin-fecha" ? 1 : b === "sin-fecha" ? -1 : a.localeCompare(b));

        const nombreDia = (iso: string) => {
            if (iso === "sin-fecha") return "Sin fecha asignada";
            // Se parte a mano en vez de `new Date(iso)`: con una fecha sola el
            // navegador la lee como UTC y en Argentina muestra el día anterior.
            const [a, m, d] = iso.split("-").map(Number);
            const f = new Date(a, m - 1, d);
            const texto = f.toLocaleDateString("es-AR",
                { weekday: "long", day: "numeric", month: "long" });
            return texto.charAt(0).toUpperCase() + texto.slice(1);
        };

        const hhmm = (iso?: string) => (iso && iso.includes("T")) ? iso.slice(11, 16) : "";

        const bloques = dias.map(dia => {
            const delDia = porDia.get(dia)!.sort((x, y) =>
                (x.fecha_inicio_estimada || "").localeCompare(y.fecha_inicio_estimada || ""));
            const minutos = delDia.reduce((t, f) => t + (f.duracion_min || 0), 0);
            const ots = new Set(delDia.map(f => f.orden_id)).size;

            const filasHtml = delDia.map(f => `<tr>
  <td class="c">${esc(hhmm(f.fecha_inicio_estimada))}</td>
  <td class="c"><b>${esc(f.id_otvieja ?? f.orden_id)}</b></td>
  <td>${esc((f.cliente || "").slice(0, 26))}</td>
  <td>${esc(f.nombre_proceso)}</td>
  <td>${f.maquinaria_nombre ? esc(f.maquinaria_nombre) : '<span class="gris">a mano</span>'}</td>
  <td>${f.operario_nombre ? esc(f.operario_nombre) : '<span class="gris">sin asignar</span>'}</td>
  <td class="c">${esc(f.duracion_min || 0)}</td>
  <td class="fill c"></td>
</tr>`).join("");

            return `<div class="dia">
  <h2>${esc(nombreDia(dia))}
    <span class="resumen">${ots} ${ots === 1 ? "orden" : "órdenes"} · ${delDia.length} trabajos · ${Math.round(minutos / 60)} h</span>
  </h2>
  <table><thead><tr>
    <th class="c">Hora</th><th class="c">OT</th><th>Cliente</th><th>Trabajo</th>
    <th>Recurso maquinaria</th><th>Recurso humano</th><th class="c">Min.</th><th class="c">Preparado</th>
  </tr></thead><tbody>${filasHtml}</tbody></table>
</div>`;
        }).join("");

        const hoy = new Date().toLocaleDateString("es-AR");
        const logoUrl = `${window.location.origin}/longchamps_logo.png`;
        const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Plan para el pañol</title>
<style>
*{box-sizing:border-box}
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;color:#111}
.page{padding:10mm 11mm}
.head{display:flex;align-items:center;gap:14px;border-bottom:2px solid #1e3a5f;padding-bottom:8px;margin-bottom:14px}
.logo{height:34px;object-fit:contain}
.marca{width:34px;height:34px;border:2px solid #DC143C;border-radius:6px;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#DC143C}
.head-c{flex:1}
.empresa{font-weight:bold;font-size:13px}
.doc{font-size:16px;font-weight:bold;color:#1e3a5f}
.head-r{text-align:right;font-size:10px;color:#666}
.dia{margin-bottom:18px;break-inside:avoid}
h2{font-size:13px;color:#1e3a5f;margin:0 0 5px;border-bottom:1px solid #cbd5e1;padding-bottom:3px;
   display:flex;justify-content:space-between;align-items:baseline}
.resumen{font-size:9.5px;color:#666;font-weight:normal}
table{width:100%;border-collapse:collapse;font-size:10.5px}
th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#1e3a5f;color:#fff;text-transform:uppercase;font-size:8px;letter-spacing:.4px}
td.c,th.c{text-align:center}
td.fill{height:20px;background:#fff;width:66px}
.gris{color:#999}
.pie{margin-top:10px;font-size:9px;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:5px}
@media print{
  .page{padding:8mm 9mm}
  th{-webkit-print-color-adjust:exact;print-color-adjust:exact}
}
</style></head><body><div class="page">
<div class="head">
  <img class="logo" src="${logoUrl}" alt="Metalúrgica Longchamps"
       onerror="this.outerHTML='<div class=\\'marca\\'>ML</div>'">
  <div class="head-c"><div class="empresa">Metalúrgica Longchamps</div>
    <div class="doc">Plan de trabajo — para el pañol</div></div>
  <div class="head-r"><div>Impreso ${esc(hoy)}</div>
    <div>${esc(filas.length)} trabajos · ${esc(dias.filter(d => d !== "sin-fecha").length)} días</div></div>
</div>
${bloques || '<p class="gris">El plan no tiene trabajos.</p>'}
<div class="pie">Tildá «Preparado» cuando el material y las herramientas del trabajo estén listos · Metalúrgica Longchamps</div>
</div></body></html>`;

        const w = window.open("", "_blank", "width=1000,height=760");
        if (!w) {
            toast.error("Habilitá las ventanas emergentes para poder imprimir el plan.");
            return;
        }
        w.document.write(html);
        w.document.close();
        w.focus();
        setTimeout(() => w.print(), 250);
    };

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
            if (filtros.atrasadas && !efectivos.some(i => diasDeAtraso(i.fecha_fin_estimada, i.fecha_prometida) > 0)) continue;
            // Un tercerizado sin operario no es un hueco: lo hace un tercero.
            if (filtros.sinOperario && !efectivos.some(i => !i.id_operario && !i.tercerizado)) continue;
            // Idem un proceso manual sin máquina: no la necesita.
            if (filtros.sinMaquina && !efectivos.some(i => !i.id_maquinaria && i.usa_maquina !== false && !i.tercerizado)) continue;

            salida[oid] = items;
        }
        return salida;
    }, [groupedResults, filtroTexto, filtros, filtrosActivos, forzarOrdenIds, editedResults]);

    /**
     * Las OT de la tabla (y del exportado) en el orden en que se trabajan: primero la
     * que arranca antes; si dos arrancan a la misma hora, la que termina antes; y si
     * también empatan, por número de OT. Julián, 25/09/2026: «la vista de las OT las
     * quiero en orden desde la primera que se arranca hasta la última que se termina».
     *
     * Antes salían en el orden del id interno de la OT, sin que nadie lo eligiera:
     * `Object.entries` de un mapa con claves numéricas las devuelve ordenadas así.
     * `groupedResults` sigue siendo un mapa (lo usan otros para buscar por OT); el
     * orden se arma acá, aparte. Cuentan las fechas efectivas, con los retoques a mano,
     * que son las que se ven en la fila. Una OT sin fechas va al final.
     */
    const otsEnOrden = React.useMemo(() => {
        const aMs = (valor?: string) => {
            const t = valor ? new Date(valor).getTime() : NaN;
            return isNaN(t) ? null : t;
        };
        const filas = Object.entries(gruposFiltrados).map(([oidStr, items]) => {
            const ordenId = Number(oidStr);
            let inicio = Infinity;
            let fin = -Infinity;
            for (const item of items) {
                const efectivo = getEffectiveItem(item);
                const a = aMs(efectivo.fecha_inicio_estimada);
                const b = aMs(efectivo.fecha_fin_estimada);
                if (a !== null && a < inicio) inicio = a;
                if (b !== null && b > fin) fin = b;
            }
            return {
                ordenId,
                items,
                inicio,
                fin: fin === -Infinity ? Infinity : fin,
                numero: items[0]?.id_otvieja ?? ordenId,
            };
        });
        // Infinity − Infinity da NaN, que es falsy: dos OT sin fechas pasan al desempate
        // siguiente en vez de quedar en cualquier orden.
        filas.sort((x, y) => (x.inicio - y.inicio) || (x.fin - y.fin) || (x.numero - y.numero));
        return filas;
    }, [gruposFiltrados, editedResults, clavesPorFila]);

    const otsFiltradas = Object.keys(gruposFiltrados).length;
    const procesosFiltrados = Object.values(gruposFiltrados).reduce((a, xs) => a + xs.length, 0);

    // ---------- Ir del aviso a la OT ----------

    /** OT a la que se acaba de saltar, resaltada un rato para no perderla de vista. */
    const [otResaltada, setOtResaltada] = React.useState<number | null>(null);
    const resaltadoRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => () => { if (resaltadoRef.current) clearTimeout(resaltadoRef.current); }, []);

    /** El #OT que se ve en la tabla (el del sistema viejo si lo tiene), a partir del
     *  `orden_id` interno. Lo usa el cartel de procesos cambiados, que habla en ids
     *  internos. Los avisos NO: esos ya traen el número visible (ver abajo). */
    const numeroDeOT = React.useCallback((ordenId: number) => {
        const fila = results.find(r => r.orden_id === ordenId)
            ?? stickyExcedentes.find(r => r.orden_id === ordenId);
        return String(fila?.id_otvieja || ordenId);
    }, [results, stickyExcedentes]);

    /**
     * Del número que el taller conoce al `orden_id` interno de la tabla.
     *
     * Los avisos traen en `impacto.ots` el número VISIBLE —`id_otvieja`, o el `id`
     * si la OT nació en SPMM— desde el 15/8 (PlanificacionService, `nro_visible`; lo
     * fija backend/tests/test_planner_pausas.py). La tabla está armada por
     * `orden_id`. Hasta el 25/9 el chip mandaba el 15717 a buscar una fila 15717, que
     * no existe (esa OT es la 7495 por dentro): salía «no está en la tabla del plan»
     * para TODAS las OT, porque desde el 15/9 hasta las creadas en SPMM tienen su
     * `id_otvieja`.
     *
     * Misma regla que el backend, invertida, y SIN respaldo a «usar el número tal
     * cual»: si no está acá, la OT no está en este plan, y un respaldo sólo podría
     * llevar a OTRA OT cuyo id interno coincidiera de casualidad. Caso raro que cae
     * en el cartel: una fila sin `id_otvieja` porque la OT la cargó otra persona
     * después de abrir la pantalla.
     */
    const ordenIdPorNumeroVisible = React.useMemo(() => {
        const m = new Map<number, number>();
        for (const r of [...results, ...stickyExcedentes]) {
            const visible = Number(r.id_otvieja || r.orden_id);
            if (!m.has(visible)) m.set(visible, r.orden_id);
        }
        return m;
    }, [results, stickyExcedentes]);

    /**
     * Lo que se marcó y el plan de la pantalla todavía no tiene: la cola que se
     * recalcula de una vez con el botón del pie (25/09/2026).
     *
     * Un cambio en Recursos detectado al volver a la pestaña cuenta uno solo y sólo
     * si no hay guardados desde el panel: esos también cambian la huella, y contarlos
     * dos veces sería decir que hay más cambios de los que hubo.
     */
    const pendientes = React.useMemo(() => {
        const lista: { clave: string; texto: string }[] = [];
        for (const a of ajustesDelPlan) {
            const estado = estadoDeAjuste(a);
            if (estado === "por-agregar") lista.push({ clave: `a-${a.clave}`, texto: `Solo en este plan: ${a.descripcion || a.titulo}` });
            if (estado === "por-quitar") lista.push({ clave: `q-${a.clave}`, texto: `Se saca de este plan: ${a.descripcion || a.titulo}` });
        }
        for (const g of guardadosSinRecalcular) {
            lista.push({ clave: `g-${g.id}`, texto: `Guardado en Recursos: ${g.descripcion || g.titulo}` });
        }
        if (revisionAuto === "cambios-en-recursos" && guardadosSinRecalcular.length === 0) {
            lista.push({ clave: "recursos", texto: "Cambió algo en Recursos (puede haber sido otra persona)" });
        }
        for (const oid of procesosEnPlan.otsCambiadas) {
            lista.push({ clave: `p-${oid}`, texto: `Procesos editados en la OT #${numeroDeOT(oid)}` });
        }
        return lista;
    }, [ajustesDelPlan, guardadosSinRecalcular, revisionAuto, procesosEnPlan.otsCambiadas, numeroDeOT]);
    const cantidadPendientes = pendientes.length;
    const textoCambios = (n: number) => `${n} ${n === 1 ? "cambio que marcaste" : "cambios que marcaste"}`;
    /**
     * Cuánto va a tardar el recálculo, escrito al lado del botón: con 48 OT son unos
     * 4 minutos, y saberlo antes de tocar es lo que deja decidir si conviene juntar
     * un arreglo más. Misma cuenta que la barra de progreso.
     */
    const tardaElRecalculo = (() => {
        const seg = duracionEstimada(buildOrdenIdsForRecalc(Array.from(forzarOrdenIds)).length);
        return seg < 60 ? `~${Math.max(5, Math.round(seg / 5) * 5)} s` : `~${Math.round(seg / 60)} min`;
    })();

    /**
     * A qué traer a la vista después del próximo dibujado. Un ref y no un
     * `setTimeout(80)`: la fila recién existe cuando React pintó el desplegado (y,
     * si se limpiaron filtros, la tabla entera), y cuánto tarda eso depende del
     * tamaño del plan. El efecto de abajo corre después de cada render y, apenas
     * el elemento está, lo centra y se olvida.
     */
    const saltoPendiente = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!saltoPendiente.current) return;
        const el = document.querySelector(saltoPendiente.current);
        if (!el) return;
        saltoPendiente.current = null;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    const resaltar = (ordenId: number) => {
        setOtResaltada(ordenId);
        if (resaltadoRef.current) clearTimeout(resaltadoRef.current);
        resaltadoRef.current = setTimeout(() => setOtResaltada(null), 4000);
    };

    /**
     * Abre una OT de la tabla: la despliega, la trae a la vista y la resalta.
     * Recibe el `orden_id` INTERNO (el panel de carga la llama así); los avisos
     * pasan por `verOTDelAviso`, que traduce antes.
     *
     * "Y vas a buscarla acá… estaría bueno que hagas clic acá" (Lucas, 28/08,
     * mirando la 15678). El número de la OT estaba en el aviso, en chico, y para
     * asignarle la persona había que bajar a buscar la fila entre todas las demás.
     * Desplegada, la asignación se hace en el mismo lugar donde cayó el salto.
     */
    const verOT = (ordenId: number) => {
        if (!groupedResults[ordenId]) {
            toast.info(`La OT #${numeroDeOT(ordenId)} no entró en este plan.`);
            return;
        }
        // Con filtros puestos la fila puede no existir en el DOM. Limpiarlos es
        // preferible a un click que no hace nada: la vuelta atrás es volver a
        // tildarlos, y el aviso dice cuáles se sacaron.
        if (filtrosActivos > 0 && !gruposFiltrados[ordenId]) {
            setFiltroTexto("");
            setFiltros({ atrasadas: false, forzadas: false, sinOperario: false, sinMaquina: false });
            toast.info("Se limpiaron los filtros para poder mostrarte la OT.");
        }
        // Lo mismo que hace `toggleRow` al abrir: sin el catálogo cargado, el
        // selector de proceso de la fila queda trabado en «Buscando procesos…» si
        // esta es la primera OT que se abre en la pantalla.
        if (!expandedOrderIds.includes(ordenId)) void pedirCatalogoProcesos();
        setExpandedOrderIds(prev => (prev.includes(ordenId) ? prev : [...prev, ordenId]));
        resaltar(ordenId);
        saltoPendiente.current = `tr[data-ot="${ordenId}"]`;
    };

    /**
     * El click en un #OT de un aviso. Tres destinos posibles, y ninguno es un
     * click que no hace nada:
     *  - está en la tabla → se abre ahí;
     *  - quedó en «Fuera del plan» → se abre su tarjeta amarilla, que dice por qué;
     *  - no está en ninguno → un cartel que dice la verdad. Es el caso de un aviso
     *    «OT X: pausada…» con la OT entera pausada, o de una OT que se sacó del
     *    plan después de calcularlo.
     */
    const verOTDelAviso = (numero: number) => {
        const ordenId = ordenIdPorNumeroVisible.get(numero);
        if (ordenId != null && groupedResults[ordenId]) {
            verOT(ordenId);
            return;
        }
        if (ordenId != null && excedentesPorOrden[ordenId]) {
            setExpandedExcedenteId(ordenId);
            resaltar(ordenId);
            saltoPendiente.current = `[data-excedente="${ordenId}"]`;
            return;
        }
        toast.info(`La OT #${numero} no entró en este plan`, {
            description: "Puede estar pausada, o la sacaste del plan después de calcularlo.",
        });
    };

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
        try {
            const guardado = localStorage.getItem(CLAVE_CARGA);
            if (guardado !== null) { setCargaAbierta(guardado !== "0"); return; }
            // Sin preferencia guardada, en pantalla angosta arranca PLEGADO: abierto se
            // lleva 300px mínimos y la tabla (min-w 1600) queda condenada a scrollear de
            // costado desde el primer segundo. Plegado son 44px y se lee. Apenas lo
            // abrís o cerrás a mano, esa decisión manda para siempre.
            if (window.innerWidth < 1280) setCargaAbierta(false);
        } catch { /* queda abierto */ }
    }, []);
    const alternarCarga = () => setCargaAbierta(v => {
        try { localStorage.setItem(CLAVE_CARGA, v ? "0" : "1"); } catch { /* nada */ }
        return !v;
    });

    /**
     * Minutos que le quedan a cada persona si se confirma este plan.
     *
     * Una sola cuenta para las tres cosas que la necesitan —el contador de pasados,
     * el orden del panel y la barra de cada tarjeta—, que antes la hacían por
     * separado y podían no coincidir.
     */
    const minutosPorOperario = React.useMemo(() => {
        const suma: Record<number, number> = {};
        for (const op of availableOperators) suma[op.id] = operatorLoads[op.id] || 0;
        for (const r of results) {
            const efectivo = getEffectiveItem(r);
            const id = efectivo.id_operario;
            if (id == null) continue;
            suma[id] = (suma[id] ?? 0) + (r.duracion_min || 0);
        }
        return suma;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [availableOperators, operatorLoads, results, editedResults]);

    /**
     * Las filas que ve el panel de carga: las efectivas (con los retoques a mano), y
     * marcadas cuando alguien les movió el inicio en la tabla. Esas traen el fin que
     * calculó el motor para el inicio viejo, así que el panel las reparte desde el
     * inicio nuevo en vez de creerle al fin.
     */
    const filasParaCarga = React.useMemo(
        () => results.map(r => {
            const e = getEffectiveItem(r);
            return { ...e, fechaEditada: e.fecha_inicio_estimada !== r.fecha_inicio_estimada };
        }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [results, editedResults]
    );

    /** Lo que no entró al plan: el panel lo suma a su desglose para que cuadre con
     *  «Carga total» del encabezado, que también lo cuenta. */
    const excedentesMin = React.useMemo(
        () => displayedExcedentes.reduce((a, e) => a + (e.duracion_min || 0), 0),
        [displayedExcedentes]
    );

    /**
     * Contra qué se compara la carga de cada persona: el período del plan.
     *
     * Hasta el 23/9 era contra 44 h fijas «de la semana», y el plan no dura una
     * semana: el de Lucas iba del 24/9 al 6/10 y Guillermo aparecía con 72,5 h / 44 h,
     * pasadísimo, cuando en esos 9 días hábiles él trabaja 9 × 8,25 = 74,25 h. La
     * carga que se suma es la de TODO el plan, así que la capacidad tiene que ser la
     * de todo el plan: los días que trabaja esa persona entre el primer día y el
     * último, sin feriados, por su jornada.
     *
     * Si el plan no trae fechas (no debería), se usa el rango elegido al planificar;
     * y si tampoco hay, una semana de lunes a viernes — y el panel lo dice.
     */
    const periodoDeCarga = React.useMemo(() => {
        if (spanPlan) return { desde: spanPlan.desde, hasta: spanPlan.hasta, habiles: spanPlan.habiles };
        const { fecha_desde: desde, fecha_hasta: hasta } = planningRange;
        if (desde && hasta) return { desde, hasta, habiles: contarDiasHabiles(desde, hasta, feriados, diasDelTaller) };
        return null;
    }, [spanPlan, planningRange, feriados, diasDelTaller]);

    const capacidadPorOperario = React.useMemo(() => {
        const salida: Record<number, CapacidadEnElPeriodo> = {};
        for (const op of availableOperators) {
            if (periodoDeCarga) {
                salida[op.id] = capacidadEnElPeriodo(op, periodoDeCarga.desde, periodoDeCarga.hasta, feriados);
            } else {
                // Sin período: una semana de cinco días con su jornada.
                const jornada = jornadaDelOperario(op);
                salida[op.id] = { dias: 5, jornada, minutos: 5 * jornada };
            }
        }
        return salida;
    }, [availableOperators, periodoDeCarga, feriados]);

    /** Qué parte de lo que puede trabajar en el período ya tiene ocupada. */
    const ocupacionDe = (opId: number) => {
        const cargaMin = minutosPorOperario[opId] || 0;
        const capacidad = capacidadPorOperario[opId];
        const capacidadMin = capacidad?.minutos ?? 0;
        // Sin días de trabajo en el período (no trabaja ninguno de esos días): con
        // cualquier minuto encima ya está pasado.
        const pasado = capacidadMin > 0 ? cargaMin > capacidadMin : cargaMin > 0;
        const porcentaje = capacidadMin > 0 ? (cargaMin / capacidadMin) * 100 : (cargaMin > 0 ? 100 : 0);
        return { cargaMin, capacidad, capacidadMin, pasado, porcentaje };
    };

    /** Cuántos operarios quedan pasados de lo que pueden trabajar en el período si se
     *  confirma este plan. Es lo que hace que plegar el panel resuma en vez de
     *  esconder: el riel lo sigue mostrando en rojo. */
    const sobrecargados = React.useMemo(
        () => availableOperators.filter(op => ocupacionDe(op.id).pasado).length,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [availableOperators, minutosPorOperario, capacidadPorOperario]
    );

    const tituloDelRiel = sobrecargados > 0
        ? `Mostrar la carga de recurso humano: ${sobrecargados} ${sobrecargados === 1 ? "pasado" : "pasados"} en todo el plan`
        : "Mostrar la carga de recurso humano";

    /**
     * A quién le saltó la carga con lo último que se agregó a mano, y cuánto.
     *
     * Lucas agregó procesos y Pablo pasó de 8,9 a 15 horas; se enteró de casualidad
     * porque venía anotando las horas en un papel (28/08). El panel siempre mostró el
     * total, pero un número que cambia de 8,9 a 15 mientras mirás otra parte de la
     * pantalla no se ve. Esto le pone el "antes → después" al lado del nombre.
     *
     * Se arma con una espera y no comparando cada cambio de carga contra el anterior:
     * `minutosPorOperario` se mueve por muchas razones que no son agregar nada —al
     * entrar (todos pasan de 0 a su carga real), al retomar un borrador, al recalcular
     * por "Forzar" o "Volver a revisar", al cambiarle el operario a una fila—, y contra
     * el anterior todas esas salían como "salto", con carteles del tipo
     * "0,0 h → 31,4 h con lo que acabás de agregar" sin que nadie hubiera agregado nada.
     *
     * Entonces: cuando entra una tanda nueva se guarda la foto de ese momento y se queda
     * esperando; el primer recálculo que llega después es el que se compara. Cualquier
     * otro movimiento no dispara nada.
     */
    const [saltoCarga, setSaltoCarga] = React.useState<{ opId: number; antes: number; despues: number } | null>(null);
    /** La foto de antes de la tanda, y cuántas tandas había cuando se sacó. */
    const esperandoSalto = React.useRef<{ antes: Record<number, number>; tandas: number } | null>(null);
    const tandasPreviasRef = React.useRef(0);

    React.useEffect(() => {
        // Sólo agregar cuenta. Quitar (deshacer, sacar una OT) baja la carga y no
        // tiene salto que mostrar.
        if (tandasManuales.length > tandasPreviasRef.current) {
            esperandoSalto.current = { antes: minutosPorOperario, tandas: tandasManuales.length };
        }
        tandasPreviasRef.current = tandasManuales.length;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tandasManuales]);

    React.useEffect(() => {
        const espera = esperandoSalto.current;
        if (!espera || espera.antes === minutosPorOperario) return;
        esperandoSalto.current = null;

        // El mayor aumento: si una tanda toca a cinco personas, la que importa es la
        // que más subió.
        let mayor: { opId: number; antes: number; despues: number } | null = null;
        for (const [id, min] of Object.entries(minutosPorOperario)) {
            const antes = espera.antes[Number(id)] ?? 0;
            const sube = min - antes;
            if (sube > 0 && (!mayor || sube > mayor.despues - mayor.antes)) {
                mayor = { opId: Number(id), antes, despues: min };
            }
        }
        if (!mayor) return;
        setSaltoCarga(mayor);
        // Si el panel está plegado no se ve nada, así que se abre solo. No se toca la
        // preferencia guardada: al volver a entrar queda como el usuario lo dejó.
        setCargaAbierta(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [minutosPorOperario]);

    /**
     * El cartel dura unos segundos y se va.
     *
     * Va en su propio efecto, colgado de `saltoCarga` y no del cálculo: si el timeout
     * se arma adentro del efecto de arriba, cualquier recálculo que llegue dentro de
     * esos segundos ejecuta la limpieza, mata el timer y sale sin volver a armarlo — y
     * el cartel se queda pegado mostrando un antes/después que ya no es cierto.
     */
    React.useEffect(() => {
        if (!saltoCarga) return;
        const t = setTimeout(() => setSaltoCarga(null), 6000);
        return () => clearTimeout(t);
    }, [saltoCarga]);

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
                    {/* Las acciones bajan a un segundo renglón cuando no entran al lado del
                        título, y adentro de ese renglón van de a varias filas si hace falta
                        (RF-27). Por ANCHO y no por breakpoint: Hoja del pañol, Agregar OTs,
                        el zoom, Volver y Salir piden ~780px, y en 1024 con el menú
                        abierto hay ~620 — la fila fija se salía de la tarjeta y la página
                        entera scrolleaba de costado (en el teléfono, con Salir afuera).
                        Donde entran (una pantalla ancha) es la misma fila de siempre.
                        La campana de avisos flota arriba a la derecha: abajo de `lg` le
                        deja lugar el `pr-11` del título; desde `lg`, el `lg:pr-16` de acá,
                        porque ahí la que queda en esa esquina es el último botón de la
                        barra (hoy «Salir») y la campana le tapaba un tercio (medido en
                        1440, con la X que había antes: 11px de 32). */}
                    <div className="px-3 sm:px-6 lg:pr-16 py-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        {/* El título nunca baja de 12rem: es lo que decide si las acciones
                            le entran al lado o se van al renglón de abajo. Con `min-w-0`
                            solo, las acciones se quedaban en la fila y el título quedaba
                            aplastado a cero. */}
                        <div className="min-w-[12rem] grow basis-0 pr-11 lg:pr-0">
                            {/* `min-w-0 overflow-hidden` en vez de `whitespace-nowrap` a secas:
                                con el título entero sin poder achicarse, en 1024 empujaba a
                                los botones de la derecha fuera de la tarjeta. Ahora el que
                                cede es el texto y "Salir" queda siempre alcanzable. */}
                            <h1 className="text-[17px] font-bold text-gray-900 flex items-center gap-2 min-w-0 overflow-hidden">
                                <CalendarClock className="w-4 h-4 text-blue-600 shrink-0" />
                                <span className="truncate">Vista previa de planificación</span>
                                {/* Que se lea que esto TODAVÍA no es el plan: es lo que
                                    distingue esta pantalla de Operaciones, que se le
                                    parece bastante y sí muestra lo ya guardado. */}
                                <span className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-widest bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                                    En revisión
                                </span>
                            </h1>

                        </div>
                        <div className="flex flex-wrap items-center gap-2 max-w-full">
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
                            {/* Deshacer lo último que se agregó a mano. Vive al lado de
                                "Agregar OTs" porque deshace exactamente eso, y sólo
                                aparece cuando hay algo que deshacer. */}
                            {/* El contador se separó de "Deshacer" porque mentía: contaba
                                TODAS las OT agregadas a mano y el botón deshace sólo la
                                última tanda. Ahora el número es su propio botón y abre la
                                lista de lo agregado — "ya no sé qué pusimos", Lucas 28/08. */}
                            {tandasManuales.length > 0 && onRecalculate && (
                                <Popover open={verAMano} onOpenChange={setVerAMano}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-8 gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300"
                                            title="Ver todo lo que agregaste a mano a este plan"
                                        >
                                            <ListChecks className="w-3.5 h-3.5" />
                                            {ordenesAMano.size} a mano
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[min(480px,calc(100vw-2rem))] p-0" align="end">
                                        <div className="p-3 border-b bg-slate-50">
                                            <div className="text-sm font-semibold text-gray-800 flex items-center gap-2">
                                                <ListChecks className="w-4 h-4 text-indigo-600" />
                                                Lo que agregaste a mano
                                            </div>
                                            <p className="text-[11px] text-gray-500 mt-1">
                                                De lo último a lo primero. El resto del plan lo armó el sistema.
                                            </p>
                                        </div>
                                        <div className="max-h-[340px] overflow-y-auto p-2 space-y-2">
                                            {detalleAMano.map((ot) => (
                                                <div key={ot.ordenId} className="rounded-lg border border-indigo-100 bg-white">
                                                    <div className="flex items-center gap-2 border-b border-indigo-50 px-2 py-1.5">
                                                        <span className="font-semibold text-[12px] text-gray-800 tabular-nums">
                                                            OT #{ot.numeroOT}
                                                        </span>
                                                        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500">
                                                            {ot.cliente}
                                                        </span>
                                                        <span className={cn(
                                                            "shrink-0 rounded px-1.5 text-[10px] font-semibold leading-[16px]",
                                                            ot.filas.length === 0
                                                                ? "bg-amber-50 text-amber-800"
                                                                : "bg-indigo-50 text-indigo-700"
                                                        )}>
                                                            {ot.filas.length === 0
                                                                ? "no entró en el plan"
                                                                : ot.entera ? "OT entera" : `${ot.filas.length} ${ot.filas.length === 1 ? "proceso" : "procesos"}`}
                                                        </span>
                                                        <span className="shrink-0 text-[11px] font-medium text-gray-600 tabular-nums">
                                                            {horasEs(ot.minutos)} h
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => { setVerAMano(false); handleRemoveOrderAndRecalculate(ot.ordenId); }}
                                                            disabled={isCalculating || isConfirming}
                                                            className="shrink-0 rounded p-0.5 text-gray-400 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-40"
                                                            title="Sacar esta OT del plan y recalcular"
                                                        >
                                                            <XIcon className="w-3.5 h-3.5" />
                                                        </button>
                                                    </div>
                                                    <ul className="divide-y divide-gray-50">
                                                        {ot.filas.map((f, i) => (
                                                            <li key={`${ot.ordenId}-${i}-${f.lineaId ?? "x"}`} className="flex items-center gap-2 px-2 py-1">
                                                                <span className="min-w-0 flex-1 truncate text-[11.5px] text-gray-700">
                                                                    {f.proceso}
                                                                </span>
                                                                <span className="shrink-0 truncate max-w-[120px] text-[11px] text-gray-500">
                                                                    {f.persona}
                                                                </span>
                                                                <span className="shrink-0 text-[11px] text-gray-500 tabular-nums">
                                                                    {horasEs(f.minutos)} h
                                                                </span>
                                                                {!ot.entera && f.lineaId != null && (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => quitarLineaAMano(ot.ordenId, f.lineaId!)}
                                                                        disabled={isCalculating || isConfirming}
                                                                        className="shrink-0 rounded p-0.5 text-gray-300 hover:bg-rose-50 hover:text-rose-600 transition-colors disabled:opacity-40"
                                                                        title="Sacar sólo este proceso y recalcular"
                                                                    >
                                                                        <XIcon className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            ))}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
                            {tandasManuales.length > 0 && onRecalculate && (
                                <div className="flex items-center">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => deshacerTandas("ultima")}
                                        disabled={isCalculating || isConfirming}
                                        className={cn(
                                            "h-8 gap-1.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300",
                                            tandasManuales.length > 1 && "rounded-r-none border-r-0"
                                        )}
                                        title="Saca del plan lo último que agregaste a mano y recalcula"
                                    >
                                        <RotateCcw className="w-3.5 h-3.5" />
                                        Deshacer
                                    </Button>
                                    {/* "Todo" sólo aparece cuando hay más de una tanda: con una
                                        sola, los dos botones harían exactamente lo mismo y sobra.
                                        Lucas pidió poder volver al plan original sin apretar
                                        Deshacer una vez por cada cosa que agregó. */}
                                    {tandasManuales.length > 1 && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => deshacerTandas("todas")}
                                            disabled={isCalculating || isConfirming}
                                            className="h-8 rounded-l-none border-indigo-200 px-2 text-indigo-700 hover:bg-indigo-50 hover:border-indigo-300"
                                            title={`Saca las ${tandasManuales.length} tandas que agregaste a mano y vuelve al plan original`}
                                        >
                                            todo
                                        </Button>
                                    )}
                                </div>
                            )}
                            {/* RF-22: el plan que se está mirando —con los retoques a mano y
                                los filtros de la tabla—, un renglón por proceso. Todavía no
                                está confirmado, y el archivo lo dice. */}
                            {results.length > 0 && (() => {
                                const nombreOperario = (i: PlanificacionResult) => {
                                    if (i.tercerizado) return "Tercerizado";
                                    const op = availableOperators.find((o: any) => o.id === i.id_operario);
                                    return op ? `${op.nombre ?? ""} ${op.apellido ?? ""}`.trim() : (i.operario_nombre || "Sin asignar");
                                };
                                const nombreMaquina = (i: PlanificacionResult) => {
                                    if (i.tercerizado) return "Tercerizado";
                                    const m = availableMachines.find((x: any) => x.id === i.id_maquinaria);
                                    if (m) return m.nombre;
                                    if (i.maquinaria_nombre) return i.maquinaria_nombre;
                                    return i.usa_maquina === false ? "No necesita" : "Sin asignar";
                                };
                                const columnas: ColumnaExport<PlanificacionResult>[] = [
                                    { titulo: "OT", tipo: "id", valor: (i) => i.id_otvieja ?? i.orden_id },
                                    { titulo: "Cliente", valor: (i) => i.cliente ?? "" },
                                    { titulo: "Código", valor: (i) => i.codigo ?? "" },
                                    { titulo: "Artículo", valor: (i) => i.articulo ?? "" },
                                    { titulo: "Proceso", valor: (i) => i.nombre_proceso },
                                    { titulo: "Inicio", tipo: "fechaHora", valor: (i) => i.fecha_inicio_estimada },
                                    { titulo: "Fin", tipo: "fechaHora", valor: (i) => i.fecha_fin_estimada },
                                    { titulo: "Minutos", tipo: "entero", valor: (i) => i.duracion_min },
                                    { titulo: "Recurso humano", valor: nombreOperario },
                                    { titulo: "Recurso maquinaria", valor: nombreMaquina },
                                    { titulo: "Prometida", tipo: "fecha", valor: (i) => i.fecha_prometida },
                                    {
                                        titulo: "Termina tarde",
                                        tipo: "booleano",
                                        // La misma cuenta que la alerta de la fila: terminar el día prometido no es tarde.
                                        valor: (i) => diasDeAtraso(i.fecha_fin_estimada, i.fecha_prometida) > 0,
                                    },
                                ];
                                // En el mismo orden que la tabla: se exporta lo que se está mirando.
                                const filas = otsEnOrden.flatMap(({ items }) => items.map(i => getEffectiveItem(i)));
                                return (
                                    <ExportarMenu
                                        titulo="Vista previa del plan (sin confirmar)"
                                        archivo="plan_vista_previa"
                                        filas={filas}
                                        columnas={columnas}
                                        filtros={() => [
                                            ...filtroBusqueda(filtroTexto),
                                            ...(filtros.atrasadas ? ["Sólo las que llegan tarde"] : []),
                                            ...(filtros.forzadas ? ["Sólo las forzadas"] : []),
                                            ...(filtros.sinOperario ? ["Sólo con procesos sin recurso humano"] : []),
                                            ...(filtros.sinMaquina ? ["Sólo con procesos sin recurso maquinaria"] : []),
                                        ]}
                                        disabled={isCalculating}
                                    />
                                );
                            })()}
                            {/* La hoja del pañol. Va acá arriba y no en el pie porque se
                                imprime ANTES de confirmar: el pañol prepara con el plan que
                                se está mirando, no con uno que ya se guardó. */}
                            {results.length > 0 && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={imprimirParaPanol}
                                    className="h-8 gap-1.5"
                                    title="Imprime el plan día por día, para que el pañol prepare el material"
                                >
                                    <Printer className="w-3.5 h-3.5" />
                                    Hoja del pañol
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
                                            {/* La regla se explica acá y no sólo en el globito del proceso
                                                gris: si no, el primero que expande una OT ve la mitad de
                                                los procesos tachados y no sabe por qué. */}
                                            <p className="text-[11px] text-gray-500 mt-1">
                                                Sueltos sólo se pueden agregar los de <strong>paso 1 o 2</strong>: un proceso posterior necesita que la pieza haya pasado por los anteriores.
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
                                                        const selProcs = pendingAddLineas[o.id] || new Set<number>();
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
                                                                        {pasadasParaAgregar(procs).map(({ rel: p, paso, habilitada }) => {
                                                                            // Se tilda la PASADA (p.id), no el proceso: la misma OT
                                                                            // puede tener el mismo proceso en varios pasos y cada
                                                                            // uno se elige por separado.
                                                                            const pid = p.id;
                                                                            const psel = selProcs.has(pid);
                                                                            // Del paso 3 en adelante se ve pero no se tilda: hace falta
                                                                            // verlo para entender por qué no se puede (y para darse
                                                                            // cuenta de que el orden de la OT está mal).
                                                                            const motivo = habilitada
                                                                                ? undefined
                                                                                : `Paso ${paso}: la pieza tiene que pasar antes por los pasos previos. A mano sólo se agregan los pasos 1 y 2. Si acá el orden está mal, corregilo en la OT.`;
                                                                            return (
                                                                                <label
                                                                                    key={pid ?? `${p.proceso?.id}-${p.orden}`}
                                                                                    title={motivo}
                                                                                    className={cn(
                                                                                        "flex items-center gap-2 px-2 py-1 rounded",
                                                                                        !habilitada && "opacity-50 cursor-not-allowed",
                                                                                        habilitada && "cursor-pointer",
                                                                                        habilitada && (psel ? "bg-blue-100/60" : "hover:bg-gray-100")
                                                                                    )}
                                                                                >
                                                                                    <Checkbox
                                                                                        checked={psel}
                                                                                        disabled={!habilitada}
                                                                                        onCheckedChange={() => habilitada && togglePendingLinea(o.id, pid)}
                                                                                    />
                                                                                    <span className={cn(
                                                                                        "inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold shrink-0",
                                                                                        habilitada ? "bg-gray-200 text-gray-600" : "bg-gray-100 text-gray-400"
                                                                                    )}>{paso}</span>
                                                                                    <span className={cn("truncate flex-1", habilitada ? "text-gray-700" : "text-gray-400 line-through")}>
                                                                                        {capitalize(p.proceso?.nombre || "")}
                                                                                    </span>
                                                                                    {p.tiempo_proceso != null && <span className="text-[10px] text-gray-400 shrink-0">{p.tiempo_proceso}m</span>}
                                                                                </label>
                                                                            );
                                                                        })}
                                                                        {procs.length > 0 && pasadasParaAgregar(procs).every(x => !x.habilitada) && (
                                                                            <div className="px-2 text-[10px] leading-snug text-amber-700">
                                                                                Ningún proceso de esta OT arranca en el paso 1 o 2. Revisá el orden en la OT, o agregala entera.
                                                                            </div>
                                                                        )}
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
                                                    onClick={() => { setPendingAddIds(new Set()); setPendingAddLineas({}); setAddSearchTerm(""); }}
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
                            {/* Volver AL PASO ANTERIOR, arriba y no sólo escondido en el
                                pie: son dos salidas distintas —una vuelve a elegir OTs y la
                                otra se va del planificador— y tenerlas juntas es lo que hace
                                obvio cuál es cuál. */}
                            {onBack && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-1.5 text-gray-500 hover:text-gray-800"
                                    onClick={onBack}
                                    disabled={isConfirming || isCalculating}
                                    title="Volver al paso anterior para cambiar qué OTs entran en el plan"
                                >
                                    <ArrowLeft className="w-3.5 h-3.5" />
                                    <span className="hidden sm:inline">Volver a elegir OTs</span>
                                </Button>
                            )}
                            {/* «Salir» es la única salida. Hubo además una X de cerrar
                                (Julián, 16/09: «falta un botón de x para cerrar»), pero
                                hacía exactamente lo mismo que «Salir», y dos botones
                                iguales se leen como dos cosas distintas. Julián, 25/9:
                                «los botones salir y la x de cerrar hacen lo mismo, sacá
                                la x». */}
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 gap-1.5 text-gray-500 hover:text-gray-800"
                                onClick={onClose}
                                disabled={isConfirming || isCalculating}
                                title="Volver a Operaciones. El plan queda guardado como borrador."
                            >
                                <LogOut className="w-3.5 h-3.5" />
                                <span className="hidden sm:inline">Salir</span>
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
                    {/* Las cinco cifras en una fila sola recién a partir de xl. Abajo de
                        eso cada celda quedaba en ~130px y los números se leían apretados
                        contra su rótulo; en dos o tres filas entran holgadas y el riel
                        sigue siendo un riel (los separadores los sigue dibujando el
                        `gap-px` sobre el fondo).
                        Cinco celdas en dos o tres columnas dejaban un hueco gris al final
                        (el fondo del riel asomando). En el teléfono la fecha, que es la
                        cifra más ancha, ocupa su renglón entero; en dos columnas quedan
                        tres renglones llenos. En tres columnas (`md`) la que se estira es
                        la de trabas, que además tiene el «Ver detalles» (RF-27). */}
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-[1.5fr_1fr_1fr_1fr_1.3fr] gap-px bg-gray-200 border-t border-gray-200">
                        {/* La fecha primero y la celda más ancha del riel.

                            Estaba en un Badge de 11px perdido entre otros tres chips.
                            Acá tiene la MISMA tipografía que las otras cifras: el peso
                            que pidió el cliente sale de la posición (primera), del ancho
                            (1.5fr) y del acento azul, no de píxeles nuevos de alto —
                            reusa una fila que ya estaba. La etiqueta dice de dónde sale
                            el período (sin tope, hasta lo elegido, o pasado del tope por
                            forzar), y el ⓘ lo explica entero: ver `periodoDelPlan`. */}
                        <CifraPlan
                            className="col-span-2 md:col-span-1"
                            tono="fecha"
                            icono={<Calendar className="w-4 h-4" />}
                            valor={spanPlan
                                ? <>{formatDate(spanPlan.desde)} <span className="text-gray-400 font-normal">→</span> {formatDate(spanPlan.hasta)}</>
                                : "—"}
                            etiqueta={periodoDelPlan
                                ? (periodoDelPlan.pasado
                                    ? <span className="font-medium text-amber-700">{periodoDelPlan.etiqueta}</span>
                                    : periodoDelPlan.etiqueta)
                                : "Período del plan"}
                            /* Por clic y no en un `title`: el title tarda en abrir, no
                               existe en el teléfono y nadie sabe que está.
                               «Cambiar» abre el selector de fechas del Paso 1 y recalcula
                               con el rango nuevo al confirmar (25/9). */
                            accion={
                                <div className="flex items-center gap-0.5">
                                {onRecalculate && (
                                    <button
                                        type="button"
                                        onClick={() => setSelectorFechasAbierto(true)}
                                        disabled={isCalculating || isConfirming}
                                        className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-1 text-xs font-medium text-blue-700 transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-40"
                                        title={isCalculating ? "Esperá a que termine el recálculo" : "Elegir otras fechas y recalcular el plan"}
                                        aria-label="Cambiar las fechas del plan"
                                    >
                                        <CalendarRange className="h-3.5 w-3.5" />
                                        {/* El texto sólo donde sobra lugar (teléfono, con la celda a
                                            todo el ancho, y pantallas grandes): en la notebook la
                                            celda mide ~260px y el texto le comía la fecha. */}
                                        <span className="md:hidden 2xl:inline">Cambiar</span>
                                    </button>
                                )}
                                {onRecalculate && (
                                    <SelectorFechasPlan
                                        abierto={selectorFechasAbierto}
                                        onAbiertoChange={setSelectorFechasAbierto}
                                        modo="recalcular"
                                        valor={fechasDelPlanActual}
                                        onConfirmar={recalcularConFechas}
                                        feriados={feriados}
                                        ordenesIds={selectorFechasAbierto ? buildOrdenIdsForRecalc(Array.from(forzarOrdenIds)) : []}
                                        prometidas={selectorFechasAbierto ? prometidasDelPlan(buildOrdenIdsForRecalc(Array.from(forzarOrdenIds))) : []}
                                        diasDelTaller={diasDelTaller}
                                        nota={forzarOrdenIds.size > 0
                                            ? `Forzaste ${forzarOrdenIds.size} OT: con una sola forzada el plan se recalcula sin fecha tope, así que el «hasta» no se respeta.`
                                            : `Se recalcula el plan entero: tarda ${tardaElRecalculo}.`}
                                    />
                                )}
                                {periodoDelPlan && (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <button
                                            type="button"
                                            className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                                            aria-label="De dónde sale el período del plan"
                                        >
                                            <Info className="w-4 h-4" />
                                        </button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-[min(360px,calc(100vw-2rem))] p-3 text-[13px] text-gray-700 space-y-2 leading-relaxed" align="start">
                                        <div className="font-semibold text-gray-900">De dónde sale el período</div>
                                        {periodoDelPlan.comoArranca && <p>{periodoDelPlan.comoArranca}</p>}
                                        <p>{periodoDelPlan.comoTermina}</p>
                                        <p className="text-[12px] text-gray-500">
                                            Días hábiles: los que trabaja alguien del taller ({describirDias(diasDelTaller)}), sin feriados, contando el primero y el último aunque sean de media jornada.
                                        </p>
                                    </PopoverContent>
                                </Popover>
                                )}
                                </div>
                            }
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
                            className="md:col-span-2 xl:col-span-1"
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
                <div className="px-3 py-3 sm:px-6 sm:py-4 flex items-center justify-between gap-3">
                    {/* Lado izquierdo: contexto + Volver */}
                    <div className="flex items-center gap-3 text-xs text-gray-500">
                        <Button variant="outline" onClick={onBack} disabled={isConfirming || isCalculating} title={isCalculating ? "Esperá a que termine el recálculo" : undefined} className="border-gray-300 text-gray-700 hover:bg-gray-50">
                            Volver
                        </Button>
                        {forzarOrdenIds.size > 0 && (
                            <span className="text-amber-700">
                                <strong>{forzarOrdenIds.size}</strong> excedente{forzarOrdenIds.size === 1 ? "" : "s"} forzada{forzarOrdenIds.size === 1 ? "" : "s"}
                            </span>
                        )}
                    </div>
                    {/* Lado derecho: recalcular lo marcado (si hay) y confirmar.
                        El botón de recalcular vive acá, fijo en el pie, porque los
                        arreglos se marcan de a varios y se recalcula una sola vez
                        (25/09/2026): tiene que estar a la vista mientras se revisa, no
                        sólo arriba del panel. Con pendientes, Confirmar pasa a segundo
                        plano: guardar así se puede, pero no es lo que se recomienda. */}
                    <div className="flex items-center gap-2">
                    {cantidadPendientes > 0 && onRecalculate && (
                        <Button
                            onClick={() => handleRecalculate()}
                            disabled={isConfirming || isCalculating}
                            title={isCalculating
                                ? "Esperá a que termine el recálculo"
                                : `El plan de la pantalla todavía no tiene ${textoCambios(cantidadPendientes)}. Tarda ${tardaElRecalculo}.`}
                            className="h-auto flex-col items-center gap-0 bg-amber-500 px-3 py-1.5 text-white shadow-md hover:bg-amber-600 sm:px-4"
                        >
                            <span className="flex items-center gap-1.5">
                                <RefreshCw className={cn("h-4 w-4", isCalculating && "animate-spin")} />
                                <span className="sm:hidden">Recalcular ({cantidadPendientes})</span>
                                <span className="hidden sm:inline">
                                    Recalcular con {cantidadPendientes} {cantidadPendientes === 1 ? "cambio" : "cambios"}
                                </span>
                            </span>
                            <span className="text-[10.5px] font-normal leading-tight text-white/85">tarda {tardaElRecalculo}</span>
                        </Button>
                    )}
                    <Button
                        onClick={onClickConfirmar}
                        disabled={isConfirming || isCalculating || (results.length === 0 && displayedExcedentes.length === 0)}
                        title={isCalculating ? "Esperá a que termine el recálculo" : undefined}
                        className={cn(
                            "px-4 sm:px-6",
                            cantidadPendientes > 0
                                ? "border border-blue-300 bg-white text-blue-700 shadow-none hover:bg-blue-50"
                                : "bg-blue-600 hover:bg-blue-700 shadow-md",
                        )}
                    >
                        {isConfirming ? (
                            <span className="flex items-center gap-2">
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                Confirmando...
                            </span>
                        ) : (
                            // En el teléfono la frase entera (270px) no entraba al lado de
                            // «Volver» y el botón se salía del pie. Dice lo mismo, más corto.
                            <>
                                <span className="sm:hidden">Confirmar plan</span>
                                <span className="hidden sm:inline">Confirmar y guardar planificación</span>
                            </>
                        )}
                    </Button>
                    </div>
                </div>
            }
        >
                {/* Tabla y panel de carga, uno al lado del otro desde `lg`; abajo de eso,
                    uno ABAJO del otro (RF-27). En fila, en un teléfono el panel se llevaba
                    la mitad de los 327px y la tabla quedaba en una tira. Apilados, cada uno
                    usa el ancho entero y el panel queda después del plan, que es lo primero
                    que se revisa. `items-stretch` abajo de `lg` porque en columna el
                    `items-start` los dejaba del ancho de su contenido. */}
                <div className="flex flex-col lg:flex-row flex-1 min-w-0 items-stretch lg:items-start">
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
                            {/* `scroll-mt`: «Ver detalles» de la cifra de trabas trae el panel
                                arriba de todo, y sin margen el encabezado —con «Recalcular»—
                                quedaba abajo de la cabecera fija. La cabecera sólo es fija
                                desde md. */}
                            <div ref={panelAvisos} className="sticky left-0 w-full md:scroll-mt-[calc(var(--alto-cabecera)+8px)]">
                                {/* Lo marcado que el plan de abajo todavía no tiene. Arriba de
                                    los avisos, porque es lo que cambia cómo se leen: el aviso
                                    que se ve rojo puede estar ya arreglado y sin recalcular. */}
                                {cantidadPendientes > 0 && (
                                    <div className="mx-3 sm:mx-4 mt-4 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5">
                                        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                                            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                                            <div className="min-w-0 flex-1 basis-60">
                                                <p className="text-[13px] font-semibold leading-snug text-amber-950">
                                                    El plan de abajo todavía no tiene {textoCambios(cantidadPendientes)}
                                                </p>
                                                <p className="text-[12px] leading-snug text-amber-900/80">
                                                    Seguí revisando y recalculá una sola vez al terminar (tarda {tardaElRecalculo}).
                                                </p>
                                                <ul className="mt-1 space-y-0.5 text-[11.5px] leading-snug text-amber-950">
                                                    {pendientes.slice(0, 6).map(p => (
                                                        <li key={p.clave} className="flex gap-1.5">
                                                            <span className="text-amber-500">•</span>
                                                            <span className="min-w-0">{p.texto}</span>
                                                        </li>
                                                    ))}
                                                    {pendientes.length > 6 && (
                                                        <li className="text-amber-800/80">y {pendientes.length - 6} más</li>
                                                    )}
                                                </ul>
                                            </div>
                                            {onRecalculate && (
                                                <Button
                                                    size="sm"
                                                    onClick={() => handleRecalculate()}
                                                    disabled={isCalculating || isConfirming}
                                                    title={isCalculating ? "Esperá a que termine el recálculo" : `Recalcular el plan con estos cambios (${tardaElRecalculo})`}
                                                    className="h-8 shrink-0 gap-1.5 bg-amber-500 text-white hover:bg-amber-600"
                                                >
                                                    <RefreshCw className={cn("h-3.5 w-3.5", isCalculating && "animate-spin")} />
                                                    Recalcular ahora
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )}
                                <DiagnosticosPlan
                                    diagnosticos={diagnosticos}
                                    /* El plegado lo maneja la pantalla, no la tira: la cifra
                                       "Trabas sin resolver" tiene que poder desplegarla. */
                                    colapsado={avisosColapsados}
                                    onColapsadoChange={setAvisosColapsados}
                                    /* Marcados a mano: los cuenta la cifra de arriba. */
                                    marcados={avisosMarcados}
                                    onMarcadosChange={setAvisosMarcados}
                                    /* Guardado el cambio en Recursos, NO se recalcula: queda
                                       anotado como pendiente y entra en el recálculo que se
                                       pide una vez al terminar de revisar (25/09/2026). Lo
                                       que se acaba de cargar pisa al ajuste temporal que
                                       tocaba lo mismo: ése sale al recalcular. */
                                    onResuelto={anotarGuardado}
                                    guardadosSinRecalcular={guardadosSinRecalcular}
                                    pendientes={cantidadPendientes}
                                    /* El otro camino: destrabar el aviso SOLO para este
                                       cálculo. No escribe en Recursos —el plan sale como
                                       si el dato estuviera cargado y nada más—, así que
                                       no pide confirmación y se deshace con un botón.
                                       Pedido de Julián (17/09/2026). Ver lib/ajustesPlan. */
                                    ajustes={ajustesDelPlan}
                                    onAplicarSoloEstePlan={aplicarAjusteDelPlan}
                                    onQuitarAjuste={quitarAjusteDelPlan}
                                    /* El traductor de rangos, para que el panel pueda escribir
                                       los nombres y no los ids. Los avisos Media no traen acción
                                       —qué rango va lo sabe el taller, no el planificador—, así
                                       que el panel la arma en pantalla y de ahí sólo salen ids:
                                       sin esto el botón dice "le cambio quién la puede usar", sin
                                       nombrar ningún rango, justo en los avisos que son el pedido
                                       de Julián. El catálogo está cargado acá, no allá. */
                                    nombreDeRango={nombreDeRango}
                                    /* Mismo recálculo, pero pedido a mano: el caso es
                                       "fui a Recursos, arreglé lo que pedía el aviso y
                                       volví". Los diagnósticos son la foto del momento
                                       del cálculo, así que sin esto el aviso sigue rojo
                                       aunque el problema ya no exista — y con un
                                       borrador retomado puede ser la foto de ayer. */
                                    /* Del aviso a la fila de la OT, desplegada y resaltada, que es
                                       donde se le asigna la persona. Antes el número estaba sólo en
                                       el globito del impacto y había que ir a buscarlo a la tabla. */
                                    /* Los avisos ya traen el número visible: se escribe tal
                                       cual, y el click lo traduce al id de la tabla. */
                                    numeroDeOT={(n) => String(n)}
                                    onVerOT={verOTDelAviso}
                                    onRevisar={onRecalculate ? () => handleRecalculate() : undefined}
                                    revisando={isCalculating}
                                    calculadoEn={calculadoEn}
                                    revisionAuto={revisionAuto}
                                />
                            </div>

                            <div className="p-0 pr-2" style={{ zoom: zoom / 100 }}>
                                {/* RF-03: una OT del plan se pausó DESPUÉS de calcularlo (una vista
                                    previa abierta, un borrador de ayer). Al confirmar no se guarda;
                                    acá se dice antes, con la opción de recalcular. */}
                                <AvisoPausadasEnElPlan
                                    filas={results}
                                    onRecalcular={onRecalculate ? () => handleRecalculate() : undefined}
                                    recalculando={isCalculating}
                                />
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
                                                    {sinMatchCount > 0 && <span>• <strong>{sinMatchCount}</strong> sin recurso humano/maquinaria compatible</span>}
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
                                                    Si la <strong>forzás</strong>, el motor la incluirá aunque eso amplíe el rango o sobrecargue al recurso humano.
                                                    {/* Forzar no es por OT: el planificador recalcula TODO el plan
                                                        sin la fecha «hasta» apenas hay una forzada. Callarlo dejaba
                                                        creer que las demás seguían atadas al rango. */}
                                                    {planningRange.fecha_hasta && (
                                                        <> Ojo: forzar aunque sea una recalcula <strong>todo el plan sin la fecha tope</strong>, así que las demás también pueden pasarse del {formatDate(planningRange.fecha_hasta)}.</>
                                                    )}
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
                                                    <div
                                                        key={oid}
                                                        data-excedente={oid}
                                                        className={cn(
                                                            "bg-white/60 transition-shadow",
                                                            otResaltada === oid && "ring-2 ring-inset ring-indigo-400"
                                                        )}
                                                    >
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
                                                                    title={planningRange.fecha_hasta
                                                                        ? `Incluir esta OT aunque amplíe el rango. Se recalcula todo el plan sin la fecha tope: las demás OT también pueden pasarse del ${formatDate(planningRange.fecha_hasta)}.`
                                                                        : "Incluir esta OT aunque amplíe el plan. Se recalculará automáticamente."}
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
                                                                            que haya recurso humano disponible, o usá <strong className="text-amber-700">Forzar</strong> si
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
                                                    ["sinOperario", "Solo con procesos sin recurso humano", "Sin contar los tercerizados."],
                                                    ["sinMaquina", "Solo con procesos sin recurso maquinaria", "Sin contar los que no necesitan."],
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
                                <table className="w-full text-sm text-left border-collapse [&_td]:py-2">
                                    <thead className="bg-gray-50 text-gray-500 font-medium uppercase text-xs sticky top-0 z-10 shadow-sm [&_th]:py-2">
                                        <tr>
                                            <th className="px-4 py-3 w-10"></th>
                                            <th className="px-4 py-3">ID</th>
                                            {ve("entrada") && <th className="px-4 py-3">Entrada</th>}
                                            {ve("cliente") && <th className="px-4 py-3 min-w-[190px]">Cliente</th>}
                                            {ve("codigo") && <th className="px-4 py-3">Código</th>}
                                            {ve("articulo") && <th className="px-4 py-3 min-w-[300px]">Artículo</th>}
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
                                        {otsEnOrden.map(({ ordenId, items }) => {
                                            const firstItem = items[0];
                                            const isExpanded = expandedOrderIds.includes(ordenId);
                                            // Entró a mano en esta vista previa (OT entera o procesos sueltos).
                                            const esAMano = ordenesAMano.has(ordenId);
                                            const lineasDeEstaOT = lineasVigentes[ordenId] || [];
                                            // Lo que se le editó a los procesos de esta OT y el plan todavía no refleja.
                                            const cambiosDeLaOT = procesosEnPlan.cambiosDe(ordenId);
                                            const editandoEstaOT = procesosEnPlan.trabajando === ordenId;
                                            // Sin las pasadas borradas y, si se cambió el orden, con el orden nuevo.
                                            const procesosVisibles = filasVisiblesDeOT(items, cambiosDeLaOT);
                                            const pasadasVisibles = pasadasEnOrden(procesosVisibles);

                                            // Calculate alerts (Lateness)
                                            const effectiveItems = items.map(i => getEffectiveItem(i));
                                            // Atraso por días de calendario (`diasDeAtraso`): terminar el día
                                            // prometido, a la hora que sea, no es llegar tarde.
                                            let maxDelayDays = 0;
                                            // El proceso que más se pasa, para que el globito muestre sus
                                            // fechas reales (fin estimado vs prometida). A igualdad de días,
                                            // el que termina más tarde: es el que decide cuándo sale la OT.
                                            let worstLateItem: PlanificacionResult | null = null;
                                            for (const i of effectiveItems) {
                                                const dias = diasDeAtraso(i.fecha_fin_estimada, i.fecha_prometida);
                                                if (dias <= 0) continue;
                                                if (dias > maxDelayDays || (dias === maxDelayDays && worstLateItem
                                                    && (i.fecha_fin_estimada ?? "") > (worstLateItem.fecha_fin_estimada ?? ""))) {
                                                    maxDelayDays = dias;
                                                    worstLateItem = i;
                                                }
                                            }
                                            const isOrderLate = maxDelayDays > 0;
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
                                                        data-ot={ordenId}
                                                        className={cn(
                                                            "transition-colors cursor-pointer group",
                                                            getRowColor(firstItem),
                                                            // El resaltado del salto desde un aviso dura unos segundos:
                                                            // en una tabla de 40 OTs, llegar a la fila no alcanza si
                                                            // después hay que adivinar cuál era.
                                                            otResaltada === ordenId && "ring-2 ring-inset ring-indigo-400"
                                                        )}
                                                        onClick={() => toggleRow(ordenId)}
                                                    >
                                                        <td className={cn(
                                                            "px-4 py-3",
                                                            // El código de color de lo agregado a mano (Lucas, 28/08).
                                                            // Va de barrita y no de fondo: el fondo de la fila ya dice
                                                            // el estado de la OT (entregada, en producción, atrasada) y
                                                            // pisarlo sería cambiar un dato por otro.
                                                            esAMano && "border-l-[3px] border-l-indigo-500"
                                                        )}>
                                                            <button className="p-1 hover:bg-black/10 rounded transition-colors text-inherit opacity-70 hover:opacity-100">
                                                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                            </button>
                                                        </td>
                                                        <td className="px-4 py-3 font-medium text-inherit">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <span>#{firstItem.id_otvieja || ordenId}</span>
                                                                {esAMano && (
                                                                    <span
                                                                        className="text-[9px] uppercase tracking-wider bg-indigo-100 text-indigo-800 border border-indigo-300 px-1.5 py-0.5 rounded-full font-bold"
                                                                        title={lineasDeEstaOT.length > 0
                                                                            ? `Agregada a mano en la vista previa: ${lineasDeEstaOT.length} proceso(s) sueltos`
                                                                            : "Agregada a mano en la vista previa (OT entera)"}
                                                                    >
                                                                        A mano
                                                                    </span>
                                                                )}
                                                                {forzarOrdenIds.has(ordenId) && (
                                                                    <span
                                                                        className="text-[9px] uppercase tracking-wider bg-amber-100 text-amber-800 border border-amber-300 px-1.5 py-0.5 rounded-full font-bold"
                                                                        title="OT forzada — el motor amplió el rango para incluirla"
                                                                    >
                                                                        Forzada
                                                                    </span>
                                                                )}
                                                                {/* Se le tocaron los procesos y el plan todavía no se rehizo. Va en la
                                                                    fila cerrada para poder encontrar la OT sin desplegarlas todas. */}
                                                                {cambiosDeLaOT && (
                                                                    /* Era una pastilla en MAYÚSCULA con un triángulo de peligro que
                                                                       decía «PROCESOS CAMBIADOS» y nada más: gritaba, no informaba, y
                                                                       encima parecía otra cosa que las demás marcas de la fila. Julián,
                                                                       17/09/2026: *"ese cartel de procesos cambiados chiquito me parece
                                                                       horrible"*. Ahora dice CUÁNTOS son y con qué falta hacer —que es
                                                                       el dato— en el mismo tono que los otros chips de la fila. */
                                                                    <span
                                                                        /* `whitespace-nowrap`: la columna del ID es angosta y «1 cambio sin
                                                                           recalcular» se partía en tres renglones, con el lápiz colgando
                                                                           en el medio. Julián, 17/09/2026: *"es horrible y se corta"*. El
                                                                           texto queda en dos palabras y el resto se lee en el globito.

                                                                           Y va en el rojo de Longchamps, el mismo #DC143C de los botones
                                                                           de la app: es la marca de «esto lo editó alguien» y se repite
                                                                           igual en las filas de adentro, así que el ojo la ata sola. */
                                                                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-[#DC143C]/25 bg-[#DC143C]/[0.07] px-1.5 py-0.5 text-[11px] font-semibold text-[#DC143C]"
                                                                        title={`${resumirCambios(cambiosDeLaOT)}. Está guardado en la orden; lo que falta es recalcular para que los horarios de esta OT valgan.`}
                                                                    >
                                                                        <Pencil className="h-2.5 w-2.5 shrink-0" />
                                                                        {contarCambios(cambiosDeLaOT) === 1 ? "1 cambio" : `${contarCambios(cambiosDeLaOT)} cambios`}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </td>
                                                        {ve("entrada") && <td className="px-4 py-3 text-inherit opacity-90">{formatDate(firstItem.fecha_entrada)}</td>}
                                                        {ve("cliente") && (
                                                            <td className="px-4 py-2 text-gray-500 italic">
                                                                <span className="line-clamp-2 leading-snug" title={firstItem.cliente || ""}>
                                                                    {nombreLindo(firstItem.cliente) || "-"}
                                                                </span>
                                                            </td>
                                                        )}
                                                        {ve("codigo") && <td className="px-4 py-3 font-mono text-xs text-inherit opacity-80">{firstItem.codigo || "-"}</td>}
                                                        {ve("articulo") && (
                                                            <td className="px-4 py-2 text-inherit max-w-[420px]">
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
                                                            <MaterialChip estado={firstItem.estado_material} noLleva={(firstItem as any).no_lleva_materia_prima} />
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
                                                                                <span>+{maxDelayDays.toLocaleString("es-AR")} {maxDelayDays === 1 ? "día" : "días"}</span>
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
                                                                                    <span className="font-bold text-red-700 tabular-nums">+{maxDelayDays.toLocaleString("es-AR")} {maxDelayDays === 1 ? "día" : "días"}</span>
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
                                                        {/* Acciones: editar los procesos de la OT y quitarla del plan.
                                                            Click no debe expandir la fila. */}
                                                        <td className="px-2 py-3 text-center whitespace-nowrap">
                                                            <Button
                                                                variant="ghost"
                                                                size="icon"
                                                                className="h-7 w-7 text-gray-400 hover:text-red-600 hover:bg-red-50"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setQuitandoOT({
                                                                        id: ordenId,
                                                                        numero: String(firstItem.id_otvieja || ordenId),
                                                                    });
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

                                                                    {/* Los procesos se editan en la fila (Julián, 17/09) y lo que se edita es
                                                                        la ORDEN, no el plan. Mientras no se recalcule, este cartel dice que
                                                                        los horarios de abajo son los de antes del cambio: es la diferencia
                                                                        entre "ya está arreglado" y "ya está arreglado en la OT".

                                                                        La frase de "queda guardado aunque descartes el borrador" es a
                                                                        propósito la contraria de la que usan los ajustes «Solo en este
                                                                        plan» ("no queda guardado en ningún lado"): son las dos mitades de
                                                                        la misma regla y conviene que se lean igual en los dos lados. */}
                                                                    {cambiosDeLaOT && (
                                                                        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-orange-300 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                                                                            <AlertTriangle className="w-4 h-4 shrink-0 text-orange-600" />
                                                                            <span className="flex-1 min-w-[260px] leading-snug">
                                                                                {/* «Cambiaste N procesos» contaba mal y se contradecía con lo que
                                                                                    venía entre paréntesis: mover un paso mostraba «Cambiaste 0
                                                                                    procesos de esta OT (cambió el orden de los pasos)». Ahora el
                                                                                    número cuenta el reordenamiento (contarCambios) y la frase habla
                                                                                    de CAMBIOS y no de procesos, que es lo que se está contando. */}
                                                                                <strong>
                                                                                    {contarCambios(cambiosDeLaOT) === 1
                                                                                        ? "Hiciste 1 cambio en los pasos de esta OT"
                                                                                        : `Hiciste ${contarCambios(cambiosDeLaOT)} cambios en los pasos de esta OT`}
                                                                                </strong>
                                                                                {` (${resumirCambios(cambiosDeLaOT)}). `}
                                                                                <strong>Queda guardado en la orden aunque descartes el borrador.</strong>
                                                                                {" "}Lo que falta es el plan: los horarios de abajo se calcularon antes del cambio,
                                                                                así que hay que recalcular para que valgan.
                                                                            </span>
                                                                            {/* Deshacer va ANTES de recalcular: primero la salida barata —volver
                                                                                atrás lo último— y después la cara, que rehace el plan entero.
                                                                                Cada acción se deshace con su inversa exacta (ver `deshacer` en
                                                                                useProcesosEnPlan), así que si la OT vuelve a quedar como estaba,
                                                                                este cartel desaparece solo. */}
                                                                            {procesosEnPlan.sePuedeDeshacer(ordenId) && (
                                                                                <Button
                                                                                    size="sm"
                                                                                    variant="ghost"
                                                                                    className="h-7 shrink-0 px-2 text-xs text-orange-900 hover:bg-orange-100"
                                                                                    disabled={isCalculating || isConfirming || editandoEstaOT}
                                                                                    onClick={() => void procesosEnPlan.deshacer(ordenId)}
                                                                                    title="Volver atrás el último cambio que hiciste en los pasos de esta OT"
                                                                                >
                                                                                    <RotateCcw className={cn("mr-1 h-3 w-3", editandoEstaOT && "animate-spin")} />
                                                                                    Deshacer
                                                                                </Button>
                                                                            )}
                                                                            <Button
                                                                                size="sm"
                                                                                variant="outline"
                                                                                className="h-7 shrink-0 border-orange-400 bg-white px-2 text-xs text-orange-900 hover:bg-orange-100"
                                                                                disabled={isCalculating || isConfirming || !onRecalculate}
                                                                                onClick={() => handleRecalculate()}
                                                                                title="Volver a repartir el trabajo con los procesos como quedaron. Se rehacen los horarios de TODO el plan, no sólo los de esta OT."
                                                                            >
                                                                                <RefreshCw className={cn("mr-1 h-3 w-3", isCalculating && "animate-spin")} />
                                                                                Recalcular el plan
                                                                            </Button>
                                                                        </div>
                                                                    )}

                                                                    {/* `w-full` y no `w-max`: con el panel de carga abierto la tabla se
                                                                        quedaba en su ancho mínimo y sobraba media pantalla en blanco a la
                                                                        derecha (Julián, 17/09/2026: *"se me hace rarisimo que quede un
                                                                        espacio en blanco tan grande ahi"*). El sobrante se lo lleva la
                                                                        columna del proceso, que es la que más lo necesita: es donde se
                                                                        cortan los nombres largos. */}
                                                                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm w-full">
                                                                        <div className="grid grid-cols-[auto_minmax(200px,1fr)_auto_auto_auto_auto] gap-0 text-sm">
                                                                            {/* Inner Header */}
                                                                            <div className="contents text-xs font-bold text-gray-500 uppercase bg-gray-100/50">
                                                                                <div className="px-3 py-1.5 border-b" title="Paso. Escribí el número para mover el proceso de lugar">#</div>
                                                                                <div className="px-3 py-1.5 border-b">Proceso</div>
                                                                                <div className="px-3 py-1.5 border-b">Recurso humano</div>
                                                                                <div className="px-3 py-1.5 border-b">Recurso maquinaria</div>
                                                                                <div className="px-3 py-1.5 border-b">Inicio</div>
                                                                                <div className="px-3 py-1.5 border-b text-right">Paso</div>
                                                                            </div>

                                                                            {/* Inner Body: procesos auto-asignados (editables) */}
                                                                            {procesosVisibles.map((item, idx) => {
                                                                                const effectiveItem = getEffectiveItem(item);
                                                                                /* Un retoque a mano —persona, máquina u horario— también es un
                                                                                   cambio de esta fila y se marca igual (Julián, 17/09/2026: *"si un
                                                                                   cambio de recurso humano maquinaria u horario también quiero que se
                                                                                   marque el renglón en rojo"*). Hasta acá sólo se marcaba lo que
                                                                                   tocaba la ORDEN —cambiar el proceso, moverlo de lugar—, y quedaba
                                                                                   la mitad de lo que uno toca sin ninguna señal. */
                                                                                const retocadaAMano = !!(editedResults[claveDeEdicion(item)] || editedResults[claveVieja(item)]);
                                                                                const limitacionElegida = limitacionDeMaquina(
                                                                                    availableMachines.find((m: any) => m.id === effectiveItem.id_maquinaria)
                                                                                );
                                                                                // Esta pasada la eligió alguien a mano (no vino con la OT entera).
                                                                                const lineaId = item.id_orden_trabajo_proceso ?? null;
                                                                                const procesoAMano = lineaId != null && lineasAMano.has(lineaId);

                                                                                // Lo que se le editó a ESTA pasada desde que se calculó el plan.
                                                                                const cambio = lineaId != null ? cambiosDeLaOT?.lineas[lineaId] : undefined;
                                                                                // El nombre y el proceso que hay que mostrar son los de después del
                                                                                // cambio; la fila del plan sigue trayendo el de antes.
                                                                                const nombreProceso = cambio?.proceso?.ahora ?? effectiveItem.nombre_proceso;
                                                                                const idProcesoActual = cambio?.proceso?.id ?? effectiveItem.proceso_id;
                                                                                /** El horario que se ve es de antes del cambio: o de esta fila, o del
                                                                                 *  reordenamiento, que le mueve el lugar a toda la OT. */
                                                                                const horarioViejo = !!cambio || !!cambiosDeLaOT?.pasos;
                                                                                // La segunda persona de un proceso comparte la pasada con la fila de
                                                                                // arriba: editarla dos veces sería editar lo mismo.
                                                                                const noSeEdita = isCalculating || isConfirming || lineaId == null || !!item.slot_extra;
                                                                                const motivoNoSeEdita = lineaId == null
                                                                                    ? "Esta fila no está atada a un paso de la orden (plan viejo): recalculá para poder editarla."
                                                                                    : item.slot_extra
                                                                                        ? "Es otra persona en el mismo paso: se edita en el renglón de arriba."
                                                                                        : undefined;
                                                                                /* El orden original, dejado sólo con las pasadas que se ven: es
                                                                                   contra ésta que se sabe si ESTA fila se movió. `ordenOriginal`
                                                                                   es la lista COMPLETA de la OT y el plan puede mostrar menos,
                                                                                   así que comparar posiciones sin filtrar daría cualquier cosa. */
                                                                                const ordenOriginalVisible = cambiosDeLaOT?.ordenOriginal
                                                                                    ? cambiosDeLaOT.ordenOriginal.filter(id => pasadasVisibles.includes(id))
                                                                                    : null;
                                                                                const posPasada = lineaId != null ? pasadasVisibles.indexOf(lineaId) : -1;
                                                                                /** Se movió de lugar: estaba en otro paso antes de que tocaran la OT. */
                                                                                const filaMovida = !!ordenOriginalVisible && lineaId != null
                                                                                    && ordenOriginalVisible.indexOf(lineaId) !== posPasada;
                                                                                /** Algo de ESTA fila cambió: el proceso, o el lugar que ocupa. */
                                                                                const filaEditada = !!cambio || filaMovida || retocadaAMano;
                                                                                const vecinoArriba = posPasada > 0 ? pasadasVisibles[posPasada - 1] : null;
                                                                                const vecinoAbajo = posPasada >= 0 && posPasada < pasadasVisibles.length - 1
                                                                                    ? pasadasVisibles[posPasada + 1]
                                                                                    : null;
                                                                                return (
                                                                                    <div key={claveDeEdicion(item)} className={cn(
                                                                                        "contents group/row",
                                                                                        // El cambio sin recalcular gana sobre el violeta de "a mano":
                                                                                        // es lo que hay que ver antes de guardar el plan.
                                                                                        /* El rojo de Longchamps para lo editado (Julián, 17/09/2026:
                                                                                           *"un pequeño color rojo […] para que de a entender que algo
                                                                                           fue editado o modificado"*). El violeta de «agregado a mano»
                                                                                           se queda: es otra cosa —no lo editaron, lo puso el que
                                                                                           armaba el plan— y tenerlas separadas es lo que permite
                                                                                           distinguirlas de un vistazo. */
                                                                                        filaEditada ? "[&>div]:bg-[#DC143C]/[0.045]" : procesoAMano && "[&>div]:bg-indigo-50/60",
                                                                                    )}>
                                                                                        <div className="px-3 py-1.5 border-b flex items-center gap-1 text-gray-400 font-mono text-xs">
                                                                                            {(filaEditada || procesoAMano) && (
                                                                                                <span
                                                                                                    className={cn(
                                                                                                        "w-0.5 self-stretch -ml-3 mr-1 rounded-r",
                                                                                                        filaEditada ? "bg-[#DC143C]" : "bg-indigo-500",
                                                                                                    )}
                                                                                                    title={filaEditada
                                                                                                        ? (cambio ? "Le cambiaste el proceso a este paso"
                                                                                                            : filaMovida ? "Este paso cambió de lugar"
                                                                                                                : "Le cambiaste a mano la persona, la máquina o el horario")
                                                                                                        : "Lo agregaste vos al plan"}
                                                                                                />
                                                                                            )}
                                                                                            <PasoEnPlanEditable
                                                                                                paso={idx + 1}
                                                                                                total={pasadasVisibles.length}
                                                                                                bloqueado={noSeEdita}
                                                                                                motivoBloqueo={motivoNoSeEdita}
                                                                                                trabajando={editandoEstaOT}
                                                                                                onMover={(pos) => void procesosEnPlan.moverAPosicion(
                                                                                                    ordenId, lineaId!, pos, pasadasVisibles)}
                                                                                            />
                                                                                        </div>
                                                                                        {/* Nombre y minutos en la MISMA línea: apilados sumaban un renglón
                                                                                            por proceso para un dato de cuatro caracteres. */}
                                                                                        <div className="px-3 py-1.5 border-b flex flex-col justify-center">
                                                                                            <div className="flex items-baseline gap-2 min-w-0">
                                                                                                <NombreDeProcesoEditable
                                                                                                    texto={capitalize(nombreProceso)}
                                                                                                    idProceso={idProcesoActual}
                                                                                                    procesos={catalogoProcesos}
                                                                                                    cambio={cambio}
                                                                                                    bloqueado={noSeEdita}
                                                                                                    motivoBloqueo={motivoNoSeEdita}
                                                                                                    trabajando={editandoEstaOT}
                                                                                                    onCambiar={(id, nombre) => void procesosEnPlan.cambiarProceso(
                                                                                                        ordenId, lineaId!, id, nombre, effectiveItem.nombre_proceso, idProcesoActual)}
                                                                                                />
                                                                                                <MinutosDelProceso minutos={effectiveItem.duracion_min} />
                                                                                                {/* Lo agregado a mano se distingue de lo que trajo la OT.
                                                                                                    La X saca esta pasada sola: sin ella, corregir "elegí
                                                                                                    la fresadora de otra OT" era tirar la OT entera y
                                                                                                    volver a tildar sus procesos uno por uno. */}
                                                                                                {procesoAMano && (
                                                                                                    <span className="shrink-0 inline-flex items-center gap-1 text-xs text-indigo-700 bg-indigo-100 border border-indigo-200 px-1.5 rounded font-medium">
                                                                                                        A mano
                                                                                                        <button
                                                                                                            type="button"
                                                                                                            onClick={() => quitarLineaAMano(item.orden_id, lineaId!)}
                                                                                                            disabled={isCalculating || isConfirming || !onRecalculate}
                                                                                                            className="text-indigo-400 hover:text-red-600 disabled:opacity-40 disabled:hover:text-indigo-400"
                                                                                                            title="Quitar este proceso del plan y recalcular"
                                                                                                        >
                                                                                                            <XIcon className="w-3 h-3" />
                                                                                                        </button>
                                                                                                    </span>
                                                                                                )}
                                                                                                {/* Tercerizado: sale sin operario y sin máquina a propósito, porque
                                                                                                    lo hace un tercero. Sin esta marca se lee como un hueco por
                                                                                                    falta de rango, que es un problema distinto. */}
                                                                                                {effectiveItem.tercerizado && (
                                                                                                    <span
                                                                                                        className="text-xs text-violet-700 bg-violet-50 border border-violet-200 px-1.5 rounded font-medium"
                                                                                                        title="Lo hace un tercero. Ocupa lugar en la secuencia de la OT, pero no lo hace nadie del taller: por eso va sin recurso humano y sin recurso maquinaria."
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
                                                                                                            Sin recurso humano asignado
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
                                                                                                {/* Mismo cuidado que en el select de máquina: sin min-w-0 y sin
                                                                                                    truncar, un nombre largo empuja la caja y se monta sobre la
                                                                                                    columna de al lado. */}
                                                                                                <SelectTrigger className="h-8 w-full text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-100 [&>span]:whitespace-nowrap [&>span]:text-left">
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
                                                                                                                {nombrePersona(op.nombre, op.apellido)} {(!op.disponible && !isPruebas) && "(Ausente)"}
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
                                                                                                    // `min-w-0` + truncado del texto: "AGUJEREADORA DE BANCO BURANI"
                                                                                                    // se salía de la caja y se montaba encima de la columna Inicio.
                                                                                                    className={cn(
                                                                                                        "h-8 w-full text-xs border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-blue-100 [&>span]:whitespace-nowrap [&>span]:text-left",
                                                                                                        // La limitación no entra en la caja sin ensanchar la columna, así que
                                                                                                        // acá queda el aviso en ámbar y el texto completo en el globito.
                                                                                                        limitacionElegida && "border-amber-300 bg-amber-50/50"
                                                                                                    )}
                                                                                                    title={[
                                                                                                        effectiveItem.usa_maquina === false
                                                                                                            ? "Proceso manual: no usa recurso maquinaria. Podés asignarle uno igual si querés."
                                                                                                            : "",
                                                                                                        limitacionElegida ? `Limitación: ${limitacionElegida}` : "",
                                                                                                    ].filter(Boolean).join(" — ") || undefined}
                                                                                                >
                                                                                                    <SelectValue placeholder="Sin asignar" />
                                                                                                </SelectTrigger>
                                                                                                <SelectContent>
                                                                                                    {/* "No necesita" ≠ "Sin asignar": embalado o pintura sin máquina
                                                                                                        no es un hueco a resolver, es lo normal (pedido de Julián 16/08). */}
                                                                                                    <SelectItem value="0" className="text-gray-400 italic">
                                                                                                        {effectiveItem.usa_maquina === false ? "No necesita" : "Sin asignar"}
                                                                                                    </SelectItem>
                                                                                                    {availableMachines.map(m => {
                                                                                                        const limitacion = limitacionDeMaquina(m);
                                                                                                        return (
                                                                                                            <SelectItem
                                                                                                                key={m.id}
                                                                                                                value={m.id.toString()}
                                                                                                                detail={limitacion
                                                                                                                    ? <span className="text-amber-700" title={limitacion}>⚠ {limitacion}</span>
                                                                                                                    : undefined}
                                                                                                            >
                                                                                                                {nombreLindo(m.nombre)}
                                                                                                            </SelectItem>
                                                                                                        );
                                                                                                    })}
                                                                                                </SelectContent>
                                                                                            </Select>
                                                                                        </div>

                                                                                        <div className="px-4 py-2 border-b flex items-center">
                                                                                            <Input
                                                                                                type="datetime-local"
                                                                                                className={cn(
                                                                                                    "h-8 text-xs px-2 border-gray-200 bg-gray-50/50 focus:ring-1 focus:ring-amber-200",
                                                                                                    // Se marca la HORA, no sólo la fila: es el dato que dejó de
                                                                                                    // ser cierto cuando cambiaron los minutos o el orden.
                                                                                                    horarioViejo && "border-orange-400 bg-orange-50 text-orange-900 font-medium",
                                                                                                )}
                                                                                                title={horarioViejo
                                                                                                    ? "Este horario se calculó antes del cambio. Recalculá para que el plan lo acomode, o dejalo y guardá así."
                                                                                                    : undefined}
                                                                                                value={effectiveItem.fecha_inicio_estimada ? effectiveItem.fecha_inicio_estimada.slice(0, 16) : getDateFromMin(effectiveItem.inicio_min)}
                                                                                                onChange={(e) => handleDateChange(item, e.target.value)}
                                                                                            />
                                                                                        </div>

                                                                                        {/* Mover el paso y sacarlo de la OT. */}
                                                                                        <div className="px-2 py-1.5 border-b flex items-center">
                                                                                            <AccionesDeProcesoEnPlan
                                                                                                nombre={nombreProceso}
                                                                                                bloqueado={noSeEdita}
                                                                                                motivoBloqueo={motivoNoSeEdita}
                                                                                                trabajando={editandoEstaOT}
                                                                                                onBorrar={() => void procesosEnPlan.borrarLinea(
                                                                                                    ordenId, idProcesoActual, lineaId!, nombreProceso,
                                                                                                    effectiveItem.duracion_min ?? 0)}
                                                                                            />
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}

                                                                            {/* Los pasos agregados desde acá.
                                                                                Están en la OT, pero el plan todavía no les buscó lugar: se
                                                                                muestran igual —si no, agregar un proceso no se ve en ningún
                                                                                lado hasta recalcular— y con el horario vacío, que es la
                                                                                verdad. Van al final porque es donde los puso la orden. */}
                                                                            {(cambiosDeLaOT?.nuevas ?? []).map((nueva, i) => (
                                                                                <div key={`nueva-${nueva.idOtp}`} className="contents group/row [&>div]:bg-emerald-50/60">
                                                                                    <div className="px-3 py-1.5 border-b flex items-center gap-1 text-gray-400 font-mono text-xs">
                                                                                        <span className="w-0.5 self-stretch -ml-3 mr-1 bg-emerald-500 rounded-r" />
                                                                                        {procesosVisibles.length + i + 1}
                                                                                    </div>
                                                                                    <div className="px-3 py-1.5 border-b flex items-center">
                                                                                        <div className="flex items-baseline gap-2 min-w-0">
                                                                                            <NombreDeProcesoEditable
                                                                                                texto={capitalize(nueva.nombre)}
                                                                                                idProceso={nueva.idProceso}
                                                                                                procesos={catalogoProcesos}
                                                                                                esNueva
                                                                                                bloqueado={isCalculating || isConfirming}
                                                                                                trabajando={editandoEstaOT}
                                                                                                onCambiar={(id, nombre) => void procesosEnPlan.cambiarProceso(
                                                                                                    ordenId, nueva.idOtp, id, nombre, nueva.nombre, nueva.idProceso)}
                                                                                            />
                                                                                            <MinutosDelProceso minutos={nueva.minutos} />
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="px-4 py-2 border-b flex items-center text-xs text-gray-500 italic">
                                                                                        Lo elige el plan
                                                                                    </div>
                                                                                    <div className="px-4 py-2 border-b flex items-center text-xs text-gray-500 italic">
                                                                                        Lo elige el plan
                                                                                    </div>
                                                                                    <div className="px-4 py-2 border-b flex items-center text-xs font-medium text-emerald-800">
                                                                                        Sin horario todavía
                                                                                    </div>
                                                                                    <div className="px-2 py-1.5 border-b flex items-center">
                                                                                        <AccionesDeProcesoEnPlan
                                                                                            nombre={nueva.nombre}
                                                                                            bloqueado={isCalculating || isConfirming}
                                                                                            trabajando={editandoEstaOT}
                                                                                            onBorrar={() => void procesosEnPlan.borrarLinea(
                                                                                                ordenId, nueva.idProceso, nueva.idOtp, nueva.nombre, nueva.minutos)}
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>

                                                                        {/* Agregar un paso a la OT sin salir del plan. */}
                                                                        <div className="border-t border-gray-100">
                                                                            <AgregarProcesoEnPlan
                                                                                procesos={catalogoProcesos}
                                                                                bloqueado={isCalculating || isConfirming}
                                                                                trabajando={editandoEstaOT}
                                                                                onAbrir={() => void pedirCatalogoProcesos()}
                                                                                onAgregar={(id, nombre, minutos) => void procesosEnPlan.agregarLinea(
                                                                                    ordenId, id, nombre, minutos)}
                                                                            />
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
                                                                                        title="Configurar rangos y recurso humano en Recursos"
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
                                                                                    const limitacionU = limitacionDeMaquina(
                                                                                        availableMachines.find((m: any) => m.id === effU.id_maquinaria)
                                                                                    );
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
                                                                                                    <SelectValue placeholder="Recurso humano" />
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
                                                                                                                {nombrePersona(op.nombre, op.apellido)}
                                                                                                            </SelectItem>
                                                                                                        );
                                                                                                    })}
                                                                                                </SelectContent>
                                                                                            </Select>
                                                                                            <Select
                                                                                                value={effU.id_maquinaria?.toString() || "0"}
                                                                                                onValueChange={(val) => handleUpdate(u, 'id_maquinaria', val === "0" ? null : parseInt(val))}
                                                                                            >
                                                                                                <SelectTrigger
                                                                                                    className={cn(
                                                                                                        "h-7 text-[11px] px-2",
                                                                                                        // Un manual sin máquina no es un pendiente: no va en rojo.
                                                                                                        effU.usa_maquina === false && !effU.id_maquinaria
                                                                                                            ? "border-gray-200 bg-gray-50/50"
                                                                                                            : !effU.id_maquinaria ? "border-red-300 bg-red-50/40" : "border-green-300 bg-green-50/40"
                                                                                                    )}
                                                                                                    // El verde acá dice "ya lo resolviste": la limitación no se lo pisa, va en el globito.
                                                                                                    title={limitacionU ? `Limitación: ${limitacionU}` : undefined}
                                                                                                >
                                                                                                    <SelectValue placeholder="Recurso maquinaria" />
                                                                                                </SelectTrigger>
                                                                                                <SelectContent>
                                                                                                    <SelectItem value="0" className="text-gray-400 italic">
                                                                                                        {effU.usa_maquina === false ? "No necesita" : "Sin asignar"}
                                                                                                    </SelectItem>
                                                                                                    {availableMachines.map(m => {
                                                                                                        const limitacion = limitacionDeMaquina(m);
                                                                                                        return (
                                                                                                            <SelectItem
                                                                                                                key={m.id}
                                                                                                                value={m.id.toString()}
                                                                                                                detail={limitacion
                                                                                                                    ? <span className="text-amber-700" title={limitacion}>⚠ {limitacion}</span>
                                                                                                                    : undefined}
                                                                                                            >
                                                                                                                {nombreLindo(m.nombre)}
                                                                                                            </SelectItem>
                                                                                                        );
                                                                                                    })}
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
                        // Borde arriba cuando va apilado abajo de la tabla, a la izquierda
                        // cuando va al costado.
                        "bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-200 flex flex-col shrink-0 transition-[width] duration-200",
                        // Sticky con alto propio: la carga de operarios queda a la vista
                        // mientras la lista corre al lado, en vez de irse para arriba a los
                        // dos scrolls. `top-[136px]` la deja justo abajo de la cabecera
                        // sticky (título + riel de cifras).
                        // `max-h` y no `h`: con alto fijo, cuando la lista de avisos es corta
                        // la fila mide menos que el panel y el panel se desborda por abajo,
                        // pisando el pie. Con max-h se estira hasta donde hay lugar y no más.
                        // `flex flex-col` para que la lista de adentro pueda tomar el resto
                        // y ser la única que scrollea.
                        // Todo eso sólo desde `lg`, que es cuando va al costado: apilado
                        // abajo de la tabla no hay nada que acompañar, y pegado se habría
                        // montado encima de la lista.
                        "lg:sticky lg:top-[var(--alto-cabecera)] lg:max-h-[calc(100svh-var(--alto-cabecera)-5rem)] lg:self-start overflow-hidden flex flex-col",
                        // Apilado (abajo de `lg`) ocupa el ancho entero; al costado, los
                        // anchos de siempre. El piso de 300px es sólo de `lg` para arriba:
                        // en un teléfono se llevaba 301 de los 327 de la fila.
                        !cargaAbierta ? "w-full lg:w-11"
                            : cargaCompleta ? "w-full lg:w-[min(34vw,520px)]"
                                : "w-full lg:w-[min(24vw,380px)] lg:min-w-[300px]"
                    )}>
                        {!cargaAbierta ? (
                            /* El riel plegado no es una franja muerta: sigue diciendo
                               cuántos operarios quedan pasados de lo que pueden trabajar en
                               el período del plan. Plegar resume,
                               no esconde. */
                            /* Al costado (`lg`) es un riel vertical con el texto parado;
                               apilado abajo de la tabla, una barra acostada que se despliega
                               para abajo: la flecha apunta hacia donde se abre. */
                            <button
                                type="button"
                                onClick={alternarCarga}
                                // El globito rojo solo no se entiende en la tablet (no hay
                                // mouse encima): el nombre accesible dice qué cuenta. Cuenta
                                // TODO el plan, no la semana que abre el panel.
                                title={tituloDelRiel}
                                aria-label={tituloDelRiel}
                                className="flex-1 w-full flex flex-row lg:flex-col items-center gap-3 px-4 lg:px-0 py-3 hover:bg-gray-100 transition-colors"
                            >
                                <ChevronRight className="w-4 h-4 text-gray-400 rotate-90 lg:rotate-180 shrink-0 order-last ml-auto lg:order-none lg:ml-0" />
                                <User className="w-4 h-4 text-gray-500 shrink-0" />
                                {sobrecargados > 0 && (
                                    <span className="rounded-full bg-rose-600 text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center tabular-nums shrink-0">
                                        {sobrecargados}
                                    </span>
                                )}
                                <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-500 lg:[writing-mode:vertical-rl]">
                                    Carga de recurso humano
                                </span>
                            </button>
                        ) : (
                            /* El panel dibuja encabezado, lista y pie; el contenedor, el
                               riel plegado y `saltoCarga` siguen acá. Las cuentas viven en
                               `lib/cargaDelPlan.ts`, que tiene su test. */
                            <PanelCargaRecursoHumano
                                filas={filasParaCarga}
                                operarios={availableOperators}
                                cargaPrevia={operatorLoads}
                                feriados={feriados}
                                span={spanPlan}
                                periodoSinFechas={periodoDeCarga}
                                diasDelTaller={diasDelTaller}
                                excedentesMin={excedentesMin}
                                rangos={rangosCatalog}
                                saltoCarga={saltoCarga}
                                completa={cargaCompleta}
                                onAlternarCompleta={() => setCargaCompleta(v => !v)}
                                onPlegar={alternarCarga}
                                onVerOT={verOT}
                                onVerSinNadie={() => setFiltros(f => ({ ...f, sinOperario: true }))}
                                onIrAAvisos={diagnosticos.length > 0 ? irAAvisos : undefined}
                                cargaTotalMin={totalDemandMinutes}
                            />
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
                                <div className="text-[11px] text-gray-500">El motor está distribuyendo los procesos entre el recurso humano y los horarios disponibles...</div>
                            </div>
                        </div>
                    </div>
                )}
        </PantallaPlanificador>
        {/* Primer eslabón: lo marcado que el plan de la pantalla todavía no tiene.
            Avisa y deja seguir: guardar el plan como está puede ser lo que se quiere.
            «Volver y recalcular» es la salida recomendada, y va con el color fuerte. */}
        <Dialog open={showDesactualizadoWarn} onOpenChange={setShowDesactualizadoWarn}>
            <DialogContent className="sm:max-w-[480px]">
                <DialogHeader className="gap-2">
                    <div className="flex items-center gap-2">
                        <div className="rounded-full bg-amber-100 p-2 text-amber-600">
                            <AlertTriangle className="h-5 w-5" />
                        </div>
                        <DialogTitle>El plan todavía no tiene {textoCambios(cantidadPendientes)}</DialogTitle>
                    </div>
                    <DialogDescription className="pt-2 text-left">
                        Lo que se guarda es el plan de la pantalla, y se calculó antes de estos cambios.
                        {" "}Si guardás igual, sale sin los arreglos recién marcados
                        {procesosEnPlan.hayCambios ? " y con los horarios de antes de editar los procesos (los pasos nuevos no tienen lugar todavía)" : ""}.
                        {" "}Lo que guardaste en Recursos queda guardado igual. Recalcular tarda {tardaElRecalculo}.
                    </DialogDescription>
                </DialogHeader>
                <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] leading-snug text-amber-950">
                    {pendientes.map(p => (
                        <li key={p.clave} className="flex gap-1.5">
                            <span className="text-amber-500">•</span>
                            <span className="min-w-0">{p.texto}</span>
                        </li>
                    ))}
                </ul>
                <DialogFooter className="mt-2 gap-2 sm:gap-0">
                    <Button
                        variant="outline"
                        type="button"
                        onClick={() => { setShowDesactualizadoWarn(false); seguirGuardando(); }}
                    >
                        Guardar igual
                    </Button>
                    {onRecalculate && (
                        <Button
                            type="button"
                            className="bg-amber-500 text-white hover:bg-amber-600"
                            onClick={() => { setShowDesactualizadoWarn(false); handleRecalculate(); }}
                        >
                            Volver y recalcular
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
        {/* Segundo eslabón: se guarda un plan que salió de datos que no están cargados.
            Cuenta qué se aplicó y deja las dos salidas abiertas —guardar igual, o volver
            y dejarlo cargado de verdad con «Guardar en Recursos»—. */}
        <ConfirmationDialog
            isOpen={showAjustesWarn}
            onClose={() => setShowAjustesWarn(false)}
            onConfirm={seguirDespuesDeAjustes}
            title="Este plan salió con arreglos que no están cargados"
            description={
                `Para destrabar este plan se aplicaron ${ajustesDelPlanMostrado(ajustesDelPlan).length} ${ajustesDelPlanMostrado(ajustesDelPlan).length === 1 ? "arreglo que vale" : "arreglos que valen"} `
                // Sin descripción no se inventa una lista vacía: se dice igual cuántos son.
                + (resumenDeAjustes ? `solo para él: ${resumenDeAjustes}. ` : "solo para él. ")
                + "Eso NO quedó cargado en el sistema: en Recursos los datos siguen como estaban. "
                + "O sea que este plan le reparte trabajo a alguien o a una máquina que, según los datos del taller, no lo puede tomar, "
                + "y una vez guardado no queda nada en pantalla que lo explique. "
                + "Si el cambio es de verdad, volvé y aplicalo con «Guardar en Recursos» en cada aviso; "
                + "si era solo para esta tanda, guardá igual."
            }
            confirmText="Guardar igual"
            cancelText="Volver y cargarlos"
        />
        <ConfirmationDialog
            isOpen={showForzarWarn}
            onClose={() => setShowForzarWarn(false)}
            onConfirm={() => { setShowForzarWarn(false); handleConfirmWithDecisions(); }}
            title="Hay OT sin forzar"
            description={`Quedaron ${Object.keys(excedentesPorOrden).length} OT fuera del plan que no forzaste. Si guardás ahora, esas OT NO se incluyen. Cerrá este aviso para forzarlas, o guardá igual.`}
            confirmText="Guardar igual"
            cancelText="Volver a revisar"
        />
        <ConfirmationDialog
            isOpen={quitandoOT !== null}
            onClose={() => setQuitandoOT(null)}
            onConfirm={() => {
                const ot = quitandoOT;
                setQuitandoOT(null);
                if (ot) handleRemoveOrderAndRecalculate(ot.id);
            }}
            title={`Sacar la OT #${quitandoOT?.numero ?? ""} del plan`}
            description="El plan se recalcula sin ella y el reparto de las otras OT puede cambiar. La orden NO se toca: sigue como estaba y se puede volver a planificar cuando quieras. Si te arrepentís, el aviso que sale después trae un «Deshacer»."
            confirmText="Sí, sacarla"
            cancelText="Volver"
            variant="destructive"
        />
        </>
    );
}
