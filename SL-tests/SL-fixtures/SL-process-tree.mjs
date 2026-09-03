import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROLE = process.argv[2] ?? "parent";
const MODE = process.argv[3] ?? "timeout";
const FIXTURE_PATH = fileURLToPath(import.meta.url);
const PID_PATH = "SL-process-tree-pids.json";
const READY_PATH = "SL-process-tree-ready.json";
const EVALUATION_COMPLETE_PATH = "SL-evaluator-complete.txt";
const MARKER_PATH = "SL-delayed-marker.txt";
const MARKER_DELAY_MS = 250;

if (ROLE === "grandchild") {
  writeFileSync(
    PID_PATH,
    JSON.stringify({ childPid: process.ppid, grandchildPid: process.pid }),
  );
  writeFileSync(
    READY_PATH,
    JSON.stringify({ grandchildPid: process.pid, markerDelayMs: MARKER_DELAY_MS }),
  );
  let markerScheduled = false;
  setInterval(() => {
    if (!markerScheduled && existsSync(EVALUATION_COMPLETE_PATH)) {
      markerScheduled = true;
      setTimeout(() => {
        writeFileSync(MARKER_PATH, "descendant survived evaluation");
      }, MARKER_DELAY_MS);
    }
  }, 25);
} else if (ROLE === "child") {
  const grandchild = spawn(process.execPath, [FIXTURE_PATH, "grandchild", MODE], {
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  if (grandchild.pid === undefined) {
    process.exit(2);
  }
  setInterval(() => undefined, 1000);
} else {
  spawn(process.execPath, [FIXTURE_PATH, "child", MODE], {
    shell: false,
    stdio: "ignore",
    windowsHide: true,
  });
  if (MODE === "success") {
    const readinessCheck = setInterval(() => {
      if (existsSync(READY_PATH)) {
        clearInterval(readinessCheck);
        process.exit(0);
      }
    }, 25);
  } else {
    setInterval(() => undefined, 1000);
  }
}
