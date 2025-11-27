
import { addWorkMinutes, WORK_HOURS, formatDate, formatTime } from "./gantt-utils";

console.log("Testing addWorkMinutes...");

const baseDate = new Date("2025-11-12T09:00:00"); // Wednesday 09:00

// Test Case 1: 5 hours (300 mins) from base
const end1 = addWorkMinutes(baseDate, 300);
console.log(`Start 09:00 + 300m -> End ${end1.toISOString()}`);
// Expected: 14:00

// Test Case 2: 9 hours (540 mins) from base
const end2 = addWorkMinutes(baseDate, 540);
console.log(`Start 09:00 + 540m -> End ${end2.toISOString()}`);
// Expected: 18:00

// Test Case 3: 10 hours (600 mins) from base
const end3 = addWorkMinutes(baseDate, 600);
console.log(`Start 09:00 + 600m -> End ${end3.toISOString()}`);
// Expected: Next day 10:00

if (end1.getHours() === 14) {
    console.log("SUCCESS: 5h task ends at 14:00.");
} else {
    console.log("FAIL: 5h task end time incorrect.");
}
