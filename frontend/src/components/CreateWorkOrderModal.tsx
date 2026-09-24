"use client";

import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Calendar as CalendarIcon, Loader2, Package, User, Settings, FileText, Plus, Trash2, ArrowRight, ArrowLeft, CheckCircle2, UploadCloud, X, Image as ImageIcon, Layers, Printer, Copy, Paperclip, ChevronLeft, ChevronRight, AlertTriangle, History, Info } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HistorialDeProcesos } from "@/components/auditoria/HistorialDeProcesos";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/lib/toast";
import { cn, capitalizeName, isOrderDelivered } from "@/lib/utils";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

import { WorkOrder } from "@/lib/types";
import { API_URL } from "@/config";
import { parseApiError } from "@/lib/utils";
import { ProcesosEditor, pasosSinMinutos, SIN_MAQUINA, ProcesoRow } from "@/components/planning/ProcesosEditor";
import { PlanoPanel } from "@/components/common/PlanoPanel";
import { usePlanosDeArticulo, usePlanosDeOrden } from "@/hooks/usePlanos";
import { usePermisos } from "@/hooks/usePermisos";
import { MarcaSoloLectura } from "@/components/permisos/SinAcceso";
import { descargarPlano, esFoto, esPlano, type Plano } from "@/lib/planos";
import { ExportarMenu } from "@/components/common/ExportarMenu";
import { PausasDeLaOT } from "@/components/pausas/PausasDeLaOT";
import { ControlDeCalidadOT } from "@/components/calidad/ControlDeCalidadOT";
import { aNumero } from "@/lib/exportar";
import { archivoDeOT, seccionesDeOT, type DatosDeOT } from "@/lib/exportes/ot";
import { EstadoYControl, type ValoresDeEstado } from "@/components/common/EstadoDeControl";
import {
    CASILLAS_NUEVAS,
    conoceEstadosDeControl,
    marcada,
    resumenEstadoYControl,
    cuandoLegible,
} from "@/lib/estadoControlOT";
import {
    CeldaConsumido,
    FilaDeConsumo,
    ListaDeConsumos,
    useConsumosDeOrden,
    type LineaDeMaterial,
} from "@/components/materiales/ConsumoDeMaterial";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

interface CreateWorkOrderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
    orderToEdit?: WorkOrder | null;
}

interface Option {
    id: number;
    nombre: string;
}

interface Maquina {
    id: number;
    nombre: string;
}

interface Articulo {
    id: number;
    cod_articulo: string;
    descripcion: string;
}

interface MateriaPrimaItem {
    id: string; // Temp ID
    /** El id de la línea en orden_trabajo_pieza. Es contra lo que se registra el consumo. */
    id_linea?: number;
    codigo: string;
    descripcion: string;
    cantidad: string;
    unidad: string;
    proveedor?: string;
    disponible: string;
    en_produccion: string;
    observaciones: string;
    precio: string;
    c_usado: string;
    utilizado: boolean;
    cortes: string;
}


/**
 * El orden en el que Anterior/Siguiente recorren las solapas.
 *
 * Antes cada botón tenía su propia cadena de `if` ("si estoy en general voy a materias, si
 * estoy en materias voy a procesos"), duplicada y al revés en el otro. Agregar Planos al
 * final quería decir tocar los dos y acordarse de los dos; escrito una sola vez acá, no
 * hay forma de que queden diciendo cosas distintas.
 */
const ORDEN_SOLAPAS = ["general", "materias", "procesos", "planos", "historial"] as const;
type Solapa = (typeof ORDEN_SOLAPAS)[number];

/**
 * "1 plano · 15 fotos".
 *
 * Se cuenta en vez de listar porque el problema era justamente listar: los quince archivos
 * de una pieza se llaman igual salvo el final —"Matriz 46x240x307mm de 2 partes (1).jpg",
 * "… (15).jpg"— y el renglón los corta por ahí, que es lo único que los distingue. Quince
 * renglones idénticos ocupando toda la solapa no dicen nada; "15 fotos" sí, y el detalle
 * con la miniatura está a un click en la solapa Planos.
 *
 * Plano y foto se separan porque no son lo mismo: hay 122 productos que no tienen ni un
 * dibujo, solo fotos de la pieza, y llamarles "planos" a todos manda al que planifica a
 * buscar un archivo que no existe.
 */
/**
 * El final del nombre, que es lo único que distingue a quince archivos que arrancan
 * igual ("Matriz 46x240x307mm de 2 partes (1).jpg" … "(15).jpg"). Cortando por el final,
 * como hacía `truncate`, los quince se leían idénticos y al lado de cada uno había un
 * botón de sacarlo de la orden: no había forma de saber cuál estabas sacando.
 */
function colaDelNombre(nombre: string, max = 34): string {
    if (!nombre || nombre.length <= max) return nombre;
    return "…" + nombre.slice(-(max - 1));
}

function resumirArchivos(archivos: { tipo_archivo?: string | null }[]): string {
    let planos = 0;
    let fotos = 0;
    let otros = 0;
    for (const a of archivos) {
        if (esPlano(a.tipo_archivo)) planos++;
        else if (esFoto(a.tipo_archivo)) fotos++;
        else otros++;
    }

    const partes: string[] = [];
    if (planos) partes.push(`${planos} ${planos === 1 ? "plano" : "planos"}`);
    if (fotos) partes.push(`${fotos} ${fotos === 1 ? "foto" : "fotos"}`);
    if (otros) partes.push(`${otros} ${otros === 1 ? "archivo" : "archivos"}`);
    return partes.join(" · ");
}

/**
 * El plano del producto, al costado de la carga de procesos.
 *
 * Los pasos salen del dibujo: el que los escribe lo está mirando. Si para verlo hay que
 * abrir un modal que tapa el listado, la cuenta la termina haciendo de memoria.
 *
 * Se pliega porque en un notebook el panel le saca 320px al listado y las columnas de
 * máquina, minutos y personas quedan espichadas: el que ya sabe qué va lo cierra.
 */
/** Dónde se recuerda si el plano va al lado de los procesos o no. */
const CLAVE_PANEL_PLANOS = "spmm.ot.panelPlanos";

function PanelDePlanos({ planos, cargando, vacioTexto, titulo, onVerTodos }: {
    planos: Plano[];
    cargando: boolean;
    vacioTexto: string;
    titulo: string;
    /** Saltar a la solapa Planos, donde entran todos a la vez y más grandes. */
    onVerTodos: () => void;
}) {
    /**
     * Plegado o no, y SE ACUERDA.
     *
     * El panel ya se podía plegar, pero volvía abierto en cada OT — así que para el
     * que trabaja cargando procesos todo el día no servía de nada. Camilo, del taller
     * (11/09): "ese cuadro que se ve al lado de los procesos se tendría que poder
     * sacar... porque no me deja ver el proceso y no tengo forma de correr o agrandar
     * para leer el proceso. Tengo que mandar a imprimir para ver qué proceso dice".
     *
     * Con la preferencia guardada, el que mira planos los deja abiertos y el que carga
     * procesos los cierra una vez y no los ve nunca más. Si el navegador no deja
     * escribir (modo privado), simplemente no se acuerda: no es motivo para romper la
     * pantalla.
     */
    const [abierto, setAbierto] = useState(true);

    useEffect(() => {
        try {
            if (localStorage.getItem(CLAVE_PANEL_PLANOS) === "cerrado") setAbierto(false);
        } catch { /* nada */ }
    }, []);

    const cambiarAbierto = (v: boolean) => {
        setAbierto(v);
        try { localStorage.setItem(CLAVE_PANEL_PLANOS, v ? "abierto" : "cerrado"); } catch { /* nada */ }
    };

    if (!abierto) {
        return (
            <button
                type="button"
                onClick={() => cambiarAbierto(true)}
                title="Volver a mostrar el plano al lado de los procesos"
                className="order-1 lg:order-2 lg:sticky lg:top-14 flex-shrink-0 flex items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-gray-400 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
                <Paperclip className="w-3 h-3" />
                <span className="lg:hidden">Ver el plano{planos.length > 0 ? ` (${planos.length})` : ""}</span>
                <ChevronLeft className="w-3.5 h-3.5" />
            </button>
        );
    }

    // 330px acá eran 330px menos para la tabla de procesos, y la que los pagaba era la
    // columna del nombre del proceso. El plano se mira, no se edita: con 260 entran
    // igual las miniaturas, y "Ver todos los planos" sigue para verlos grandes.
    return (
        <aside className="order-1 lg:order-2 lg:sticky lg:top-14 flex-shrink-0 w-full lg:w-[280px] relative rounded-xl border border-gray-200 bg-gray-50/60 p-3">
            {/* Antes era una flechita gris clarito de 14px sin texto: estaba, pero nadie
                la encontraba — por eso el pedido fue "sacar el cuadro" y no "plegarlo".
                Ahora dice qué hace y por qué te conviene. */}
            <button
                type="button"
                onClick={() => cambiarAbierto(false)}
                title="Sacar el plano de acá para que se vea entero el nombre del proceso. Queda en la solapa Planos."
                className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-md border border-gray-200 bg-white px-1.5 py-1 text-[10px] font-semibold text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
                Ocultar
                <ChevronRight className="w-3 h-3" />
            </button>
            {/* El panel scrollea solo: el modal ya tiene su propio scroll y una lista
                larga de planos lo empujaría más allá del alto fijo del diálogo. */}
            <div className="max-h-[52vh] overflow-y-auto pr-1">
                <PlanoPanel
                    planos={planos}
                    cargando={cargando}
                    compacto
                    titulo={titulo}
                    vacioTexto={vacioTexto}
                />
            </div>
            {/* En 330px las miniaturas entran de a dos y chiquitas: alcanza para saber cuál
                es cuál, no para leer una cota. El que necesita mirar el dibujo en serio se
                va a la solapa Planos y vuelve, sin perder lo que estaba cargando. */}
            <button
                type="button"
                onClick={onVerTodos}
                className="mt-2 w-full flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
            >
                <Paperclip className="w-3 h-3" />
                Ver todos los planos
            </button>
        </aside>
    );
}

/** «11/09 a las 15:42». Día y hora, sin año: el rastro sirve para "¿lo tocaron
 *  recién?", y el año sólo ocupa lugar salvo que sea muy viejo, donde sí va. */
const formatearMomento = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const esteAnio = d.getFullYear() === new Date().getFullYear();
    const fecha = d.toLocaleDateString("es-AR", esteAnio
        ? { day: "2-digit", month: "2-digit" }
        : { day: "2-digit", month: "2-digit", year: "numeric" });
    const hora = d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
    return `${fecha} a las ${hora}`;
};

/**
 * La huella de lo que el usuario puede cambiar en el modal.
 *
 * Sirve para contestar una sola pregunta: ¿cambió algo desde que se abrió? Se saca
 * una huella al terminar de cargar y otra al cerrar; si son iguales, no hay nada que
 * descartar y no hay por qué preguntar.
 *
 * QUÉ ENTRA Y QUÉ NO, y por qué:
 *
 *  - El `id` de cada proceso NO entra: se inventa al vuelo con `Math.random()` para
 *    que React distinga las filas, así que es distinto en cada carga y compararlo
 *    daría «cambió» siempre. `id_otp` —la pasada real— sí entra. El ORDEN del array
 *    también cuenta: la posición ES el paso que se guarda.
 *  - Las MATERIAS PRIMAS no entran: esa solapa se mira, no se edita (el único
 *    `setMateriasPrimas` que no es carga ni reset no existe) y no viaja al guardar.
 *  - Los ARCHIVOS EXISTENTES tampoco: el único botón que los saca escribe
 *    `deletedFileIds` en la misma línea, así que esa lista ya cuenta la historia
 *    completa. De los nuevos alcanza con nombre y tamaño.
 *
 * Que esas dos queden afuera no es un detalle de prolijidad: son justo las dos cosas
 * que llegan por red. Sin ellas la foto se saca de una, sincrónica, y desaparece la
 * ventana en la que lo que alguien tipeaba mientras cargaba se metía DENTRO de la
 * foto — y se perdía al cerrar, sin cartel y sin aviso.
 */
type EstadoDelFormulario = {
    generalData: any;
    detailsData: any;
    processes: ProcesoRow[];
    files: File[];
    deletedFileIds: number[];
};

/** El formulario en blanco. Está acá, y no escrito dos veces, para que el reset y la
 *  foto del alta no se puedan separar: si se separaran, abrir «Nueva orden» y cerrar
 *  sin escribir nada volvería a mostrar el cartel. */
const generalVacio = () => ({
    cliente: "", cliente_id: "", descripcion: "", prioridad_id: "", articulo_id: "", sector_id: "", fecha_prometida: "",
    fecha_entrada: new Date().toISOString().split('T')[0], fecha_orden: new Date().toISOString().split('T')[0],
    fecha_entrega: "", cantidad_entregada: "", reclamo: false, finalizadototal: false, finalizadoparcial: false,
    n_ped_l: "", n_pedido: "", subsector: "", requerido_por: "", aprobado_por: "", remitos_salida: "",
    f_disp_material: "", fabricacion: false, reparacion: false, sin_cargo: false, stock: false, interno: false,
    revisada: false, tercerizado_total: false, tercerizado_parcial: false, suspendida: false, email: false,
    tiene_plano: false, no_lleva_plano: false, no_lleva_materia_prima: false,
    programada: false, en_proceso: false, id_otvieja: "",
    // RF-11: el resto de «Estado y control» de la ficha vieja.
    controlado: false, finalizado_para_pintar: false, finalizado_tercerizacion_final: false,
    finalizado_tercerizacion_intermedia: false, cantidad_finalizada_parcial: "",
});

const detallesVacios = () => ({ cantidad: "", observaciones: "", nota_1: "", nota_2: "", nota_3: "" });

const huellaDelFormulario = (v: EstadoDelFormulario): string => {
    const sinIdDeUI = ({ id, ...resto }: any) => resto;
    return JSON.stringify({
        general: v.generalData,
        detalles: v.detailsData,
        procesos: (v.processes || []).map(sinIdDeUI),
        archivosNuevos: (v.files || []).map(f => `${f.name}:${f.size}`),
        archivosBorrados: [...(v.deletedFileIds || [])].sort((a, b) => a - b),
    });
};

export default function CreateWorkOrderModal({ isOpen, onClose, onSuccess, orderToEdit }: CreateWorkOrderModalProps) {
    // RF-24: ver `soloLectura` más abajo. Crear o borrar un proceso del CATÁLOGO desde
    // acá es escribir en Recursos › Procesos, y pide eso (así lo pide el backend).
    const { puedeSeccion } = usePermisos();
    const editaCatalogoProcesos = puedeSeccion("recursos_procesos", "write");
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [historialLoading, setHistorialLoading] = useState(false);
    /**
     * Los procesos que trajo el historial, esperando confirmación.
     *
     * «Traer historial» REEMPLAZA la lista entera, y el botón está al lado de
     * «Agregar proceso»: tocarlo después de cargar ocho pasos a mano se los llevaba
     * todos, sin aviso y sin forma de volver atrás — el modal no tiene deshacer. Es
     * la misma forma del problema que hizo que el taller dejara de usar el sistema
     * («perdió toda la mañana de procesos»), así que acá se pregunta antes.
     *
     * null = no hay nada pendiente. Con lista = el cartel está abierto.
     */
    const [historialPendiente, setHistorialPendiente] = useState<ProcesoRow[] | null>(null);
    const [activeTab, setActiveTab] = useState("general");
    const [showConfirmSubmit, setShowConfirmSubmit] = useState(false);
    const [showConfirmCancel, setShowConfirmCancel] = useState(false);

    /**
     * Cómo estaba el formulario recién abierto. Con esto se sabe si de verdad cambió
     * algo: antes se preguntaba «¿tiene datos?» —`cliente_id || descripcion ||
     * processes.length`— y editando una OT eso es SIEMPRE que sí, así que el cartel de
     * «Descartar los cambios» salía aunque no se hubiera tocado nada (Julián, 16/09).
     */
    const fotoInicial = useRef<string | null>(null);


    // Form state
    const [generalData, setGeneralData] = useState({
        // numero_orden removed - generated by backend
        cliente: "", // Legacy or display name
        cliente_id: "", // New ID field
        descripcion: "",
        prioridad_id: "",
        articulo_id: "",
        sector_id: "", // Nuevo campo DB
        fecha_prometida: "",
        fecha_entrada: new Date().toISOString().split('T')[0],
        fecha_orden: new Date().toISOString().split('T')[0],
        fecha_entrega: "",
        cantidad_entregada: "",
        reclamo: false,
        finalizadototal: false,
        finalizadoparcial: false,
        id_otvieja: "",
        // Campos "En Desarrollo" (sin db)
        n_ped_l: "",
        n_pedido: "",
        subsector: "",
        requerido_por: "",
        aprobado_por: "",
        remitos_salida: "",
        f_disp_material: "",
        fabricacion: false,
        reparacion: false,
        sin_cargo: false,
        stock: false,
        interno: false,
        revisada: false,
        tercerizado_total: false,
        tercerizado_parcial: false,
        suspendida: false,
        email: false,
        tiene_plano: false,
        no_lleva_plano: false,
        no_lleva_materia_prima: false,
        programada: false,
        en_proceso: false,
        // RF-11: el resto de «Estado y control» de la ficha vieja.
        controlado: false,
        finalizado_para_pintar: false,
        finalizado_tercerizacion_final: false,
        finalizado_tercerizacion_intermedia: false,
        cantidad_finalizada_parcial: "",
    });

    const [detailsData, setDetailsData] = useState({
        cantidad: "",
        observaciones: "",
        nota_1: "",
        nota_2: "",
        nota_3: "",
    });


    const [processes, setProcesses] = useState<ProcesoRow[]>([]);
    /** Lo que el planificador asignó, por id de pasada. Lo manda GET /ordenes/{id}. */
    const [planificado, setPlanificado] = useState<Record<number, any>>({});
    const [materiasPrimas, setMateriasPrimas] = useState<MateriaPrimaItem[]>([]);
    /** Lo consumido de cada material (RF-15). Si el backend no tiene la ruta, `estado`
     *  queda en "no" y la solapa se ve exactamente como antes. */
    const consumo = useConsumosDeOrden(orderToEdit?.id, isOpen);
    /** La línea con el alta de consumo abierta debajo. Una sola a la vez: en un
     *  teléfono dos formularios abiertos empujan la lista fuera de la pantalla. */
    const [consumoAbierto, setConsumoAbierto] = useState<number | null>(null);
    useEffect(() => { setConsumoAbierto(null); }, [isOpen, orderToEdit?.id]);
    const [files, setFiles] = useState<File[]>([]);
    const [existingFiles, setExistingFiles] = useState<ExistingFile[]>([]);
    const [deletedFileIds, setDeletedFileIds] = useState<number[]>([]);
    /** Ids de los planos que son del producto, no de esta orden. Borrar uno de estos
     *  lo saca de todas las órdenes del artículo y no se recupera, así que se guardan
     *  aparte y se filtran otra vez al guardar: que el botón no esté alcanza hoy, pero
     *  esto sigue protegiendo si mañana aparece otra forma de sacar un archivo. */
    const planosDelProducto = useRef<Set<number>>(new Set());

    interface ExistingFile {
        id: number;
        nombre: string;
        tipo_archivo: string;
        /** "ot" = adjunto de esta orden · "articulo" = plano del producto, compartido. */
        origen?: "ot" | "articulo";
        id_articulo?: number | null;
    }

    // Data options
    const [prioridades, setPrioridades] = useState<Option[]>([]);
    const [procesosOptions, setProcesosOptions] = useState<Option[]>([]);
    /** {proceso_id: [operario_id]} — quién puede hacer cada trabajo. Ver el endpoint. */
    const [quienPuede, setQuienPuede] = useState<Record<string, number[]> | undefined>(undefined);
    const [articulos, setArticulos] = useState<Articulo[]>([]);
    const [clientes, setClientes] = useState<Option[]>([]); // New state
    const [operarios, setOperarios] = useState<{ id: number, nombre: string, apellido: string }[]>([]);
    const [maquinarias, setMaquinarias] = useState<Maquina[]>([]);
    const [sectores, setSectores] = useState<Option[]>([]);

    useEffect(() => {
        if (isOpen) {
            // La foto de la apertura anterior no vale: el modal queda montado y su
            // estado sobrevive al cierre.
            fotoInicial.current = null;

            fetchData();
            if (activeTab !== "general") setActiveTab("general");

            if (isOpen && orderToEdit) {
                // Populate form with existing data
                console.log("Populating form with:", orderToEdit);
                // Helper to get ID string safely
                const getSafeId = (obj: any) => obj?.id?.toString() || "";

                const generalCargado = {
                    cliente: orderToEdit.cliente ? (typeof orderToEdit.cliente === 'object' ? orderToEdit.cliente.nombre : orderToEdit.cliente) || "" : "",
                    cliente_id: getSafeId(orderToEdit.cliente),
                    descripcion: orderToEdit.detalle || orderToEdit.observaciones || "",
                    prioridad_id: getSafeId(orderToEdit.prioridad) || orderToEdit.id_prioridad?.toString() || "1",
                    articulo_id: getSafeId(orderToEdit.articulo) || orderToEdit.id_articulo?.toString() || "",
                    sector_id: getSafeId(orderToEdit.sector) || orderToEdit.id_sector?.toString() || "1",
                    fecha_prometida: orderToEdit.fecha_prometida ? orderToEdit.fecha_prometida.split('T')[0] : "",
                    fecha_entrada: orderToEdit.fecha_entrada ? orderToEdit.fecha_entrada.split('T')[0] : new Date().toISOString().split('T')[0],
                    fecha_orden: orderToEdit.fecha_orden ? orderToEdit.fecha_orden.split('T')[0] : new Date().toISOString().split('T')[0],
                    fecha_entrega: orderToEdit.fecha_entrega ? orderToEdit.fecha_entrega.split('T')[0] : "",
                    cantidad_entregada: orderToEdit.cantidad_entregada?.toString() || "",
                    reclamo: orderToEdit.reclamo === 1 || orderToEdit.reclamo === true,
                    finalizadototal: orderToEdit.finalizadototal === 1 || orderToEdit.finalizadototal === true,
                    finalizadoparcial: orderToEdit.finalizadoparcial === 1 || orderToEdit.finalizadoparcial === true,
                    id_otvieja: orderToEdit.id_otvieja?.toString() || "",
                    // Campos Pronto funcionales
                    n_ped_l: orderToEdit.n_ped_l || "",
                    n_pedido: orderToEdit.n_pedido || "",
                    subsector: orderToEdit.subsector || "",
                    requerido_por: orderToEdit.requerido_por || "",
                    aprobado_por: orderToEdit.aprobado_por || "",
                    remitos_salida: orderToEdit.remitos_salida || "",
                    f_disp_material: orderToEdit.f_disp_material ? orderToEdit.f_disp_material.split('T')[0] : "",
                    fabricacion: orderToEdit.fabricacion === 1 || orderToEdit.fabricacion === true,
                    reparacion: orderToEdit.reparacion === 1 || orderToEdit.reparacion === true,
                    sin_cargo: orderToEdit.sin_cargo === 1 || orderToEdit.sin_cargo === true,
                    stock: orderToEdit.stock === 1 || orderToEdit.stock === true,
                    interno: orderToEdit.interno === 1 || orderToEdit.interno === true,
                    revisada: orderToEdit.revisada === 1 || orderToEdit.revisada === true,
                    tercerizado_total: orderToEdit.tercerizado_total === 1 || orderToEdit.tercerizado_total === true,
                    tercerizado_parcial: orderToEdit.tercerizado_parcial === 1 || orderToEdit.tercerizado_parcial === true,
                    suspendida: orderToEdit.suspendida === 1 || orderToEdit.suspendida === true,
                    email: orderToEdit.email === 1 || orderToEdit.email === true,
                    tiene_plano: orderToEdit.tiene_plano === 1 || orderToEdit.tiene_plano === true,
                    no_lleva_plano: (orderToEdit as any).no_lleva_plano === 1 || (orderToEdit as any).no_lleva_plano === true,
                    no_lleva_materia_prima: (orderToEdit as any).no_lleva_materia_prima === 1 || (orderToEdit as any).no_lleva_materia_prima === true,
                    programada: orderToEdit.programada === 1 || orderToEdit.programada === true,
                    en_proceso: orderToEdit.en_proceso === 1 || orderToEdit.en_proceso === true,
                    // RF-11. Con el backend de antes (sin estos campos) quedan en blanco y
                    // bloqueados: ver `conoceControl`.
                    controlado: marcada(orderToEdit.controlado),
                    finalizado_para_pintar: marcada(orderToEdit.finalizado_para_pintar),
                    finalizado_tercerizacion_final: marcada(orderToEdit.finalizado_tercerizacion_final),
                    finalizado_tercerizacion_intermedia: marcada(orderToEdit.finalizado_tercerizacion_intermedia),
                    cantidad_finalizada_parcial: orderToEdit.cantidad_finalizada_parcial != null
                        ? String(orderToEdit.cantidad_finalizada_parcial) : "",
                };
                setGeneralData(generalCargado);

                const detallesCargados = {
                    cantidad: orderToEdit.unidades ? orderToEdit.unidades.toString() : "",
                    observaciones: orderToEdit.observaciones || "",
                    nota_1: "",
                    nota_2: "",
                    nota_3: "",
                };
                setDetailsData(detallesCargados);

                // Los procesos ya mapeados, fuera del `if` para que la foto de abajo
                // pueda verlos: adentro del bloque quedan fuera de alcance.
                let procesosCargados: ProcesoRow[] = [];

                // Populate processes if they exist
                if (orderToEdit.procesos && orderToEdit.procesos.length > 0) {
                    // Ordenar por el PASO guardado, no por como vengan en el JSON.
                    //
                    // La API manda `orden` desde siempre y acá nunca se leía: las filas se
                    // pintaban en el orden crudo del array, que es el orden físico de la
                    // tabla. Camilo ordenó 15 OT a mano y al reabrirlas le salían bailadas.
                    // Y como la pantalla numera por posición y el backend guarda
                    // `orden = posición`, el próximo guardado escribía ese desorden en la
                    // base. El backend también ordena ahora (OrdenTrabajo.procesos), pero
                    // se deploya a mano: esto sale por Vercel y arregla el taller ya.
                    //
                    // Desempate por id: hay 531 filas que comparten paso con otra de la
                    // misma OT y sin esto seguirían bailando entre aperturas.
                    const mappedProcesses: ProcesoRow[] = [...orderToEdit.procesos]
                        .sort((a, b) =>
                            ((a as any).orden ?? 0) - ((b as any).orden ?? 0) ||
                            ((a as any).id ?? 0) - ((b as any).id ?? 0))
                        .map(p => ({
                        id: Math.random().toString(36).substr(2, 9), // Temp UI ID
                        // La pasada real, para que al guardar se actualice ESTA fila y
                        // no otra del mismo proceso (una OT puede repetirlo).
                        id_otp: (p as any).id,
                        proceso_id: p.proceso.id.toString(),
                        tiempo: p.tiempo_proceso ? p.tiempo_proceso.toString() : "",
                        cant_operarios: p.cant_operarios ? p.cant_operarios.toString() : "1",
                        // id_maquinaria puede no estar en el tipo TS todavía; lo leemos defensivo.
                        // La marca «va a mano» gana: si está, el desplegable muestra eso
                        // y no «Sin recurso maquinaria», que significa otra cosa.
                        maquina_id: (p as any).no_lleva_maquina
                            ? SIN_MAQUINA
                            : ((p as any).id_maquinaria ? (p as any).id_maquinaria.toString() : ""),
                        operario_id: (p as any).id_operario ? (p as any).id_operario.toString() : "",
                        incluido: true,
                    }));
                    procesosCargados = mappedProcesses;
                    setProcesses(mappedProcesses);
                    // Lo que el planificador asignó viene pegado a cada proceso en la
                    // misma respuesta: no hace falta un segundo viaje, y así no parpadea
                    // "Sin asignar" antes de que lleguen los datos.
                    setPlanificado(Object.fromEntries(
                        (orderToEdit.procesos || [])
                            .filter((p: any) => p.id && p.planificado)
                            .map((p: any) => [p.id, p.planificado])
                    ));
                } else {
                    setProcesses([]);
                    setPlanificado({});
                }

                // LA FOTO, ACÁ Y AHORA.
                //
                // Se arma con los valores que se acaban de setear y NO leyendo el
                // estado: los setters de React no se aplicaron todavía, así que en este
                // punto `generalData` y `processes` siguen teniendo lo de la apertura
                // anterior.
                //
                // Y se saca ANTES de los dos viajes de abajo a propósito. Esperarlos
                // abría una ventana de medio segundo en la que lo que alguien tipeaba
                // entraba DENTRO de la foto: al cerrar, esos cambios figuraban como
                // "nada cambió" y se perdían sin cartel. Ninguno de los dos hace falta
                // para la comparación (ver `huellaDelFormulario`).
                fotoInicial.current = huellaDelFormulario({
                    generalData: generalCargado,
                    detailsData: detallesCargados,
                    processes: procesosCargados,
                    files: [],
                    deletedFileIds: [],
                });

                // Fetch existing files
                fetch(`${API_URL}/planos/orden/${orderToEdit.id}`, { headers: getAuthHeaders() })
                    .then(async (res) => {
                        if (res.ok) {
                            const data = await res.json();
                            if (data.status && Array.isArray(data.data)) {
                                // Esta lista ya no es solo "los archivos de la orden": el
                                // endpoint suma los planos del producto. Se le marca de
                                // dónde viene cada uno porque acá se ofrece borrarlos, y
                                // borrar el del producto lo saca de TODAS las órdenes que
                                // lo fabrican. Si la API todavía no manda `origen` (el
                                // backend se deploya a mano), se deduce del id_articulo.
                                const conOrigen: ExistingFile[] = data.data.map((f: ExistingFile) => ({
                                    ...f,
                                    origen: f.origen ?? (f.id_articulo ? "articulo" : "ot"),
                                }));
                                planosDelProducto.current = new Set(
                                    conOrigen.filter(f => f.origen === "articulo").map(f => f.id)
                                );
                                setExistingFiles(conOrigen);
                            }
                        }
                    })
                    .catch(err => console.error("Error fetching files:", err));


                // Fetch existing materias primas (orden_trabajo_pieza JOIN pieza)
                fetch(`${API_URL}/ordenes-trabajo-piezas?id_orden_trabajo=${orderToEdit.id}`, { headers: getAuthHeaders() })
                    .then(async (res) => {
                        if (!res.ok) return;
                        const data = await res.json();
                        if (!data.status || !Array.isArray(data.data)) return;
                        const mapped: MateriaPrimaItem[] = data.data.map((p: any) => ({
                            id: p.id?.toString() || Math.random().toString(36).substr(2, 9),
                            id_linea: typeof p.id === "number" ? p.id : undefined,
                            codigo: p.cod_pieza || "",
                            descripcion: p.descripcion || "",
                            cantidad: p.cantidad?.toString() || "0",
                            unidad: p.unidad || "",
                            proveedor: p.proveedor || "",
                            disponible: p.disponible?.toString() || "0",
                            en_produccion: "",
                            observaciones: "",
                            precio: p.unitario?.toString() || "0",
                            c_usado: p.cantusada?.toString() || "0",
                            utilizado: false,
                            cortes: "",
                        }));
                        setMateriasPrimas(mapped);
                    })
                    .catch(err => console.error("Error fetching materias primas:", err));


            } else {
                // Reset if new
                resetForm();
                // Y su foto: un alta recién abierta y sin tocar tampoco tiene nada que
                // descartar. `resetForm` deja exactamente estos valores.
                fotoInicial.current = huellaDelFormulario({
                    generalData: generalVacio(),
                    detailsData: detallesVacios(),
                    processes: [],
                    files: [],
                    deletedFileIds: [],
                });
            }
        }
    }, [isOpen, orderToEdit]);



    const fetchData = async () => {
        setLoading(true);
        try {
            const [prioridadesRes, procesosRes, operariosRes, maquinariasRes, articulosRes, clientesRes, sectoresRes] = await Promise.all([
                fetch(`${API_URL}/prioridades`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/procesos`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/operarios`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/maquinarias`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/articulos`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/clientes`, { headers: getAuthHeaders() }),
                fetch(`${API_URL}/sectores`, { headers: getAuthHeaders() })
            ]);

            if (prioridadesRes.ok) {
                const data = await prioridadesRes.json();
                const rawData = Array.isArray(data) ? data : (data.data || []);
                setPrioridades(rawData.map((p: any) => ({ id: p.id, nombre: p.descripcion })));
            }
            if (clientesRes.ok) {
                const data = await clientesRes.json();
                const rawData = Array.isArray(data) ? data : (data.data || []);
                setClientes(rawData.map((c: any) => ({ id: c.id, nombre: c.nombre })));
            }
            if (procesosRes.ok) {
                const data = await procesosRes.json();
                setProcesosOptions(Array.isArray(data) ? data : (data.data || []));
            }
            // Quién puede hacer cada trabajo. Va aparte y sin bloquear: si falla, los
            // desplegables se ven como siempre en vez de quedarse sin personas.
            fetch(`${API_URL}/procesos/quien-puede`, { headers: getAuthHeaders() })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => { if (d?.data) setQuienPuede(d.data); })
                .catch(() => { /* se sigue sin la marca */ });
            if (operariosRes.ok) {
                const data = await operariosRes.json();
                setOperarios(Array.isArray(data) ? data : (data.data || []));
            }
            if (maquinariasRes.ok) {
                const data = await maquinariasRes.json();
                setMaquinarias(Array.isArray(data) ? data : (data.data || []));
            }
            if (articulosRes.ok) {
                const data = await articulosRes.json();
                setArticulos(Array.isArray(data) ? data : (data.data || []));
            }
            if (sectoresRes.ok) {
                const data = await sectoresRes.json();
                const rawData = Array.isArray(data) ? data : (data.data || []);
                setSectores(rawData.map((s: any) => ({ id: s.id, nombre: s.nombre || s.descripcion })));
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            setLoading(false);
        }
    };


    /**
     * Crear un proceso que no está en el catálogo, sin salir de la OT.
     *
     * Antes había que salir, ir a Recursos, crearlo y volver a empezar la carga. Y
     * desde que el catálogo dejó de llenarse solo desde el sistema viejo (2/9), si no
     * se puede crear acá no se puede crear en el momento en que hace falta.
     *
     * Nace sin rango y sin máquina, como cualquier proceso nuevo: eso significa que el
     * planificador se lo puede dar a cualquiera y no le reserva máquina. Se avisa al
     * crearlo y el aviso dice dónde se completa, que es lo que evita que ese proceso
     * quede siendo una traba silenciosa en la próxima planificación.
     */
    const handleCrearProceso = async (nombre: string) => {
        const limpio = nombre.trim().toUpperCase();
        if (!limpio) return null;
        try {
            const res = await fetch(`${API_URL}/procesos`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({ nombre: limpio, descripcion: "" }),
            });
            if (!res.ok) {
                toast.error(parseApiError(await res.text().catch(() => "")) || "No se pudo crear el proceso");
                return null;
            }
            const body = await res.json();
            const creado = body?.data ?? body;
            const item = { id: Number(creado.id), nombre: creado.nombre ?? limpio };
            setProcesosOptions((prev) => [...prev, item as Option]);
            toast.success(`Proceso «${item.nombre}» creado`, {
                description: "Queda sin categoría ni recurso maquinaria: completalo en Recursos › Procesos para que el plan lo pueda ubicar.",
                duration: 7000,
            });
            return item;
        } catch {
            toast.error("No se pudo crear el proceso");
            return null;
        }
    };

    /**
     * Borrar un proceso del catálogo desde el desplegable de la OT.
     *
     * Julián, 2/9: «hay cosas mal escritas o chanchuyos». Son las variantes de tipeo
     * que el sistema viejo daba de alta como procesos nuevos.
     *
     * Dos pasos: la primera pasada pregunta y la segunda ejecuta. Si el proceso está
     * en alguna OT el backend contesta 409 con cuáles son y qué se pierde — acá no se
     * pierde una categoría, se pierde trabajo cargado en órdenes reales, así que el
     * cartel lo dice con todas las letras antes de dejar seguir.
     */
    const handleEliminarProceso = async (id: string, nombre: string) => {
        const borrar = async (forzar: boolean) => {
            const res = await fetch(`${API_URL}/procesos/${id}${forzar ? "?forzar=true" : ""}`, {
                method: "DELETE",
                headers: getAuthHeaders(),
            });
            return res;
        };
        try {
            let res = await borrar(false);
            if (res.status === 409) {
                const motivo = parseApiError(await res.text().catch(() => ""));
                const seguir = window.confirm(
                    `${motivo || `«${nombre}» está en uso.`}\n\n¿Lo eliminás igual?`
                );
                if (!seguir) return;
                res = await borrar(true);
            }
            if (!res.ok) {
                toast.error(parseApiError(await res.text().catch(() => "")) || "No se pudo eliminar el proceso");
                return;
            }
            const body = await res.json().catch(() => ({}));
            const afectadas = body?.data?.ordenes_afectadas ?? 0;
            setProcesosOptions((prev) => prev.filter((o: any) => String(o.id) !== String(id)));
            // Y las filas de ESTA orden que lo tenían elegido quedan sin proceso, no
            // apuntando a uno que ya no existe.
            setProcesses((prev) => prev.map((r) => (r.proceso_id === String(id) ? { ...r, proceso_id: "" } : r)));
            toast.success(`Proceso «${nombre}» eliminado`, {
                description: afectadas > 0
                    ? `Se fue de ${afectadas} ${afectadas === 1 ? "orden" : "órdenes"}. Las que estaban planificadas hay que volver a planificarlas.`
                    : "No estaba en ninguna orden.",
                duration: 7000,
            });
        } catch {
            toast.error("No se pudo eliminar el proceso");
        }
    };

    const validateForm = () => {
        // Antes las OT importadas se validaban distinto —solo la fecha prometida—
        // porque el resto estaba bloqueado. Ya no: se validan como cualquier otra.

        if (!generalData.cliente_id || !generalData.descripcion || !generalData.prioridad_id || !generalData.articulo_id) {
            toast.error("Por favor completa los campos obligatorios en la pestaña General");
            setActiveTab("general");
            return false;
        }

        // RF-11: el «Cant.» de Finalizado parcial es un número entero de unidades, o vacío.
        const cantParcial = generalData.cantidad_finalizada_parcial.trim();
        if (cantParcial !== "" && !/^\d+$/.test(cantParcial)) {
            toast.error("La «Cant.» de Finalizado parcial tiene que ser un número entero de unidades (o quedar vacía).");
            setActiveTab("general");
            return false;
        }

        // Una OT puede quedarse sin procesos a propósito.
        //
        // Antes acá se cortaba con "Debes agregar al menos un proceso": el que sacaba
        // todos los pasos no podía guardar, y quedaba encerrado sin forma de salir más
        // que cancelando y perdiendo el resto de los cambios. Las OT que llegan del
        // sistema viejo entran sin ningún proceso, así que "sin procesos" es un estado
        // normal de la orden, no un error de carga.
        //
        // Los pasos se cargan después, desde la lista o desde acá mismo. El aviso de
        // que quedó sin pasos lo da la confirmación, que no bloquea.
        const incluidos = processes.filter(p => p.incluido);

        const sinProceso = incluidos.find(p => !p.proceso_id);
        if (sinProceso) {
            toast.error("Hay un paso sin proceso elegido.");
            setActiveTab("procesos");
            return false;
        }
        // `!p.tiempo` no alcanzaba: "0" es un string verdadero, así que un paso en cero
        // minutos pasaba el control. El planificador después lo agenda como 1 minuto y
        // el plan queda más corto de lo que el taller va a tardar. Ver `tieneMinutos`.
        const sinMinutos = pasosSinMinutos(incluidos);
        if (sinMinutos.length > 0) {
            const nombreDe = (id: string) =>
                procesosOptions.find(o => o.id.toString() === id)?.nombre || "un paso";
            const cuales = sinMinutos.slice(0, 3).map(p => `«${nombreDe(p.proceso_id)}»`).join(", ");
            toast.error(
                sinMinutos.length === 1
                    ? `Falta cargarle los minutos a ${cuales}.`
                    : `Faltan los minutos de ${sinMinutos.length} pasos: ${cuales}` +
                      (sinMinutos.length > 3 ? " y otros." : ".")
            );
            setActiveTab("procesos");
            return false;
        }
        return true;
    };

    /** Correrse una solapa. Se apoya en ORDEN_SOLAPAS para no repetir el orden en cada botón. */
    const moverSolapa = (paso: 1 | -1) => {
        const i = ORDEN_SOLAPAS.indexOf(activeTab as Solapa);
        const destino = i >= 0 ? ORDEN_SOLAPAS[i + paso] : undefined;
        if (destino) setActiveTab(destino);
    };

    const handleNextStep = () => moverSolapa(1);
    const handlePrevStep = () => moverSolapa(-1);

    // OT proveniente del sistema legacy: solo se puede editar fecha_prometida.
    /**
     * Las OT importadas ya no están bloqueadas.
     *
     * Tenían casi todo el formulario deshabilitado por una razón concreta: el sync
     * traía las OT del sistema viejo cada 5 minutos y le devolvía a cada una lo que
     * decía el legacy, así que cualquier corrección hecha acá se perdía sola y sin
     * aviso. Dejar editar habría sido peor que no dejar.
     *
     * Desde el 2/9 ese sync está apagado —SPMM es el dueño de las órdenes y de los
     * procesos, se crean todas acá—, así que no queda nada que las pise y se editan
     * como cualquier otra. Se deja la constante en false en vez de sacar los cuarenta
     * `disabled` de una: el día que aparezca otra fuente que pise datos, se prende acá.
     */
    const isLegacyOT = false;
    /**
     * RF-24: quien no puede editar OT (la solapa Órdenes en escritura) abre la misma
     * ficha para MIRARLA: todo se ve, nada se cambia y no hay «Guardar». Usa los mismos
     * `disabled` que dejó preparados el modo legacy de arriba, que es exactamente eso.
     * El backend igual rechaza el guardado (403); esto es para no dejar escribir algo
     * que después no se va a poder guardar.
     */
    const soloLectura = !puedeSeccion("operaciones_ordenes", "write");
    const camposBloqueados = isLegacyOT || soloLectura;
    /**
     * RF-11: ¿el backend guarda las casillas nuevas de «Estado y control»? El que está en
     * producción hoy (3422285) no las conoce: se las saltearía en silencio y la persona
     * creería que quedaron marcadas. Editando, lo dice la OT que llegó (si no trae
     * `controlado`, no las sabe); en el alta no hay OT para mirar, se deja cargar y se
     * avisa después si la respuesta no las trae (ver `performSubmission`).
     */
    const conoceControl = !orderToEdit || conoceEstadosDeControl(orderToEdit);

    /**
     * De dónde salen los planos que muestran la solapa Planos y el panel de Procesos.
     *
     * Editando una OT alcanza con el endpoint de la orden: ya devuelve los adjuntos propios
     * MÁS los del producto que fabrica, que es todo lo que hay para mirar. La excepción es
     * haber cambiado el producto en la solapa General y no haber guardado todavía: esa
     * lista quedó vieja —sigue trayendo los dibujos del artículo anterior— y mientras dura
     * ese rato se piden los del producto recién elegido, que es el que la persona tiene en
     * la cabeza. Creando una OT nueva no hay orden todavía, así que siempre es por artículo.
     *
     * Los dos hooks se llaman siempre porque son hooks, pero solo uno recibe id: el otro
     * devuelve la lista vacía sin salir a la red.
     */
    const articuloElegido = Number(generalData.articulo_id) || undefined;
    const articuloGuardado = orderToEdit
        ? Number(orderToEdit.articulo?.id ?? orderToEdit.id_articulo) || undefined
        : undefined;
    const planosSonDeLaOrden = !!orderToEdit && articuloElegido === articuloGuardado;

    const { planos: planosDeLaOrden, cargando: cargandoOrden, error: errorOrden } =
        usePlanosDeOrden(planosSonDeLaOrden ? orderToEdit?.id : undefined);
    const { planos: planosDelArticulo, cargando: cargandoArticulo, error: errorArticulo } =
        usePlanosDeArticulo(planosSonDeLaOrden ? undefined : articuloElegido);

    const planosCargando = planosSonDeLaOrden ? cargandoOrden : cargandoArticulo;
    const planosError = planosSonDeLaOrden ? errorOrden : errorArticulo;

    /**
     * Lo que se ve en la galería.
     *
     * Un archivo que sacaron en la solapa 1 desaparece acá en el acto, aunque el borrado
     * real recién salga al guardar: si siguiera a la vista, el que lo sacó vuelve a la
     * solapa Planos, lo encuentra ahí y cree que el botón no hizo nada.
     */
    const planosVisibles = useMemo(() => {
        const lista = planosSonDeLaOrden ? planosDeLaOrden : planosDelArticulo;
        return deletedFileIds.length > 0
            ? lista.filter(p => !deletedFileIds.includes(p.id))
            : lista;
    }, [planosSonDeLaOrden, planosDeLaOrden, planosDelArticulo, deletedFileIds]);

    /** Sin producto elegido no hay nada que pedir, y hay que decirlo con todas las letras. */
    const faltaElegirProducto = !articuloElegido && !planosSonDeLaOrden;

    const planosTitulo = planosSonDeLaOrden ? "Planos de esta OT" : "Planos del producto";
    const planosVacioTexto = planosError
        ?? (faltaElegirProducto
            ? "Elegí el producto en la solapa General y su plano aparece acá."
            : planosSonDeLaOrden
                ? "Ni esta orden ni el producto que fabrica tienen archivos cargados."
                : "Este producto todavía no tiene planos cargados.");

    /**
     * Los adjuntos de la orden se separan de los del producto porque no se tratan igual:
     * el del producto es el mismo archivo para TODAS las órdenes del artículo (borrarlo lo
     * saca de todas), así que en la solapa 1 solo se cuenta; el propio de la orden es el
     * único que se puede sacar desde acá.
     */
    const adjuntosDeLaOrden = existingFiles.filter(f => f.origen !== "articulo");
    const adjuntosDelProducto = existingFiles.filter(f => f.origen === "articulo");

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        // Solo lectura: un Enter en un campo no guarda nada (el botón ni está).
        if (soloLectura) return;

        // Trigger confirmation if validation passes
        if (validateForm()) {
            setShowConfirmSubmit(true);
        }
    };

    /**
     * RF-11: las casillas nuevas de «Estado y control» y el «Cant.» del parcial, para el
     * cuerpo del guardado.
     *
     * En el alta van todas. Editando, sólo las que la persona CAMBIÓ: el backend deja
     * como estaba lo que no viene, así que una OT que llegó de una lista que no trae
     * estos campos (o de un backend que no los conoce) no puede terminar desmarcada por
     * guardarla. Y si el backend no los conoce, no se mandan (`conoceControl`).
     */
    const camposDeControl = (): Record<string, unknown> => {
        const cant = generalData.cantidad_finalizada_parcial.trim();
        const valores: Record<string, unknown> = {
            controlado: generalData.controlado,
            finalizado_para_pintar: generalData.finalizado_para_pintar,
            finalizado_tercerizacion_final: generalData.finalizado_tercerizacion_final,
            finalizado_tercerizacion_intermedia: generalData.finalizado_tercerizacion_intermedia,
            cantidad_finalizada_parcial: cant === "" ? null : parseInt(cant, 10),
        };
        if (!orderToEdit) return valores;
        if (!conoceControl) return {};
        const antes: Record<string, unknown> = {
            ...Object.fromEntries(CASILLAS_NUEVAS.map((c) => [c, marcada(orderToEdit[c])])),
            cantidad_finalizada_parcial: orderToEdit.cantidad_finalizada_parcial ?? null,
        };
        return Object.fromEntries(Object.entries(valores).filter(([k, v]) => antes[k] !== v));
    };

    const performSubmission = async () => {
        setSubmitting(true);

        const selectedArticle = articulos.find(a => a.id.toString() === generalData.articulo_id);
        const articleDescription = selectedArticle ? `${selectedArticle.cod_articulo} - ${selectedArticle.descripcion}` : "";

        // Unir las notas en observaciones
        let observacionesUnidas = detailsData.observaciones || articleDescription;
        if (detailsData.nota_1) observacionesUnidas += `\nNota 1: ${detailsData.nota_1}`;
        if (detailsData.nota_2) observacionesUnidas += `\nNota 2: ${detailsData.nota_2}`;
        if (detailsData.nota_3) observacionesUnidas += `\nNota 3: ${detailsData.nota_3}`;

        const fullData = {
            id_otvieja: generalData.id_otvieja ? parseInt(generalData.id_otvieja) : 0, // 0 triggers backend auto-generation
            observaciones: observacionesUnidas,
            detalle: generalData.descripcion,
            id_cliente: parseInt(generalData.cliente_id),
            cliente: clientes.find(c => c.id.toString() === generalData.cliente_id)?.nombre || "",
            unidades: detailsData.cantidad ? parseInt(detailsData.cantidad) : 0,

            id_prioridad: parseInt(generalData.prioridad_id),
            id_sector: generalData.sector_id ? parseInt(generalData.sector_id) : 1,
            id_articulo: parseInt(generalData.articulo_id),

            fecha_orden: generalData.fecha_orden ? new Date(generalData.fecha_orden).toISOString() : new Date().toISOString(),
            fecha_entrada: generalData.fecha_entrada ? new Date(generalData.fecha_entrada).toISOString() : new Date().toISOString(),
            fecha_prometida: generalData.fecha_prometida ? new Date(generalData.fecha_prometida).toISOString() : new Date().toISOString(),
            fecha_entrega: generalData.fecha_entrega ? new Date(generalData.fecha_entrega).toISOString() : null,

            cantidad_entregada: generalData.cantidad_entregada ? parseInt(generalData.cantidad_entregada) : 0,
            reclamo: generalData.reclamo ? 1 : 0,
            finalizadototal: generalData.finalizadototal ? 1 : 0,
            finalizadoparcial: generalData.finalizadoparcial ? 1 : 0,

            // Nuevos Campos "Pronto"
            n_ped_l: generalData.n_ped_l,
            n_pedido: generalData.n_pedido,
            subsector: generalData.subsector,
            requerido_por: generalData.requerido_por,
            aprobado_por: generalData.aprobado_por,
            remitos_salida: generalData.remitos_salida,
            f_disp_material: generalData.f_disp_material ? new Date(generalData.f_disp_material).toISOString() : null,

            fabricacion: generalData.fabricacion,
            reparacion: generalData.reparacion,
            sin_cargo: generalData.sin_cargo,
            stock: generalData.stock,
            interno: generalData.interno,
            revisada: generalData.revisada,
            tercerizado_total: generalData.tercerizado_total,
            tercerizado_parcial: generalData.tercerizado_parcial,
            suspendida: generalData.suspendida,
            email: generalData.email,
            tiene_plano: generalData.tiene_plano,
            no_lleva_plano: generalData.no_lleva_plano,
            no_lleva_materia_prima: generalData.no_lleva_materia_prima,
            programada: generalData.programada,
            en_proceso: generalData.en_proceso,

            ...camposDeControl(),

            // Sólo se guardan los procesos tildados ("Va") con proceso elegido.
            // maquinaria_id se manda como string ('' -> null) para respetar el DTO.
            procesos: processes
                .filter(p => p.incluido && p.proceso_id)
                .map(p => ({
                    proceso_id: parseInt(p.proceso_id),
                    id_otp: p.id_otp,
                    tiempo_proceso: parseInt(p.tiempo) || 0,
                    cant_operarios: parseInt(p.cant_operarios) || 1,
                    maquinaria_id: p.maquina_id && p.maquina_id !== SIN_MAQUINA ? p.maquina_id : null,
                    no_lleva_maquina: p.maquina_id === SIN_MAQUINA,
                    operario_id: p.operario_id ? p.operario_id : null,
                }))
        };

        try {
            let response;

            if (orderToEdit) {
                // UPDATE (PUT) - Expects JSON
                response = await fetch(`${API_URL}/ordenes/${orderToEdit.id}`, {
                    method: "PUT",
                    headers: {
                        ...getAuthHeaders() as Record<string, string>,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(fullData),
                });
            } else {
                // CREATE (POST) - Expects Multipart/Form-Data
                const formData = new FormData();
                formData.append('data', JSON.stringify(fullData));
                files.forEach(file => {
                    formData.append('files', file);
                });

                response = await fetch(`${API_URL}/ordenes`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: formData,
                });
            }

            if (!response.ok) {
                // El cuerpo del error no siempre es JSON: un 502/504 de Cloud Run devuelve
                // HTML, y ahí `response.json()` tiraba un "Unexpected token" que se comía el
                // error de verdad y dejaba al usuario sin saber qué pasó.
                const crudo = await response.text().catch(() => "");
                let errorData: any = {};
                try { errorData = crudo ? JSON.parse(crudo) : {}; } catch { errorData = {}; }
                console.error("Error response from backend:", response.status, crudo);

                let errorMessage = orderToEdit
                    ? `No se pudieron guardar los cambios de la OT (error ${response.status})`
                    : `No se pudo crear la orden (error ${response.status})`;

                // Parse standardized backend errors (ResponseDTO)
                if (errorData.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
                    errorMessage = errorData.errors.map((e: any) => e.message).join(", ");
                }
                // Parse standard FastAPI details
                else if (typeof errorData.detail === 'string') {
                    errorMessage = errorData.detail;
                } else if (errorData.detail && Array.isArray(errorData.detail)) {
                    // Pydantic validation errors
                    errorMessage = errorData.detail.map((e: any) => e.msg).join(", ");
                } else if (errorData.message) {
                    errorMessage = errorData.message;
                }

                throw new Error(errorMessage);
            }

            // Handle file updates for EDIT mode
            if (orderToEdit) {
                // 1. Delete removed files (nunca los del producto: ver planosDelProducto)
                const aBorrar = deletedFileIds.filter(id => !planosDelProducto.current.has(id));
                if (aBorrar.length > 0) {
                    await Promise.all(aBorrar.map(id =>
                        fetch(`${API_URL}/planos/${id}`, { method: 'DELETE', headers: getAuthHeaders() })
                    ));
                }

                // 2. Upload new files
                if (files.length > 0) {
                    for (const file of files) {
                        const fileData = new FormData();
                        fileData.append('nombre', file.name);
                        fileData.append('tipo_archivo', file.type);
                        fileData.append('id_orden_trabajo', orderToEdit.id.toString());
                        fileData.append('archivo', file);

                        await fetch(`${API_URL}/planos`, {
                            method: "POST",
                            headers: getAuthHeaders(),
                            body: fileData
                        });
                    }
                }
            }

            toast.success(orderToEdit ? "Orden de Trabajo actualizada correctamente" : "Orden de Trabajo creada correctamente");

            // RF-11: un alta con Controlado (o las otras casillas nuevas) contra un backend
            // que todavía no las guarda. La OT se creó bien; lo único que no quedó es eso,
            // y hay que decirlo en vez de dejar que la persona crea que sí.
            if (!orderToEdit) {
                const cargoControl = CASILLAS_NUEVAS.some(c => generalData[c])
                    || generalData.cantidad_finalizada_parcial.trim() !== "";
                const guardada = await response.json().then(j => j?.data ?? j).catch(() => null);
                if (cargoControl && guardada && typeof guardada === "object" && !conoceEstadosDeControl(guardada)) {
                    toast.warning("La OT se creó, pero el servidor todavía no guarda Controlado, las etapas de pintura y tercerización ni la «Cant.» del parcial. Se van a poder cargar cuando se actualice.");
                }
            }
            onSuccess?.();
            onClose();
            resetForm();
        } catch (error) {
            console.error("Error creating/updating order:", error);
            toast.error(error instanceof Error
                ? error.message
                : (orderToEdit ? "Error desconocido al guardar la OT" : "Error desconocido al crear la orden"));
        } finally {
            setSubmitting(false);
        }
    };

    const resetForm = () => {
        setGeneralData(generalVacio());
        setDetailsData(detallesVacios());
        setProcesses([]);
        setMateriasPrimas([]);
        setFiles([]);
        setExistingFiles([]);
        setDeletedFileIds([]);
        setActiveTab("general");
    };

    const handleAttemptClose = () => {
        // ¿CAMBIÓ ALGO? — no «¿tiene datos?», que es lo que preguntaba antes.
        //
        // Editando una OT siempre hay cliente y procesos, así que con la pregunta vieja
        // el cartel de «Descartar los cambios» salía SIEMPRE, aunque uno hubiera abierto
        // la orden sólo para mirarla. Ahora se compara contra la foto del momento en que
        // terminó de cargar.
        //
        // Si la foto todavía no se sacó (el modal se está cargando, o falló algo), se
        // pregunta: ante la duda, mejor un cartel de más que perder lo que alguien
        // escribió.
        const huellaActual = huellaDelFormulario({
            generalData, detailsData, processes, files, deletedFileIds,
        });
        const sinCambios = fotoInicial.current !== null && huellaActual === fotoInicial.current;

        if (sinCambios) {
            handleClose();
        } else {
            setShowConfirmCancel(true);
        }
    };

    const handleClose = () => {
        resetForm();
        onClose();
        setActiveTab("general");
    };

    // "Traer historial": trae los procesos de la última OT del mismo producto
    // (artículo = código + descripción) y los carga en el listado, todos tildados.
    const handleTraerHistorial = async () => {
        if (!generalData.articulo_id) {
            toast.error("Elegí primero el producto (artículo) en la pestaña General");
            setActiveTab("general");
            return;
        }
        setHistorialLoading(true);
        try {
            const params = new URLSearchParams({ id_articulo: generalData.articulo_id });
            if (orderToEdit?.id) params.set("excluir_orden_id", orderToEdit.id.toString());
            const res = await fetch(`${API_URL}/ordenes/historial-procesos?${params.toString()}`, { headers: getAuthHeaders() });
            if (!res.ok) throw new Error("request failed");
            const body = await res.json();
            const items = Array.isArray(body?.data) ? body.data : [];
            if (items.length === 0) {
                toast.info("No hay historial de procesos para este producto");
                return;
            }
            const nuevos: ProcesoRow[] = items.map((it: any) => ({
                id: Math.random().toString(36).slice(2),
                proceso_id: it.id_proceso != null ? it.id_proceso.toString() : "",
                tiempo: it.tiempo_proceso != null ? it.tiempo_proceso.toString() : "",
                cant_operarios: it.cant_operarios != null ? it.cant_operarios.toString() : "1",
                maquina_id: it.id_maquinaria ? it.id_maquinaria.toString() : "",
                operario_id: it.id_operario ? it.id_operario.toString() : "",
                incluido: true,
            }));
            // Si ya hay procesos cargados, no se pisan sin preguntar: se muestra qué
            // se pierde y decide la persona.
            const yaCargados = processes.filter((p) => p.proceso_id).length;
            if (yaCargados > 0) {
                setHistorialPendiente(nuevos);
                return;
            }
            setProcesses(nuevos);
            toast.success(`Se trajeron ${nuevos.length} procesos del historial. Destildá los que esta vez no van.`);
        } catch (e) {
            console.error(e);
            toast.error("No se pudo traer el historial");
        } finally {
            setHistorialLoading(false);
        }
    };

    /**
     * Lo que sale al exportar la OT (RF-22): lo que está en el formulario AHORA, igual
     * que «Imprimir» —sirve para una OT guardada y para un borrador—. De cada paso va la
     * preselección y, si no tiene, lo que asignó el planificador.
     */
    const datosParaExportar = (): DatosDeOT => {
        const art = articulos.find(a => a.id.toString() === generalData.articulo_id);
        const procName = (id: string) => procesosOptions.find(p => p.id.toString() === id)?.nombre || "";
        const maqName = (id: string) =>
            id === SIN_MAQUINA ? "No lleva máquina (a mano)" : maquinarias.find(m => m.id.toString() === id)?.nombre || "";
        const opName = (id: string) => {
            const o = operarios.find(op => op.id.toString() === id);
            return o ? capitalizeName(`${o.nombre} ${o.apellido ?? ""}`) : "";
        };
        const pasada = (idOtp?: number): any => (orderToEdit?.procesos ?? []).find((p: any) => p.id === idOtp);
        return {
            numero: String(orderToEdit?.id_otvieja || orderToEdit?.id || "Nueva"),
            cliente: clientes.find(c => c.id.toString() === generalData.cliente_id)?.nombre || generalData.cliente || "",
            codigo: art?.cod_articulo ?? "",
            articulo: art?.descripcion ?? "",
            prioridad: prioridades.find(p => p.id.toString() === generalData.prioridad_id)?.nombre ?? "",
            sector: sectores.find(x => x.id.toString() === generalData.sector_id)?.nombre ?? "",
            cantidad: detailsData.cantidad,
            nPedido: generalData.n_pedido,
            fechaEntrada: generalData.fecha_entrada,
            fechaPrometida: generalData.fecha_prometida,
            fechaEntrega: generalData.fecha_entrega,
            pedidoPor: generalData.requerido_por,
            aprobadoPor: generalData.aprobado_por,
            notaDeTaller: detailsData.observaciones,
            descripcion: generalData.descripcion,
            // RF-11: lo marcado en «Estado y control» (lo del formulario, como el resto).
            // Quién la controló sale de la OT guardada, y sólo si sigue marcada.
            estadoYControl: resumenEstadoYControl(generalData),
            controladoPor: generalData.controlado && marcada(orderToEdit?.controlado)
                ? orderToEdit?.controlado_por ?? "" : "",
            controladoEl: generalData.controlado && marcada(orderToEdit?.controlado)
                ? orderToEdit?.controlado_en ?? "" : "",
            procesos: processes.filter(p => p.incluido && p.proceso_id).map((p, i) => {
                const plan = p.id_otp ? planificado[p.id_otp] : undefined;
                return {
                    paso: i + 1,
                    proceso: procName(p.proceso_id),
                    maquina: (p.maquina_id ? maqName(p.maquina_id) : "") || plan?.maquinaria || "",
                    recursoHumano: (p.operario_id ? opName(p.operario_id) : "") || plan?.operario
                        || capitalizeName(pasada(p.id_otp)?.operario_nombre) || "",
                    minutos: aNumero(p.tiempo),
                    enSimultaneo: aNumero(p.cant_operarios),
                    estado: pasada(p.id_otp)?.estado_proceso?.descripcion ?? "",
                };
            }),
            materias: materiasPrimas.map(mp => ({
                codigo: mp.codigo,
                descripcion: mp.descripcion,
                proveedor: mp.proveedor || "",
                cantidad: mp.cantidad,
                unidad: mp.unidad,
                disponible: mp.disponible,
            })),
        };
    };

    // "Imprimir OT": arma una vista imprimible (ventana nueva) con los datos de la
    // orden + procesos + materias primas, y dispara el diálogo de impresión del navegador.
    // Usa el estado actual del formulario, así sirve tanto para una OT existente como para un borrador.
    const handlePrint = () => {
        const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString("es-AR") : "-");
        const cliente = clientes.find(c => c.id.toString() === generalData.cliente_id)?.nombre || generalData.cliente || "-";
        const art = articulos.find(a => a.id.toString() === generalData.articulo_id);
        const articuloLabel = art ? `${art.cod_articulo} — ${art.descripcion}` : "-";
        const prioridad = prioridades.find(p => p.id.toString() === generalData.prioridad_id)?.nombre || "-";
        const sector = sectores.find(s => s.id.toString() === generalData.sector_id)?.nombre || "-";
        const procName = (id: string) => procesosOptions.find(p => p.id.toString() === id)?.nombre || "-";
        const maqName = (id: string) => maquinarias.find(m => m.id.toString() === id)?.nombre || "Sin recurso maquinaria";

        const procs = processes.filter(p => p.incluido && p.proceso_id);
        // RF-11: las casillas marcadas de «Estado y control», igual que en el PDF.
        const exportado = datosParaExportar();
        const quienControlo = [exportado.controladoPor ? `controlada por ${exportado.controladoPor}` : "",
                               cuandoLegible(exportado.controladoEl)].filter(Boolean).join(" · ");
        const estadoImpreso = exportado.estadoYControl
            ? exportado.estadoYControl + (quienControlo ? ` (${quienControlo})` : "") : "";
        // Hoja de procesos (operario): datos planificados + columnas en blanco para
        // la carga real a mano (empleado, horarios, total, obs).
        // Cada proceso lleva TRES renglones de carga, no uno.
        //
        // Lucas, 2/9: «que tengan varios casilleros renglones porque si eran 2 días y al
        // final fueron 3 que pueda escribir». Un trabajo de 400 minutos no se hace en un
        // día, y con un solo renglón el operario terminaba escribiendo dos fechas
        // apretadas en la misma celda o anotando en el margen. El primer renglón lleva
        // el proceso y lo planificado; los otros dos son la continuación, con la fecha
        // adelante para que se lea como un parte de trabajo.
        // La columna DÍA es lo que reemplaza a duplicar el proceso.
        //
        // Lucas, 2/9: cuando un trabajo lleva dos días, el taller cargaba el proceso dos
        // veces en la OT para tener dos renglones donde anotar — y eso le rompía el orden
        // de los pasos y confundía al planificador, que veía dos trabajos donde hay uno.
        // Su propia solución, textual: «poner a lo sumo día uno o día dos, que lo divida».
        // Los renglones vienen numerados: el operario sólo escribe la fecha y las horas.
        const RENGLONES_POR_PROCESO = 3;
        const renglon = (dia: number, p?: any, i?: number) => {
            const esPrimero = dia === 1;
            const izq = esPrimero
                ? `<td class="c">${(i ?? 0) + 1}</td>` +
                  `<td>${esc(procName(p.proceso_id))}</td>` +
                  `<td>${p.maquina_id ? esc(maqName(p.maquina_id)) : '<span style="color:#999">Sin recurso maquinaria</span>'}</td>` +
                  `<td class="c">${esc(p.tiempo || 0)}</td>`
                : `<td class="c"></td><td class="fill"></td><td class="fill"></td><td class="fill"></td>`;
            return `<tr class="${esPrimero ? "proc" : "cont"}">${izq}` +
                `<td class="c dia">${dia}</td><td class="fill"></td>` +
                `<td class="fill"></td><td class="fill"></td><td class="fill"></td><td class="fill"></td></tr>`;
        };
        const procRows = procs.length
            ? procs.map((p, i) =>
                Array.from({ length: RENGLONES_POR_PROCESO }, (_, k) => renglon(k + 1, p, i)).join("")
              ).join("")
            : `<tr><td colspan="10" class="c" style="color:#999">Sin procesos cargados</td></tr>`;

        // Hoja de materias primas (pañol): datos + columna "Retirado" para tildar a mano.
        const mpRows = materiasPrimas.length
            ? materiasPrimas.map(mp => `<tr><td>${esc(mp.codigo)}</td><td>${esc(mp.descripcion)}</td><td>${esc(mp.proveedor || "")}</td><td class="c">${esc(mp.cantidad)}</td><td class="c">${esc(mp.unidad)}</td><td class="fill c"></td><td class="fill"></td></tr>`).join("")
            : `<tr><td colspan="7" class="c" style="color:#999">Sin materias primas</td></tr>`;

        const otNum = orderToEdit?.id_otvieja || orderToEdit?.id || "Nueva";
        const hoy = new Date().toLocaleDateString("es-AR");
        const logoUrl = `${window.location.origin}/longchamps_logo.png`;
        const encabezado = (titulo: string, subtitulo: string) => `
<div class="head">
  <img class="logo" src="${logoUrl}" alt="Metalúrgica Longchamps"
       onerror="this.outerHTML='<div class=\\'marca\\'>ML</div>'">
  <div class="head-c"><div class="empresa">Metalúrgica Longchamps</div><div class="doc">${esc(titulo)}</div></div>
  <div class="head-r"><div class="otn">OT N° ${esc(otNum)}</div><div class="fecha">${esc(subtitulo)}</div></div>
</div>`;
        const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>OT ${esc(otNum)}</title>
<style>
/* Hoja de taller: se imprime, se llena con birome y se ensucia. Por eso líneas
   marcadas, casilleros altos y nada de gris claro, que en una fotocopia desaparece. */
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;font-size:12px}
.page{padding:12mm 11mm}.page.break{page-break-after:always}

.head{display:flex;align-items:center;gap:16px;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:14px}
.logo{height:58px;width:auto}
.marca{display:flex;align-items:center;justify-content:center;height:58px;width:58px;border:3px solid #1e3a5f;
  border-radius:6px;font-size:22px;font-weight:bold;color:#1e3a5f;letter-spacing:-1px}
.head-c{flex:1}
.empresa{font-size:13px;color:#1e3a5f;font-weight:bold;letter-spacing:1px;text-transform:uppercase}
.doc{font-size:21px;font-weight:bold;color:#111;line-height:1.15}
.head-r{text-align:right}
.otn{font-size:22px;font-weight:bold;letter-spacing:-.5px}
.fecha{font-size:10px;color:#666;margin-top:2px}

.grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px;margin-bottom:12px}
.cell{border-bottom:1px solid #d9d9d9;padding:5px 0;display:flex;justify-content:space-between;gap:12px}
.cell .k{color:#666;text-transform:uppercase;font-size:9.5px;letter-spacing:.6px;white-space:nowrap}
.cell .v{font-weight:bold;text-align:right}

h2{font-size:12px;margin:16px 0 6px;border-bottom:2px solid #1e3a5f;padding-bottom:3px;
  text-transform:uppercase;letter-spacing:.8px;color:#1e3a5f}
table{width:100%;border-collapse:collapse;font-size:11px}
th,td{border:1px solid #999;padding:5px 7px;text-align:left;vertical-align:top}
th{background:#1e3a5f;color:#fff;text-transform:uppercase;font-size:8.5px;letter-spacing:.4px;padding:6px 7px}
td.c,th.c{text-align:center}
td.fill{height:26px;background:#fff}
td.dia{background:#f4f6f9;font-weight:bold;color:#1e3a5f;width:26px}

/* El primer renglón de cada proceso lleva el nombre; los de abajo son la continuación
   para los días siguientes. La línea gruesa arriba separa un proceso del otro. */
tr.proc td{border-top:2px solid #1e3a5f;font-weight:bold}
tr.cont td{border-top:1px solid #ddd}
tr.cont td:first-child{border-top:1px solid #ddd}

.ayuda{font-size:9px;color:#666;margin:4px 0 0;font-style:italic}
.notas{white-space:pre-wrap;border:1px solid #999;padding:8px;color:#111;margin-top:4px;min-height:52px}
.firmas{display:flex;gap:28px;margin-top:16px}
.firma{flex:1;border-top:1px solid #111;padding-top:4px;font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px}
.pie{margin-top:12px;font-size:9px;color:#888;text-align:center;border-top:1px solid #ddd;padding-top:6px}
@media print{.page{padding:8mm 9mm}th{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>

<div class="page break">
${encabezado("Orden de Trabajo — Procesos", `Impreso ${esc(hoy)}`)}
<div class="grid">
<div class="cell"><span class="k">Cliente</span><span class="v">${esc(cliente)}</span></div>
<div class="cell"><span class="k">Prioridad</span><span class="v">${esc(prioridad)}</span></div>
<div class="cell"><span class="k">Producto</span><span class="v">${esc(articuloLabel)}</span></div>
<div class="cell"><span class="k">Sector</span><span class="v">${esc(sector)}</span></div>
<div class="cell"><span class="k">Cantidad</span><span class="v">${esc(detailsData.cantidad || "-")}</span></div>
<div class="cell"><span class="k">N° Pedido</span><span class="v">${esc(generalData.n_pedido || "-")}</span></div>
<div class="cell"><span class="k">F. Entrada</span><span class="v">${fmt(generalData.fecha_entrada)}</span></div>
<div class="cell"><span class="k">F. Prometida</span><span class="v">${fmt(generalData.fecha_prometida)}</span></div>
</div>
<h2>Procesos (planificado + carga real)</h2>
<table class="procesos"><thead><tr><th class="c">#</th><th>Proceso</th><th>Recurso maquinaria</th><th class="c">Min. plan.</th><th class="c">Día</th><th class="c">Fecha</th><th>Recurso humano</th><th class="c">H. inicio</th><th class="c">H. fin</th><th class="c">Total</th></tr></thead><tbody>${procRows}</tbody></table>
<p class="ayuda">Cada proceso trae tres renglones, uno por día: no hace falta cargarlo dos veces en el sistema. Si lleva más de tres días, seguí en la Nota de taller.</p>
<h2>Nota de taller</h2>
<div class="notas">${esc(detailsData.observaciones || "")}</div>
${generalData.descripcion ? `<h2>Descripción</h2><div class="notas">${esc(generalData.descripcion)}</div>` : ""}
${estadoImpreso ? `<h2>Estado y control</h2><div class="notas">${esc(estadoImpreso)}</div>` : ""}
<div class="firmas">
  <div class="firma">Firma del recurso humano</div>
  <div class="firma">Control / Calidad</div>
  <div class="firma">Fecha de cierre</div>
</div>
<div class="pie">Hoja de PROCESOS — para el recurso humano · Metalúrgica Longchamps</div>
</div>

<div class="page">
${encabezado("Materias Primas", "Retirar en pañol")}
<div class="grid">
<div class="cell"><span class="k">Cliente</span><span class="v">${esc(cliente)}</span></div>
<div class="cell"><span class="k">Producto</span><span class="v">${esc(articuloLabel)}</span></div>
<div class="cell"><span class="k">Cantidad</span><span class="v">${esc(detailsData.cantidad || "-")}</span></div>
<div class="cell"><span class="k">N° Pedido</span><span class="v">${esc(generalData.n_pedido || "-")}</span></div>
</div>
<h2>Materias Primas</h2>
<table><thead><tr><th>Código</th><th>Descripción</th><th>Proveedor</th><th class="c">Cant.</th><th class="c">Un.</th><th class="c">Retirado</th><th>Obs.</th></tr></thead><tbody>${mpRows}</tbody></table>
<h2>Observaciones pañol</h2>
<div class="notas"></div>
<div class="pie">Hoja de MATERIAS PRIMAS — para el pañol</div>
</div>

</body></html>`;

        const w = window.open("", "_blank", "width=900,height=700");
        if (!w) {
            toast.error("Habilitá las ventanas emergentes para poder imprimir la OT.");
            return;
        }
        w.document.write(html);
        w.document.close();
        w.focus();
        // Pequeño delay para que el navegador termine de renderizar antes del diálogo de impresión.
        setTimeout(() => w.print(), 250);
    };

    return (
        <>
            <ConfirmationDialog
                isOpen={showConfirmSubmit}
                onClose={() => setShowConfirmSubmit(false)}
                onConfirm={performSubmission}
                title={orderToEdit ? "Guardar cambios de la OT" : "Crear Orden de Trabajo"}
                description={
                    // Quedarse sin pasos es válido, pero conviene decirlo: una OT sin
                    // procesos no entra en la planificación hasta que se le carguen.
                    processes.filter(p => p.incluido && p.proceso_id).length === 0
                        ? "Esta Orden de Trabajo va a quedar SIN PROCESOS. Se guarda igual, pero no se va a poder planificar hasta que le cargues los pasos. ¿Seguimos?"
                        : orderToEdit
                            ? "¿Guardamos los cambios en esta Orden de Trabajo? Verificá que todos los datos sean correctos."
                            : "¿Estás seguro de que quieres crear esta Orden de Trabajo? Verificá que todos los datos sean correctos."}
                confirmText={orderToEdit ? "Sí, guardar cambios" : "Sí, crear orden"}
            />

            <ConfirmationDialog
                isOpen={showConfirmCancel}
                onClose={() => setShowConfirmCancel(false)}
                onConfirm={handleClose}
                title={orderToEdit ? "Descartar los cambios" : "Cancelar Creación"}
                description={orderToEdit
                    ? "Si cancelas ahora, perderás los cambios que hiciste en esta OT. ¿Estás seguro?"
                    : "Si cancelas ahora, perderás todos los datos ingresados. ¿Estás seguro?"}
                confirmText="Sí, cancelar"
                cancelText="Volver"
                variant="destructive"
            />

            <Dialog open={isOpen} onOpenChange={(open) => !open && handleAttemptClose()}>

                {/* Ancho y alto de verdad.
                    Estaba topado en 1200px y 85vh: en un monitor de taller quedaban
                    cientos de píxeles muertos a los costados mientras la lista de
                    procesos scrolleaba a las cuatro filas. Ahora usa hasta 1600px —o el
                    95% de la pantalla, lo que sea menor— y 92vh de alto, así entra el
                    doble de pasos sin tocar la rueda del mouse. El tope sigue existiendo
                    a propósito: una tabla de 2000px de ancho se vuelve incómoda de leer. */}
                <DialogContent className="max-w-[min(1600px,95vw)] bg-white rounded-xl shadow-2xl border-0 h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
                    {/* La cabecera se lleva alto que le falta a la lista de abajo. El ícono
                        baja de 24 a 20px, el título de 2xl a xl, y la bajada —"Modifica la
                        información de la OT existente"— se va: no dice nada que el título no
                        diga ya. Son unos 40px que pasan a ser dos filas más de proceso. */}
                    {/* RF-27: en el teléfono, márgenes de 12px y la cabecera que baja de
                        renglón (número, tipo de trabajo y «modificada el…» no entran en una
                        fila de 343px y se salían por la derecha). `pr-10` para no pisar la X
                        de cerrar del diálogo, que es absoluta arriba a la derecha. */}
                    <DialogHeader className="px-3 sm:px-6 pr-10 sm:pr-10 py-3 border-b bg-white flex-shrink-0">
                        <DialogTitle className="text-lg sm:text-xl font-bold text-gray-900 flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                            <div className="p-2 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-md shadow-blue-500/20">
                                <CalendarIcon className="h-5 w-5 text-white" />
                            </div>
                            <span>{orderToEdit
                                ? `${soloLectura ? "Orden de Trabajo" : "Editar Orden de Trabajo"} #${orderToEdit.id_otvieja || orderToEdit.id}`
                                : "Nueva Orden de Trabajo"}</span>
                            {soloLectura && <MarcaSoloLectura que="la orden" />}
                            {/* Qué clase de trabajo es, arriba de todo.
                                Camilo, 14/09: "cuando abrís la OT no dice si es fabricación
                                o reparación o sin cargo. Eso me ayuda de mucho al momento de
                                poner los procesos". Es lo primero que se mira, así que va al
                                lado del número y no enterrado entre las tildes de abajo.
                                Si no está cargado no se pone nada: "no sé" también es una
                                respuesta y un cartel gris de más sólo hace ruido. */}
                            {(() => {
                                const tipo = generalData.fabricacion ? { t: "Fabricación", c: "bg-sky-50 text-sky-700 ring-sky-200" }
                                    : generalData.reparacion ? { t: "Reparación", c: "bg-violet-50 text-violet-700 ring-violet-200" }
                                    : generalData.sin_cargo ? { t: "Sin Cargo", c: "bg-amber-50 text-amber-700 ring-amber-200" }
                                    : null;
                                return tipo ? (
                                    <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ring-1", tipo.c)}>
                                        {tipo.t}
                                    </span>
                                ) : null;
                            })()}
                            {/* Quién la tocó por última vez y cuándo.
                                Va en la cabecera y no en una solapa porque la pregunta se
                                hace ANTES de mirar nada: "¿esto lo cambió alguien?". Si no
                                dice nada es que nunca se editó desde acá —es el caso de
                                todas las que trajo el sistema viejo— y eso también es una
                                respuesta, así que no se pone ningún cartel. */}
                            {orderToEdit?.modificado_en && (
                                <span className="sm:ml-auto flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-[11px] font-medium text-gray-500">
                                    <History className="h-3 w-3 shrink-0" />
                                    Modificada el {formatearMomento(orderToEdit.modificado_en)}
                                    {orderToEdit.modificado_por ? ` por ${capitalizeName(orderToEdit.modificado_por)}` : ""}
                                </span>
                            )}
                        </DialogTitle>
                    </DialogHeader>

                    {/* RF-03: pausar y reanudar la OT o un paso. Arriba de todo y fuera del
                        formulario (sus botones no guardan la OT): una OT pausada es lo
                        primero que hay que ver al abrirla, y el «Reanudar» tiene que estar
                        donde lo manda el aviso del planificador. Con un backend de antes no
                        dibuja nada. */}
                    {orderToEdit?.id ? (
                        <PausasDeLaOT
                            idOrden={orderToEdit.id}
                            numeroOT={orderToEdit.id_otvieja || orderToEdit.id}
                            pasos={orderToEdit.procesos || []}
                            entregada={isOrderDelivered(orderToEdit)}
                        />
                    ) : null}

                    {/* RF-12: el control de calidad de la OT (sus no conformidades, cargar
                        un rechazo y cerrarlo). Fuera del formulario por lo mismo que las
                        pausas: sus botones no guardan la OT. Con un backend de antes no
                        dibuja nada. RF-11 engancha acá su casilla «Controlado» llamando a
                        ofrecerRegistrarRechazos(id) de lib/calidad.ts. */}
                    {orderToEdit?.id ? (
                        <ControlDeCalidadOT
                            idOrden={orderToEdit.id}
                            numeroOT={orderToEdit.id_otvieja || orderToEdit.id}
                        />
                    ) : null}

                    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
                        <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-3 relative">
                            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                                {/* Los rótulos se acortan abajo de lg y no se dejan enteros.
                                    El TabsTrigger es `whitespace-nowrap` y la columna del grid mide
                                    1fr: en un notebook angosto, "1. Información General" no entra en
                                    su celda y se le monta encima a la de al lado. Pasando de tres
                                    solapas a cuatro cada celda perdió un cuarto de ancho, así que lo
                                    que antes zafaba raspando ahora se pisa. Abajo de lg queda
                                    "1. General · 2. Materias · 3. Procesos · 4. Planos". */}
                                {/* En el teléfono (RF-27) las solapas van sin ícono, sin el número
                                    de paso y con 4px de costado en vez de 12: cada celda mide ~60-75px
                                    y «1. General» con su ícono pedía 100; salía «1. Gen…». La que
                                    está elegida ya se ve resaltada, y Anterior/Siguiente siguen el
                                    mismo orden. La de Historial es al revés: ahí queda sólo el reloj
                                    (sin él no diría qué es), con el nombre para el lector de pantalla. */}
                                <TabsList className={`grid w-full ${orderToEdit ? "grid-cols-5" : "grid-cols-4"} mb-4 bg-gray-100/50 p-1 rounded-xl sticky top-0 z-10 backdrop-blur-sm`}>
                                    <TabsTrigger value="general" className="min-w-0 px-1 sm:px-3 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 transition-all text-xs md:text-sm">
                                        <FileText size={16} className="mr-1 md:mr-2 shrink-0 hidden sm:block" />
                                        <span className="truncate"><span className="hidden sm:inline">1. </span><span className="hidden lg:inline">Información </span>General</span>
                                    </TabsTrigger>
                                    <TabsTrigger value="materias" className="min-w-0 px-1 sm:px-3 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 transition-all text-xs md:text-sm">
                                        <Layers size={16} className="mr-1 md:mr-2 shrink-0 hidden sm:block" />
                                        <span className="truncate"><span className="hidden sm:inline">2. </span>Materias<span className="hidden lg:inline"> Primas</span></span>
                                    </TabsTrigger>
                                    <TabsTrigger value="procesos" className="min-w-0 px-1 sm:px-3 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 transition-all text-xs md:text-sm">
                                        <Settings size={16} className="mr-1 md:mr-2 shrink-0 hidden sm:block" />
                                        <span className="truncate"><span className="hidden sm:inline">3. </span>Procesos<span className="hidden lg:inline"> (Opcional)</span></span>
                                    </TabsTrigger>
                                    {/* Los planos son parte de planificar, no un anexo: el que arma los pasos
                                        los está mirando. La cuenta va en la solapa para no tener que entrar a
                                        ver si hay algo —y para que "0" se lea de una, que es el caso de los
                                        122 productos que solo tienen fotos. */}
                                    <TabsTrigger value="planos" className="min-w-0 px-1 sm:px-3 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 transition-all text-xs md:text-sm">
                                        <Paperclip size={16} className="mr-1 md:mr-2 shrink-0 hidden sm:block" />
                                        <span className="truncate"><span className="hidden sm:inline">4. </span>Planos</span>
                                        {!planosCargando && planosVisibles.length > 0 && (
                                            <span className="ml-1.5 shrink-0 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 text-[10px] font-bold tabular-nums">
                                                {resumirArchivos(planosVisibles)}
                                            </span>
                                        )}
                                    </TabsTrigger>
                                    {/* Sólo en una orden que ya existe: en un alta no hay historial
                                        que mirar, y así las otras cuatro no pierden ancho al cargar. */}
                                    {orderToEdit && (
                                        <TabsTrigger value="historial" aria-label="Historial" title="Historial" className="min-w-0 px-1 sm:px-3 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-blue-600 transition-all text-xs md:text-sm">
                                            <History size={16} className="sm:mr-1 md:mr-2 shrink-0" />
                                            {/* Abajo de lg queda "5." y el reloj: la quinta solapa
                                                le saca un quinto de ancho a cada celda, y los
                                                rótulos de las otras cuatro ya venían raspando. */}
                                            <span className="truncate"><span className="hidden sm:inline">5.</span><span className="hidden lg:inline"> Historial</span></span>
                                        </TabsTrigger>
                                    )}
                                </TabsList>

                                {/* Tab: General */}
                                <TabsContent value="general" className="space-y-4 mt-0 animate-in fade-in-50 slide-in-from-left-2 duration-300">
                                    <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-6 gap-x-4 gap-y-2">
                                        {/* Section: Identification */}
                                        <div className="md:col-span-4 xl:col-span-6 flex items-center gap-2 mb-1">
                                            <div className="h-px flex-1 bg-gray-100"></div>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2">Identificación</span>
                                            <div className="h-px flex-1 bg-gray-100"></div>
                                        </div>
                                        
                                        <div className="space-y-1.5">
                                            <Label htmlFor="id_otvieja" className="text-[11px] font-bold text-blue-600 uppercase">Nº OT Vieja</Label>
                                            <Input id="id_otvieja" disabled={camposBloqueados} value={generalData.id_otvieja} onChange={(e) => setGeneralData({ ...generalData, id_otvieja: e.target.value })} className="h-8 text-sm border-blue-200 focus:ring-blue-500 font-mono font-bold" placeholder="No especificado" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="n_pedido" className="text-[11px] font-bold text-gray-500 uppercase">N° Pedido</Label>
                                            <Input id="n_pedido" disabled={camposBloqueados} value={generalData.n_pedido} onChange={(e) => setGeneralData({ ...generalData, n_pedido: e.target.value })} className="h-8 text-sm" placeholder="No especificado" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="n_ped_l" className="text-[11px] font-bold text-gray-500 uppercase">N° Ped L</Label>
                                            <Input id="n_ped_l" disabled={camposBloqueados} value={generalData.n_ped_l} onChange={(e) => setGeneralData({ ...generalData, n_ped_l: e.target.value })} className="h-8 text-sm" placeholder="No especificado" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="prioridad" className="text-[11px] font-bold text-gray-400 uppercase">Prioridad <span className="text-red-500">*</span></Label>
                                            <SearchableSelect disabled={camposBloqueados} options={prioridades.map(p => ({ value: p.id.toString(), label: p.nombre }))} value={generalData.prioridad_id} onValueChange={(val) => setGeneralData({ ...generalData, prioridad_id: val })} placeholder="No especificado" triggerClassName="h-8" />
                                        </div>

                                        <div className="md:col-span-2 space-y-1.5">
                                            <Label htmlFor="cliente" className="text-[11px] font-bold text-gray-400 uppercase">Cliente <span className="text-red-500">*</span></Label>
                                            <SearchableSelect disabled={camposBloqueados} options={clientes.map(c => ({ value: c.id.toString(), label: c.nombre }))} value={generalData.cliente_id} onValueChange={(val) => setGeneralData({ ...generalData, cliente_id: val })} placeholder="No especificado" triggerClassName="h-8" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="sector" className="text-[11px] font-bold text-gray-400 uppercase">Sector <span className="text-red-500">*</span></Label>
                                            <SearchableSelect disabled={camposBloqueados} options={sectores.map(s => ({ value: s.id.toString(), label: s.nombre }))} value={generalData.sector_id} onValueChange={(val) => setGeneralData({ ...generalData, sector_id: val })} placeholder="No especificado" triggerClassName="h-8" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="subsector" className="text-[11px] font-bold text-gray-400 uppercase">SubSector</Label>
                                            <Input id="subsector" disabled={camposBloqueados} value={generalData.subsector} onChange={(e) => setGeneralData({ ...generalData, subsector: e.target.value })} className="h-8 text-sm" placeholder="No especificado" />
                                        </div>

                                        {/* Section: Logistics & Quantities */}
                                        <div className="md:col-span-4 xl:col-span-6 flex items-center gap-2 mb-1 mt-1">
                                            <div className="h-px flex-1 bg-gray-100"></div>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2">Logística y Cantidades</span>
                                            <div className="h-px flex-1 bg-gray-100"></div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label htmlFor="cantidad" className="text-[11px] font-bold text-gray-400 uppercase">Cant Fabricar</Label>
                                            <Input id="cantidad" disabled={camposBloqueados} type="number" value={detailsData.cantidad} onChange={(e) => setDetailsData({ ...detailsData, cantidad: e.target.value })} className="h-8 text-sm font-bold text-blue-700" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="cantidad_entregada" className="text-[11px] font-bold text-gray-400 uppercase">Cant Entregada</Label>
                                            <Input id="cantidad_entregada" disabled={camposBloqueados} type="number" value={generalData.cantidad_entregada} onChange={(e) => setGeneralData({ ...generalData, cantidad_entregada: e.target.value })} className="h-8 text-sm" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="requerido_por" className="text-[11px] font-bold text-gray-400 uppercase">Requerido por</Label>
                                            <Input id="requerido_por" disabled={camposBloqueados} value={generalData.requerido_por} onChange={(e) => setGeneralData({ ...generalData, requerido_por: e.target.value })} className="h-8 text-sm" placeholder="No especificado" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="aprobado_por" className="text-[11px] font-bold text-gray-400 uppercase">Aprobado por</Label>
                                            <Input id="aprobado_por" disabled={camposBloqueados} value={generalData.aprobado_por} onChange={(e) => setGeneralData({ ...generalData, aprobado_por: e.target.value })} className="h-8 text-sm" placeholder="No especificado" />
                                        </div>

                                        {/* Producto: selector (busca por código o descripción) + código separado y copiable */}
                                        <div className="md:col-span-3 space-y-1.5">
                                            <Label htmlFor="articulo" className="text-[11px] font-bold text-gray-400 uppercase">Producto / Artículo <span className="text-red-500">*</span></Label>
                                            <SearchableSelect disabled={camposBloqueados} options={articulos.map(a => ({ value: a.id.toString(), label: `${a.cod_articulo} - ${a.descripcion}` }))} value={generalData.articulo_id} onValueChange={(val) => setGeneralData({ ...generalData, articulo_id: val })} placeholder="Buscá por código o descripción" triggerClassName="h-8" />
                                        </div>
                                        <div className="md:col-span-1 space-y-1.5">
                                            <Label htmlFor="cod_articulo" className="text-[11px] font-bold text-gray-400 uppercase">Código</Label>
                                            {(() => {
                                                const codSel = articulos.find(a => a.id.toString() === generalData.articulo_id)?.cod_articulo || "";
                                                return (
                                                    <div className="flex items-center gap-1">
                                                        <Input id="cod_articulo" readOnly value={codSel} placeholder="—" title="Código del producto" className="h-8 text-sm font-mono" />
                                                        <Button type="button" variant="outline" className="h-8 w-8 p-0 shrink-0" disabled={!codSel} title="Copiar código" onClick={() => { navigator.clipboard.writeText(codSel); toast.success(`Código ${codSel} copiado`); }}>
                                                            <Copy className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                );
                                            })()}
                                        </div>

                                        {/* Section: Dates */}
                                        <div className="md:col-span-4 xl:col-span-6 flex items-center gap-2 mb-1 mt-1">
                                            <div className="h-px flex-1 bg-gray-100"></div>
                                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest px-2">Fechas Clave</span>
                                            <div className="h-px flex-1 bg-gray-100"></div>
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label htmlFor="fecha_orden" className="text-[11px] font-bold text-gray-400 uppercase">Fecha Orden</Label>
                                            <Input id="fecha_orden" disabled={camposBloqueados} type="date" value={generalData.fecha_orden} onChange={(e) => setGeneralData({ ...generalData, fecha_orden: e.target.value })} className="h-8 text-sm" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="fecha_entrada" className="text-[11px] font-bold text-gray-400 uppercase">Fecha Entrada</Label>
                                            <Input id="fecha_entrada" disabled={camposBloqueados} type="date" value={generalData.fecha_entrada} onChange={(e) => setGeneralData({ ...generalData, fecha_entrada: e.target.value })} className="h-8 text-sm" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="fecha_prometida" className="text-[11px] font-bold text-blue-600 uppercase font-black">F. Prometida</Label>
                                            <Input id="fecha_prometida" type="date" disabled={soloLectura} value={generalData.fecha_prometida} onChange={(e) => setGeneralData({ ...generalData, fecha_prometida: e.target.value })} className={cn("h-8 text-sm border-blue-200", isLegacyOT && "ring-2 ring-blue-300 ring-offset-1 bg-blue-50/40")} />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label htmlFor="fecha_entrega" className="text-[11px] font-bold text-gray-400 uppercase">F. Entrega Real</Label>
                                            <Input id="fecha_entrega" disabled={camposBloqueados} type="date" value={generalData.fecha_entrega} onChange={(e) => setGeneralData({ ...generalData, fecha_entrega: e.target.value })} className="h-8 text-sm" />
                                        </div>

                                        <div className="space-y-1.5">
                                            <Label htmlFor="f_disp_material" className="text-[11px] font-bold text-gray-400 uppercase">F. Disp Mat</Label>
                                            <Input id="f_disp_material" disabled={camposBloqueados} type="date" value={generalData.f_disp_material} onChange={(e) => setGeneralData({ ...generalData, f_disp_material: e.target.value })} className="h-8 text-sm" />
                                        </div>
                                        <div className="md:col-span-3 space-y-1.5">
                                            <Label htmlFor="remitos_salida" className="text-[11px] font-bold text-gray-400 uppercase">Remitos Salida</Label>
                                            <Input id="remitos_salida" disabled={camposBloqueados} value={generalData.remitos_salida} onChange={(e) => setGeneralData({ ...generalData, remitos_salida: e.target.value })} className="h-8 text-sm" placeholder="No especificado" />
                                        </div>

                                        {/* Section: Flags (Compact) */}
                                        <div className="md:col-span-4 xl:col-span-6 grid grid-cols-2 md:grid-cols-4 gap-2 p-2.5 border border-gray-100 rounded-xl bg-gray-50/30 mt-1">
                                            {/* Fabricación, reparación o sin cargo: UNA elección, no tres casillas.
                                                Pedido de Lucas (10/09) para poder filtrar de un vistazo. En la
                                                base siguen siendo tres banderas del legacy, pero acá se eligen
                                                como lo que son: excluyentes.
                                                «Sin Cargo» faltaba y el taller la usa (Camilo, 14/09: "y lo de
                                                sin cargo no está"): en el sistema viejo es la tercera opción del
                                                mismo grupo de radios, junto a Fabricación y Reparación. */}
                                            {/* `flex-wrap` y alto libre en el teléfono: «Trabajo:» y las
                                                tres opciones piden ~300px y ahí hay 260; se salían del
                                                recuadro. Desde `md` es la fila de 32px de siempre. */}
                                            <div className="col-span-2 md:col-span-3 flex flex-wrap md:flex-nowrap items-center gap-1 px-2 py-1 min-h-8 md:h-8">
                                                <span className="text-xs text-gray-500 font-medium tracking-tight mr-1 shrink-0">Trabajo:</span>
                                                {([
                                                    ["fabricacion", "Fabricación"],
                                                    ["reparacion", "Reparación"],
                                                    ["sin_cargo", "Sin Cargo"],
                                                ] as const).map(([clave, texto]) => {
                                                    const activo = generalData[clave];
                                                    return (
                                                        <button
                                                            key={clave}
                                                            type="button"
                                                            disabled={camposBloqueados}
                                                            /* Volver a tocar el que ya está elegido lo apaga: sin eso,
                                                               una OT marcada por error no se puede dejar en blanco. */
                                                            onClick={() => setGeneralData({
                                                                ...generalData,
                                                                fabricacion: clave === "fabricacion" ? !activo : false,
                                                                reparacion: clave === "reparacion" ? !activo : false,
                                                                sin_cargo: clave === "sin_cargo" ? !activo : false,
                                                            })}
                                                            className={cn(
                                                                "text-xs font-medium px-2 py-1 rounded border transition-colors",
                                                                activo
                                                                    ? "bg-red-50 border-red-300 text-red-700"
                                                                    : "bg-white border-gray-200 text-gray-500 hover:border-gray-300"
                                                            )}
                                                        >
                                                            {texto}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100/50 px-2 py-1 rounded border border-transparent transition-colors w-full h-8">
                                                <Checkbox id="stock" disabled={camposBloqueados} checked={generalData.stock} onCheckedChange={(c) => setGeneralData({ ...generalData, stock: !!c })} /> 
                                                <span className="text-xs text-gray-600 font-medium tracking-tight">Stock</span>
                                            </Label>
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100/50 px-2 py-1 rounded border border-transparent transition-colors w-full h-8">
                                                <Checkbox id="interno" disabled={camposBloqueados} checked={generalData.interno} onCheckedChange={(c) => setGeneralData({ ...generalData, interno: !!c })} /> 
                                                <span className="text-xs text-gray-600 font-medium tracking-tight">Interno</span>
                                            </Label>
                                            
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100/50 px-2 py-1 rounded border border-transparent transition-colors w-full h-8">
                                                <Checkbox id="tercerizado_total" disabled={camposBloqueados} checked={generalData.tercerizado_total} onCheckedChange={(c) => setGeneralData({ ...generalData, tercerizado_total: !!c })} /> 
                                                <span className="text-xs text-gray-600 font-medium tracking-tight">Terc. Total</span>
                                            </Label>
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100/50 px-2 py-1 rounded border border-transparent transition-colors w-full h-8">
                                                <Checkbox id="tercerizado_parcial" disabled={camposBloqueados} checked={generalData.tercerizado_parcial} onCheckedChange={(c) => setGeneralData({ ...generalData, tercerizado_parcial: !!c })} /> 
                                                <span className="text-xs text-gray-600 font-medium tracking-tight">Terc. Parcial</span>
                                            </Label>
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-100/50 px-2 py-1 rounded border border-transparent transition-colors w-full h-8">
                                                <Checkbox id="email" disabled={camposBloqueados} checked={generalData.email} onCheckedChange={(c) => setGeneralData({ ...generalData, email: !!c })} /> 
                                                <span className="text-xs text-gray-600 font-medium tracking-tight">Email</span>
                                            </Label>
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-orange-50 px-2 py-1 rounded border border-transparent transition-colors text-orange-600 font-bold w-full h-8">
                                                <Checkbox id="reclamo" disabled={camposBloqueados} className="border-orange-500 data-[state=checked]:bg-orange-500" checked={generalData.reclamo} onCheckedChange={(c) => setGeneralData({ ...generalData, reclamo: !!c })} /> 
                                                <span className="text-xs uppercase">Reclamo</span>
                                            </Label>
                                            
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-red-50 px-2 py-1 rounded border border-transparent transition-colors text-red-600 font-bold w-full h-8">
                                                <Checkbox id="suspendida" disabled={camposBloqueados} className="border-red-600 data-[state=checked]:bg-red-600" checked={generalData.suspendida} onCheckedChange={(c) => setGeneralData({ ...generalData, suspendida: !!c })} /> 
                                                <span className="text-xs uppercase">Suspendida</span>
                                            </Label>
                                            {/* «Fin. Parcial» y «Entrega Completa (Total)» se mudaron al
                                                recuadro «Estado y control» de abajo (RF-11), junto con las
                                                otras seis casillas de estado de la ficha vieja. */}
                                        </div>

                                        {/* Status block (Row 7).
                                            RF-27: las casillas en fila no entraban en el teléfono y el
                                            formulario entero scrolleaba de costado. Ahí bajan de renglón; desde `md`, la fila
                                            repartida de siempre. */}
                                        <div className="md:col-span-4 xl:col-span-6 flex flex-wrap md:flex-nowrap items-center justify-start md:justify-between gap-x-3 gap-y-1 md:gap-4 py-2 border-t border-gray-100 mt-1">
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors group">
                                                <Checkbox id="tiene_plano" disabled={camposBloqueados} checked={generalData.tiene_plano} onCheckedChange={(c) => setGeneralData({ ...generalData, tiene_plano: !!c, no_lleva_plano: c ? false : generalData.no_lleva_plano })} /> 
                                                <span className="text-xs font-medium text-gray-500 group-hover:text-gray-700">Tiene Plano</span>
                                            </Label>
                                            {/* "No lleva" es distinto de "no hay ninguno cargado": con esto marcado,
                                                el que revisa planos se la saltea en vez de ir a buscarla al Drive
                                                (Lucas, 10/09: "si dice sin plano lo va a tener que revisar"). */}
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors group">
                                                <Checkbox id="no_lleva_plano" disabled={camposBloqueados} checked={generalData.no_lleva_plano} onCheckedChange={(c) => setGeneralData({ ...generalData, no_lleva_plano: !!c, tiene_plano: c ? false : generalData.tiene_plano })} /> 
                                                <span className="text-xs font-medium text-gray-500 group-hover:text-gray-700">No lleva plano</span>
                                            </Label>
                                            {/* Programada y En Proceso se mudaron a «Estado y control» (RF-11). */}
                                            <Label className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded transition-colors group">
                                                <Checkbox id="revisada" disabled={camposBloqueados} checked={generalData.revisada} onCheckedChange={(c) => setGeneralData({ ...generalData, revisada: !!c })} /> 
                                                <span className="text-xs font-medium text-gray-500 group-hover:text-gray-700">Revisada</span>
                                            </Label>
                                        </div>

                                        {/* RF-11: las ocho casillas de estado de la ficha del sistema
                                            viejo, en su orden, con el «Cant.» al lado de Finalizado
                                            parcial. Quién marcó Controlado y cuándo lo pone el backend. */}
                                        <EstadoYControl
                                            valores={generalData as ValoresDeEstado}
                                            onCasilla={(clave, valor) => setGeneralData(g => ({ ...g, [clave]: valor }))}
                                            onCantidad={(texto) => setGeneralData(g => ({ ...g, cantidad_finalizada_parcial: texto }))}
                                            bloqueado={camposBloqueados}
                                            conoceNuevas={conoceControl}
                                            guardada={orderToEdit ? {
                                                controlado: marcada(orderToEdit.controlado),
                                                por: orderToEdit.controlado_por,
                                                en: orderToEdit.controlado_en,
                                            } : null}
                                            unidades={aNumero(detailsData.cantidad)}
                                        />

                                        {/* Textareas (Compact Row 8) */}
                                        <div className="md:col-span-2 space-y-1.5">
                                            <Label htmlFor="descripcion" className="text-[11px] font-bold text-gray-600 uppercase">Info Gral / Descripción *</Label>
                                            <Textarea id="descripcion" disabled={camposBloqueados} value={generalData.descripcion} onChange={(e) => setGeneralData({ ...generalData, descripcion: e.target.value })} className="h-16 min-h-[60px] text-sm bg-white" required />
                                        </div>
                                        <div className="md:col-span-2 space-y-1.5">
                                            <Label htmlFor="nota_taller" className="text-[11px] font-bold text-gray-600 uppercase">Nota de Taller</Label>
                                            <Textarea id="nota_taller" disabled={camposBloqueados} value={detailsData.observaciones} onChange={(e) => setDetailsData({ ...detailsData, observaciones: e.target.value })} className="h-16 min-h-[60px] text-sm bg-white" />
                                        </div>
                                        
                                        <div className="md:col-span-4 xl:col-span-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
                                            <div className="space-y-1">
                                                <Label htmlFor="nota_1" className="text-[9px] font-bold text-gray-400 flex items-center justify-between uppercase">Nota 1</Label>
                                                <Input id="nota_1" disabled={camposBloqueados} value={detailsData.nota_1} onChange={(e) => setDetailsData({ ...detailsData, nota_1: e.target.value })} className="h-7 text-xs bg-gray-50/50" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="nota_2" className="text-[9px] font-bold text-gray-400 flex items-center justify-between uppercase">Nota 2</Label>
                                                <Input id="nota_2" disabled={camposBloqueados} value={detailsData.nota_2} onChange={(e) => setDetailsData({ ...detailsData, nota_2: e.target.value })} className="h-7 text-xs bg-gray-50/50" />
                                            </div>
                                            <div className="space-y-1">
                                                <Label htmlFor="nota_3" className="text-[9px] font-bold text-gray-400 flex items-center justify-between uppercase">Nota 3</Label>
                                                <Input id="nota_3" disabled={camposBloqueados} value={detailsData.nota_3} onChange={(e) => setDetailsData({ ...detailsData, nota_3: e.target.value })} className="h-7 text-xs bg-gray-50/50" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-2 pt-3">
                                        {/* Acá se subía y se listaba todo junto: con quince archivos del
                                            producto la lista se comía la solapa entera y encima los quince
                                            renglones se leían iguales (mismo nombre, cortado por el final,
                                            que es lo único que cambia). Ahora acá queda lo que se hace
                                            —cuántos hay y subir uno más— y verlos es la solapa Planos, que
                                            los muestra con la miniatura. */}
                                        <div className="flex items-center justify-between gap-3 flex-wrap">
                                            <Label className="text-sm font-semibold text-gray-700">
                                                Archivos Adjuntos (Planos, Especificaciones)
                                            </Label>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setActiveTab("planos")}
                                                className="h-8 gap-2 text-xs"
                                            >
                                                <Paperclip className="w-3.5 h-3.5" />
                                                Verlos en la solapa Planos
                                            </Button>
                                        </div>

                                        {existingFiles.length > 0 && (
                                            <p className="text-xs text-gray-500">
                                                Ya hay <span className="font-semibold text-gray-700">{resumirArchivos(existingFiles)}</span>
                                                {adjuntosDelProducto.length > 0 && (
                                                    <>
                                                        {" "}—{" "}
                                                        {adjuntosDelProducto.length === 1
                                                            ? "uno es del producto y se ve en todas las OT que lo fabrican"
                                                            : `${adjuntosDelProducto.length} son del producto y se ven en todas las OT que lo fabrican`}
                                                    </>
                                                )}
                                                .
                                            </p>
                                        )}
                                        {/* Dynamic Upload Box */}
                                        <div
                                            className={cn(
                                                "border-2 border-dashed border-gray-200 rounded-xl transition-all hover:border-blue-400 hover:bg-blue-50/30 group cursor-pointer relative",
                                                (existingFiles.length > 0 || files.length > 0)
                                                    ? "p-3 flex items-center justify-between gap-4"
                                                    : "p-6 text-center"
                                            )}
                                        >
                                            <input
                                                type="file"
                                                multiple
                                                accept="image/*,.pdf"
                                                disabled={camposBloqueados}
                                                className={cn(
                                                    "absolute inset-0 w-full h-full opacity-0 z-10",
                                                    camposBloqueados ? "cursor-not-allowed" : "cursor-pointer"
                                                )}
                                                onChange={(e) => {
                                                    if (e.target.files) {
                                                        const newFiles = Array.from(e.target.files);
                                                        setFiles(prev => [...prev, ...newFiles]);
                                                    }
                                                }}
                                            />

                                            {(existingFiles.length > 0 || files.length > 0) ? (
                                                <>
                                                    <div className="flex items-center gap-3">
                                                        <div className="p-2 bg-blue-50 text-blue-600 rounded-full group-hover:scale-105 transition-transform">
                                                            <UploadCloud className="w-5 h-5" />
                                                        </div>
                                                        <div className="text-sm text-gray-600 text-left">
                                                            <span className="font-semibold text-blue-600">Agregar más archivos</span>
                                                            <p className="text-xs text-gray-400">PDF, PNG, JPG</p>
                                                        </div>
                                                    </div>
                                                    <div className="pr-2">
                                                        <Plus className="w-5 h-5 text-gray-400 group-hover:text-blue-500" />
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="flex flex-col items-center gap-2 pointer-events-none">
                                                    <div className="p-3 bg-blue-50 text-blue-600 rounded-full group-hover:scale-110 transition-transform">
                                                        <UploadCloud className="w-6 h-6" />
                                                    </div>
                                                    <div className="text-sm text-gray-600">
                                                        <span className="font-semibold text-blue-600">Haz clic para subir</span> o arrastra y suelta
                                                    </div>
                                                    <p className="text-xs text-gray-400">PDF, PNG, JPG (máx. 10MB)</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Solo lo que se puede tocar desde acá: el adjunto propio de la
                                            orden y el que se acaba de elegir. El plano del PRODUCTO no se
                                            borra desde una OT —es el mismo archivo para todas las órdenes
                                            del artículo y para la sección Planos—, así que no aparece como
                                            renglón: se cuenta arriba y se mira en la solapa Planos.
                                            El alto está topeado a propósito: es lo que evitaba que la solapa
                                            se estirara y hubiera que scrollear la página entera. */}
                                        {(adjuntosDeLaOrden.length > 0 || files.length > 0) && (
                                            <div className="flex flex-wrap gap-2 mt-3 max-h-28 overflow-y-auto pr-1">
                                                {adjuntosDeLaOrden.map((file) => (
                                                    <span
                                                        key={`existing-${file.id}`}
                                                        title={file.nombre}
                                                        className="inline-flex items-center gap-1.5 max-w-[290px] pl-2 pr-1 py-1 bg-blue-50/60 border border-blue-100 rounded-lg"
                                                    >
                                                        {esPlano(file.tipo_archivo) || file.nombre.toLowerCase().endsWith(".pdf") ? (
                                                            <FileText className="w-3.5 h-3.5 shrink-0 text-red-500" />
                                                        ) : (
                                                            <ImageIcon className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                                                        )}
                                                        <button
                                                            type="button"
                                                            onClick={() => descargarPlano(file.id, file.nombre)
                                                                .catch(() => toast.error("No se pudo descargar el archivo"))}
                                                            className="text-xs font-medium text-gray-700 truncate hover:text-blue-600 hover:underline"
                                                            title="Descargar este archivo"
                                                        >
                                                            {colaDelNombre(file.nombre)}
                                                        </button>
                                                        {!camposBloqueados && (
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon"
                                                                onClick={() => {
                                                                    setDeletedFileIds(prev => [...prev, file.id]);
                                                                    setExistingFiles(prev => prev.filter(f => f.id !== file.id));
                                                                }}
                                                                className="h-5 w-5 shrink-0 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                                                title="Sacar este archivo de la orden"
                                                            >
                                                                <Trash2 className="w-3 h-3" />
                                                            </Button>
                                                        )}
                                                    </span>
                                                ))}

                                                {files.map((file, index) => (
                                                    <span
                                                        key={`nuevo-${index}`}
                                                        title={file.name}
                                                        className="inline-flex items-center gap-1.5 max-w-[290px] pl-2 pr-1 py-1 bg-gray-50 border border-gray-200 rounded-lg"
                                                    >
                                                        {file.type.includes("pdf") ? (
                                                            <FileText className="w-3.5 h-3.5 shrink-0 text-red-500" />
                                                        ) : (
                                                            <ImageIcon className="w-3.5 h-3.5 shrink-0 text-blue-500" />
                                                        )}
                                                        <span className="text-xs font-medium text-gray-700 truncate">{file.name}</span>
                                                        <span className="text-[10px] font-semibold text-amber-600 shrink-0">sin subir</span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            onClick={() => setFiles(files.filter((_, i) => i !== index))}
                                                            className="h-5 w-5 shrink-0 text-gray-400 hover:text-red-500 hover:bg-red-50"
                                                            title="No subir este archivo"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </Button>
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </TabsContent>

                                {/* Tab: Materias Primas */}
                                <TabsContent value="materias" className="space-y-4 mt-0 animate-in fade-in-50 slide-in-from-right-2 duration-300">
                                    <div className="flex flex-col gap-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <h3 className="text-base font-semibold text-gray-900">Materias Primas</h3>
                                                <p className="text-xs text-gray-500">Los materiales que lleva esta orden</p>
                                            </div>
                                        </div>

                                        {/* Esta solapa se MIRA, no se carga.
                                            Decisión de Julián (11/09): el sistema viejo sigue siendo el
                                            dueño de las materias primas y el sync las sigue trayendo cada
                                            media hora. Antes acá había un formulario para agregar filas
                                            que no viajaban a ningún lado: se juntaban en pantalla, salían
                                            en la hoja de pañol y se perdían al cerrar. Con el viejo como
                                            dueño, agregar material acá nunca iba a ser correcto, así que
                                            el formulario se fue y la pantalla dice dónde se carga.
                                            Lo único que SÍ es nuestro es la casilla de abajo… y, desde
                                            el 22/09 (RF-15), lo CONSUMIDO: va a una tabla propia que el
                                            sync no mira, y se carga desde la fila del material. La
                                            lista de lo que se pide sigue siendo del viejo. */}
                                        <Alert className="border-blue-200 bg-blue-50/60">
                                            <Info className="h-4 w-4 text-blue-600" />
                                            <AlertDescription className="text-xs text-blue-900">
                                                <strong>Las materias primas se cargan en el sistema viejo.</strong> Acá
                                                se ven, y se actualizan solas cada pocos minutos. Si a esta orden le
                                                falta un material, cargalo allá y en un rato aparece.
                                                {/* En un solo span: AlertDescription es una grilla y
                                                    cada nodo suelto (el <strong> incluido) caía en su
                                                    propio renglón. */}
                                                {consumo.estado === "si" && (
                                                    <span>
                                                        Lo que se <strong>consume</strong> sí se registra acá: tocá la
                                                        columna Consumido del material. No descuenta stock.
                                                    </span>
                                                )}
                                            </AlertDescription>
                                        </Alert>

                                        {/* Table */}
                                        {/* `@container`: la fila que se abre para cargar el consumo
                                            mide su ancho contra esta caja (100cqw), así queda a la
                                            vista aunque la tabla se desplace de costado. */}
                                        <div className="@container border border-gray-200 rounded-xl overflow-hidden shadow-sm overflow-x-auto bg-white">
                                            <table className="w-full text-sm text-left relative">
                                                <thead className="text-xs text-gray-600 bg-gray-50/80 border-b border-gray-200 uppercase whitespace-nowrap">
                                                    <tr>
                                                        <th className="px-3 py-2">Código</th>
                                                        <th className="px-3 py-2">Descripción</th>
                                                        <th className="px-3 py-2">Proveedor</th>
                                                        <th className="px-3 py-2">Cant</th>
                                                        <th className="px-3 py-2">UN</th>
                                                        {consumo.estado === "si" && (
                                                            <th className="px-3 py-2" title="Lo registrado en SPMM, carga por carga. No descuenta stock.">
                                                                Consumido
                                                            </th>
                                                        )}
                                                        <th className="px-3 py-2">Disponible</th>
                                                        <th className="px-3 py-2">En Prod.</th>
                                                        <th className="px-3 py-2 w-32">Obs</th>
                                                        <th className="px-3 py-2">Precio</th>
                                                        <th className="px-3 py-2" title="Lo que dice el sistema viejo. No es lo consumido que se registra acá.">C. Usado</th>
                                                        <th className="px-3 py-2 text-center">Utiliz.</th>
                                                        <th className="px-3 py-2 text-center">Cortes</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100">
                                                    {materiasPrimas.length === 0 ? (
                                                        <tr>
                                                            <td colSpan={consumo.estado === "si" ? 13 : 12} className="p-0">
                                                                {/* Del ancho de la caja y pegado a la izquierda (RF-27): la
                                                                    tabla mide ~900px y, centrado en todo ese ancho, en el
                                                                    teléfono el cartel quedaba cortado a la mitad y había que
                                                                    deslizar la tabla vacía para leerlo. Mismo `100cqw` que la
                                                                    fila de consumo. */}
                                                                <div className="sticky left-0 w-[100cqw] px-4 py-8 text-center text-sm text-gray-500">
                                                                    Esta orden no tiene materias primas cargadas en el sistema viejo.
                                                                    <br />
                                                                    <span className="text-xs text-gray-400">
                                                                        Si no lleva material, marcalo abajo — así deja de figurar como que falta cargarla.
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    ) : (
                                                        materiasPrimas.map((mp) => {
                                                            // La línea contra la que se registra el consumo. Sin id (una
                                                            // fila que no vino de la base) no hay contra qué cargarlo.
                                                            const linea: LineaDeMaterial | null =
                                                                consumo.estado === "si" && mp.id_linea != null
                                                                    ? {
                                                                        idLinea: mp.id_linea,
                                                                        codigo: mp.codigo,
                                                                        descripcion: mp.descripcion,
                                                                        pedido: Number(mp.cantidad) || 0,
                                                                        unidad: mp.unidad,
                                                                    }
                                                                    : null;
                                                            const abierto = linea !== null && consumoAbierto === linea.idLinea;
                                                            const totalConsumido = linea ? (consumo.totalPorLinea.get(linea.idLinea) ?? 0) : 0;
                                                            return (
                                                            <Fragment key={mp.id}>
                                                            <tr className={cn("hover:bg-gray-50/50 transition-colors group", abierto && "bg-blue-50/40")}>
                                                                <td className="px-3 py-2 font-medium">{mp.codigo}</td>
                                                                <td className="px-3 py-2 truncate max-w-[150px]" title={mp.descripcion}>{mp.descripcion}</td>
                                                                <td className="px-3 py-2 text-gray-600 truncate max-w-[120px]" title={mp.proveedor}>{mp.proveedor || "—"}</td>
                                                                <td className="px-3 py-2">{mp.cantidad}</td>
                                                                <td className="px-3 py-2">{mp.unidad}</td>
                                                                {consumo.estado === "si" && (
                                                                    <td className="px-2 py-1">
                                                                        {linea ? (
                                                                            <CeldaConsumido
                                                                                linea={linea}
                                                                                total={totalConsumido}
                                                                                abierto={abierto}
                                                                                onAlternar={() => setConsumoAbierto(abierto ? null : linea.idLinea)}
                                                                            />
                                                                        ) : (
                                                                            <span className="text-gray-400">—</span>
                                                                        )}
                                                                    </td>
                                                                )}
                                                                <td className="px-3 py-2 text-gray-500">{mp.disponible}</td>
                                                                <td className="px-3 py-2 text-gray-500">{mp.en_produccion}</td>
                                                                <td className="px-3 py-2 truncate max-w-[100px] text-gray-500" title={mp.observaciones}>{mp.observaciones}</td>
                                                                <td className="px-3 py-2 text-gray-500">{mp.precio}</td>
                                                                <td className="px-3 py-2 text-gray-500">{mp.c_usado}</td>
                                                                {/* Utilizado y Cortes eran una casilla y un campo que no
                                                                    guardaban nada: se tildaban, se cerraba el modal y no
                                                                    quedaba rastro. Ahora muestran lo que dice el sistema
                                                                    viejo, que es de donde salen. */}
                                                                <td className="px-3 py-2 text-center text-gray-500">
                                                                    {mp.utilizado ? "Sí" : "—"}
                                                                </td>
                                                                <td className="px-3 py-2 text-center text-gray-500 tabular-nums">
                                                                    {mp.cortes || "—"}
                                                                </td>
                                                            </tr>
                                                            {abierto && linea && (
                                                                <FilaDeConsumo
                                                                    linea={linea}
                                                                    colSpan={13}
                                                                    consumos={consumo.consumos.filter(c => c.id_orden_trabajo_pieza === linea.idLinea)}
                                                                    total={totalConsumido}
                                                                    onRegistrar={(cantidad, obs) => consumo.registrar(linea, cantidad, obs)}
                                                                    puedeAnular={consumo.puedeAnular}
                                                                    onAnular={(id) => { void consumo.anular(id); }}
                                                                />
                                                            )}
                                                            </Fragment>
                                                            );
                                                        })
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {/* Consumos que no cuelgan de ninguna fila de arriba: cargados
                                            por API contra un material que no está en la lista, o contra
                                            una línea que el sistema viejo sacó después. No se pierden de
                                            vista: siguen siendo de esta orden. */}
                                        {consumo.estado === "si" && (() => {
                                            const lineas = new Set(materiasPrimas.map(mp => mp.id_linea).filter((x): x is number => x != null));
                                            const sueltos = consumo.consumos.filter(c => c.id_orden_trabajo_pieza == null || !lineas.has(c.id_orden_trabajo_pieza));
                                            if (sueltos.length === 0) return null;
                                            return (
                                                <div className="rounded-xl border border-gray-200 bg-white p-3">
                                                    <p className="text-xs font-semibold text-gray-700">Consumos de materiales que no están en la lista</p>
                                                    <p className="mb-1 text-[11px] text-gray-500">
                                                        Se registraron contra esta orden, pero no contra ninguna de las filas de arriba.
                                                    </p>
                                                    <ListaDeConsumos
                                                        consumos={sueltos}
                                                        puedeAnular={consumo.puedeAnular}
                                                        onAnular={(id) => { void consumo.anular(id); }}
                                                        mostrarMaterial
                                                    />
                                                </div>
                                            );
                                        })()}

                                        {/* El backend tiene la ruta pero no pudo contestar (la tabla
                                            todavía no se creó, la base no respondió). La columna no se
                                            muestra para no dibujar un «—» que parezca «nada consumido». */}
                                        {consumo.estado === "error" && materiasPrimas.length > 0 && (
                                            <p className="text-[11px] text-amber-700">
                                                No se pudo leer lo consumido de esta orden. La lista de materiales está
                                                completa; volvé a abrir la orden en un rato para ver y cargar el consumo.
                                            </p>
                                        )}

                                        {/* Lo único de esta solapa que SÍ se guarda, y es de SPMM: el
                                            sync no lo mira ni lo pisa. Hace falta porque sin esto «no
                                            lleva material» y «nadie cargó la lista» se ven iguales —las
                                            dos sin piezas— y son cosas opuestas: una hay que saltearla y
                                            la otra hay que ir a cargarla. Mismo caso que «no lleva plano».
                                            Antes esta casilla se tildaba y no quedaba en ningún lado. */}
                                        <label
                                            htmlFor="no_lleva_mp"
                                            className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-gray-200 bg-gray-50/50 p-3 hover:bg-gray-50"
                                        >
                                            <Checkbox
                                                id="no_lleva_mp"
                                                disabled={soloLectura}
                                                className="mt-0.5"
                                                checked={generalData.no_lleva_materia_prima}
                                                onCheckedChange={(c) => setGeneralData({ ...generalData, no_lleva_materia_prima: !!c })}
                                            />
                                            <span className="text-sm">
                                                <span className="font-semibold text-gray-800">Esta orden no lleva materia prima</span>
                                                <span className="block text-xs text-gray-500">
                                                    Marcala y la columna Material deja de decir «Sin cargar»: pasa a decir
                                                    «No lleva», que es otra cosa.
                                                </span>
                                            </span>
                                        </label>
                                    </div>
                                </TabsContent>

                                {/* Tab: Procesos */}
                                <TabsContent value="procesos" className="space-y-4 mt-0 animate-in fade-in-50 slide-in-from-right-2 duration-300">
                                    {/* El título estaba dos veces, uno arriba del otro: acá
                                        "Procesos de la Orden" y tres renglones más abajo
                                        "Procesos de la orden (7 activos de 7)" con la barra de
                                        botones. Dos renglones enteros de alto para decir lo mismo,
                                        justo arriba de la lista que uno quiere ver. Queda el de
                                        abajo, que además cuenta cuántos hay. */}
                                    <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
                                        <div className="space-y-1">
                                            <p className="text-sm text-gray-500">
                                                Elegí proceso, recurso maquinaria, recurso humano, minutos y cuánto recurso humano hace falta. Destildá los que esta vez no van (opcional).
                                            </p>
                                        </div>
                                        {/* Ir y volver a los planos sin apuntarle a la solapa cada vez: los pasos
                                            salen del dibujo, así que este viaje se hace muchas veces por orden. */}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setActiveTab("planos")}
                                            className="h-9 gap-2 shrink-0 hover:text-blue-600 hover:border-blue-200"
                                        >
                                            <Paperclip className="w-4 h-4" />
                                            Ver los planos
                                            {!planosCargando && planosVisibles.length > 0 && (
                                                <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-600 text-[10px] font-bold tabular-nums">
                                                    {resumirArchivos(planosVisibles)}
                                                </span>
                                            )}
                                        </Button>
                                    </div>

                                    <div className="flex flex-col lg:flex-row lg:items-start gap-4">
                                        <div className="order-2 lg:order-1 flex-1 min-w-0">
                                            <ProcesosEditor
                                                rows={processes}
                                                onChange={setProcesses}
                                                procesos={procesosOptions}
                                                maquinarias={maquinarias}
                                                operarios={operarios}
                                                planificado={planificado}
                                                disabled={camposBloqueados}
                                                onTraerHistorial={camposBloqueados ? undefined : handleTraerHistorial}
                                                historialLoading={historialLoading}
                                                onCrearProceso={editaCatalogoProcesos ? handleCrearProceso : undefined}
                                                onEliminarProceso={editaCatalogoProcesos ? handleEliminarProceso : undefined}
                                                quienPuede={quienPuede}
                                            />
                                        </div>

                                        <PanelDePlanos
                                            planos={planosVisibles}
                                            cargando={planosCargando}
                                            vacioTexto={planosVacioTexto}
                                            titulo={planosTitulo}
                                            onVerTodos={() => setActiveTab("planos")}
                                        />
                                    </div>
                                </TabsContent>

                                {/* Tab: Planos */}
                                <TabsContent value="planos" className="space-y-4 mt-0 animate-in fade-in-50 slide-in-from-right-2 duration-300">
                                    <div className="flex items-start justify-between gap-3 flex-wrap">
                                        <div className="space-y-1">
                                            <h3 className="text-lg font-semibold text-gray-900">Planos</h3>
                                            <p className="text-sm text-gray-500">
                                                El dibujo del producto, las fotos de la pieza y lo que se haya adjuntado a esta orden. Tocá una miniatura para verla grande y pasar de una a la otra.
                                            </p>
                                        </div>
                                        {/* La vuelta del atajo que está en Procesos: se mira el plano, se vuelve
                                            a cargar el paso y no se perdió nada de lo que estaba escrito. */}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => setActiveTab("procesos")}
                                            className="h-9 gap-2 shrink-0 hover:text-blue-600 hover:border-blue-200"
                                        >
                                            <Settings className="w-4 h-4" />
                                            Ir a procesos
                                            <ArrowRight className="w-4 h-4" />
                                        </Button>
                                    </div>

                                    {faltaElegirProducto ? (
                                        /* Sin producto no hay planos que traer, y conviene decirlo derecho: en
                                           la solapa Procesos esto mismo salía como un panel vacío y parecía
                                           que la pantalla estaba rota. */
                                        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50/50 px-6 py-10 text-center space-y-3">
                                            <Package className="w-8 h-8 mx-auto text-gray-300" />
                                            <div className="space-y-1">
                                                <p className="text-sm font-semibold text-gray-600">Todavía no elegiste el producto</p>
                                                <p className="text-xs text-gray-400">
                                                    Los planos cuelgan del producto que la OT fabrica. Elegilo en la solapa 1 y aparecen acá.
                                                </p>
                                            </div>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                onClick={() => setActiveTab("general")}
                                                className="h-9 gap-2"
                                            >
                                                <ArrowLeft className="w-4 h-4" />
                                                Ir a Información General
                                            </Button>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Sin `alto`: la solapa ya scrollea sola y acá el pedido es
                                                justamente que entren todos a la vista, no dentro de una
                                                cajita con su propio scroll. Con el modal en 1200px entran
                                                siete por fila, así que quince archivos son tres filas. */}
                                            <PlanoPanel
                                                planos={planosVisibles}
                                                cargando={planosCargando}
                                                titulo={planosTitulo}
                                                vacioTexto={planosVacioTexto}
                                            />

                                            {files.length > 0 && (
                                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                    {files.length === 1
                                                        ? "Hay 1 archivo elegido que todavía no se subió: aparece acá cuando guardes la orden."
                                                        : `Hay ${files.length} archivos elegidos que todavía no se subieron: aparecen acá cuando guardes la orden.`}
                                                </p>
                                            )}
                                        </>
                                    )}
                                </TabsContent>

                                {/* Tab: Historial */}
                                {orderToEdit && (
                                    <TabsContent value="historial" className="space-y-4 mt-0 animate-in fade-in-50 slide-in-from-right-2 duration-300">
                                        <div className="space-y-1">
                                            <h3 className="text-lg font-semibold text-gray-900">
                                                Qué se hizo con los pasos de esta orden
                                            </h3>
                                            <p className="text-sm text-gray-500">
                                                Cada vez que alguien agrega, cambia o saca un paso queda acá:
                                                quién fue, desde qué pantalla y el día y la hora exactos. Sirve
                                                para cuando un proceso aparece dos veces o falta uno y hay que
                                                saber qué pasó.
                                            </p>
                                        </div>
                                        <HistorialDeProcesos idOrden={orderToEdit.id} />
                                    </TabsContent>
                                )}
                            </Tabs>
                        </div>

                        {/* RF-27: en el teléfono los cuatro botones del pie pedían ~560px. Ahí
                            van con menos relleno, «Imprimir» queda en el ícono, y si igual no
                            entran, los de avanzar bajan a un segundo renglón, a la derecha. */}
                        <DialogFooter className="px-3 sm:px-6 py-3 border-t bg-gray-50/50 flex-shrink-0">
                            <div className="flex flex-wrap items-center justify-between gap-2 w-full">
                                <div className="flex items-center gap-2 sm:gap-3">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handleAttemptClose}
                                        className="h-10 px-4 sm:px-8 hover:bg-white hover:text-red-600 hover:border-red-200 transition-colors"
                                    >
                                        Cancelar
                                    </Button>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        onClick={handlePrint}
                                        className="h-10 px-3 sm:px-5 gap-2 hover:bg-white hover:text-blue-600 hover:border-blue-200 transition-colors"
                                        title="Imprimir esta OT (procesos + materias primas)"
                                        aria-label="Imprimir"
                                    >
                                        <Printer className="w-4 h-4" />
                                        <span className="hidden sm:inline">Imprimir</span>
                                    </Button>
                                    {/* RF-22: la misma OT como archivo. El PDF es la hoja de
                                        «Imprimir»; Excel y CSV traen la orden, los procesos y las
                                        materias primas por separado. */}
                                    {(() => {
                                        const numero = String(orderToEdit?.id_otvieja || orderToEdit?.id || "Nueva");
                                        return (
                                            <ExportarMenu
                                                titulo={`Orden de trabajo N° ${numero}`}
                                                archivo={archivoDeOT({ numero })}
                                                secciones={() => seccionesDeOT(datosParaExportar())}
                                                filtros={null}
                                                rotulo="Exportar esta orden, como está en pantalla"
                                                pdf={async () => (await import("@/lib/exportes/otPdf")).pdfDeOT(datosParaExportar())}
                                                align="start"
                                                className="h-10 px-3 sm:px-4"
                                            />
                                        );
                                    })()}
                                </div>
                                <div className="flex gap-2 sm:gap-3 ml-auto">
                                    {activeTab !== "general" && (
                                        <Button
                                            key="prev-button"
                                            type="button"
                                            variant="outline"
                                            onClick={handlePrevStep}
                                            className="h-10 px-3 sm:px-6"
                                        >
                                            <ArrowLeft className="w-4 h-4 mr-2" />
                                            Anterior
                                        </Button>
                                    )}

                                    {/* Guardar se puede desde Procesos (como siempre) y también desde
                                        Planos e Historial: son las últimas solapas, y quedar ahí sin
                                        más botón que "Anterior" obliga a volver solo para apretar
                                        Guardar. En Historial, además, sin este botón el pie se
                                        quedaba mostrando un "Siguiente" que no llevaba a ningún lado. */}
                                    {soloLectura && (activeTab === "procesos" || activeTab === "planos" || activeTab === "historial") ? null
                                    : activeTab === "procesos" || activeTab === "planos" || activeTab === "historial" ? (
                                        <Button
                                            key="submit-button"
                                            type="submit"
                                            disabled={submitting || loading}
                                            className="h-10 px-4 sm:px-8 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02]"
                                        >
                                            {submitting ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : (
                                                <CheckCircle2 className="mr-2 h-4 w-4" />
                                            )}
                                            {orderToEdit ? "Guardar cambios" : "Crear Orden"}
                                        </Button>
                                    ) : (
                                        <Button
                                            key="next-button"
                                            type="button"
                                            onClick={handleNextStep}
                                            className="h-10 px-4 sm:px-8 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white shadow-lg shadow-blue-500/30 transition-all hover:scale-[1.02]"
                                        >
                                            Siguiente
                                            <ArrowRight className="ml-2 h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog >

            {/* «Traer historial» reemplaza la lista entera. Antes lo hacía sin avisar y
                el modal no tiene deshacer: ocho pasos cargados a mano se iban de una.
                Avisar, no bloquear — se dice qué se pierde y el botón lo hace igual. */}
            <Dialog open={historialPendiente !== null} onOpenChange={(v) => { if (!v) setHistorialPendiente(null); }}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Ya tenés procesos cargados</DialogTitle>
                    </DialogHeader>
                    <p className="text-sm text-gray-600 leading-relaxed">
                        Esta orden tiene{" "}
                        <strong>{processes.filter((p) => p.proceso_id).length} procesos</strong>{" "}
                        cargados. Traer el historial los <strong>reemplaza</strong> por los{" "}
                        <strong>{historialPendiente?.length ?? 0}</strong> del último trabajo de
                        este producto. Lo que cargaste a mano se pierde.
                    </p>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setHistorialPendiente(null)}>
                            Dejar los que tengo
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                const nuevos = historialPendiente ?? [];
                                setProcesses(nuevos);
                                setHistorialPendiente(null);
                                toast.success(`Se trajeron ${nuevos.length} procesos del historial. Destildá los que esta vez no van.`);
                            }}
                        >
                            Reemplazar por el historial
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    );
}
