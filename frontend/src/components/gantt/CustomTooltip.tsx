import React from "react";
import { Task } from "gantt-task-react";

interface CustomTooltipProps {
    task: Task;
    fontSize: string;
    fontFamily: string;
}

const CustomTooltip: React.FC<CustomTooltipProps> = ({
    task,
    fontSize,
    fontFamily,
}) => {
    if (task.type === "project") return null;

    return (
        <div
            style={{
                backgroundColor: "white",
                padding: "12px",
                borderRadius: "8px",
                boxShadow:
                    "0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)",
                border: "1px solid #e5e7eb",
                fontSize: "12px",
                fontFamily,
                zIndex: 1000,
                minWidth: "200px",
            }}
        >
            <div className="font-bold text-gray-900 mb-1 text-sm">
                {task.name.split(" (OT:")[0]}
            </div>
            <div className="text-gray-600 mb-2">
                {task.name.match(/\(OT: \d+\)/)?.[0] || ""}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                <span className="font-semibold">Inicio:</span>
                <span>
                    {task.start.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                </span>

                <span className="font-semibold">Fin:</span>
                <span>
                    {task.end.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                    })}
                </span>

                <span className="font-semibold">Duración:</span>
                <span>
                    {Math.round((task.end.getTime() - task.start.getTime()) / 60000)} min
                </span>
            </div>
        </div>
    );
};

export default CustomTooltip;
