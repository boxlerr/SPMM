import React from "react";
import { Task } from "gantt-task-react";
import { ChevronRight } from "lucide-react";

interface PlanificacionItem {
    id: number;
    orden_id: number;
    proceso_id: number;
    nombre_proceso: string;
    inicio_min: number;
    fin_min: number;
    creado_en: string;
    id_operario?: number;
    id_maquinaria?: number;
    nombre_maquinaria?: string;
    nombre_operario?: string;
    apellido_operario?: string;
    fecha_prometida?: string;
    prioridad_peso?: number;
}

interface TaskListTableProps {
    rowHeight: number;
    tasks: Task[];
    onExpanderClick: (task: Task) => void;
    planificacionItems: PlanificacionItem[];
    cargasMap: Record<string, { totalMinutos: number; porcentaje: number }>;
    isSidebarOpen?: boolean;
    onTaskClick?: (item: PlanificacionItem) => void;
    getProcessColor: (processName: string) => string;
}

const TaskListTable: React.FC<TaskListTableProps> = ({
    rowHeight,
    tasks,
    onExpanderClick,
    planificacionItems,
    cargasMap,
    isSidebarOpen,
    onTaskClick,
    getProcessColor,
}) => {
    if (isSidebarOpen === false) return null;

    return (
        <div style={{ fontFamily: "inherit" }}>
            {tasks.map((t) => {
                const isProject = t.type === "project";
                let mainText = t.name;
                let subText = "";

                if (isProject) {
                    if (
                        !mainText ||
                        mainText === "Rango Inicio" ||
                        mainText === "Rango Fin"
                    ) {
                        if (t.id === "range-start" || t.id === "range-end") {
                            return <div key={t.id} style={{ height: rowHeight }} />;
                        }

                        if (t.id === "op-none") {
                            mainText = "Sin Operario Asignado";
                        } else if (t.id.startsWith("op-")) {
                            const opId = parseInt(t.id.replace("op-", ""));
                            const item = planificacionItems.find(
                                (p) => p.id_operario === opId
                            );
                            if (item) {
                                mainText = `${item.nombre_operario || ""} ${item.apellido_operario || ""
                                    }`.trim();
                            } else {
                                mainText = "Operario";
                            }
                        }
                    }

                    const carga = cargasMap[t.id] || { totalMinutos: 0, porcentaje: 0 };

                    return (
                        <div
                            key={t.id}
                            style={{
                                height: rowHeight,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                paddingLeft: 16,
                                paddingRight: 16,
                                borderBottom: "1px solid #e5e7eb",
                                backgroundColor: "#f3f4f6",
                                cursor: "pointer",
                                transition: "background-color 0.2s",
                            }}
                            onClick={() => onExpanderClick(t)}
                        >
                            <div
                                style={{
                                    paddingLeft: 0,
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    gap: 8,
                                    width: "100%",
                                    overflow: "hidden",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        flex: 1,
                                        overflow: "hidden",
                                    }}
                                >
                                    <span
                                        style={{ fontSize: 10, color: "#6b7280", flexShrink: 0 }}
                                    >
                                        {t.hideChildren ? "▶" : "▼"}
                                    </span>

                                    <div className="truncate w-full">
                                        <span
                                            style={{
                                                fontWeight: 700,
                                                color: "#111827",
                                                fontSize: "0.875rem",
                                            }}
                                        >
                                            {mainText}
                                        </span>
                                    </div>
                                </div>

                                <div
                                    style={{
                                        fontSize: "0.65rem",
                                        color:
                                            carga.porcentaje > 90
                                                ? "#dc2626"
                                                : carga.porcentaje > 75
                                                    ? "#f59e0b"
                                                    : "#10b981",
                                        fontWeight: 600,
                                        flexShrink: 0,
                                        paddingLeft: 8,
                                    }}
                                >
                                    {Math.round(carga.totalMinutos / 60)}h/8h
                                </div>
                            </div>

                            <div
                                style={{
                                    marginTop: 4,
                                    height: 3,
                                    backgroundColor: "#e5e7eb",
                                    borderRadius: 2,
                                    overflow: "hidden",
                                    width: "100%",
                                }}
                            >
                                <div
                                    style={{
                                        height: "100%",
                                        width: `${carga.porcentaje}%`,
                                        backgroundColor:
                                            carga.porcentaje > 90
                                                ? "#dc2626"
                                                : carga.porcentaje > 75
                                                    ? "#f59e0b"
                                                    : "#10b981",
                                        transition: "width 0.3s ease",
                                    }}
                                />
                            </div>
                        </div>
                    );
                } else {
                    const parts = t.name.split(" (OT:");
                    mainText = parts[0];
                    mainText = mainText.charAt(0).toUpperCase() + mainText.slice(1);

                    if (parts.length > 1) {
                        subText = `OT: ${parts[1].replace(")", "")}`;
                    }

                    const dateText = t.start.toLocaleDateString("es-AR", {
                        month: "short",
                        day: "numeric",
                    });

                    // Extraer el ID de la planificación del task.id
                    const taskIdParts = t.id.split("-");
                    const dbIdStr = taskIdParts[4];
                    const planItem = dbIdStr
                        ? planificacionItems.find((p) => p.id === parseInt(dbIdStr))
                        : null;

                    const handleTaskClick = () => {
                        if (planItem && onTaskClick) {
                            onTaskClick(planItem);
                        }
                    };

                    return (
                        <div
                            key={t.id}
                            onClick={handleTaskClick}
                            style={{
                                height: rowHeight,
                                display: "flex",
                                flexDirection: "column",
                                justifyContent: "center",
                                paddingLeft: 16,
                                paddingRight: 16,
                                borderBottom: "1px solid #e5e7eb",
                                borderLeft: "3px solid transparent",
                                backgroundColor: "#fff",
                                cursor: planItem ? "pointer" : "default",
                                transition: "all 0.2s ease",
                            }}
                            onMouseEnter={(e) => {
                                if (planItem) {
                                    e.currentTarget.style.backgroundColor = "#f3f4f6";
                                    e.currentTarget.style.borderLeftColor = getProcessColor(
                                        planItem.nombre_proceso || "default"
                                    );
                                    e.currentTarget.style.boxShadow =
                                        "0 1px 3px 0 rgba(0, 0, 0, 0.1)";
                                    const chevron = e.currentTarget.querySelector(".task-chevron") as HTMLElement;
                                    if (chevron) {
                                        chevron.style.color = "#6b7280";
                                        chevron.style.transform = "translateX(2px)";
                                    }
                                }
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = "#fff";
                                e.currentTarget.style.borderLeftColor = "transparent";
                                e.currentTarget.style.boxShadow = "none";
                                const chevron = e.currentTarget.querySelector(".task-chevron") as HTMLElement;
                                if (chevron) {
                                    chevron.style.color = "#9ca3af";
                                    chevron.style.transform = "translateX(0)";
                                }
                            }}
                        >
                            <div
                                style={{
                                    paddingLeft: 24,
                                    display: "flex",
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    width: "100%",
                                    overflow: "hidden",
                                }}
                            >
                                <div className="truncate" style={{ flex: 1, marginRight: 8 }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                        <span
                                            style={{
                                                fontWeight: 600,
                                                color: "#374151",
                                                fontSize: "0.8125rem",
                                            }}
                                        >
                                            {mainText}
                                        </span>
                                    </div>
                                    {subText && (
                                        <span
                                            style={{
                                                display: "block",
                                                fontSize: "0.75rem",
                                                color: "#6b7280",
                                                marginTop: "2px",
                                                fontWeight: 600,
                                            }}
                                        >
                                            {subText}
                                        </span>
                                    )}
                                </div>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                    <div
                                        style={{
                                            fontSize: "0.75rem",
                                            color: "#6b7280",
                                            textAlign: "right",
                                        }}
                                    >
                                        {dateText}
                                    </div>
                                    <ChevronRight
                                        size={16}
                                        style={{
                                            color: planItem ? "#9ca3af" : "transparent",
                                            flexShrink: 0,
                                            transition: "transform 0.15s ease, color 0.15s ease",
                                        }}
                                        className="task-chevron"
                                    />
                                </div>
                            </div>
                        </div>
                    );
                }
            })}
        </div >
    );
};

export default TaskListTable;
