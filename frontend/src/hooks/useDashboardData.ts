import { useState, useEffect, useCallback } from "react"
import {
    EstadisticasOrdenes,
    OrdenCritica,
    TimelineItem,
    TopCliente,
    DistribucionPrioridad,
    TopArticulo,
    OrdenPrioridad,
    OrdenEstado,
} from "@/components/dashboard/types"
import { API_URL } from "@/config"
import { useAuth } from "@/contexts/AuthContext"
import type { TarjetaCodigo } from "@/lib/permisos"

const getAuthHeaders = (): HeadersInit => {
    const token = localStorage.getItem('access_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
};

/**
 * Los datos del Dashboard, pedidos SÓLO para las tarjetas que se ven (RF-28).
 *
 * `visibles` son las tarjetas de las áreas que la persona puede leer (tarjetasVisibles,
 * lib/permisos.ts). Una tarjeta que no se ve no se pide: el backend la contestaría 403 y
 * saldría el aviso «No tenés permiso» con sólo abrir el Dashboard. Si una tarjeta aparece
 * después (le dieron el área y se refrescaron los permisos), se pide en ese momento.
 *
 * Ya no se pide /api/dashboard/tiempo-promedio: no lo muestra ninguna tarjeta (se pedía y
 * se tiraba), y desde RF-28 pide Operaciones.
 */
export function useDashboardData(visibles: readonly TarjetaCodigo[]) {
    const apiUrl = API_URL
    const { notifySessionExpired } = useAuth()

    const veEstado = visibles.includes("estado_ordenes")
    const veCriticas = visibles.includes("ordenes_criticas")
    const veTimeline = visibles.includes("timeline_entregas")
    const veClientes = visibles.includes("top_clientes")
    const vePrioridades = visibles.includes("distribucion_prioridades")
    const veArticulos = visibles.includes("top_articulos")

    const [estadisticas, setEstadisticas] = useState<EstadisticasOrdenes | null>(null)
    const [ordenesCriticas, setOrdenesCriticas] = useState<OrdenCritica[]>([])
    const [timelineEntregas, setTimelineEntregas] = useState<TimelineItem[]>([])
    const [topClientes, setTopClientes] = useState<TopCliente[]>([])
    const [distribucionPrioridades, setDistribucionPrioridades] = useState<DistribucionPrioridad[]>([])
    const [topArticulos, setTopArticulos] = useState<TopArticulo[]>([])

    const [loading, setLoading] = useState(true)
    const [loadingCriticas, setLoadingCriticas] = useState(true)
    const [loadingTimeline, setLoadingTimeline] = useState(true)
    const [loadingExtras, setLoadingExtras] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [selectedPriority, setSelectedPriority] = useState<string | null>(null)
    const [priorityOrders, setPriorityOrders] = useState<OrdenPrioridad[]>([])
    const [loadingPriorityOrders, setLoadingPriorityOrders] = useState(false)

    const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
    const [statusOrders, setStatusOrders] = useState<OrdenEstado[]>([])
    const [loadingStatusOrders, setLoadingStatusOrders] = useState(false)
    // Si la lista no se pudo traer se dice, en vez de mostrarla vacía como si no hubiera
    // ninguna: con el backend de antes de RF-02, Pendientes y Retrasadas fallaban siempre
    // (GETDATE en Postgres) y la tarjeta decía 40 pero la lista «no hay órdenes».
    const [errorStatusOrders, setErrorStatusOrders] = useState<string | null>(null)

    const fetchWithAuth = useCallback(async (endpoint: string) => {
        const response = await fetch(`${apiUrl}${endpoint}`, { headers: getAuthHeaders() })

        if (response.status === 401) {
            console.warn(`[useDashboardData] 401 Unauthorized at ${endpoint}. Notifying user...`)
            notifySessionExpired()
            // Return a dummy response to prevent crashes in calling functions
            return new Response(JSON.stringify({ data: [] }), { status: 401 })
        }

        return response
    }, [apiUrl, notifySessionExpired])

    const fetchEstadisticas = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const response = await fetchWithAuth("/api/dashboard/estadisticas")
            if (!response.ok) throw new Error("Error al cargar estadísticas")
            const data = await response.json()
            // El backend responde 200 con success=false si la query falla:
            // sin este chequeo el spinner queda girando para siempre.
            if (!data.success || !data.data) {
                throw new Error(data.error || "Error al cargar estadísticas")
            }
            setEstadisticas(data.data)
        } catch (err) {
            const msg = err instanceof Error ? err.message : "Error desconocido"
            if (msg !== "Sesión expirada") {
                setError(msg)
                console.error("Error fetching estadisticas:", err)
            }
        } finally {
            setLoading(false)
        }
    }, [fetchWithAuth])

    const fetchOrdenesCriticas = useCallback(async () => {
        try {
            setLoadingCriticas(true)
            const response = await fetchWithAuth("/api/dashboard/ordenes-criticas")
            if (!response.ok) throw new Error("Error al cargar órdenes críticas")
            const data = await response.json()
            setOrdenesCriticas(data.data || [])
        } catch (err) {
            console.error("Error fetching ordenes criticas:", err)
        } finally {
            setLoadingCriticas(false)
        }
    }, [fetchWithAuth])


    const fetchTimelineEntregas = useCallback(async () => {
        try {
            setLoadingTimeline(true)
            const response = await fetchWithAuth("/api/dashboard/timeline-entregas")
            if (!response.ok) throw new Error("Error al cargar timeline")
            const data = await response.json()
            setTimelineEntregas(data.data || [])
        } catch (err) {
            console.error("Error fetching timeline:", err)
        } finally {
            setLoadingTimeline(false)
        }
    }, [fetchWithAuth])

    const fetchTopClientes = useCallback(async () => {
        try {
            const response = await fetchWithAuth("/api/dashboard/clientes-mayor-volumen")
            if (!response.ok) throw new Error("Error al cargar top clientes")
            const data = await response.json()
            setTopClientes(data.data || [])
        } catch (err) {
            console.error("Error fetching top clientes:", err)
        }
    }, [fetchWithAuth])

    const fetchDistribucionPrioridades = useCallback(async () => {
        try {
            const response = await fetchWithAuth("/api/dashboard/distribucion-prioridades")
            if (!response.ok) throw new Error("Error al cargar prioridades")
            const data = await response.json()
            setDistribucionPrioridades(data.data || [])
        } catch (err) {
            console.error("Error fetching prioridades:", err)
        }
    }, [fetchWithAuth])

    const fetchTopArticulos = useCallback(async () => {
        try {
            const response = await fetchWithAuth("/api/dashboard/top-articulos")
            if (!response.ok) throw new Error("Error al cargar artículos")
            const data = await response.json()
            setTopArticulos(data.data || [])
        } catch (err) {
            console.error("Error fetching articulos:", err)
        }
    }, [fetchWithAuth])

    const fetchOrdenesPorPrioridad = useCallback(
        async (prioridad: string) => {
            try {
                console.log("Fetching orders for priority:", prioridad)
                setLoadingPriorityOrders(true)
                setSelectedPriority(prioridad)
                const endpoint = `/api/dashboard/ordenes-por-prioridad/${encodeURIComponent(prioridad)}`
                console.log("Fetch URL:", endpoint)

                const response = await fetchWithAuth(endpoint)
                if (!response.ok) throw new Error("Error al cargar órdenes por prioridad")
                const data = await response.json()
                console.log("Priority orders response:", data)
                setPriorityOrders(data.data || [])
            } catch (err) {
                console.error("Error fetching ordenes por prioridad:", err)
            } finally {
                setLoadingPriorityOrders(false)
            }
        },
        [fetchWithAuth]
    )

    const fetchOrdenesPorEstado = useCallback(
        async (estado: string) => {
            try {
                console.log("Fetching orders for status:", estado)
                setLoadingStatusOrders(true)
                setErrorStatusOrders(null)
                setStatusOrders([])
                setSelectedStatus(estado)
                const endpoint = `/api/dashboard/ordenes-por-estado/${encodeURIComponent(estado)}`

                const response = await fetchWithAuth(endpoint)
                if (response.status === 401) return
                if (!response.ok) throw new Error("Error al cargar órdenes por estado")
                const data = await response.json()
                if (data?.success === false) throw new Error(data.error || "Error al cargar órdenes por estado")
                setStatusOrders(data.data || [])
            } catch (err) {
                console.error("Error fetching ordenes por estado:", err)
                setErrorStatusOrders("No se pudo traer la lista. Probá de nuevo en un rato; si sigue igual, avisá.")
            } finally {
                setLoadingStatusOrders(false)
            }
        },
        [fetchWithAuth]
    )

    // Una tarjeta que no se ve no se pide, y su «cargando» se apaga: si no, el botón
    // Actualizar quedaría girando para siempre esperando algo que nunca se pidió.
    useEffect(() => {
        if (veEstado) fetchEstadisticas()
        else setLoading(false)
    }, [veEstado, fetchEstadisticas])

    useEffect(() => {
        if (veCriticas) fetchOrdenesCriticas()
        else setLoadingCriticas(false)
    }, [veCriticas, fetchOrdenesCriticas])

    useEffect(() => {
        if (veTimeline) fetchTimelineEntregas()
        else setLoadingTimeline(false)
    }, [veTimeline, fetchTimelineEntregas])

    useEffect(() => {
        setLoadingExtras(true)
        Promise.all([
            veClientes ? fetchTopClientes() : null,
            vePrioridades ? fetchDistribucionPrioridades() : null,
            veArticulos ? fetchTopArticulos() : null,
        ]).finally(() => setLoadingExtras(false))
    }, [veClientes, vePrioridades, veArticulos, fetchTopClientes, fetchDistribucionPrioridades, fetchTopArticulos])

    const refreshAll = useCallback(() => {
        if (veEstado) fetchEstadisticas()
        if (veCriticas) fetchOrdenesCriticas()
        if (veTimeline) fetchTimelineEntregas()
        if (veClientes) fetchTopClientes()
        if (vePrioridades) fetchDistribucionPrioridades()
        if (veArticulos) fetchTopArticulos()
    }, [
        veEstado,
        veCriticas,
        veTimeline,
        veClientes,
        vePrioridades,
        veArticulos,
        fetchEstadisticas,
        fetchOrdenesCriticas,
        fetchTimelineEntregas,
        fetchTopClientes,
        fetchDistribucionPrioridades,
        fetchTopArticulos,
    ])

    return {
        estadisticas,
        ordenesCriticas,
        timelineEntregas,
        topClientes,
        distribucionPrioridades,
        topArticulos,
        loading,
        loadingCriticas,
        loadingTimeline,
        loadingExtras,
        error,
        selectedPriority,
        priorityOrders,
        loadingPriorityOrders,
        setSelectedPriority,
        setPriorityOrders,
        fetchOrdenesPorPrioridad,
        selectedStatus,
        statusOrders,
        loadingStatusOrders,
        errorStatusOrders,
        setSelectedStatus,
        setStatusOrders,
        fetchOrdenesPorEstado,
        refreshAll,
        apiUrl,
    }
}
