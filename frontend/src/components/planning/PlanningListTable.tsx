"use client";

import React from "react";
import { WorkOrder, PlanificacionItem } from "@/lib/types";
import { AddProcessRow } from "@/components/planning/AddProcessRow";
import { RegistrarIncidenciaModal } from "@/components/planning/RegistrarIncidenciaModal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, getWorkOrderRowColor, parseApiError } from "@/lib/utils";
import {
    useOrdenesConPlano,
    usePlanosDisponibles,
    estadoPlano,
    rankPlano,
} from "@/hooks/useOrdenesConPlano";
import { PlanoDeOrden } from "@/components/common/PlanoDeOrden";
import { Input } from "@/components/ui/input";
import {
    Search, ChevronDown, ChevronRight, CalendarClock,
    Pencil,
    LayoutDashboard,
    Save,
    X,
    PlusCircle,
    Plus,
    GripVertical,
    AlertCircle,
    AlertTriangle,
    Check,
    CheckCircle2,
    Users,
    FileWarning
} from "lucide-react";
import { toast } from "sonner";
import { OrderFiles } from "@/components/common/OrderFiles";
import { Button } from "@/components/ui/button";
import { DeliveryProgress } from "@/components/common/DeliveryProgress";
import { RegisterDeliveryDialog } from "@/components/planning/RegisterDeliveryDialog";


import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { Checkbox } from "@/components/ui/checkbox";
import {
    baseDelPlan,
    finDeLaFila,
    formatoCorto,
    inicioDeLaFila,
    minutosDesdeFecha,
    paraInputDatetimeLocal,
} from "@/lib/plan-fechas";
import { limitacionDeMaquina } from "@/lib/maquinas";
import { API_URL } from "@/config";
import { MaterialChip } from "@/components/common/MaterialChip";
import { rankMaterial, resumirMaterial } from "@/lib/materialOT";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

interface PlanningListTableProps {
    data: WorkOrder[];
    isLoading: boolean;
    onRowClick: (item: WorkOrder) => void;
    // `idOtp` = orden_trabajo_proceso.id: qué PASADA es. El mismo proceso puede estar
    // varias veces en la OT y cada una tiene su estado.
    onProcessStatusChange?: (ordenId: number, procesoId: number, newStatusId: number, idOtp?: number) => void;
    onProcessReorder?: (ordenId: number, newOrder: any[]) => void;
    /** Cambia el operario de UNA fila del plan. Se identifica por el id de la fila
     *  (`planificacion.id`) y no por (orden, proceso): con el mismo proceso repetido
     *  en la OT, ese par no distingue una pasada de la otra. */
    onOperatorChange?: (planId: number, operarioId: number) => void;
    onMachineryChange?: (planId: number, maquinariaId: number) => void;
    selectedIds?: number[];
    onSelectionChange?: (ids: number[]) => void;
    operarios?: any[];
    maquinarias?: any[]; // Added
    planificacion?: PlanificacionItem[];
    /** Días que el taller no trabaja (feriados, mantenimiento). Hacen falta para la
     *  VUELTA: lo que se guarda al corregir un horario a mano es el minuto, y ese minuto
     *  tiene que contar los mismos días que contó el backend al armar la fecha que se
     *  está viendo. Sin ellos, cada feriado en el medio corre el proceso un día. */
    feriados?: string[];
    /**
     * El día que se está mirando, para marcar qué pasos caen ahí.
     *
     * La vista Diaria muestra una OT si ALGÚN paso suyo toca ese día, y un paso largo
     * —soldar 2700 minutos son cinco jornadas y media— toca varios días seguidos. El
     * problema es que en pantalla se leía «Vie 11/09» estando parado un miércoles, y
     * parecía un error: no había forma de ver cuál de los pasos era el que estaba en
     * curso. Con esto, el que toca el día queda resaltado y dice por qué está.
     */
    diaResaltado?: Date;
    onDataChange?: () => void; // Added for refreshing data without reload
    hideStatus?: boolean; // New prop to hide status column
    highlightedIds?: number[]; // New prop for visual highlighting
    onFieldUpdate?: (ordenId: number, field: string, value: any) => Promise<void>;
    /** Zoom (%) aplicado SOLO a la tabla (no al search ni a las tarjetas mobile). */
    tableZoom?: number;
    /** Las OTs tildadas van arriba de la lista. El agrupamiento se recalcula al
     *  cambiar la búsqueda (no con cada tilde): reordenar en vivo movía la fila
     *  bajo el cursor y el siguiente click caía en la OT equivocada. */
    pinSelectedOnTop?: boolean;
    /** Qué decir cuando la lista está vacía. Sin esto las seis solapas mostraban la
     *  misma frase —"No hay órdenes activas en este momento"— y no se entendía si no
     *  había trabajo, si estaba en otro día o si algo había fallado. */
    mensajeVacio?: string;
    /** Modo compacto: sin el margen de arriba y con menos aire entre buscador y tabla.
        Lo usa el planificador, donde la tabla ya vive adentro de una tarjeta. */
    compacto?: boolean;
    /** Huella de los filtros de afuera. Cada vez que cambia se cierran las filas que
     *  estaban desplegadas. Sin esto la lista nueva aparece con las bandas abiertas
     *  de la vuelta anterior y no se entiende qué estás mirando. */
    colapsarFilasKey?: string;
}

/** Columnas ordenables de la tabla. TODAS las columnas con dato ordenan; las que
 *  no muestran un valor "ordenable" obvio (Material, Proceso, Plano, Entrega) usan
 *  un ranking explícito — ver `getSortValue`. */
type SortColumn =
    | 'id' | 'id_otvieja' | 'fecha_entrada' | 'cliente' | 'codigo' | 'descripcion'
    | 'n_pedido' | 'unidades' | 'prioridad' | 'material' | 'proceso' | 'plano'
    | 'estado' | 'entrega' | 'fecha_prometida' | 'fecha_entrega'
    | 'aprobado_por' | 'requerido_por';

/** Ranking del estado de material: peor primero (asc = "qué me falta"). Vive en
 *  lib/materialOT junto con el resto de la definición, porque antes esta función
 *  metía «sin stock» y «sin cargar» en el mismo cajón. */
const materialRank = rankMaterial;

/** Ranking de la columna Proceso: manda la CANTIDAD de procesos de la OT (una OT
 *  de 6 procesos antes que una de 2), y entre OTs con la misma cantidad desempata
 *  la que tiene más procesos terminados.
 *
 *  Antes ordenaba solo por avance (finalizados/total) y no se movía nada: en la
 *  planificación casi todas las OTs arrancan en 0 terminados, así que empataban
 *  todas en 0 (pedido de Lucas 14/08). */
const procesoRank = (item: WorkOrder) => {
    const total = item.procesos?.length || 0;
    if (total === 0) return 0;
    const finalizados = item.procesos.filter(p => p.estado_proceso?.id === 3).length;
    return total * 1000 + finalizados;
};

/** Estado derivado de la OT según el avance de sus procesos.
 *  Vive a nivel de módulo (y no adentro del componente) porque el ordenamiento por
 *  la columna Estado lo necesita ANTES, durante el `useMemo` de `sortedData`. */
const getOrderStatus = (order: WorkOrder) => {
    if (!order.procesos || order.procesos.length === 0) return 'Pendiente';

    const allFinalized = order.procesos.every(p => p.estado_proceso.id === 3);
    if (allFinalized) return 'Finalizado';

    const hasProgress = order.procesos.some(p => p.estado_proceso.id === 2 || p.estado_proceso.id === 3);
    if (hasProgress) return 'En Proceso';

    return 'Pendiente';
};

/** Columnas donde el PRIMER click ordena de mayor a menor (pedido de Lucas: "que
 *  me las ordene de mayor a menor"). Son las que son una cantidad: la OT más
 *  nueva, la mayor cantidad de piezas, la prioridad más alta, la OT con más
 *  procesos. Las demás arrancan al revés a propósito:
 *    - Material / Plano / Entrega: primero lo que FALTA (sin stock, sin plano,
 *      sin entregar), que es lo accionable.
 *    - Fechas: la más próxima primero.
 *    - Texto: A → Z. */
const PRIMER_CLICK_DESC: SortColumn[] = ['id', 'id_otvieja', 'unidades', 'prioridad', 'proceso'];

/** Proporción entregada (0..1). Sin unidades cargadas se considera 0. */
const entregaRank = (item: WorkOrder) => {
    const total = Number(item.unidades) || 0;
    const entregado = Number(item.cantidad_entregada) || 0;
    if (total <= 0) return entregado > 0 ? 1 : 0;
    return Math.min(entregado / total, 1);
};

export const PlanningListTable = React.memo(_PlanningListTable);

function _PlanningListTable({
    data,
    isLoading,
    onRowClick,
    onProcessStatusChange,
    onProcessReorder,
    onOperatorChange,
    onMachineryChange, // Added
    selectedIds = [],
    onSelectionChange,
    operarios = [],
    maquinarias = [], // Added
    planificacion = [],


    onDataChange, // Added
    hideStatus = false,
    highlightedIds = [],
    tableZoom = 100,
    mensajeVacio,
    feriados = [],
    diaResaltado,
    pinSelectedOnTop = false,
    compacto = false,
    colapsarFilasKey
}: PlanningListTableProps) {

    // Las dos preguntas sobre el plano, que hasta ahora eran una sola y por eso esta
    // columna decía "No" en todas las filas: los más de mil planos que hay cargados
    // cuelgan del ARTÍCULO, ninguno de una orden, así que el conjunto de abajo venía
    // vacío y la tabla negaba planos que están a un click.
    //   · `ordenesConPlano`   -> qué OT EXIGEN saber leer planos (filtro duro del
    //     planificador). No se toca: sumarle 198 OT de golpe es una decisión del taller.
    //   · `planosDisponibles` -> qué OT tienen algo PARA MIRAR, sea propio o del producto.
    // Acá se necesitan las dos porque la columna se puede ordenar, y ordenar es cosa de
    // la tabla; el badge de cada fila las vuelve a pedir por su cuenta, pero el hook
    // cachea la respuesta a nivel de módulo y sale un solo pedido para toda la pantalla.
    const ordenesConPlano = useOrdenesConPlano();
    const planosDisponibles = usePlanosDisponibles();

    const [sortConfig, setSortConfig] = React.useState<{
        key: SortColumn | null;
        direction: 'asc' | 'desc' | null
    }>({
        key: null,
        direction: null,
    });
    const [searchTerm, setSearchTerm] = React.useState("");
    const [expandedOrderIds, setExpandedOrderIds] = React.useState<number[]>([]);

    // B1 (feedback 06/07): staging de reasignaciones de OPERARIO y MÁQUINA en Planificadas.
    // Antes cada cambio se guardaba al instante; ahora se acumulan acá y se aplican al
    // tocar "Aceptar cambios". El avance (estado) y las fechas siguen guardando al toque.
    // Autoguardado: el staging se inicializa desde localStorage para sobrevivir a
    // un corte de luz / recarga (ver efectos de persistencia más abajo).
    const STAGING_KEY = "plan_pending_staging";
    // Cuántos cambios de una sesión anterior no se pudieron recuperar. Ver abajo.
    const perdidosAlAbrir = React.useRef(0);
    const [pendingRes, setPendingRes] = React.useState<Record<string, { operario?: number; maquina?: number }>>(() => {
        if (typeof window === "undefined") return {};
        try {
            const saved = JSON.parse(localStorage.getItem(STAGING_KEY) || "null");
            if (!saved || typeof saved !== "object") return {};
            // Se queda SÓLO con las claves del formato nuevo ("p<id de la fila del
            // plan>"). Las viejas eran "<orden>-<proceso>", que en una OT con el mismo
            // proceso repetido no distingue una pasada de la otra: aplicarlas a ciegas
            // sería cambiarle el operario a la pasada equivocada. Se descartan y se
            // avisa, que es mejor que hacerlo mal o que borrarlas en silencio.
            const vigentes: Record<string, { operario?: number; maquina?: number }> = {};
            for (const [clave, valor] of Object.entries(saved)) {
                if (/^p\d+$/.test(clave)) vigentes[clave] = valor as any;
                else perdidosAlAbrir.current++;
            }
            return vigentes;
        } catch { /* dato corrupto / sin localStorage: ignorar */ }
        return {};
    });
    // La clave del staging es la FILA del plan (`p<id>`). Era `${ordenId}-${procesoId}`,
    // que en una OT con el mismo proceso repetido mezclaba las dos pasadas en un solo
    // cambio pendiente. Las claves viejas que puedan estar guardadas en el navegador se
    // reconocen por el guión y se resuelven como antes, para no perder lo que alguien
    // haya dejado a medio hacer.
    const resKey = (planId?: number) => `p${planId ?? 0}`;
    const stageOperario = (planId: number, operarioId: number) =>
        setPendingRes(prev => ({ ...prev, [resKey(planId)]: { ...prev[resKey(planId)], operario: operarioId } }));
    const stageMaquina = (planId: number, maquinaId: number) =>
        setPendingRes(prev => ({ ...prev, [resKey(planId)]: { ...prev[resKey(planId)], maquina: maquinaId } }));
    const discardPending = () => setPendingRes({});
    const applyPending = () => {
        for (const [key, chg] of Object.entries(pendingRes)) {
            // Todas las claves que sobreviven al montaje son "p<id>": ver el useState.
            const planId = Number(key.slice(1));
            if (!planId) continue;
            if (chg.operario !== undefined && onOperatorChange) onOperatorChange(planId, chg.operario);
            if (chg.maquina !== undefined && onMachineryChange) onMachineryChange(planId, chg.maquina);
        }
        setPendingRes({});
    };

    // Aviso una sola vez si se recuperaron cambios de una sesión anterior (corte de luz / recarga).
    React.useEffect(() => {
        const n = Object.keys(pendingRes).length;
        if (n > 0) toast.info(`Se recuperaron ${n} cambio${n === 1 ? "" : "s"} sin guardar de una sesión anterior`);
        const perdidos = perdidosAlAbrir.current;
        if (perdidos > 0) {
            toast.warning(
                `No se pudieron recuperar ${perdidos} cambio${perdidos === 1 ? "" : "s"} sin guardar de una sesión anterior. `
                + "Volvé a elegir el recurso humano o la máquina.");
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persistencia del staging: se guarda ante cada cambio y se limpia al Aceptar/Descartar.
    React.useEffect(() => {
        try {
            if (Object.keys(pendingRes).length > 0) localStorage.setItem(STAGING_KEY, JSON.stringify(pendingRes));
            else localStorage.removeItem(STAGING_KEY);
        } catch { /* sin localStorage: ignorar */ }
    }, [pendingRes]);

    // Estado del scroll horizontal para mostrar/ocultar el gradient fade dinámicamente.
    // Cuando el usuario llega al final del scroll (no hay más columnas a la derecha),
    // ocultamos el fade para que no engañe diciendo "hay más".
    const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
    const [showRightFade, setShowRightFade] = React.useState(true);

    /**
     * Filas que el usuario cerró A MANO aunque la búsqueda las quiera abiertas.
     *
     * Buscar un proceso abre solas las filas que lo tienen (`procesoMatchIds`), y eso
     * está bien. Lo que estaba mal es que la flechita no podía cerrarlas: `toggleRow`
     * sólo escribe `expandedOrderIds`, así que sacar el id de ahí no cambiaba nada y
     * la fila seguía abierta. Clickeabas, no pasaba nada, clickeabas de nuevo y
     * tampoco — se lee exactamente como "la flechita se buguea".
     */
    const [cerradasAMano, setCerradasAMano] = React.useState<Set<number>>(new Set());

    const toggleRow = (orderId: number) => {
        const abiertaPorBusqueda = procesoMatchIds.has(orderId);
        const estaAbierta = expandedOrderIds.includes(orderId)
            || (abiertaPorBusqueda && !cerradasAMano.has(orderId));

        if (estaAbierta) {
            setExpandedOrderIds(prev => prev.filter(id => id !== orderId));
            if (abiertaPorBusqueda) {
                setCerradasAMano(prev => new Set(prev).add(orderId));
            }
            return;
        }
        setCerradasAMano(prev => {
            if (!prev.has(orderId)) return prev;
            const next = new Set(prev);
            next.delete(orderId);
            return next;
        });
        setExpandedOrderIds(prev => prev.includes(orderId) ? prev : [...prev, orderId]);
    };

    // Cambiar de filtro cierra lo que hubiera quedado abierto (pedido de Lucas,
    // 28/08). Antes las filas seguían desplegadas al filtrar y, abriendo una acá y
    // otra allá, la lista terminaba llena de bandas de OTs que ya no estabas
    // mirando: "abre una banda, después hace un quilombo, no entienden nada".
    React.useEffect(() => {
        if (colapsarFilasKey === undefined) return;
        setExpandedOrderIds(prev => (prev.length === 0 ? prev : []));
        setCerradasAMano(prev => (prev.size === 0 ? prev : new Set()));
    }, [colapsarFilasKey]);

    // El tilde de la cabecera trabaja sobre lo VISIBLE: suma las filas de la lista
    // actual a lo que ya venía tildado, o solo esas saca. Antes reemplazaba la
    // selección entera, así que tildar acá con un filtro puesto borraba lo elegido
    // bajo los otros filtros (pedido de Lucas, 28/08: la selección se acumula).
    const handleSelectAll = (checked: boolean) => {
        if (!onSelectionChange) return;
        const visibles = sortedData.map(item => item.id);
        if (checked) {
            onSelectionChange(Array.from(new Set([...selectedIds, ...visibles])));
        } else {
            const fuera = new Set(visibles);
            onSelectionChange(selectedIds.filter(id => !fuera.has(id)));
        }
    };

    const handleSelectRow = (orderId: number, checked: boolean) => {
        if (!onSelectionChange) return;
        if (checked) {
            onSelectionChange([...selectedIds, orderId]);
        } else {
            onSelectionChange(selectedIds.filter(id => id !== orderId));
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr || dateStr.startsWith('1950')) return "-";
        try {
            const date = new Date(dateStr);
            return new Intl.DateTimeFormat('es-AR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric'
            }).format(date);
        } catch (e) {
            return dateStr;
        }
    };

    const toTitleCase = (str: string | null | undefined) => {
        if (!str) return "";
        return str.toLowerCase().split(' ').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    };

    /** ¿Lo que se lee en la columna Producto sale de la observación de la ORDEN?
     *
     *  Las OT sin artículo (NO-DEF) y las heredadas del viejo no tienen nombre de
     *  producto: ahí el texto que se ve es la observación de la propia orden. Es la única
     *  situación en la que escribir en esa celda guarda en el mismo lugar del que la celda
     *  lee. Con un artículo de verdad lo que se muestra es el nombre del artículo, que
     *  comparten todas las OT que fabrican esa pieza. */
    const esOrdenSinArticuloPropio = (item: WorkOrder) =>
        item.articulo?.cod_articulo === 'NO-DEF' ||
        !!item.articulo?.descripcion?.toLowerCase().includes('heredado');

    /** ¿Esta celda se puede editar? Sí en las órdenes sin artículo propio: ahí lo que
     *  se escribe va a las observaciones de la orden, que es de donde la celda lee.
     *
     *  OJO CON QUÉ SE PRECARGA EL CAMPO. Mientras la orden todavía no tiene nada
     *  escrito, la celda muestra el texto genérico del artículo NO-DEF —el mismo para
     *  todas— y precargar el editor con ESO hacía que un click y un Enter le sembraran
     *  a la orden una descripción que nadie escribió, como si fuera propia. Por eso el
     *  editor abre con `valorEditableDeDescripcion`, que en ese caso abre vacío. */
    const descripcionSaleDeObservaciones = (item: WorkOrder) =>
        esOrdenSinArticuloPropio(item);

    const getEditableProductDescription = (item: WorkOrder) => {
        if (descripcionSaleDeObservaciones(item) && item.observaciones) {
            return item.observaciones;
        }
        return item.articulo?.descripcion;
    };

    /** Lo que se le pone al campo al abrirlo: la observación de la orden y nada más.
     *  Vacía si no hay, para que lo que quede escrito sea lo que escribió la persona. */
    const valorEditableDeDescripcion = (item: WorkOrder) => item.observaciones || "";


    /**
     * La fila del plan que le corresponde a UNA PASADA de la OT.
     *
     * Se busca por `id_orden_trabajo_proceso`, que es la pasada exacta. Buscar por
     * (orden, proceso) y quedarse con la primera es lo que hacía antes, y en una OT con
     * el mismo proceso repetido —que es dato válido: la 7497 tiene TORNO CNC trece
     * veces— las trece pasadas mostraban el horario, el operario y la máquina de la
     * primera. Se cae al par viejo sólo para los planes guardados antes de que la
     * pasada existiera, donde la columna viene en NULL.
     */
    const filaDelPlan = (ordenId: number, proc: { id?: number; proceso: { id: number } }) => {
        if (!planificacion || planificacion.length === 0) return null;
        if (proc.id) {
            const exacta = planificacion.find(p => p.id_orden_trabajo_proceso === proc.id);
            if (exacta) return exacta;
        }
        return planificacion.find(
            p => p.orden_id === ordenId && p.proceso_id === proc.proceso.id) || null;
    };

    const getScheduledStart = (ordenId: number, proc: { id?: number; proceso: { id: number } }) => {
        const item = filaDelPlan(ordenId, proc);
        if (!item) return "-";

        // La fecha la calcula el backend con la jornada real del taller y con el
        // arranque de ESTE plan. Acá antes se recalculaba sola desde `creado_en` a las
        // 09:00, y por eso un plan hecho el miércoles a las 11 mostraba trabajo para
        // el miércoles a las 09:00 — nueve horas antes de existir. Ver lib/plan-fechas.
        const start = inicioDeLaFila(item, feriados);
        if (!start) return "-";

        // Formato compacto y legible: "Jue 07/05 09:00".
        // Antes el Intl daba "jue., 07/05, 09:00" con comas que cortaban feo cuando
        // se truncaba. Se arma a mano para mantener todo en una sola línea.
        return formatoCorto(start);
    };

    /**
     * Lo mismo, partido en día y hora.
     *
     * El renglón contesta dos cosas de distinto peso: QUÉ DÍA se hace (que se repite
     * entre procesos seguidos) y A QUÉ HORA arranca (que es el dato que se busca). En
     * una sola línea del mismo tamaño las dos competían; separadas, la hora manda.
     */
    /**
     * Qué relación tiene el paso con el día que se está mirando: si arranca ahí, si
     * viene de antes y sigue en curso, o si no lo toca. `null` cuando no se está
     * mirando ningún día en particular (Pendientes, Entregadas, etc.).
     */
    const relacionConElDia = (ordenId: number, proc: { id?: number; proceso: { id: number } })
        : "arranca" | "en curso" | null => {
        if (!diaResaltado) return null;
        const fila = filaDelPlan(ordenId, proc);
        if (!fila) return null;
        const inicio = inicioDeLaFila(fila, feriados);
        const fin = finDeLaFila(fila, feriados);
        if (!inicio || !fin) return null;
        const desde = new Date(diaResaltado); desde.setHours(0, 0, 0, 0);
        const hasta = new Date(diaResaltado); hasta.setHours(23, 59, 59, 999);
        if (inicio >= desde && inicio <= hasta) return "arranca";
        if (inicio < desde && fin >= desde) return "en curso";
        return null;
    };

    const inicioEnPartes = (ordenId: number, proc: { id?: number; proceso: { id: number } }) => {
        const item = filaDelPlan(ordenId, proc);
        if (!item) return null;
        const start = inicioDeLaFila(item, feriados);
        if (!start) return null;
        const texto = formatoCorto(start);          // "Jue 17/09 07:00"
        const corte = texto.lastIndexOf(" ");
        return { dia: texto.slice(0, corte), hora: texto.slice(corte + 1) };
    };


    const getRowColor = (item: WorkOrder) => {
        // Highlighted check (e.g. reused orders in re-planning)
        if (highlightedIds.includes(item.id)) {
            return "bg-green-50 hover:bg-green-100 text-green-900 border-l-4 border-green-500";
        }
        return getWorkOrderRowColor(item);
    };

    const getPriorityLabel = (priorityId?: number, descripcion?: string) => {
        if (descripcion) return descripcion;
        switch (priorityId) {
            case 3: return "Crítica";
            case 2: return "Urgente";
            case 1: return "Normal";
            default: return "Normal";
        }
    };

    const handleSort = (key: SortColumn) => {
        // Cada columna arranca para el lado que más sirve (ver PRIMER_CLICK_DESC).
        // 1er click: dirección natural · 2do: la inversa · 3ro: sin ordenar.
        const primera: 'asc' | 'desc' = PRIMER_CLICK_DESC.includes(key) ? 'desc' : 'asc';
        let direction: 'asc' | 'desc' | null = primera;

        if (sortConfig.key === key) {
            if (sortConfig.direction === primera) {
                direction = primera === 'asc' ? 'desc' : 'asc';
            } else if (sortConfig.direction) {
                direction = null;
            }
        }

        setSortConfig({ key: direction ? key : null, direction });
    };

    // Términos efectivos de búsqueda. Se puede pegar una lista de OTs — "13345
    // 13343" o "#13345, #13343" — y cada número filtra por su cuenta (el # y los
    // separadores se ignoran). Un texto normal ("ceramica cañuelas") se busca
    // entero, como frase; con comas, cada parte por separado. trim(): un espacio
    // al final ("13345 ") hacía que la búsqueda no encontrara NADA.
    const searchTerms = React.useMemo(() => {
        const raw = searchTerm.trim();
        if (!raw) return [] as string[];
        const tokens = raw.split(/[\s,;]+/).map(t => t.replace(/^#/, "")).filter(Boolean);
        const esListaDeNumeros = tokens.length > 0 && tokens.every(t => /^\d+$/.test(t));
        const terms = (esListaDeNumeros || raw.includes(","))
            ? tokens.map(t => t.toLowerCase())
            : [raw.replace(/^#/, "").toLowerCase()];
        // "#" o "," solos no son una búsqueda: sin términos se muestra todo.
        return terms.filter(Boolean);
    }, [searchTerm]);

    const filteredData = React.useMemo(() => {
        if (searchTerms.length === 0) return data;

        const matchesTerm = (item: WorkOrder, term: string) =>
            item.id.toString().includes(term) ||
            (item.id_otvieja && item.id_otvieja.toString().includes(term)) ||
            String(item.n_pedido || item.n_ped_l || "").toLowerCase().includes(term) ||
            String(item.observaciones || "").toLowerCase().includes(term) ||
            String(item.cliente?.nombre || "").toLowerCase().includes(term) ||
            String(item.articulo?.cod_articulo || "").toLowerCase().includes(term) ||
            String(item.articulo?.descripcion || "").toLowerCase().includes(term) ||
            item.procesos.some(p => String(p.proceso?.nombre || "").toLowerCase().includes(term));

        return data.filter(item => searchTerms.some(t => matchesTerm(item, t)));
    }, [data, searchTerms]);

    // Al buscar por nombre de proceso, auto-expandir las OT que matchean para que
    // el proceso (con su orden) quede visible sin abrir la fila a mano. Usa los
    // MISMOS términos que el filtro: con "amolado, plegado" cada parte expande lo
    // suyo (antes se testeaba la frase entera y con comas no expandía nada).
    const procesoMatchIds = React.useMemo(() => {
        if (searchTerms.length === 0) return new Set<number>();
        return new Set(
            data.filter(item => item.procesos.some(p => {
                const nombre = String(p.proceso?.nombre || "").toLowerCase();
                return searchTerms.some(t => nombre.includes(t));
            })).map(item => item.id)
        );
    }, [data, searchTerms]);

    // Anclado de tildadas arriba (pinSelectedOnTop): la foto de qué va arriba se
    // toma al montar y en cada cambio de búsqueda — NO con cada tilde, para que
    // la lista no se reordene abajo del cursor mientras tildás.
    const [pinnedIds, setPinnedIds] = React.useState<Set<number>>(() => new Set(selectedIds));
    React.useEffect(() => {
        if (pinSelectedOnTop) setPinnedIds(new Set(selectedIds));
        setCerradasAMano(prev => (prev.size === 0 ? prev : new Set()));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchTerm, pinSelectedOnTop]);
    // Lo cerrado a mano gana sobre lo que abrió la búsqueda: si alguien la cerró, es
    // porque no la quiere ver, aunque coincida con lo que buscó.
    const isRowExpanded = (id: number) =>
        expandedOrderIds.includes(id) || (procesoMatchIds.has(id) && !cerradasAMano.has(id));

    /** Lo tildado, para preguntar por fila sin recorrer el array en cada una: con la
     *  selección acumulada `selectedIds` puede ser bastante más larga que la lista. */
    const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);

    const sortedData = React.useMemo(() => {

        // Sort processes by 'orden' for each item to ensure correct display
        const dataWithSortedProcesses = filteredData.map(item => ({
            ...item,
            procesos: [...item.procesos].sort((a, b) => a.orden - b.orden)
        }));

        if (!sortConfig.key || !sortConfig.direction) {
            // Tildadas arriba (solo sin orden de columna explícito: si el usuario
            // ordenó por una columna, ese orden manda).
            if (pinSelectedOnTop && pinnedIds.size > 0) {
                return [
                    ...dataWithSortedProcesses.filter(i => pinnedIds.has(i.id)),
                    ...dataWithSortedProcesses.filter(i => !pinnedIds.has(i.id)),
                ];
            }
            return dataWithSortedProcesses;
        }

        const key = sortConfig.key;
        const dir = sortConfig.direction === 'asc' ? 1 : -1;

        // Valor comparable de cada columna. Devuelve número o string; las fechas
        // vacías van SIEMPRE al final (independiente de la dirección) para que no
        // ensucien el arranque de la lista.
        const getSortValue = (item: WorkOrder): number | string => {
            switch (key) {
                case 'id': return item.id;
                case 'id_otvieja': return item.id_otvieja || 0;
                case 'fecha_entrada': return new Date(item.fecha_entrada || 0).getTime();
                case 'cliente': return item.cliente?.nombre || "";
                case 'codigo': return item.articulo?.cod_articulo || "";
                case 'descripcion': return getEditableProductDescription(item) || "";
                case 'n_pedido': return String(item.n_pedido || item.n_ped_l || "");
                case 'unidades': return item.unidades || 0;
                case 'prioridad': return item.id_prioridad || 0;
                case 'material': return materialRank(item.estado_material, item.no_lleva_materia_prima);
                case 'proceso': return procesoRank(item);
                case 'plano': return rankPlano(estadoPlano(item.id, item.tiene_plano, ordenesConPlano, planosDisponibles));
                case 'estado': return getOrderStatus(item);
                case 'entrega': return entregaRank(item);
                case 'aprobado_por': return item.aprobado_por || "";
                case 'requerido_por': return item.requerido_por || "";
                case 'fecha_prometida':
                case 'fecha_entrega': {
                    const raw = key === 'fecha_prometida' ? item.fecha_prometida : item.fecha_entrega;
                    // '1950-01-01' es el sentinel del legacy para "sin fecha".
                    if (!raw || raw.startsWith('1950')) return Number.NaN;
                    const t = new Date(raw).getTime();
                    return isNaN(t) ? Number.NaN : t;
                }
                default: return 0;
            }
        };

        return [...dataWithSortedProcesses].sort((a, b) => {
            const va = getSortValue(a);
            const vb = getSortValue(b);

            // Vacíos (fechas sin cargar) siempre al fondo.
            const emptyA = typeof va === 'number' && isNaN(va);
            const emptyB = typeof vb === 'number' && isNaN(vb);
            if (emptyA && emptyB) return 0;
            if (emptyA) return 1;
            if (emptyB) return -1;

            if (typeof va === 'string' || typeof vb === 'string') {
                // `numeric: true` para que N° Pedido / códigos ordenen 2 < 10 y no "10" < "2".
                return dir * String(va).localeCompare(String(vb), 'es', { numeric: true, sensitivity: 'base' });
            }
            return dir * (va - vb);
        });
    // Las dos respuestas de planos entran en las dependencias porque llegan DESPUÉS del
    // primer dibujo (son un fetch). Faltaban, y hasta ahora no se notaba porque el
    // conjunto venía vacío y todas las filas empataban; ahora que la columna distingue
    // propio / del producto / sin archivo, sin esto quien ordenara por Plano antes de
    // que contestara el backend se quedaba con el orden viejo mirando badges nuevos.
    }, [filteredData, sortConfig, pinSelectedOnTop, pinnedIds, ordenesConPlano, planosDisponibles]);

    // Observa el scroll horizontal del contenedor de la tabla y actualiza `showRightFade`:
    //   true  → hay más columnas a la derecha → mostrar el gradient fade
    //   false → llegó al final → ocultar el gradient (no engaña al usuario)
    React.useEffect(() => {
        const el = scrollContainerRef.current;
        if (!el) return;
        const updateFade = () => {
            const remaining = el.scrollWidth - el.scrollLeft - el.clientWidth;
            // Margen de 2px para evitar parpadeo por subpixel rendering.
            setShowRightFade(remaining > 2);
        };
        updateFade();
        el.addEventListener('scroll', updateFade, { passive: true });
        const ro = new ResizeObserver(updateFade);
        ro.observe(el);
        return () => {
            el.removeEventListener('scroll', updateFade);
            ro.disconnect();
        };
    }, [sortedData.length]);

    const SortIcon = ({ column }: { column: SortColumn }) => {
        if (sortConfig.key !== column || !sortConfig.direction) return <span className="ml-1 text-gray-300 opacity-0 group-hover:opacity-50">↕</span>;
        return (
            <span className="ml-1 text-red-600 font-bold">
                {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </span>
        );
    };

    const renderStatusBadge = (status: string) => {
        switch (status) {
            case 'Finalizado':
                return <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-green-200">Finalizado</Badge>;
            case 'En Proceso':
                return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200">En Proceso</Badge>;
            default:
                return null;
        }
    };

    const [editingOrder, setEditingOrder] = React.useState<{ id: number, field: string, value: string, originalValue: string } | null>(null);
    // Se guarda el id de la FILA del plan y no (orden, proceso): con el mismo proceso
    // repetido en la OT, ese par abría el editor en las dos pasadas a la vez.
    const [editingStartDate, setEditingStartDate] = React.useState<{ planId: number, value: string, original: string } | null>(null);
    const [deliveryOrder, setDeliveryOrder] = React.useState<{ id: number, total: number, delivered: number } | null>(null);
    const [incidencia, setIncidencia] = React.useState<{ orderId: number, procesoId: number, procesoNombre: string, operarioId: number | null, operarioNombre: string } | null>(null);

    /** El aviso de que la celda se puede editar.
     *
     *  Ocho celdas de esta fila se editan con un click y ninguna lo decía: aparecía un
     *  campo con un tilde y una cruz sin que nada lo hubiera anunciado ("qué es esa
     *  edición poronga, no entiendo", Julián 10/09). En el detalle ya había una celda que
     *  sí se entendía —Inicio Estimado— y se entendía por esto: un lápiz tenue que sale
     *  al pasar el mouse. Al pasar el mouse y no fijo, porque la tabla tiene veinte
     *  columnas y ocho lápices dibujados todo el tiempo serían ruido, no ayuda.
     *  Mientras la celda se está editando el lápiz no va: taparía el campo. */
    const lapizDeCelda = (ordenId: number, campo: string) => (
        editingOrder?.id === ordenId && editingOrder.field === campo ? null : (
            <Pencil className="pointer-events-none absolute right-1 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-400 opacity-0 transition-opacity group-hover/edit:opacity-100" />
        )
    );

    const handleTextClick = (orderId: number, field: string, currentValue: string | undefined | number) => {
        const val = currentValue?.toString() || "";
        setEditingOrder({
            id: orderId,
            field,
            value: val,
            originalValue: val
        });
    };

    const handleDateClick = (orderId: number, field: string, currentValue: string | undefined) => {
        let val = "";
        if (currentValue && !currentValue.startsWith('1950')) {
            try {
                val = new Date(currentValue).toISOString().split('T')[0];
            } catch (e) {
                val = "";
            }
        }
        setEditingOrder({
            id: orderId,
            field,
            value: val,
            originalValue: val
        });
    };

    const handleDateSave = async () => {
        if (!editingOrder) return;
        if (editingOrder.value === editingOrder.originalValue) {
            setEditingOrder(null);
            return;
        }

        // La fecha de entrada y la prometida son obligatorias en la orden: vaciar la
        // celda mandaba null y la base lo rechazaba. Como el catch de abajo sólo
        // logueaba, el usuario no veía NADA: la celda volvía sola al valor viejo y
        // parecía que el sistema le ignoraba el cambio. La de entrega sí puede quedar
        // vacía (es "todavía no se entregó").
        const OBLIGATORIAS = ['fecha_entrada', 'fecha_prometida'];
        if (OBLIGATORIAS.includes(editingOrder.field) && !editingOrder.value) {
            toast.error(
                editingOrder.field === 'fecha_entrada'
                    ? "La fecha de entrada no puede quedar vacía"
                    : "La fecha prometida no puede quedar vacía"
            );
            setEditingOrder(null);
            return;
        }

        try {
            const response = await fetch(`${API_URL}/ordenes/${editingOrder.id}`, {
                method: 'PUT',
                headers: { ...getAuthHeaders() as Record<string, string>, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    [editingOrder.field]: editingOrder.field.startsWith('fecha_') ? (editingOrder.value ? new Date(editingOrder.value).toISOString() : null) : (editingOrder.field === 'unidades' ? parseInt(editingOrder.value) || 0 : editingOrder.value)
                })
            });

            if (!response.ok) {
                // El backend manda el motivo; sin esto el usuario se quedaba sin saber
                // por qué no se guardó.
                throw new Error(parseApiError(await response.text().catch(() => "")) || `No se pudo guardar (error ${response.status})`);
            }

            setEditingOrder(null);

            // If the parent provided an onDataChange callback, use it
            if (onDataChange) {
                onDataChange();
            }

        } catch (error) {
            console.error('Error saving date:', error);
            toast.error(error instanceof Error ? error.message : "No se pudo guardar el cambio");
            setEditingOrder(null);
        }
    };

    /** Escape estaba cancelando a medias: el campo tiene `onBlur` que guarda, así que si
     *  el navegador manda el blur al desmontarse el input, el cambio que se quería tirar
     *  se guardaba igual. La bandera dura lo que dura ese desmonte y se limpia al abrir
     *  el editor, así no se queda pegada. */
    const cancelandoInicio = React.useRef(false);

    const cancelarInicioEstimado = () => {
        cancelandoInicio.current = true;
        setEditingStartDate(null);
    };

    const handleStartDateClick = (orderId: number, proc: { id?: number; proceso: { id: number } }) => {
        cancelandoInicio.current = false;
        const item = filaDelPlan(orderId, proc);
        if (!item) return;

        // Lo que se ve en la celda ("Jue 17/09 07:00") está formateado: el campo
        // necesita la fecha cruda, y tiene que ser LA MISMA que se está mostrando.
        const start = inicioDeLaFila(item, feriados);
        if (!start) return;

        const cargado = paraInputDatetimeLocal(start);
        setEditingStartDate({ planId: item.id, value: cargado, original: cargado });
    };

    const handleStartDateSave = async () => {
        if (cancelandoInicio.current) {
            cancelandoInicio.current = false;
            return;
        }
        if (!editingStartDate) return;
        // El campo guarda en `onBlur`, así que un click en cualquier otro lado dispara
        // esto sin que nadie haya editado nada. Si el valor es el mismo que se cargó, no
        // hay nada que escribir: era un click perdido.
        if (editingStartDate.value === editingStartDate.original) {
            setEditingStartDate(null);
            return;
        }
        // console.log("Saving new start date:", editingStartDate.value);

        // Calculate new inicio_min
        const item = planificacion.find(p => p.id === editingStartDate.planId);
        if (!item) return;

        const newDate = new Date(editingStartDate.value);
        if (isNaN(newDate.getTime())) return; // Invalid date

        // Lo que se guarda no es la fecha sino el minuto del plan, así que esta cuenta
        // tiene que ser la inversa EXACTA de la que mostró la celda: misma jornada y
        // mismo arranque. Si no, correr un proceso diez minutos lo movía de día.
        const newInicioMin = minutosDesdeFecha(baseDelPlan(item, feriados), newDate, feriados);
        const duration = item.fin_min - item.inicio_min;
        const newFinMin = newInicioMin + duration;

        try {
            const response = await fetch(`${API_URL}/planificacion/${editingStartDate.planId}`, {
                method: 'PUT',
                headers: { ...getAuthHeaders() as Record<string, string>, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inicio_min: newInicioMin,
                    fin_min: newFinMin
                })
            });

            if (!response.ok) throw new Error('Failed to update start date');

            setEditingStartDate(null);
            window.location.reload();
        } catch (error) {
            console.error('Error saving start date:', error);
        }
    };

    const calculateRealMinutes = (start?: string, end?: string) => {
        if (!start) return "-";
        if (!end) return "En curso...";

        const startDate = new Date(start);
        const endDate = new Date(end);

        const diffMs = endDate.getTime() - startDate.getTime();
        const diffMins = Math.round(diffMs / 60000);

        return `${diffMins} min`;
    };

    const renderDetails = (item: WorkOrder) => (
        <div className="w-full border rounded-md overflow-hidden bg-white shadow-inner flex flex-col">
            {/* Los archivos: abajo y PLEGADOS.
                Arriba la galería se llevaba media pantalla —casi siempre vacía— y empujaba
                Producción, que es justamente para lo que uno despliega la fila. Mismo
                criterio que en el otro listado de OT, incluido el cómo: se reordena con
                `order-*` sobre el contenedor flex y NO moviendo el JSX, porque mover este
                bloque ya rompió el archivo una vez. `<details>` nativo: ni una línea de
                estado nueva.
                Plegado no esconde nada que haga falta para trabajar: adentro sólo hay
                archivos para mirar. */}
            <details className="group/extra order-2 border-t border-gray-200">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-tight text-gray-500 hover:bg-gray-50">
                    <ChevronRight className="h-3 w-3 shrink-0 transition-transform group-open/extra:rotate-90" />
                    Planos y archivos
                </summary>
                <div className="border-t border-gray-100">
            <div className="px-2 py-2">
                <OrderFiles orderId={item.id} />
            </div>
                </div>
            </details>

            {/* La barra de entrega NO se pliega, y no es un olvido.
                Lo que se plegó arriba —la galería de archivos— es de sólo leer. Esta
                barra HACE algo: se le hace click y se registra una entrega. En la
                tarjeta de celular es además el ÚNICO camino, porque ahí no está la
                columna «Entrega» de la fila. Metiéndola adentro del plegable, cargar
                una entrega desde el teléfono pasaba de dos toques a tres, y el tercero
                atrás de un rótulo que dice «archivos». */}
            <div className="order-3 p-2 border-t border-gray-200">
                <div
                    className="cursor-pointer hover:ring-2 ring-blue-100 rounded-xl transition-all"
                    onClick={(e) => {
                        e.stopPropagation();
                        setDeliveryOrder({
                            id: item.id,
                            total: item.unidades || 0,
                            delivered: item.cantidad_entregada || 0
                        });
                    }}
                >
                    <DeliveryProgress
                        total={item.unidades}
                        delivered={item.cantidad_entregada}
                    />
                </div>
            </div>

            {/* Producción primero: `order-1` contra el `order-2` del plegable de arriba. */}
            <div className="order-1 w-full text-sm">
                <div className="hidden md:grid bg-gray-100 text-[11px] uppercase text-gray-600 grid-cols-[44px_minmax(200px,1.6fr)_150px_118px_72px_72px_minmax(150px,2fr)_minmax(150px,2.4fr)] gap-3 px-4 py-2 font-bold border-t border-gray-200">
                    <div>#</div>
                    <div>Proceso</div>
                    <div>Inicio Estimado</div>
                    <div>Estado</div>
                    <div className="text-center">Min. Est.</div>
                    <div className="text-center text-blue-700">Min. Real</div>
                    <div>Recurso humano</div>
                    <div>Recurso maquinaria</div>
                </div>

                <div>
                    {item.procesos && item.procesos.length > 0 ? (
                        <>
                            {item.procesos.map((proc, idx) => {
                                const plannedItem = filaDelPlan(item.id, proc);
                                const machineName = plannedItem?.nombre_maquinaria || (plannedItem?.id_maquinaria ? "Cargando..." : "Recurso maquinaria sin asignar");

                                return (
                                    <div
                                        key={proc.id ?? `${item.id}-${proc.proceso.id}-${idx}`}
                                        className="flex flex-col md:grid md:grid-cols-[44px_minmax(200px,1.6fr)_150px_118px_72px_72px_minmax(150px,2fr)_minmax(150px,2.4fr)] gap-3 px-4 py-4 md:py-2 border-t hover:bg-gray-50 items-stretch md:items-center bg-white"
                                    >
                                        {/* # */}
                                        <div className="flex flex-row justify-between md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase self-center">Orden</span>
                                            <div className="flex items-center text-gray-500 font-mono">
                                                {proc.orden}
                                            </div>
                                        </div>

                                        {/* Proceso */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Proceso</span>
                                            <div className="flex items-center gap-1.5">
                                                <div className="font-medium text-xs md:text-sm truncate" title={proc.proceso?.nombre || "-"}>{proc.proceso?.nombre || "-"}</div>
                                                {proc.cant_operarios && proc.cant_operarios > 1 && (
                                                    <span
                                                        className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded-full"
                                                        title={`Requiere ${proc.cant_operarios} de recurso humano en simultáneo`}
                                                    >
                                                        <Users className="w-3 h-3" />
                                                        {proc.cant_operarios}
                                                    </span>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setIncidencia({
                                                        orderId: item.id,
                                                        procesoId: proc.proceso.id,
                                                        procesoNombre: proc.proceso?.nombre || "",
                                                        operarioId: plannedItem?.id_operario ?? null,
                                                        operarioNombre: proc.operario_nombre || "",
                                                    })}
                                                    title="Registrar incidencia de plano (tiempo perdido)"
                                                    className="shrink-0 text-amber-500 hover:text-amber-700 hover:bg-amber-50 rounded p-0.5 transition-colors"
                                                >
                                                    <FileWarning className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Inicio Estimado.

                                            Se edita en un desplegable y no con un campo
                                            metido adentro de la celda: ahí no entraba
                                            —"11/09/2026, 08:30 a.m." con su calendarito en
                                            110px— y guardaba al perder el foco, así que un
                                            click en cualquier lado escribía. Acá hay lugar
                                            para el campo, y para decir qué se está por
                                            guardar y con qué botón. */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Inicio Estimado</span>
                                            {(() => {
                                                const partes = inicioEnPartes(item.id, proc);
                                                const relacion = relacionConElDia(item.id, proc);
                                                return (
                                                    <Popover
                                                        // SIN `open`: lo maneja el propio desplegable.
                                                        //
                                                        // Atándolo a `editingStartDate` no abría nunca: el estado se
                                                        // seteaba pero el desplegable seguía cerrado, porque su apertura
                                                        // dependía de que ese estado volviera a coincidir con la fila, y en
                                                        // el medio se perdía. Acá el click abre —que es lo que el usuario
                                                        // pidió que funcione— y el estado de edición se prepara y se limpia
                                                        // desde el mismo aviso.
                                                        onOpenChange={(abierto) => {
                                                            if (abierto) handleStartDateClick(item.id, proc);
                                                            else cancelarInicioEstimado();
                                                        }}
                                                    >
                                                        <PopoverTrigger asChild>
                                                            <button
                                                                type="button"
                                                                title="Cambiar el horario de este paso"
                                                                className={cn(
                                                                    "group relative flex w-full items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 py-1 text-left transition-all",
                                                                    relacion === "arranca"
                                                                        ? "border-amber-400 bg-amber-100 ring-1 ring-amber-300"
                                                                        : relacion === "en curso"
                                                                            ? "border-blue-300 bg-blue-50"
                                                                            : "border-amber-200 bg-amber-50 hover:border-amber-300 hover:bg-amber-100",
                                                                    "hover:shadow-sm",
                                                                )}
                                                            >
                                                                <CalendarClock className={cn(
                                                                    "h-3.5 w-3.5 shrink-0",
                                                                    relacion === "en curso" ? "text-blue-500" : "text-amber-500",
                                                                )} />
                                                                {partes ? (
                                                                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                                                                        <span className={cn(
                                                                            "text-[11px] font-semibold",
                                                                            relacion === "en curso" ? "text-blue-800" : "text-amber-800",
                                                                        )}>
                                                                            {partes.dia}
                                                                        </span>
                                                                        <span className={cn(
                                                                            "text-sm font-bold tabular-nums tracking-tight",
                                                                            relacion === "en curso" ? "text-blue-950" : "text-amber-950",
                                                                        )}>
                                                                            {partes.hora}
                                                                        </span>
                                                                    </span>
                                                                ) : (
                                                                    <span className="flex-1 text-gray-400">—</span>
                                                                )}
                                                                {/* El lápiz, siempre a la vista: que la celda se puede tocar
                                                                    no puede depender de pasar el mouse por encima. */}
                                                                <Pencil className="h-3 w-3 shrink-0 text-amber-400 opacity-60 transition-opacity group-hover:opacity-100" />
                                                            </button>
                                                        </PopoverTrigger>
                                                        <PopoverContent align="start" className="w-[270px] p-3">
                                                            <p className="text-xs font-semibold text-gray-800">Cambiar el horario</p>
                                                            <p className="mt-0.5 mb-2 truncate text-[11px] text-gray-500" title={proc.proceso?.nombre || ""}>
                                                                {proc.proceso?.nombre || ""}
                                                            </p>
                                                            <input
                                                                type="datetime-local"
                                                                className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20"
                                                                value={editingStartDate?.value || ""}
                                                                onChange={(e) => editingStartDate && setEditingStartDate({ ...editingStartDate, value: e.target.value })}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter') handleStartDateSave();
                                                                    if (e.key === 'Escape') cancelarInicioEstimado();
                                                                }}
                                                                autoFocus
                                                            />
                                                            <div className="mt-2.5 flex justify-end gap-2">
                                                                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={cancelarInicioEstimado}>
                                                                    Cancelar
                                                                </Button>
                                                                <Button
                                                                    size="sm"
                                                                    className="h-7 bg-amber-600 text-xs hover:bg-amber-700"
                                                                    onClick={handleStartDateSave}
                                                                    disabled={!editingStartDate || editingStartDate.value === editingStartDate.original}
                                                                >
                                                                    Guardar
                                                                </Button>
                                                            </div>
                                                        </PopoverContent>
                                                    </Popover>
                                                );
                                            })()}
                                            {/* Por qué esta OT está en la lista del día: el paso
                                                que la trae. Sin esto, un paso largo que empezó el
                                                viernes se leía como «esto no es de hoy». */}
                                            {relacionConElDia(item.id, proc) === "en curso" && (
                                                <span className="mt-1 hidden items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-blue-700 md:inline-flex">
                                                    <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                                                    Sigue en curso este día
                                                </span>
                                            )}
                                        </div>

                                        {/* Estado */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Estado</span>
                                            <div>
                                                <Select
                                                    defaultValue={proc.estado_proceso?.id?.toString() || "1"}
                                                    onValueChange={(val) => onProcessStatusChange && onProcessStatusChange(item.id, proc.proceso.id, parseInt(val), (proc as any).id)}
                                                >
                                                    <SelectTrigger className={cn(
                                                        "h-7 text-xs w-full border-none shadow-none font-medium px-2",
                                                        (proc.estado_proceso?.id === 3 || (!proc.estado_proceso?.id && false)) ? "text-green-800 bg-green-100 hover:bg-green-200" :
                                                            proc.estado_proceso?.id === 2 ? "text-blue-800 bg-blue-100 hover:bg-blue-200" :
                                                                "text-gray-800 bg-gray-100 hover:bg-gray-200"
                                                    )}>
                                                        <SelectValue placeholder="Estado" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="1">Pendiente</SelectItem>
                                                        <SelectItem value="2">En Proceso</SelectItem>
                                                        <SelectItem value="3">Finalizado</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>

                                        {/* Min. Est. */}
                                        <div className="flex flex-row justify-between md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase self-center">Min. Est.</span>
                                            <div className="text-center text-gray-600 text-xs">{proc.tiempo_proceso || "-"}</div>
                                        </div>

                                        {/* Min. Real */}
                                        <div className="flex flex-row justify-between md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase self-center">Min. Real</span>
                                            <div className="text-center font-bold text-blue-700 text-xs">
                                                {calculateRealMinutes(proc.inicio_real, proc.fin_real)}
                                            </div>
                                        </div>

                                        {/* Operario */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Recurso humano</span>
                                            <div>
                                                {onOperatorChange && operarios.length > 0 ? (
                                                    <Select
                                                        value={(pendingRes[resKey(plannedItem?.id)]?.operario ?? operarios.find(op => {
                                                            const opName = `${op.nombre} ${op.apellido}`.trim().toLowerCase();
                                                            const currentName = (proc.operario_nombre || "").trim().toLowerCase();
                                                            return opName === currentName;
                                                        })?.id)?.toString() || undefined}
                                                        onValueChange={(val) => plannedItem && stageOperario(plannedItem.id, parseInt(val))}
                                                    >
                                                        <SelectTrigger className={cn("h-7 text-xs w-full border px-2", pendingRes[resKey(plannedItem?.id)]?.operario !== undefined ? "border-amber-400 ring-1 ring-amber-300 bg-amber-50" : "border-gray-200")}>
                                                            <SelectValue placeholder={toTitleCase(proc.operario_nombre) || "Sin Asignar"} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {operarios.map((op) => (
                                                                <SelectItem key={op.id} value={op.id.toString()}>
                                                                    {toTitleCase(`${op.nombre} ${op.apellido}`)}
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <span className="text-gray-700 text-xs font-medium block truncate" title={toTitleCase(proc.operario_nombre) || "Sin Asignar"}>
                                                        {toTitleCase(proc.operario_nombre) || "Sin Asignar"}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Maquinaria */}
                                        <div className="flex flex-col md:block w-full md:w-auto">
                                            <span className="md:hidden text-xs font-bold text-gray-500 uppercase mb-1">Recurso maquinaria</span>
                                            <div>
                                                {onMachineryChange && maquinarias.length > 0 ? (
                                                    <Select
                                                        value={(pendingRes[resKey(plannedItem?.id)]?.maquina ?? plannedItem?.id_maquinaria)?.toString() || "0"}
                                                        onValueChange={(val) => plannedItem && stageMaquina(plannedItem.id, parseInt(val))}
                                                    >
                                                        <SelectTrigger className={cn("h-7 text-xs w-full border px-2", pendingRes[resKey(plannedItem?.id)]?.maquina !== undefined ? "border-amber-400 ring-1 ring-amber-300 bg-amber-50" : "border-gray-200")}>
                                                            <SelectValue placeholder={machineName} />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="0" className="text-gray-400 italic">Recurso maquinaria sin asignar</SelectItem>
                                                            {maquinarias.map((m) => {
                                                                const limitacion = limitacionDeMaquina(m);
                                                                return (
                                                                    <SelectItem
                                                                        key={m.id}
                                                                        value={m.id.toString()}
                                                                        detail={limitacion
                                                                            ? <span className="text-amber-700" title={limitacion}>⚠ {limitacion}</span>
                                                                            : undefined}
                                                                    >
                                                                        {m.nombre}
                                                                    </SelectItem>
                                                                );
                                                            })}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <div className="text-gray-600 text-xs font-medium truncate" title={machineName}>
                                                        {machineName}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}

                            <RegisterDeliveryDialog
                                open={!!deliveryOrder}
                                onOpenChange={(open) => !open && setDeliveryOrder(null)}
                                currentOrder={deliveryOrder}
                                onSuccess={() => {
                                    window.location.reload();
                                }}
                            />
                            <div className="px-3 py-3 bg-gray-50 border-t border-gray-200">
                                <AddProcessRow
                                    orderId={item.id}
                                    onProcessAdded={() => {
                                        if (onDataChange) onDataChange();
                                    }}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="px-4 py-4 bg-gray-50 border-t border-gray-100">
                            <div className="w-full">
                                <AddProcessRow
                                    orderId={item.id}
                                    onProcessAdded={() => {
                                        if (onDataChange) onDataChange();
                                    }}
                                    isCentered={true}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );

    if (isLoading) {
        return (
            <div className="flex justify-center items-center h-64">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-700"></div>
            </div>
        );
    }

    return (
        /* `mt-6` es el aire que la tabla necesita en las pestañas de Operaciones, donde
           arranca pegada a la barra de tabs. Dentro del planificador ese margen sobra
           —ya está adentro de una tarjeta con su propio padding— y son 24px que le
           faltan a la lista. */
        <div className={compacto ? "space-y-1.5" : "space-y-4 mt-6"}>
            {/* B1 (feedback 06/07): barra flotante de cambios pendientes de operario/máquina.
                Aparece solo cuando hay reasignaciones sin guardar; el avance y las fechas siguen al toque. */}
            {Object.keys(pendingRes).length > 0 && (
                /* `bottom-24` y no `bottom-5`: el pie del planificador es sticky y vive
                   en esa misma banda, así que la barra le caía justo encima y tapaba
                   "Planificar". Y con `max-w`/`flex-wrap` no se sale de una pantalla
                   angosta, donde los tres textos más los dos botones no entran. */
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 flex flex-wrap justify-center items-center gap-2 max-w-[calc(100vw-2rem)] bg-white border border-amber-300 shadow-lg rounded-full pl-4 pr-2 py-2">
                    <span className="text-xs font-medium text-gray-700">
                        {Object.keys(pendingRes).length} proceso{Object.keys(pendingRes).length === 1 ? "" : "s"} con cambios sin guardar
                    </span>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-500 hover:text-gray-700" onClick={discardPending}>
                        Descartar
                    </Button>
                    <Button size="sm" className="h-7 text-xs bg-blue-600 hover:bg-blue-700 rounded-full px-4" onClick={applyPending}>
                        Aceptar cambios
                    </Button>
                </div>
            )}
            {/* En compacto el buscador NO va acá: es la cabecera de la tarjeta de la
                tabla, unos renglones más abajo. Suelto quedaba separado de la tabla por el
                riel de la barra de scroll horizontal —que `scrollbar-top` manda arriba— y
                entre las dos cosas se veía una banda blanca que Julián marcó dos veces
                ("quedan esos espacios entre el buscador y las OT, pierde espacio"). */}
            {!compacto && (
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Buscar por OT, pedido, cliente, código, producto o proceso..."
                        className={cn("pl-10 border-gray-300 focus:border-red-500 focus:ring-red-500", compacto && "h-8 text-xs")}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
            )}

            {/* Mobile Card View (< md) */}
            <div className="md:hidden space-y-4">
                {sortedData.length === 0 ? (
                    <div className="text-center py-8 text-gray-500 bg-white rounded-lg shadow">
                        {searchTerm ? "No se encontraron resultados." : (mensajeVacio || "No hay órdenes activas.")}
                    </div>
                ) : (
                    sortedData.map((item) => (
                        <Card key={item.id} className={cn("overflow-hidden border border-gray-200 shadow-sm", getRowColor(item))}>
                            <div
                                className="p-4"
                                onClick={() => toggleRow(item.id)}
                            >
                                <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-2">
                                        {/* La casilla FALTABA en la tarjeta: abajo de `md` no había
                                            manera de tildar una OT. Mientras el planificador abría
                                            con todo tildado no se notaba; desde que abre en cero,
                                            en un teléfono no se podía planificar nada. */}
                                        {onSelectionChange && (
                                            <span onClick={(e) => e.stopPropagation()} className="flex items-center">
                                                <Checkbox
                                                    className="h-5 w-5"
                                                    checked={selectedIdSet.has(item.id)}
                                                    onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                                    aria-label={`Elegir la OT ${item.id_otvieja || item.id}`}
                                                />
                                            </span>
                                        )}
                                        <span className="font-bold text-lg text-gray-800">#{item.id_otvieja || item.id}</span>
                                        {!hideStatus && renderStatusBadge(getOrderStatus(item))}
                                    </div>
                                    <button className="text-gray-400">
                                        {isRowExpanded(item.id) ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                                    </button>
                                </div>

                                <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                        <span className="font-semibold text-gray-900 line-clamp-1">{item.cliente?.nombre || "-"}</span>
                                        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{item.articulo?.cod_articulo}</span>
                                    </div>

                                    <div className="text-gray-600 line-clamp-2 text-xs">
                                        {(item.articulo?.cod_articulo === 'NO-DEF' || item.articulo?.descripcion?.toLowerCase().includes('heredado')) && item.observaciones
                                            ? item.observaciones
                                            : item.articulo?.descripcion}
                                    </div>

                                    <div className="grid grid-cols-2 gap-2 text-xs pt-2 border-t border-gray-100/50 mt-2">
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Cant.</span>
                                            <span className="font-medium">{item.unidades}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Prioridad</span>
                                            <Badge variant="outline" className="bg-white/50 text-[10px] h-5 px-1.5">
                                                {getPriorityLabel(item.id_prioridad, item.prioridad?.descripcion)}
                                            </Badge>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Entrega</span>
                                            <span className="font-medium">{item.fecha_entrega ? formatDate(item.fecha_entrega) : "-"}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Material</span>
                                            {/* Mismo criterio que la tabla de escritorio, pero sin chip: en la
                                                tarjeta de celular el rótulo va suelto para no comerse el ancho. */}
                                            <span className={cn("font-medium",
                                                resumirMaterial(item.estado_material, item.no_lleva_materia_prima).faltaMaterial ? "text-red-600" :
                                                    item.estado_material === 'ok' ? "text-green-600" :
                                                        "text-gray-600"
                                            )} title={resumirMaterial(item.estado_material, item.no_lleva_materia_prima).titulo}>
                                                {resumirMaterial(item.estado_material, item.no_lleva_materia_prima).rotulo}
                                            </span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">N° Pedido</span>
                                            <span className="font-medium text-gray-700">{item.n_pedido || item.n_ped_l || "-"}</span>
                                        </div>
                                        <div>
                                            <span className="text-gray-500 block text-[10px] uppercase">Aprobado Por</span>
                                            <span className="font-medium text-gray-700">{item.aprobado_por || "-"}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Expanded Details for Mobile */}
                            {isRowExpanded(item.id) && (
                                <div className="bg-gray-50 border-t p-2">
                                    {renderDetails(item)}
                                </div>
                            )}
                        </Card>
                    ))
                )}
            </div>

            {/* Desktop Table View (>= md). El `zoom` aplica SOLO acá (no al search ni a las tarjetas mobile). */}
            <Card className="hidden md:block overflow-hidden border-none shadow-xl bg-white w-full relative">
                {compacto && (
                    <div className="relative p-2 border-b border-gray-100 bg-white">
                        <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <Input
                            placeholder="Buscar por OT, pedido, cliente, código, producto o proceso..."
                            className="pl-9 h-8 text-xs border-gray-200 focus:border-red-500 focus:ring-red-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                )}
                <div
                    ref={scrollContainerRef}
                    className={cn("w-full overflow-x-auto scrollbar-horizontal-visible scrollbar-top", !compacto && "pt-4")}
                    style={{ zoom: tableZoom / 100 }}
                >
                    <table className={cn("w-full min-w-[1600px] text-sm text-left", compacto && "[&_td]:py-2 [&_th]:py-2")}>
                        <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                            <tr>
                                <th className="w-12 px-2 py-3">
                                    {onSelectionChange && (
                                        <label className="flex items-center justify-center w-full h-full py-1 cursor-pointer">
                                            <Checkbox
                                                className="h-5 w-5"
                                                checked={sortedData.length > 0 && sortedData.every(item => selectedIdSet.has(item.id))}
                                                onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                            />
                                        </label>
                                    )}
                                </th>
                                <th className="w-10 px-3 py-3"></th>
                                <th className="w-12 px-3 py-3 font-bold text-gray-500 text-center" title="Número de fila">#</th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('id_otvieja')}
                                >
                                    <div className="flex items-center">
                                        OT
                                        <SortIcon column="id_otvieja" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('fecha_entrada')}
                                >
                                    <div className="flex items-center">
                                        F. Entrada
                                        <SortIcon column="fecha_entrada" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group min-w-[200px]"
                                    onClick={() => handleSort('cliente')}
                                >
                                    <div className="flex items-center">
                                        Cliente
                                        <SortIcon column="cliente" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('codigo')}
                                >
                                    <div className="flex items-center">
                                        Código
                                        <SortIcon column="codigo" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group min-w-[400px]"
                                    onClick={() => handleSort('descripcion')}
                                    title="Ordenar por producto"
                                >
                                    <div className="flex items-center">
                                        Producto
                                        <SortIcon column="descripcion" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('n_pedido')}
                                    title="Ordenar por N° de pedido"
                                >
                                    <div className="flex items-center">
                                        N° Pedido
                                        <SortIcon column="n_pedido" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('unidades')}
                                    title="Ordenar por cantidad (de mayor a menor)"
                                >
                                    <div className="flex items-center justify-center">
                                        Cant.
                                        <SortIcon column="unidades" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('prioridad')}
                                    title="Ordenar por prioridad (primero las más urgentes)"
                                >
                                    <div className="flex items-center justify-center">
                                        Prioridad
                                        <SortIcon column="prioridad" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('material')}
                                    title="Ordenar por estado de material (primero lo que falta: Sin Stock → Pedido → OK)"
                                >
                                    <div className="flex items-center justify-center">
                                        Material
                                        <SortIcon column="material" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('proceso')}
                                    title="¿La OT tiene procesos cargados? Ordena por cantidad de procesos, de mayor a menor (el número de abajo es terminados/total)"
                                >
                                    <div className="flex items-center justify-center">
                                        Proceso
                                        <SortIcon column="proceso" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('plano')}
                                    title="¿Hay un plano para mirar? Tocalo y se abre sin salir de la tabla. Ordena primero las OT que no tienen nada"
                                >
                                    <div className="flex items-center justify-center">
                                        Plano
                                        <SortIcon column="plano" />
                                    </div>
                                </th>
                                {!hideStatus && (
                                    <th
                                        className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                        onClick={() => handleSort('estado')}
                                    >
                                        <div className="flex items-center justify-center">
                                            Estado
                                            <SortIcon column="estado" />
                                        </div>
                                    </th>
                                )}
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 text-center cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('entrega')}
                                    title="Ordenar por % entregado (primero lo que menos se entregó)"
                                >
                                    <div className="flex items-center justify-center">
                                        Entrega
                                        <SortIcon column="entrega" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('fecha_prometida')}
                                >
                                    <div className="flex items-center">
                                        F. Prometida
                                        <SortIcon column="fecha_prometida" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('fecha_entrega')}
                                >
                                    <div className="flex items-center">
                                        F. Entrega
                                        <SortIcon column="fecha_entrega" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('aprobado_por')}
                                    title="Ordenar por quién aprobó"
                                >
                                    <div className="flex items-center">
                                        Aprobado x
                                        <SortIcon column="aprobado_por" />
                                    </div>
                                </th>
                                <th
                                    className="px-3 py-3 font-bold text-gray-600 cursor-pointer hover:bg-gray-200 transition-colors select-none group"
                                    onClick={() => handleSort('requerido_por')}
                                    title="Ordenar por quién pidió"
                                >
                                    <div className="flex items-center">
                                        Pedido x
                                        <SortIcon column="requerido_por" />
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        {/* `[&_td]:align-middle` centra verticalmente todas las celdas de body.
                            Antes cuando "INDUSTRIAS CERAMICAS LOURDES S.A." rompía en 3-4 líneas,
                            el resto de las celdas (#, OT, fecha, código) se anclaban al top y la
                            fila se veía desalineada. */}
                        <tbody className="[&_td]:align-middle">
                            {sortedData.length === 0 ? (
                                <tr className="bg-gray-50 border-b">
                                    <td colSpan={hideStatus ? 19 : 20} className="px-3 py-8 text-center text-gray-500">
                                        {searchTerm ? "No se encontraron resultados para la búsqueda." : (mensajeVacio || "No hay órdenes activas en este momento.")}
                                    </td>
                                </tr>

                            ) : (
                                sortedData.map((item, index) => (
                                    <React.Fragment key={item.id}>
                                        {/* Un click DESPLIEGA. Dos clicks abren la OT.
                                            Antes el mismo click hacía las dos cosas —desplegaba Y
                                            abría el modal—, así que errarle a la flechita por unos
                                            píxeles te tiraba la OT entera encima sin haberla pedido
                                            (Julián, 10/09: "si le erro al click de la flechita me
                                            abre la OT entera y me buguea"). Y cerrar el modal te
                                            dejaba con la fila desplegada de arriba, que era el
                                            "bug" que veía.

                                            El doble clic no necesita compensar nada: son dos
                                            toggles, así que la fila queda como estaba y encima se
                                            abre la OT. Cierra de paso el pedido del 28/08 de abrir
                                            la OT con doble clic. */}
                                        <tr
                                            onClick={() => toggleRow(item.id)}
                                            onDoubleClick={() => onRowClick(item)}
                                            title="Un click para ver el detalle · doble clic para abrir la OT"
                                            className={cn(
                                                "border-b transition-colors duration-150 cursor-pointer hover:opacity-80 select-none",
                                                getRowColor(item)
                                            )}
                                        >
                                            <td className="px-2 py-3" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                                                {onSelectionChange && (
                                                    <label className="flex items-center justify-center w-full h-full py-2 cursor-pointer">
                                                        <Checkbox
                                                            className="h-5 w-5"
                                                            checked={selectedIds.includes(item.id)}
                                                            onCheckedChange={(checked) => handleSelectRow(item.id, !!checked)}
                                                        />
                                                    </label>
                                                )}
                                            </td>
                                            {/* El blanco es la celda entera, no el ícono: antes eran
                                                24px de lado (un `p-1` alrededor de un ícono de 16) y
                                                por eso se le erraba. Ahora son 40 de alto y todo el
                                                ancho de la columna. El ícono crece a 20px y el
                                                desplegado se marca con color, no sólo con la
                                                rotación. */}
                                            <td className="p-0">
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        toggleRow(item.id);
                                                    }}
                                                    // Dos clicks nerviosos sobre la flechita no pueden terminar
                                                    // abriendo la OT: `stopPropagation` del click no frena el
                                                    // dblclick, que es otro evento y burbujea igual.
                                                    onDoubleClick={(e) => e.stopPropagation()}
                                                    aria-expanded={isRowExpanded(item.id)}
                                                    aria-label={isRowExpanded(item.id)
                                                        ? `Ocultar el detalle de la OT ${item.id_otvieja || item.id}`
                                                        : `Ver el detalle de la OT ${item.id_otvieja || item.id}`}
                                                    className="flex h-10 w-full items-center justify-center rounded hover:bg-black/10 active:bg-black/15 transition-colors"
                                                >
                                                    {isRowExpanded(item.id) ? (
                                                        <ChevronDown className="h-5 w-5 text-gray-700" />
                                                    ) : (
                                                        <ChevronRight className="h-5 w-5 text-gray-500" />
                                                    )}
                                                </button>
                                            </td>
                                            <td className="px-3 py-3 text-center text-gray-500 font-mono text-xs select-none">{index + 1}</td>
                                            <td className="px-3 py-3 font-medium">{item.id_otvieja || item.id}</td>
                                            <td
                                                className="group/edit relative px-3 py-3 font-medium cursor-pointer hover:bg-black/5 rounded-sm"
                                                title="Click para editar la fecha de entrada"
                                                onClick={(e) => { e.stopPropagation(); handleDateClick(item.id, 'fecha_entrada', item.fecha_entrada); }}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                            >
                                                {editingOrder?.id === item.id && editingOrder.field === 'fecha_entrada' ? (
                                                    <input
                                                        type="date"
                                                        className="border rounded px-1 py-1 text-xs w-full shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    formatDate(item.fecha_entrada)
                                                )}
                                                {lapizDeCelda(item.id, 'fecha_entrada')}
                                            </td>
                                            <td className="px-3 py-3 text-gray-500 italic">{item.cliente?.nombre || "-"}</td>
                                            <td className="px-3 py-3 font-mono text-xs">{item.articulo?.cod_articulo || "-"}</td>
                                            {/* Mostraba una cosa y guardaba en otra: la celda lee la descripción del
                                                ARTÍCULO y el guardado escribía en la observación de la ORDEN. En
                                                una OT con artículo de verdad eso daba lo peor de los dos mundos —la
                                                celda volvía sola al valor viejo, como si no hubiera guardado, y de
                                                paso le pisaba la observación sin avisar—.
                                                Queda editable SÓLO donde las dos puntas son la misma cosa: las OT
                                                sin artículo y las heredadas, donde la observación ES lo que la celda
                                                muestra. Ahí ya andaba y sigue andando igual.
                                                Con un artículo cargado la celda pasa a ser de lectura, que es lo que
                                                de hecho ya era —el cambio nunca se veía—. Hacerla guardar de verdad
                                                sería cambiarle el nombre al artículo desde una orden, y ese nombre
                                                lo comparten todas las OT que fabrican la pieza: es otra cosa, y no
                                                se decide acá. */}
                                            <td
                                                className={cn(
                                                    "px-3 py-3 font-medium text-gray-900 min-w-[300px] max-w-[450px]",
                                                    descripcionSaleDeObservaciones(item) && "group/edit relative cursor-pointer hover:bg-black/5 rounded-sm"
                                                )}
                                                title={descripcionSaleDeObservaciones(item)
                                                    ? `${getEditableProductDescription(item) || "Sin descripción"}\n\nClick para escribir la descripción de ESTA orden`
                                                    : getEditableProductDescription(item)}
                                                onClick={descripcionSaleDeObservaciones(item)
                                                    ? (e) => { e.stopPropagation(); handleTextClick(item.id, 'observaciones', valorEditableDeDescripcion(item)); }
                                                    : undefined}
                                                onDoubleClick={descripcionSaleDeObservaciones(item)
                                                    ? (e) => e.stopPropagation()
                                                    : undefined}
                                            >
                                                {editingOrder?.id === item.id && editingOrder.field === 'observaciones' ? (
                                                    <input
                                                        type="text"
                                                        className="border rounded px-2 py-1 text-xs w-full shadow-inner focus:ring-2 focus:ring-blue-500/20"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className="line-clamp-2">
                                                        {getEditableProductDescription(item) || "-"}
                                                    </span>
                                                )}
                                                {descripcionSaleDeObservaciones(item) && lapizDeCelda(item.id, 'observaciones')}
                                            </td>
                                            <td
                                                className="group/edit relative px-3 py-3 text-xs text-gray-600 cursor-pointer hover:bg-black/5 rounded-sm"
                                                title="Click para editar el N° de pedido"
                                                onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'n_pedido', item.n_pedido || item.n_ped_l); }}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                            >
                                                {editingOrder?.id === item.id && editingOrder.field === 'n_pedido' ? (
                                                    <input
                                                        type="text"
                                                        className="border rounded px-1 py-1 text-xs w-full shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.n_pedido || item.n_ped_l || "-"
                                                )}
                                                {lapizDeCelda(item.id, 'n_pedido')}
                                            </td>
                                            <td
                                                className="group/edit relative px-3 py-3 text-center font-medium cursor-pointer hover:bg-black/5 rounded-sm"
                                                title="Click para editar la cantidad"
                                                onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'unidades', item.unidades); }}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                            >
                                                {editingOrder?.id === item.id && editingOrder.field === 'unidades' ? (
                                                    <input
                                                        type="number"
                                                        className="border rounded px-1 py-1 text-xs w-16 text-center shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.unidades ?? "-"
                                                )}
                                                {lapizDeCelda(item.id, 'unidades')}
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <Badge variant="outline" className="bg-white/50 border-gray-400 text-gray-800">
                                                    {getPriorityLabel(item.id_prioridad, item.prioridad?.descripcion)}
                                                </Badge>
                                            </td>
                                            <td className="px-3 py-3 text-center">
                                                <MaterialChip estado={item.estado_material} noLleva={item.no_lleva_materia_prima} />
                                            </td>
                                            {/* Proceso: Sí (verde) si tiene procesos cargados + cuántos terminados
                                                (ese x/y es justamente el criterio con el que ordena la columna). */}
                                            <td className="px-3 py-3 text-center">
                                                {(item.procesos && item.procesos.length > 0) ? (
                                                    <div className={cn("flex justify-center", compacto ? "flex-row items-center gap-1.5" : "flex-col items-center gap-0.5")}>
                                                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 font-semibold">Sí</Badge>
                                                        <span
                                                            className="text-[10px] font-mono text-gray-500"
                                                            title="Procesos finalizados / total"
                                                        >
                                                            {item.procesos.filter(p => p.estado_proceso?.id === 3).length}/{item.procesos.length}
                                                        </span>
                                                    </div>
                                                ) : (
                                                    <Badge variant="outline" className="bg-gray-100 text-gray-500 border-gray-300 font-semibold">No</Badge>
                                                )}
                                            </td>
                                            {/* Plano: el badge se toca y abre el archivo acá mismo. Esta es LA
                                                pantalla desde la que se planifica, y hasta ahora la columna solo
                                                informaba —y encima informaba mal, "No" en todas las filas—: para
                                                ver un plano había que abrir la ficha de la OT, perder la lista y
                                                volver a buscarla. Ahora dice "Del producto" cuando el plano es el
                                                del artículo que fabrica (que es el caso de casi todas) y se mira
                                                sin moverse de la fila. Ojo: mostrarlo NO lo convierte en una OT
                                                que exija saber leer planos; eso lo sigue decidiendo el otro
                                                conjunto, el del filtro duro del planificador. */}
                                            <td className="px-3 py-3 text-center">
                                                <PlanoDeOrden
                                                    ordenId={item.id}
                                                    tienePlano={item.tiene_plano}
                                                    compacto={compacto}
                                                />
                                            </td>
                                            {!hideStatus && (
                                                <td className="px-3 py-3 text-center">
                                                    {renderStatusBadge(getOrderStatus(item))}
                                                </td>
                                            )}
                                            <td className="px-3 py-3">
                                                <div
                                                    className="cursor-pointer hover:opacity-70 transition-opacity"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeliveryOrder({
                                                            id: item.id,
                                                            total: item.unidades || 0,
                                                            delivered: item.cantidad_entregada || 0
                                                        });
                                                    }}
                                                    title="Click para registrar entrega"
                                                >
                                                    {compacto ? (
                                                        <span className="text-xs font-medium text-gray-700 tabular-nums whitespace-nowrap">
                                                            {item.cantidad_entregada || 0}
                                                            <span className="text-gray-400">/</span>
                                                            {item.unidades ?? "-"}
                                                        </span>
                                                    ) : (
                                                        <DeliveryProgress
                                                            total={item.unidades}
                                                            delivered={item.cantidad_entregada}
                                                            compact={true}
                                                        />
                                                    )}
                                                </div>
                                            </td>

                                            {/* Editable F. Prometida */}
                                            <td
                                                className="group/edit relative px-3 py-3 font-medium cursor-pointer hover:bg-black/5"
                                                title="Click para editar la fecha prometida"
                                                onClick={(e) => { e.stopPropagation(); handleDateClick(item.id, 'fecha_prometida', item.fecha_prometida); }}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                            >
                                                {editingOrder?.id === item.id && editingOrder.field === 'fecha_prometida' ? (
                                                    <input
                                                        type="date"
                                                        className="border rounded px-1 py-0.5 text-xs w-full"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    formatDate(item.fecha_prometida)
                                                )}
                                                {lapizDeCelda(item.id, 'fecha_prometida')}
                                            </td>

                                            {/* Editable F. Entrega */}
                                            <td
                                                className="group/edit relative px-3 py-3 text-gray-500 cursor-pointer hover:bg-black/5"
                                                title="Click para editar la fecha de entrega"
                                                onClick={(e) => { e.stopPropagation(); handleDateClick(item.id, 'fecha_entrega', item.fecha_entrega); }}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                            >
                                                {editingOrder?.id === item.id && editingOrder.field === 'fecha_entrega' ? (
                                                    <input
                                                        type="date"
                                                        className="border rounded px-1 py-0.5 text-xs w-full"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.fecha_entrega && !item.fecha_entrega.startsWith('1950') ? (
                                                        formatDate(item.fecha_entrega)
                                                    ) : (
                                                        <div className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors bg-gray-50/50 px-2 py-1 rounded border border-transparent hover:border-gray-200">
                                                            <CalendarClock className="h-3 w-3" />
                                                            <span>dd/mm/aaaa</span>
                                                        </div>
                                                    )
                                                )}
                                                {lapizDeCelda(item.id, 'fecha_entrega')}
                                            </td>
                                            <td
                                                className="group/edit relative px-3 py-3 text-xs text-gray-600 cursor-pointer hover:bg-black/5 rounded-sm"
                                                title={`${item.aprobado_por || "Sin cargar"} · click para editar quién aprobó la orden`}
                                                onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'aprobado_por', item.aprobado_por); }}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                            >
                                                {editingOrder?.id === item.id && editingOrder.field === 'aprobado_por' ? (
                                                    <input
                                                        type="text"
                                                        className="border rounded px-1 py-1 text-xs w-full shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.aprobado_por || "-"
                                                )}
                                                {lapizDeCelda(item.id, 'aprobado_por')}
                                            </td>
                                            <td
                                                className="group/edit relative px-3 py-3 text-xs text-gray-600 cursor-pointer hover:bg-black/5 rounded-sm"
                                                title={`${item.requerido_por || "Sin cargar"} · click para editar quién pidió la orden`}
                                                onClick={(e) => { e.stopPropagation(); handleTextClick(item.id, 'requerido_por', item.requerido_por); }}
                                                onDoubleClick={(e) => e.stopPropagation()}
                                            >
                                                {editingOrder?.id === item.id && editingOrder.field === 'requerido_por' ? (
                                                    <input
                                                        type="text"
                                                        className="border rounded px-1 py-1 text-xs w-full shadow-inner"
                                                        value={editingOrder.value}
                                                        onChange={(e) => setEditingOrder({ ...editingOrder, value: e.target.value })}
                                                        onBlur={handleDateSave}
                                                        onKeyDown={(e) => e.key === 'Enter' && handleDateSave()}
                                                        autoFocus
                                                    />
                                                ) : (
                                                    item.requerido_por || "-"
                                                )}
                                                {lapizDeCelda(item.id, 'requerido_por')}
                                            </td>
                                        </tr>
                                        {isRowExpanded(item.id) && (
                                            <tr className="bg-gray-50 border-b">
                                                <td colSpan={hideStatus ? 19 : 20} className="px-4 py-4">
                                                    {renderDetails(item)}
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                {/* Gradient fade en el borde derecho — solo se muestra cuando hay
                    más contenido scrolleable a la derecha. Cuando el usuario llega al
                    final, `showRightFade` pasa a false y el gradient desaparece con
                    una transición suave de opacidad. */}
                <div
                    className={`pointer-events-none absolute top-0 right-0 h-full w-12 bg-gradient-to-l from-white via-white/80 to-transparent transition-opacity duration-200 ${showRightFade ? 'opacity-100' : 'opacity-0'}`}
                />
            </Card >

            {incidencia && (
                <RegistrarIncidenciaModal
                    open={!!incidencia}
                    onClose={() => setIncidencia(null)}
                    orderId={incidencia.orderId}
                    procesoId={incidencia.procesoId}
                    procesoNombre={incidencia.procesoNombre}
                    operarioId={incidencia.operarioId}
                    operarioNombre={incidencia.operarioNombre}
                />
            )}
        </div >
    );
}


