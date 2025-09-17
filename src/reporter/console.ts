import type { Reporter, Step } from "../types.js";

function now() {
  return Date.now();
}

export class ConsoleReporter implements Reporter {
  private suiteName = "";
  private suiteStart = 0;
  private flowStart = 0;

  onSuiteStart(name: string): void {
    this.suiteName = name;
    this.suiteStart = now();
    console.log(`\n=== Suite: ${name} ===`);
  }

  onSuiteEnd(): void {
    const dur = now() - this.suiteStart;
    console.log(`=== Suite End (${this.suiteName}) - ${dur}ms ===\n`);
  }

  onFlowStart(name: string): void {
    this.flowStart = now();
    console.log(`\n-- Flow: ${name} --`);
  }

  onFlowEnd(name: string, result: { passed: boolean; durationMs: number }): void {
    console.log(`-- Flow End: ${name} - ${result.passed ? "PASSED" : "FAILED"} - ${result.durationMs}ms`);
  }

  onStepStart(index: number, step: Step): void {
    const key = Object.keys(step)[0];
    console.log(`  [${String(index).padStart(3, " ")}] ${key}`);
  }

  onStepEnd(
    index: number,
    step: Step,
    result: { passed: boolean; durationMs: number; error?: string }
  ): void {
    const key = Object.keys(step)[0];
    if (result.passed) {
      console.log(
        `  ✔ [${String(index).padStart(3, " ")}] ${key} (${result.durationMs}ms)`
      );
    } else {
      console.log(
        `  ✖ [${String(index).padStart(3, " ")}] ${key} (${result.durationMs}ms)\n    ${result.error ?? "Error"}`
      );
    }
  }

  log(message: string): void {
    console.log(`  > ${message}`);
  }
}
