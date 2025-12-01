import { useState, useEffect, useCallback } from "react"
import {
    EstadisticasOrdenes,
    OrdenCritica,
    OcupacionSector,
    TimelineItem,
    ProcesoUtilizado,
    DistribucionPrioridad,
    TiempoPromedio,
    TopArticulo,
    OrdenPrioridad,
    OrdenEstado,
} from "@/components/dashboard/types"

export function useDashboardData() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"

    const [estadisticas, setEstadisticas] = useState<EstadisticasOrdenes | null>(null)
    const [ordenesCriticas, setOrdenesCriticas] = useState<OrdenCritica[]>([])
    const [ocupacionSectores, setOcupacionSectores] = useState<OcupacionSector[]>([])
    const [timelineEntregas, setTimelineEntregas] = useState<TimelineItem[]>([])
    const [procesosMasUtilizados, setProcesosMasUtilizados] = useState<ProcesoUtilizado[]>([])
    const [distribucionPrioridades, setDistribucionPrioridades] = useState<DistribucionPrioridad[]>([])
    const [tiempoPromedio, setTiempoPromedio] = useState<TiempoPromedio | null>(null)
    const [topArticulos, setTopArticulos] = useState<TopArticulo[]>([])

    const [loading, setLoading] = useState(true)
    const [loadingCriticas, setLoadingCriticas] = useState(true)
    const [loadingOcupacion, setLoadingOcupacion] = useState(true)
    const [loadingTimeline, setLoadingTimeline] = useState(true)
    const [loadingExtras, setLoadingExtras] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [selectedPriority, setSelectedPriority] = useState<string | null>(null)
    const [priorityOrders, setPriorityOrders] = useState<OrdenPrioridad[]>([])
    const [loadingPriorityOrders, setLoadingPriorityOrders] = useState(false)

    const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
    const [statusOrders, setStatusOrders] = useState<OrdenEstado[]>([])
    const [loadingStatusOrders, setLoadingStatusOrders] = useState(false)

    const fetchEstadisticas = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)
            const response = await fetch(`${apiUrl}/api/dashboard/estadisticas`)
            if (!response.ok) throw new Error("Error al cargar estadísticas")
            const data = await response.json()
            setEstadisticas(data.data || null)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Error desconocido")
            console.error("Error fetching estadisticas:", err)
        } finally {
            setLoading(false)
        }
    }, [apiUrl])

    const fetchOrdenesCriticas = useCallback(async () => {
        try {
            setLoadingCriticas(true)
            const response = await fetch(`${apiUrl}/api/dashboard/ordenes-criticas`)
            if (!response.ok) throw new Error("Error al cargar órdenes críticas")
            const data = await response.json()
            setOrdenesCriticas(data.data || [])
        } catch (err) {
            console.error("Error fetching ordenes criticas:", err)
        } finally {
            setLoadingCriticas(false)
        }
    }, [apiUrl])

    const fetchOcupacionSectores = useCallback(async () => {
        try {
            setLoadingOcupacion(true)
            const response = await fetch(`${apiUrl}/api/dashboard/ocupacion-sectores`)
            if (!response.ok) throw new Error("Error al cargar ocupación de sectores")
            const data = await response.json()
            setOcupacionSectores(data.data || [])
        } catch (err) {
            console.error("Error fetching ocupacion sectores:", err)
        } finally {
            setLoadingOcupacion(false)
        }
    }, [apiUrl])

    const fetchTimelineEntregas = useCallback(async () => {
        try {
            setLoadingTimeline(true)
            const response = await fetch(`${apiUrl}/api/dashboard/timeline-entregas`)
            if (!response.ok) throw new Error("Error al cargar timeline")
            const data = await response.json()
            setTimelineEntregas(data.data || [])
        } catch (err) {
            console.error("Error fetching timeline:", err)
        } finally {
            setLoadingTimeline(false)
        }
    }, [apiUrl])

    const fetchProcesosMasUtilizados = useCallback(async () => {
        try {
            const response = await fetch(`${apiUrl}/api/dashboard/procesos-mas-utilizados`)
            if (!response.ok) throw new Error("Error al cargar procesos")
            const data = await response.json()
            setProcesosMasUtilizados(data.data || [])
        } catch (err) {
            console.error("Error fetching procesos:", err)
        }
    }, [apiUrl])

    const fetchDistribucionPrioridades = useCallback(async () => {
        try {
            const response = await fetch(`${apiUrl}/api/dashboard/distribucion-prioridades`)
            if (!response.ok) throw new Error("Error al cargar prioridades")
            const data = await response.json()
            setDistribucionPrioridades(data.data || [])
        } catch (err) {
            console.error("Error fetching prioridades:", err)
        }
    }, [apiUrl])

    const fetchTopArticulos = useCallback(async () => {
        try {
            const response = await fetch(`${apiUrl}/api/dashboard/top-articulos`)
            if (!response.ok) throw new Error("Error al cargar artículos")
            const data = await response.json()
            setTopArticulos(data.data || [])
        } catch (err) {
            console.error("Error fetching articulos:", err)
        }
    }, [apiUrl])

    const fetchTiempoPromedio = useCallback(async () => {
        try {
            const response = await fetch(`${apiUrl}/api/dashboard/tiempo-promedio`)
            if (!response.ok) throw new Error("Error al cargar tiempo promedio")
            const data = await response.json()
            setTiempoPromedio(data.data || null)
        } catch (err) {
            console.error("Error fetching tiempo promedio:", err)
        }
    }, [apiUrl])

    const fetchOrdenesPorPrioridad = useCallback(
        async (prioridad: string) => {
            try {
                console.log("Fetching orders for priority:", prioridad)
                setLoadingPriorityOrders(true)
                setSelectedPriority(prioridad)
                const url = `${apiUrl}/api/dashboard/ordenes-por-prioridad/${encodeURIComponent(prioridad)}`
                console.log("Fetch URL:", url)

                const response = await fetch(url)
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
        [apiUrl]
    )

    const fetchOrdenesPorEstado = useCallback(
        async (estado: string) => {
            try {
                console.log("Fetching orders for status:", estado)
                setLoadingStatusOrders(true)
                setSelectedStatus(estado)
                const url = `${apiUrl}/api/dashboard/ordenes-por-estado/${encodeURIComponent(estado)}`
                console.log("Fetch URL:", url)

                const response = await fetch(url)
                if (!response.ok) throw new Error("Error al cargar órdenes por estado")
                const data = await response.json()
                console.log("Status orders response:", data)
                setStatusOrders(data.data || [])
            } catch (err) {
                console.error("Error fetching ordenes por estado:", err)
            } finally {
                setLoadingStatusOrders(false)
            }
        },
        [apiUrl]
    )

    useEffect(() => {
        fetchEstadisticas()
        fetchOrdenesCriticas()
        fetchOcupacionSectores()
        fetchTimelineEntregas()
    }, [fetchEstadisticas, fetchOrdenesCriticas, fetchOcupacionSectores, fetchTimelineEntregas])

    useEffect(() => {
        setLoadingExtras(true)
        Promise.all([
            fetchProcesosMasUtilizados(),
            fetchDistribucionPrioridades(),
            fetchTopArticulos(),
            fetchTiempoPromedio(),
        ]).finally(() => setLoadingExtras(false))
    }, [fetchProcesosMasUtilizados, fetchDistribucionPrioridades, fetchTopArticulos, fetchTiempoPromedio])

    const refreshAll = useCallback(() => {
        fetchEstadisticas()
        fetchOrdenesCriticas()
        fetchOcupacionSectores()
        fetchTimelineEntregas()
        fetchProcesosMasUtilizados()
        fetchDistribucionPrioridades()
        fetchTopArticulos()
        fetchTiempoPromedio()
    }, [
        fetchEstadisticas,
        fetchOrdenesCriticas,
        fetchOcupacionSectores,
        fetchTimelineEntregas,
        fetchProcesosMasUtilizados,
        fetchDistribucionPrioridades,
        fetchTopArticulos,
        fetchTiempoPromedio,
    ])

    return {
        estadisticas,
        ordenesCriticas,
        ocupacionSectores,
        timelineEntregas,
        procesosMasUtilizados,
        distribucionPrioridades,
        tiempoPromedio,
        topArticulos,
        loading,
        loadingCriticas,
        loadingOcupacion,
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
        setSelectedStatus,
        setStatusOrders,
        fetchOrdenesPorEstado,
        refreshAll,
        apiUrl,
    }
}
