"use client";

/**
 * Primera vez que alguien entra: elige una contraseña suya antes de ver el sistema.
 *
 * La inicial se la pasa quien lo da de alta, por WhatsApp o de palabra, así que hasta
 * que la cambie está escrita en algún lado. Pedido de Julián el 2/9 al dar de alta a
 * Matías: «apenas se loguee tiene que aparecerle la pantalla de cambiar contraseña,
 * obligarlo a poner una de él».
 *
 * No es una ruta: se dibuja en lugar del sistema entero desde el AuthGuard. Desde una
 * ruta se puede volver atrás o escribir otra en la barra; desde acá no hay a dónde ir.
 * La única salida sin cambiarla es cerrar sesión.
 */

import { useState } from "react";
import { Eye, EyeOff, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { API_URL } from "@/config";
import { parseApiError } from "@/lib/utils";

const MINIMO = 6;

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return { "Content-Type": "application/json" };
    const token = localStorage.getItem("access_token");
    return token
        ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
        : { "Content-Type": "application/json" };
};

export default function PrimerIngreso({ onListo }: { onListo: () => void }) {
    const { user, logout } = useAuth();
    const [actual, setActual] = useState("");
    const [nueva, setNueva] = useState("");
    const [repetir, setRepetir] = useState("");
    const [ver, setVer] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const motivo =
        !actual ? "Escribí la contraseña con la que entraste"
            : nueva.length < MINIMO ? `La nueva tiene que tener al menos ${MINIMO} caracteres`
                : nueva !== repetir ? "Las dos veces que escribiste la nueva no coinciden"
                    : nueva === actual ? "La nueva tiene que ser distinta de la que te pasaron"
                        : null;

    const guardar = async () => {
        if (motivo) return;
        setGuardando(true);
        setError(null);
        try {
            const res = await fetch(`${API_URL}/change-password`, {
                method: "POST",
                headers: getAuthHeaders(),
                body: JSON.stringify({
                    current_password: actual,
                    new_password: nueva,
                    confirm_password: repetir,
                }),
            });
            if (!res.ok) {
                setError(parseApiError(await res.text().catch(() => "")) || "No se pudo cambiar la contraseña");
                return;
            }
            // El flag vive en el usuario guardado: se apaga acá y el guard deja pasar
            // sin obligar a volver a entrar.
            try {
                const guardado = localStorage.getItem("user");
                if (guardado) {
                    const u = JSON.parse(guardado);
                    u.debe_cambiar_password = false;
                    localStorage.setItem("user", JSON.stringify(u));
                }
            } catch { /* si no se puede escribir, se lo vuelve a pedir la próxima */ }
            onListo();
        } catch {
            setError("No se pudo cambiar la contraseña");
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
            <div className="w-full max-w-md rounded-xl border bg-white p-6 shadow-sm">
                <div className="mb-1 flex items-center gap-2 text-red-700">
                    <KeyRound className="h-5 w-5" />
                    <h1 className="text-lg font-bold">Elegí tu contraseña</h1>
                </div>
                <p className="mb-5 text-sm text-gray-600">
                    {user?.nombre ? `Hola ${user.nombre}. ` : ""}
                    Entraste con una contraseña que te pasaron. Poné una tuya para empezar a
                    usar el sistema — es la única vez que te lo vamos a pedir.
                </p>

                <div className="space-y-3">
                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">
                            La contraseña con la que entraste
                        </label>
                        <Input
                            type={ver ? "text" : "password"}
                            value={actual}
                            onChange={(e) => setActual(e.target.value)}
                            autoComplete="current-password"
                            autoFocus
                        />
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Tu contraseña nueva</label>
                        <div className="relative">
                            <Input
                                type={ver ? "text" : "password"}
                                value={nueva}
                                onChange={(e) => setNueva(e.target.value)}
                                autoComplete="new-password"
                                placeholder={`Al menos ${MINIMO} caracteres`}
                                className="pr-9"
                            />
                            <button
                                type="button"
                                onClick={() => setVer((v) => !v)}
                                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-700"
                                aria-label={ver ? "Ocultar contraseñas" : "Ver contraseñas"}
                            >
                                {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="mb-1 block text-xs font-medium text-gray-600">Repetila</label>
                        <Input
                            type={ver ? "text" : "password"}
                            value={repetir}
                            onChange={(e) => setRepetir(e.target.value)}
                            autoComplete="new-password"
                            onKeyDown={(e) => { if (e.key === "Enter" && !motivo) void guardar(); }}
                        />
                    </div>

                    {error && (
                        <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                            {error}
                        </p>
                    )}

                    <Button onClick={guardar} disabled={!!motivo || guardando} className="w-full">
                        {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Guardar y entrar
                    </Button>
                    {motivo && <p className="text-center text-xs text-gray-500">{motivo}</p>}

                    <button
                        type="button"
                        onClick={logout}
                        className="w-full pt-1 text-center text-xs text-gray-400 hover:text-gray-600"
                    >
                        Salir sin cambiarla
                    </button>
                </div>
            </div>
        </div>
    );
}
