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
            <div className="flex items-center gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                <Input
                    autoFocus
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") guardar();
                        if (e.key === "Escape") setEditando(false);
                    }}
                    className="h-6 w-16 text-[10px] px-1.5 text-center tabular-nums"
                    placeholder="min"
                />
                <button
                    onClick={guardar}
                    disabled={guardando}
                    className="p-1 rounded text-green-600 hover:bg-green-50 disabled:opacity-50"
                    title="Guardar los minutos"
                >
                    {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                </button>
                <button
                    onClick={() => setEditando(false)}
                    className="p-1 rounded text-gray-400 hover:bg-gray-100"
                    title="Cancelar"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
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
                className="flex items-center gap-0.5 justify-end opacity-0 group-hover/proc:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    onClick={() => setEditando(true)}
                    className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                    title="Cambiar los minutos de este proceso"
                >
                    <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={() => setConfirmarBorrado(true)}
                    className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                    title="Sacar este proceso de la orden"
                >
                    <Trash2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </>
    );
}
