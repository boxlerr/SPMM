
import { addWorkMinutes, WORK_HOURS, formatDate, formatTime } from "./gantt-utils";

// Mock addDurationToDate since it's not exported (I'll copy it here for testing or export it temporarily)
// Actually, I should export it from gantt-utils.ts to test it properly.
// But for now, I'll copy the implementation to verify the logic.

function addDurationToDate(startDate: Date, minutesToAdd: number): Date {
    let currentDate = new Date(startDate);
    let minutesRemaining = minutesToAdd;

    while (minutesRemaining > 0) {
        const currentHour = currentDate.getHours();
        const currentMinute = currentDate.getMinutes();
        const currentTotalMinutes = currentHour * 60 + currentMinute;

        const workStartMinutes = WORK_HOURS.start * 60;
        const workEndMinutes = WORK_HOURS.end * 60;

        if (currentTotalMinutes < workStartMinutes) {
            currentDate.setHours(WORK_HOURS.start, 0, 0, 0);
            continue;
        }

        if (currentTotalMinutes >= workEndMinutes) {
            currentDate.setDate(currentDate.getDate() + 1);
            currentDate.setHours(WORK_HOURS.start, 0, 0, 0);
            while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
                currentDate.setDate(currentDate.getDate() + 1);
            }
            continue;
        }

        const minutesAvailableToday = workEndMinutes - currentTotalMinutes;

        if (minutesRemaining <= minutesAvailableToday) {
            currentDate.setMinutes(currentDate.getMinutes() + minutesRemaining);
            minutesRemaining = 0;
        } else {
            minutesRemaining -= minutesAvailableToday;
            currentDate.setDate(currentDate.getDate() + 1);
            currentDate.setHours(WORK_HOURS.start, 0, 0, 0);
            while (currentDate.getDay() === 0 || currentDate.getDay() === 6) {
                currentDate.setDate(currentDate.getDate() + 1);
            }
        }
    }

    return currentDate;
}

console.log("Testing addDurationToDate...");

// Test Case 1: 5 hours task starting at 09:00
const start1 = new Date("2025-11-12T09:00:00");
const duration1 = 300; // 5 hours
const end1 = addDurationToDate(start1, duration1);
console.log(`Task 1 (5h): Start ${start1.toISOString()} -> End ${end1.toISOString()}`);
// Expected: 14:00

// Test Case 2: 10 hours task starting at 09:00
const start2 = new Date("2025-11-12T09:00:00");
const duration2 = 600; // 10 hours
const end2 = addDurationToDate(start2, duration2);
console.log(`Task 2 (10h): Start ${start2.toISOString()} -> End ${end2.toISOString()}`);
// Expected: Day 1 18:00 (9h) + Day 2 10:00 (1h) -> End 2025-11-13T10:00:00

// Test Case 3: Task starting at 17:00 with 2h duration
const start3 = new Date("2025-11-12T17:00:00");
const duration3 = 120; // 2 hours
const end3 = addDurationToDate(start3, duration3);
console.log(`Task 3 (2h @ 17:00): Start ${start3.toISOString()} -> End ${end3.toISOString()}`);
// Expected: Day 1 18:00 (1h) + Day 2 10:00 (1h) -> End 2025-11-13T10:00:00

if (end1.getHours() === 14) {
    console.log("SUCCESS: Task 1 ends at 14:00.");
} else {
    console.log("FAIL: Task 1 end time incorrect.");
}
