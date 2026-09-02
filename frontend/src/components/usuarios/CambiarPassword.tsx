"use client";

/**
 * Cambiar la propia contraseña.
 *
 * El endpoint existía desde siempre (`POST /change-password`) pero no había pantalla,
 * así que en los hechos nadie podía cambiarla: al que entraba por primera vez le
 * quedaba para siempre la que le habían pasado por WhatsApp. Aparece cuando se le da
 * de alta a alguien nuevo — el 2/9 con Matías.
 *
 * Pide la actual además de la nueva: es lo que evita que alguien que se encontró una
 * sesión abierta se quede con la cuenta.
 */

import { useState } from "react";
import { Eye, EyeOff, Loader2, KeyRound, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { API_URL } from "@/config";
import { parseApiError } from "@/lib/utils";

const getAuthHeaders = (): HeadersInit => {
    if (typeof window === "undefined") return { "Content-Type": "application/json" };
    const token = localStorage.getItem("access_token");
    return token
        ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
        : { "Content-Type": "application/json" };
};

const MINIMO = 6;

export default function CambiarPassword() {
    const [actual, setActual] = useState("");
    const [nueva, setNueva] = useState("");
    const [repetir, setRepetir] = useState("");
    const [ver, setVer] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const [listo, setListo] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // El motivo se calcula acá y no al apretar: el botón apagado sin decir por qué es
    // lo que hace que uno pruebe tres veces y se vaya.
    const motivo =
        !actual ? "Escribí tu contraseña actual"
            : nueva.length < MINIMO ? `La nueva tiene que tener al menos ${MINIMO} caracteres`
                : nueva !== repetir ? "Las dos veces que escribiste la nueva no coinciden"
                    : nueva === actual ? "La nueva tiene que ser distinta de la actual"
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
            setListo(true);
            setActual(""); setNueva(""); setRepetir("");
        } catch {
            setError("No se pudo cambiar la contraseña");
        } finally {
            setGuardando(false);
        }
    };

    if (listo) {
        return (
            <div className="max-w-md rounded-lg border border-green-200 bg-green-50 p-4">
                <div className="flex items-start gap-3">
                    <Check className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
                    <div>
                        <p className="text-sm font-semibold text-green-900">Contraseña cambiada</p>
                        <p className="mt-1 text-sm text-green-800">
                            La próxima vez que entres, usá la nueva. La sesión de ahora sigue abierta.
                        </p>
                        <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => setListo(false)}
                        >
                            Cambiarla de nuevo
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-md space-y-3">
            <div className="flex items-center gap-2 text-gray-700">
                <KeyRound className="h-4 w-4" />
                <span className="text-sm font-semibold">Cambiar mi contraseña</span>
            </div>
            <p className="text-sm text-gray-500">
                Si entraste con una contraseña que te pasaron, cambiala acá por una tuya.
            </p>

            <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">Contraseña actual</label>
                <Input
                    type={ver ? "text" : "password"}
                    value={actual}
                    onChange={(e) => setActual(e.target.value)}
                    autoComplete="current-password"
                    placeholder="La que usaste para entrar"
                />
            </div>

            <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">Contraseña nueva</label>
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
                        title={ver ? "Ocultar" : "Ver lo que escribo"}
                    >
                        {ver ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                </div>
            </div>

            <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">Repetí la nueva</label>
                <Input
                    type={ver ? "text" : "password"}
                    value={repetir}
                    onChange={(e) => setRepetir(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Para no equivocarte"
                />
            </div>

            {error && (
                <p className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
            )}

            <div className="flex items-center gap-3 pt-1">
                <Button onClick={guardar} disabled={!!motivo || guardando}>
                    {guardando && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Cambiar contraseña
                </Button>
                {motivo && <span className="text-xs text-gray-500">{motivo}</span>}
            </div>
        </div>
    );
}
