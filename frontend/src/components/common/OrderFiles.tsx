import React from "react";
import { Trash2, UploadCloud } from "lucide-react";
import { API_URL } from "@/config";
import { toast } from "sonner";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { PlanoPanel, contarArchivos } from "./PlanoPanel";
import { FileViewerModal } from "./FileViewerModal";
import { olvidarPlano, type Plano } from "@/lib/planos";
import { invalidarOrdenesConPlano } from "@/hooks/useOrdenesConPlano";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === 'undefined') return {};
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

/**
 * De dónde cuelga el plano cuando el backend todavía no lo dice.
 *
 * El backend se deploya a mano y el front sale por Vercel: existe la ventana en la que
 * esta pantalla habla con la API vieja, que no manda `origen`. La fila igual trae
 * `id_articulo`, y con eso alcanza para no rotular todo como si fuera de la orden (y,
 * peor, ofrecer borrar el plano del producto desde acá).
 */
const conOrigen = (fila: any): Plano => ({
    ...fila,
    origen: fila?.origen ?? (fila?.id_articulo ? "articulo" : "ot"),
});

/**
 * Alto máximo de la galería adentro del desplegable.
 *
 * Antes las tarjetas se apilaban sueltas y la fila crecía con ellas: quince archivos
 * estiraban el desplegable tanto que para volver a la lista de OT había que scrollear la
 * página entera. Con un tope, el que scrollea es el panel y la fila mide lo mismo con un
 * archivo que con veinte.
 */
const ALTO_GALERIA = "max-h-80";

/**
 * El encabezado, que además dice de quién es cada cosa.
 *
 * PlanoPanel ya pone a la derecha QUÉ hay ("1 plano · 15 fotos"); lo que falta es de
 * DÓNDE cuelga, y eso no es un detalle: el archivo del producto lo comparten todas las OT
 * que fabrican el artículo, así que desde una orden no se saca. Contarlos a ojo tarjeta
 * por tarjeta era justamente lo que no se podía hacer con quince.
 */
function tituloSegunOrigen(planos: Plano[]): string {
    if (planos.length === 0) return "Archivos";
    const propios = planos.filter(p => p.origen === "ot").length;
    const delProducto = planos.length - propios;
    if (propios === 0) return "Archivos del producto";
    if (delProducto === 0) return "Archivos de esta orden";
    return `Archivos · ${propios} de esta orden y ${delProducto} del producto`;
}

/**
 * El final del nombre, que es lo único que distingue un archivo de otro.
 *
 * Los archivos de una pieza se llaman todos igual salvo el final —"Matriz 46x240x307mm de
 * 2 partes (1).jpg", "… (2).jpg"—, así que recortar por el final (que es lo que hace
 * `truncate`) deja una fila de chips idénticos. Se muestra la cola y se pierde el arranque,
 * que es el pedazo que ya se sabe de memoria.
 */
const colaDelNombre = (nombre: string, max = 26): string =>
    nombre.length <= max ? nombre : `…${nombre.slice(-max)}`;

// Component to fetch and display files for an order
interface OrderFilesProps {
    orderId: number;
    /**
     * Un solo renglón en vez de la galería.
     *
     * La lista de OT del Gantt monta esto AL LADO del título "Procesos asignados", dentro
     * de un renglón de 10px pensado para algo diminuto. Con la galería completa, una OT
     * sin archivos metía un recuadro de ~110px y una con quince metía 320px adentro de ese
     * renglón: el encabezado dejaba de ser un encabezado. Acá se dice qué hay y se abre en
     * el visor, que es lo que sirve mientras se mira el Gantt.
     */
    resumen?: boolean;
}

export const OrderFiles = ({ orderId, resumen = false }: OrderFilesProps) => {
    const [files, setFiles] = React.useState<Plano[]>([]);
    const [loading, setLoading] = React.useState(true);
    const [isUploading, setIsUploading] = React.useState(false);
    // Solo lo usa la variante `resumen`: ahí no hay galería, así que el visor lo abre
    // este componente. En la variante normal el visor lo pone PlanoPanel.
    const [viendo, setViendo] = React.useState<number | null>(null);
    const [fileToDelete, setFileToDelete] = React.useState<{ id: number, name: string } | null>(null);

    const fetchFiles = React.useCallback(async () => {
        if (!orderId) return;
        try {
            // Add timestamp to prevent caching issues
            const res = await fetch(`${API_URL}/planos/orden/${orderId}?t=${Date.now()}`, { headers: getAuthHeaders() });
            if (res.ok) {
                const json = await res.json();
                setFiles(Array.isArray(json?.data) ? json.data.map(conOrigen) : []);
            } else {
                console.error("Failed to fetch files");
            }
        } catch (err) {
            console.error("Error loading files", err);
        } finally {
            setLoading(false);
        }
    }, [orderId]);

    React.useEffect(() => {
        fetchFiles();
    }, [fetchFiles]);

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;

        setIsUploading(true);
        const selectedFiles = Array.from(e.target.files);

        try {
            let successCount = 0;
            for (const file of selectedFiles) {
                const formData = new FormData();
                formData.append('nombre', file.name);
                formData.append('tipo_archivo', file.type);
                formData.append('id_orden_trabajo', orderId.toString());
                formData.append('archivo', file);

                const res = await fetch(`${API_URL}/planos`, {
                    method: "POST",
                    headers: getAuthHeaders(),
                    body: formData
                });

                if (res.ok) successCount++;
            }

            if (successCount > 0) {
                toast.success(`${successCount} archivo(s) subido(s) correctamente`);
                // La lista de OTs con plano está cacheada a nivel de módulo y decide la
                // columna Plano de las tablas de planificación: sin tirarla, la OT sigue
                // apareciendo como "marcada sin archivo" después de subirlo.
                invalidarOrdenesConPlano();
                await fetchFiles();
            } else {
                toast.error("Error al subir archivos");
            }
        } catch (error) {
            console.error("Upload error:", error);
            toast.error("Error al subir archivos");
        } finally {
            setIsUploading(false);
            // Reset input
            e.target.value = '';
        }
    };

    const handleDeleteFile = (fileId: number, fileName: string) => {
        setFileToDelete({ id: fileId, name: fileName });
    };

    const confirmDelete = async () => {
        if (!fileToDelete) return;

        try {
            const res = await fetch(`${API_URL}/planos/${fileToDelete.id}`, {
                method: "DELETE",
                headers: getAuthHeaders()
            });

            if (res.ok) {
                toast.success("Archivo eliminado");
                setFiles(prev => prev.filter(f => f.id !== fileToDelete.id));
                // El archivo y su miniatura quedan guardados por id: si no se olvidan,
                // un plano nuevo en la misma pantalla podría mostrar el dibujo borrado.
                olvidarPlano(fileToDelete.id);
                invalidarOrdenesConPlano();
            } else {
                throw new Error("Failed to delete");
            }
        } catch (error) {
            console.error("Delete error:", error);
            toast.error("Error al eliminar archivo");
        } finally {
            setFileToDelete(null);
        }
    };

    // Los del producto no se listan acá: el botón de sacar existe solo para los que se
    // subieron a esta orden.
    const propios = files.filter(f => f.origen === "ot");

    if (resumen) {
        const c = contarArchivos(files);
        return (
            <>
                <FileViewerModal
                    isOpen={viendo !== null}
                    onClose={() => setViendo(null)}
                    file={viendo !== null ? files[viendo] ?? null : null}
                    planos={files}
                    indice={viendo ?? 0}
                    onIndiceChange={setViendo}
                />
                {loading ? (
                    <span className="text-[10px] text-gray-400">buscando planos…</span>
                ) : files.length === 0 ? (
                    <span className="text-[10px] text-gray-400">sin planos</span>
                ) : (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.stopPropagation();
                            setViendo(0);
                        }}
                        title="Ver los planos y fotos de esta orden"
                        className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 hover:underline"
                    >
                        {c.resumen}
                    </button>
                )}
            </>
        );
    }

    return (
        <div className="mt-2 mb-2 min-w-0 flex flex-col gap-2">
            <ConfirmationDialog
                isOpen={!!fileToDelete}
                onClose={() => setFileToDelete(null)}
                onConfirm={confirmDelete}
                title="Eliminar Archivo"
                description={`¿Estás seguro de eliminar el archivo "${fileToDelete?.name}"? Esta acción no se puede deshacer.`}
                confirmText="Eliminar"
                cancelText="Cancelar"
                variant="destructive"
            />

            {/* La misma galería que la solapa Planos y que la carga de procesos: planos
                primero, cada tarjeta rotulada Plano o Foto, y el aviso cuando de un producto
                solo hay fotos. Acá va con alto para que scrollee adentro del desplegable. */}
            <PlanoPanel
                planos={files}
                cargando={loading}
                titulo={tituloSegunOrigen(files)}
                alto={ALTO_GALERIA}
                vacioTexto="Esta orden no tiene planos ni fotos, ni propios ni del producto."
            />

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative group inline-flex">
                    <input
                        type="file"
                        multiple
                        accept="image/*,.pdf"
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-wait"
                        onChange={handleFileUpload}
                        disabled={isUploading}
                    />
                    <div className="flex items-center gap-1.5 py-1 px-2 border border-dashed border-gray-300 rounded-lg hover:border-blue-400 hover:bg-blue-50/50 transition-all">
                        <UploadCloud className="w-3 h-3 text-gray-400 group-hover:text-blue-500" />
                        <span className="text-[10px] text-gray-500 group-hover:text-blue-600">
                            {isUploading ? "Subiendo…" : "Subir planos o fotos"}
                        </span>
                    </div>
                </div>

                {/* Las tarjetas de la galería no traen botón de borrar a propósito: el plano
                    del producto lo comparten TODAS las OT que lo fabrican y borrarlo desde
                    una orden se lo saca a las demás (eso se hace en la ficha del producto).
                    Acá abajo aparecen únicamente los que se subieron a ESTA orden, que son
                    los únicos que se pueden sacar sin arrastrar a nadie. */}
                {propios.map((file) => (
                    <span
                        key={file.id}
                        title={file.nombre}
                        className="inline-flex items-center gap-1 max-w-[200px] rounded-full bg-slate-100 border border-slate-200 pl-2 pr-0.5 py-0.5 text-[10px] text-slate-600"
                    >
                        <span className="truncate">{colaDelNombre(file.nombre)}</span>
                        <button
                            type="button"
                            onClick={() => handleDeleteFile(file.id, file.nombre)}
                            className="p-1 rounded-full text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                            title={`Sacar ${file.nombre} de esta orden`}
                        >
                            <Trash2 className="w-3 h-3" />
                        </button>
                    </span>
                ))}
            </div>
        </div>
    );
};
