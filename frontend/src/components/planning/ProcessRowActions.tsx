import React from "react";
import { Pencil, Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "@/lib/toast";
import { API_URL } from "@/config";
import { Input } from "@/components/ui/input";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { parseApiError } from "@/lib/utils";
import { usePermisos } from "@/hooks/usePermisos";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return {};
    const token = localStorage.getItem("access_token");
    return token ? { Authorization: `Bearer ${token}` } : {};
};

/**
 * Los minutos estimados, editables en su propia columna.
 *
 * Vivían atrás del lápiz de la columna ACCIONES, que está al otro extremo de la fila:
 * al tocarlo aparecía una cajita con un número lejos de la columna MIN. EST., y no se
 * entendía qué era — *"qué es esa edición poronga"* (Julián, 10/09/2026). El comentario
 * de acá abajo decía que mudarlo era «cirugía mayor en tres tablas»; resultó que la
 * fila de los minutos la usa una sola, así que se mudó.
 *
 * Se toca UNA pasada, por `id_otp`: el mismo proceso puede ir varias veces en la misma
 * orden. Y va sin `motivo`, porque esto NO es el planificador: el registro de cambios
 * tiene que decir que se editó desde la ficha de la orden.
 */
export function MinutosEditables({
    orderId, idOtp, nombre, minutos, onChanged,
}: {
    orderId: number;
    idOtp: number;
    nombre: string;
    minutos: number | null | undefined;
    onChanged: () => void;
}) {
    const [editando, setEditando] = React.useState(false);
    const [valor, setValor] = React.useState(String(minutos ?? ""));
    const [guardando, setGuardando] = React.useState(false);
    const cancelando = React.useRef(false);
    // RF-24: cambiar los minutos de un paso es editar la OT (solapa Órdenes).
    const { puedeSeccion } = usePermisos();
    const puedeEditar = puedeSeccion("operaciones_ordenes", "write");

    React.useEffect(() => {
        if (!editando) setValor(String(minutos ?? ""));
    }, [minutos, editando]);

    const guardar = async () => {
        const min = parseInt(valor, 10);
        if (isNaN(min) || min < 0) {
            toast.error("Poné los minutos como un número");
            return;
        }
        if (min === (minutos ?? -1)) { setEditando(false); return; }
        setGuardando(true);
        try {
            const res = await fetch(`${API_URL}/ordenes/${orderId}/procesos/linea/${idOtp}`, {
                method: "PUT",
                headers: { ...(getAuthHeaders() as Record<string, string>), "Content-Type": "application/json" },
                body: JSON.stringify({ tiempo_proceso: min }),
            });
            if (!res.ok) throw new Error(parseApiError(await res.text().catch(() => "")) || `error ${res.status}`);
            toast.success(`«${nombre}»: ${min} min`);
            setEditando(false);
            onChanged();
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "No se pudo guardar el proceso");
        } finally {
            setGuardando(false);
        }
    };

    if (!puedeEditar) {
        return (
            <span className="mx-auto flex h-6 items-center justify-center px-1.5 text-[10px] tabular-nums text-gray-500">
                {minutos || "-"}
            </span>
        );
    }

    if (editando) {
        return (
            <input
                autoFocus
                value={valor}
                inputMode="numeric"
                onChange={(e) => setValor(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); guardar(); }
                    if (e.key === "Escape") { cancelando.current = true; setEditando(false); }
                }}
                /* Salir del campo guarda, como en el resto de las tablas; Escape lo
                   descarta y frena ese guardado. */
                onBlur={() => {
                    if (cancelando.current) { cancelando.current = false; return; }
                    if (!guardando) guardar();
                }}
                className="mx-auto block h-6 w-14 rounded border border-blue-300 bg-white px-1 text-center text-[10px] tabular-nums outline-none focus:border-blue-500"
            />
        );
    }

    return (
        <button
            type="button"
            onClick={(e) => { e.stopPropagation(); cancelando.current = false; setEditando(true); }}
            title={`Minutos estimados de «${nombre}». Tocá para cambiarlos.`}
            className="mx-auto flex h-6 items-center justify-center gap-1 rounded px-1.5 text-[10px] tabular-nums text-gray-500 hover:bg-blue-50 hover:text-blue-700 transition-colors"
        >
            {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : (minutos || "-")}
            <Pencil className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover/proc:opacity-60" />
        </button>
    );
}

/**
 * Sacar un paso desde la propia lista de la OT (pedido de Julián, 3/9).
 *
 * Antes esto también editaba los minutos, atrás de un lápiz. Se mudaron a su propia
 * columna (`MinutosEditables`, acá arriba), que es donde alguien los va a buscar: acá
 * queda sólo lo que no tiene columna propia. El resto —máquina, persona— sigue estando
 * en el editor completo, que es donde están los desplegables.
 *
 * Se toca UNA pasada, por `id_otp`: el mismo proceso puede ir varias veces en la misma
 * orden y borrar por (orden, proceso) se llevaría puestas todas.
 */
export function ProcessRowActions({
    orderId,
    idOtp,
    idProceso,
    nombre,
    onChanged,
}: {
    orderId: number;
    idOtp: number;
    idProceso: number;
    nombre: string;
    onChanged: () => void;
}) {
    const [guardando, setGuardando] = React.useState(false);
    const [confirmarBorrado, setConfirmarBorrado] = React.useState(false);
    // RF-24: sacar un paso es editar la OT (solapa Órdenes). Sin eso, no hay botón.
    const { puedeSeccion } = usePermisos();
    const puedeEditar = puedeSeccion("operaciones_ordenes", "write");

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

    if (!puedeEditar) return <div aria-hidden />;

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
