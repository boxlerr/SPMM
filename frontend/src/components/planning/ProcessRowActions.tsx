import React from "react";
import { Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { API_URL } from "@/config";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { parseApiError } from "@/lib/utils";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Editar y eliminar un paso desde la propia lista de la OT (pedido de Julián, 3/9).
 *
 * Hasta ahora la fila del proceso era de sólo lectura: para cambiarle los minutos
 * había que abrir la OT entera, ir a la solapa 3 y guardar todo, y para sacar un paso
 * no había forma desde acá. Se edita lo que se ve en la fila —los minutos estimados—
 * y el resto (máquina, persona) sigue estando en el editor completo, que es donde
 * están los desplegables.
 *
 * Se toca UNA pasada, por `id_otp`: el mismo proceso puede ir varias veces en la misma
 * orden y borrar por (orden, proceso) se llevaría puestas todas.
 */
export function ProcessRowActions({
    orderId,
    idOtp,
    idProceso,
    nombre,
    minutos,
    onChanged,
}: {
    orderId: number;
    idOtp: number;
    idProceso: number;
    nombre: string;
    minutos: number | null | undefined;
    onChanged: () => void;
}) {
    const [editando, setEditando] = React.useState(false);
    const [valor, setValor] = React.useState(String(minutos ?? ""));
    const [guardando, setGuardando] = React.useState(false);
    const [confirmarBorrado, setConfirmarBorrado] = React.useState(false);

    React.useEffect(() => {
        if (!editando) setValor(String(minutos ?? ""));
    }, [minutos, editando]);

    const guardar = async () => {
        const min = parseInt(valor, 10);
        if (isNaN(min) || min < 0) {
            toast.error("Poné los minutos como un número");
            return;
        }
        setGuardando(true);
        try {
            const res = await fetch(`${API_URL}/ordenes/${orderId}/procesos/linea/${idOtp}`, {
                method: "PUT",
                headers: { ...(getAuthHeaders() as Record<string, string>), "Content-Type": "application/json" },
                body: JSON.stringify({ tiempo_proceso: min }),
            });
            if (!res.ok) {
                throw new Error(parseApiError(await res.text().catch(() => "")) || `error ${res.status}`);
            }
            toast.success(`«${nombre}»: ${min} min`);
            setEditando(false);
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "No se pudo guardar el proceso");
        } finally {
            setGuardando(false);
        }
    };

    /**
     * Cancelar de verdad.
     *
     * El campo guarda al perder el foco, y cerrar el editor lo DESMONTA: el navegador
     * manda el blur de salida, `guardar()` corre igual y termina guardando justo lo
     * que se quiso tirar. El `onMouseDown` de los botones tapa el blur ANTERIOR al
     * click, que es otro choque distinto — y a Escape, que no pasa por ningún botón,
     * no lo tapa nada.
     *
     * La bandera dura lo que dura el desmonte. Es la misma forma que usa el editor de
     * «Inicio Estimado» en PlanningListTable, por la misma razón.
     */
    const cancelando = React.useRef(false);
    const cancelar = () => {
        cancelando.current = true;
        setEditando(false);
    };

    const borrar = async () => {
        setGuardando(true);
        try {
            const res = await fetch(
                `${API_URL}/ordenes/${orderId}/procesos/${idProceso}?id_otp=${idOtp}`,
                { method: "DELETE", headers: getAuthHeaders() }
            );
            if (!res.ok) {
                throw new Error(parseApiError(await res.text().catch(() => "")) || `error ${res.status}`);
            }
            toast.success(`Se sacó «${nombre}» de la orden`);
            setConfirmarBorrado(false);
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "No se pudo sacar el proceso");
        } finally {
            setGuardando(false);
        }
    };

    if (editando) {
        return (
            /* La columna de ACCIONES mide 70px y el editor pide más del doble: el rótulo,
               el campo y los dos botones. Inline se desbordaba de la celda y se montaba
               sobre la columna de al lado, porque la fila no recorta nada.
               Sale del flujo y se ancla al borde derecho de la celda: crece hacia la
               izquierda, por encima de la fila, y queda contenido por la tarjeta de
               Producción, que sí recorta. La celda conserva sus 70px y ninguna columna se
               corre cuando aparece el editor. */
            <div className="relative flex h-6 items-center justify-end" onClick={(e) => e.stopPropagation()}>
                <div className="absolute right-0 top-1/2 z-20 flex -translate-y-1/2 items-center gap-1 rounded-md border border-blue-200 bg-white px-1.5 py-1 shadow-md">
                    {/* El rótulo no es decoración. El input aparece en la columna ACCIONES,
                        o sea lejos de la columna MIN. EST. que es la que se está editando:
                        salía una cajita con un número en un lugar que no tiene nada que ver
                        con minutos, y no se entendía qué era ("qué es esa edición poronga",
                        Julián 10/09). Mover el editor a su columna es cirugía mayor en tres
                        tablas; decir qué es cuesta una palabra. */}
                    <span className="text-[10px] font-semibold uppercase tracking-tight text-gray-400">
                        Min.
                    </span>
                    <Input
                        autoFocus
                        value={valor}
                        onChange={(e) => setValor(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") guardar();
                            if (e.key === "Escape") cancelar();
                        }}
                        /* Salir del campo guarda, como en el resto de las tablas. Antes había
                           que acertarle al tilde: hacer click en cualquier otro lado tiraba
                           lo escrito sin decir nada. */
                        onBlur={() => {
                            if (cancelando.current) { cancelando.current = false; return; }
                            if (!guardando) guardar();
                        }}
                        className="h-6 w-16 text-[10px] px-1.5 text-center tabular-nums"
                        placeholder="min"
                    />
                    {/* Los dos botones frenan el `mousedown`, y no es un detalle: el campo
                        guarda al perder el foco, y el blur llega ANTES que el click. Con la
                        cruz eso era directamente al revés de lo que dice el cartel —apretar
                        Cancelar guardaba justo lo que se quería tirar—; con el tilde salían
                        dos guardados por un click. Si el foco no se mueve no hay blur, y cada
                        botón hace lo único que promete. */}
                    <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={guardar}
                        disabled={guardando}
                        className="p-1 rounded text-green-600 hover:bg-green-50 disabled:opacity-50"
                        title="Guardar los minutos (o apretá Enter)"
                    >
                        {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={cancelar}
                        className="p-1 rounded text-gray-400 hover:bg-gray-100"
                        title="Cancelar (o apretá Escape)"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <>
            <ConfirmationDialog
                isOpen={confirmarBorrado}
                onClose={() => setConfirmarBorrado(false)}
                onConfirm={borrar}
                title="Sacar el proceso de la orden"
                description={`Se va a sacar «${nombre}» de esta OT, con el trabajo que tenga cargado (estado y avance). Si la orden estaba planificada, hay que volver a planificarla.`}
                confirmText="Sí, sacarlo"
                cancelText="Volver"
                variant="destructive"
            />
            <div
                /* Los botones se ven SIEMPRE, apenas marcados. Antes vivían en
                   `opacity-0` hasta pasar el mouse: no había forma de saber que la fila
                   era editable salvo tropezársela. Atenuados no hacen ruido, y con el
                   mouse encima toman color. */
                className="flex items-center gap-0.5 justify-end text-gray-300 group-hover/proc:text-gray-500 transition-colors"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={() => (cancelando.current = false, setEditando(true))}
                    className="p-1 rounded text-current hover:text-blue-600 hover:bg-blue-50"
                    title="Cambiar los minutos estimados de este proceso"
                >
                    <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={() => setConfirmarBorrado(true)}
                    className="p-1 rounded text-current hover:text-red-600 hover:bg-red-50"
                    title="Sacar este proceso de la orden"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </>
    );
}
