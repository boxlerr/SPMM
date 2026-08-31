"use client"

/** Banco de pruebas de la pantalla de selección de OT. NO es parte del producto:
 *  sirve para reproducir a mano el comportamiento de los filtros sin backend. */
import { useMemo, useState } from "react"
import { PlanningSelectionScreen } from "@/components/planning/PlanningSelectionScreen"
import type { WorkOrder } from "@/lib/types"

const CLIENTES = ["CERAMICAS LOURDES S.A.", "METALURGICA DEL SUR", "AGRO NORTE SRL"]
const PRIORIDADES = ["URGENTE 1", "URGENTE 2", "NORMAL"]
const PROCESOS = ["Torno CNC", "Fresado", "Plegado", "Soldadura con MIG", "Amolado"]

const d = (offsetDias: number) => {
    const t = new Date(2026, 7, 31)
    t.setDate(t.getDate() + offsetDias)
    return t.toISOString().slice(0, 10)
}

const ORDENES: WorkOrder[] = Array.from({ length: 18 }, (_, i) => ({
    id: 9000 + i,
    id_otvieja: 15700 + i,
    observaciones: `Pieza de prueba ${i + 1}`,
    unidades: 5 + i * 3,
    fecha_entrada: d(-30 + i),
    // Las primeras 6 quedan atrasadas (fecha prometida ya pasada).
    fecha_prometida: i < 6 ? d(-5 - i) : d(3 + i),
    estado_material: "ok" as const,
    reclamo: i % 5 === 0 ? 1 : 0,
    prioridad: { id: (i % 3) + 1, descripcion: PRIORIDADES[i % 3] },
    cliente: { id: (i % 3) + 1, nombre: CLIENTES[i % 3] },
    sector: { id: 1, nombre: "PRODUCCION" },
    articulo: { id: i, cod_articulo: `ART-${1000 + i}`, descripcion: `Artículo ${i + 1}` },
    procesos: Array.from({ length: (i % 3) + 2 }, (_, j) => ({
        orden: j + 1,
        id: (9000 + i) * 100 + j,
        tiempo_proceso: 60 + j * 45,
        proceso: { id: j + 1, nombre: PROCESOS[(i + j) % PROCESOS.length] },
        estado_proceso: { id: 1, descripcion: "Pendiente" },
    })),
}))

const OPERARIOS = Array.from({ length: 4 }, (_, i) => ({
    id: i + 1, disponible: true, hora_inicio: "07:00", hora_fin: "16:00",
    min_desayuno: 15, min_almuerzo: 30,
}))

export default function ProbeSeleccion() {
    const [open, setOpen] = useState(true)
    const ordenes = useMemo(() => ORDENES, [])
    return (
        <PlanningSelectionScreen
            isOpen={open}
            onClose={() => setOpen(false)}
            unplannedOrders={ordenes}
            onPlan={(ids) => console.log("PLAN", ids)}
            initialSelectedIds={[]}
            autoSelectAll
            availableOperarios={OPERARIOS}
        />
    )
}
