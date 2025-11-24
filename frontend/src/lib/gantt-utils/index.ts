import { ViewMode } from "gantt-task-react";

// Paleta de colores para procesos
export const PROCESS_COLORS = [
    "#3b82f6", // blue-500
    "#ef4444", // red-500
    "#10b981", // emerald-500
    "#f59e0b", // amber-500
    "#8b5cf6", // violet-500
    "#ec4899", // pink-500
    "#06b6d4", // cyan-500
    "#f97316", // orange-500
];

export const getProcessColor = (processName: string) => {
    let hash = 0;
    for (let i = 0; i < processName.length; i++) {
        hash = processName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % PROCESS_COLORS.length;
    return PROCESS_COLORS[index];
};

export const getColumnWidth = (viewMode: ViewMode) => {
    switch (viewMode) {
        case ViewMode.Year:
            return 500;
        case ViewMode.Month:
            return 400;
        case ViewMode.Week:
            return 350;
        case ViewMode.Day:
            return 300;
        case ViewMode.Hour:
            return 120;
        default:
            return 120;
    }
};

export const getZoomLimits = (viewMode: ViewMode) => {
    switch (viewMode) {
        case ViewMode.Hour:
            return { min: 60, max: 250 };
        case ViewMode.Day:
            return { min: 80, max: 500 };
        case ViewMode.Week:
            return { min: 150, max: 800 };
        case ViewMode.Month:
            return { min: 200, max: 1000 };
        case ViewMode.Year:
            return { min: 300, max: 1200 };
        default:
            return { min: 50, max: 500 };
    }
};

export const getViewLabel = (mode: ViewMode) => {
    switch (mode) {
        case ViewMode.Hour:
            return "Horas";
        case ViewMode.Day:
            return "Días";
        case ViewMode.Week:
            return "Semanas";
        case ViewMode.Month:
            return "Meses";
        case ViewMode.Year:
            return "Años";
        default:
            return "Vista";
    }
};
