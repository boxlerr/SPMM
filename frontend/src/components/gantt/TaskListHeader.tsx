import React from "react";

interface TaskListHeaderProps {
    headerHeight: number;
    isSidebarOpen?: boolean;
}

const TaskListHeader: React.FC<TaskListHeaderProps> = ({
    headerHeight,
    isSidebarOpen,
}) => {
    if (isSidebarOpen === false) return null;

    return (
        <div
            style={{
                height: headerHeight,
                fontFamily: "inherit",
                fontWeight: "bold",
                paddingLeft: 16,
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid #e5e7eb",
                backgroundColor: "#f9fafb",
                color: "#374151",
                fontSize: "0.875rem",
            }}
        >
            Operario / Tarea
        </div>
    );
};

export default TaskListHeader;
