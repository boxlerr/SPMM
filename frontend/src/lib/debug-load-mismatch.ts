
import { calculateResourceLoad } from "./gantt-utils";
import type { GanttTask } from "./types";

console.log("Debugging Load Mismatch...");

// Task: Wed 14:20 - Thu 11:10
// Duration: 5.83h
const task: GanttTask = {
    id: "task-1",
    dbId: 1,
    workOrderId: 101,
    workOrderNumber: "101",
    resourceId: "1",
    resourceName: "Agustin",
    resourceType: "operario",
    process: "Oxicorte",
    startDate: "2025-11-12", // Wednesday
    startTime: "14:20",
    endDate: "2025-11-13",   // Thursday
    endTime: "11:10",
    duration: 5.83,
    priority: "normal",
    status: "en_proceso",
    progress: 0,
    isDelayed: false,
    client: "Client",
    sector: "Sector",
    subsector: "Subsector",
    quantity: 1,
    materials: []
};

const tasks = [task];

// Calculate load for Wednesday 2025-11-12
const loadWed = calculateResourceLoad(tasks, "1", "2025-11-12");
console.log(`Load for Wed 2025-11-12: ${loadWed.toFixed(2)}h`);

// Expected: 14:20 to 18:00 = 3h 40m = 3.67h
if (Math.abs(loadWed - 3.67) < 0.1) {
    console.log("SUCCESS: Wed load is correct.");
} else {
    console.log(`FAIL: Wed load is ${loadWed}, expected ~3.67.`);
}

// Calculate load for Thursday 2025-11-13
const loadThu = calculateResourceLoad(tasks, "1", "2025-11-13");
console.log(`Load for Thu 2025-11-13: ${loadThu.toFixed(2)}h`);

// Expected: 09:00 to 11:10 = 2h 10m = 2.17h
if (Math.abs(loadThu - 2.17) < 0.1) {
    console.log("SUCCESS: Thu load is correct.");
} else {
    console.log(`FAIL: Thu load is ${loadThu}, expected ~2.17.`);
}
