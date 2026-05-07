import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Clock, CalendarPlus, Zap, ArrowRight } from "lucide-react"

export interface SugerenciaOpcion {
    tipo: "he" | "sabado" | "ambos"
    descripcion: string
    capacidad_extra_min_semana: number
}

export interface SugerenciaPayload {
    motivo: string
    minutos_faltantes: number
    cantidad_urgentes_excedentes: number
    opciones: SugerenciaOpcion[]
}

export type SugerenciaAccion =
    | { tipo: "habilitar"; permitir_he: boolean; permitir_sabado: boolean }
    | { tipo: "aceptar_parcial" }
    | { tipo: "cancelar" }

interface OvertimeSuggestionModalProps {
    isOpen: boolean
    sugerencia: SugerenciaPayload | null
    onResolver: (accion: SugerenciaAccion) => void
    isReplanning?: boolean
}

const formatMin = (min: number) => {
    const h = Math.floor(min / 60)
    const m = min % 60
    if (h && m) return `${h}h ${m}min`
    if (h) return `${h}h`
    return `${m}min`
}

const iconoPorTipo = (tipo: SugerenciaOpcion["tipo"]) => {
    if (tipo === "he") return <Clock className="h-5 w-5 text-amber-600" />
    if (tipo === "sabado") return <CalendarPlus className="h-5 w-5 text-blue-600" />
    return <Zap className="h-5 w-5 text-purple-600" />
}

const flagsPorTipo = (tipo: SugerenciaOpcion["tipo"]): { permitir_he: boolean; permitir_sabado: boolean } => {
    if (tipo === "he") return { permitir_he: true, permitir_sabado: false }
    if (tipo === "sabado") return { permitir_he: false, permitir_sabado: true }
    return { permitir_he: true, permitir_sabado: true }
}

export function OvertimeSuggestionModal({
    isOpen,
    sugerencia,
    onResolver,
    isReplanning = false,
}: OvertimeSuggestionModalProps) {
    if (!sugerencia) return null

    return (
        <Dialog open={isOpen} onOpenChange={(open) => { if (!open && !isReplanning) onResolver({ tipo: "cancelar" }) }}>
            <DialogContent className="max-w-2xl">
                <DialogHeader>
                    <div className="flex items-start gap-3">
                        <div className="h-10 w-10 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
                            <AlertTriangle className="h-5 w-5 text-amber-600" />
                        </div>
                        <div>
                            <DialogTitle className="text-base">Capacidad insuficiente para urgencias</DialogTitle>
                            <DialogDescription className="mt-1">
                                {sugerencia.motivo}. Faltan{" "}
                                <span className="font-semibold text-gray-900">{formatMin(sugerencia.minutos_faltantes)}</span>{" "}
                                de trabajo de prioridad alta.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>

                <div className="space-y-2 py-2">
                    <p className="text-sm text-gray-600">
                        Para que entren las urgencias podés habilitar capacidad extra:
                    </p>

                    <div className="grid gap-2">
                        {sugerencia.opciones.map((op) => {
                            const flags = flagsPorTipo(op.tipo)
                            return (
                                <button
                                    key={op.tipo}
                                    type="button"
                                    disabled={isReplanning}
                                    onClick={() => onResolver({ tipo: "habilitar", ...flags })}
                                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 hover:border-gray-300 transition-colors text-left disabled:opacity-60 disabled:cursor-not-allowed"
                                >
                                    <div className="flex items-center gap-3">
                                        {iconoPorTipo(op.tipo)}
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">{op.descripcion}</div>
                                            <div className="text-xs text-gray-500">
                                                +{formatMin(op.capacidad_extra_min_semana)} de capacidad por semana
                                            </div>
                                        </div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-gray-400" />
                                </button>
                            )
                        })}
                    </div>
                </div>

                <DialogFooter className="flex-col sm:flex-row gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => onResolver({ tipo: "cancelar" })}
                        disabled={isReplanning}
                    >
                        Cancelar
                    </Button>
                    <Button
                        variant="outline"
                        onClick={() => onResolver({ tipo: "aceptar_parcial" })}
                        disabled={isReplanning}
                    >
                        Aceptar plan parcial
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
