import { spawn } from "node:child_process";

export type OptionalInstallTarget = "flights" | "all";

export interface InstallStep {
  id: string;
  title: string;
  command: string;
  args: string[];
}

export interface InstallPlan {
  target: OptionalInstallTarget;
  globalInstall: boolean;
  steps: InstallStep[];
  includes: {
    flights: boolean;
  };
}

export interface InstallStepResult {
  id: string;
  title: string;
  command: string;
  args: string[];
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface InstallResult {
  dryRun: boolean;
  plan: InstallPlan;
  results: InstallStepResult[];
}

export function isOptionalInstallTarget(value: string | undefined): value is OptionalInstallTarget {
  return value === "flights" || value === "all";
}

export function buildInstallPlan(target: OptionalInstallTarget, globalInstall = false): InstallPlan {
  const steps: InstallStep[] = [];

  if (target === "flights" || target === "all") {
    steps.push({
      id: "fli-python-sdk",
      title: "install Fli Python SDK",
      command: process.env.SRCH_FLI_PYTHON?.trim() || "python3",
      args: ["-m", "pip", "install", "flights"]
    });
  }

  return {
    target,
    globalInstall,
    steps,
    includes: {
      flights: true
    }
  };
}

export function renderInstallPlan(plan: InstallPlan): string {
  const lines = [`Install target: ${plan.target}`];
  for (const step of plan.steps) lines.push(`- ${step.title}: ${step.command} ${step.args.join(" ")}`);
  return lines.join("\n");
}

export async function executeInstallPlan(plan: InstallPlan, options: { dryRun?: boolean; captureOutput?: boolean } = {}): Promise<InstallResult> {
  const dryRun = options.dryRun ?? false;
  const captureOutput = options.captureOutput ?? false;

  if (dryRun) {
    return {
      dryRun: true,
      plan,
      results: plan.steps.map((step) => ({
        id: step.id,
        title: step.title,
        command: step.command,
        args: step.args,
        exitCode: 0
      }))
    };
  }

  const results: InstallStepResult[] = [];
  for (const step of plan.steps) {
    const result = await runStep(step, captureOutput);
    results.push(result);
    if (result.exitCode !== 0) {
      const detail = result.stderr?.trim() || result.stdout?.trim() || `${step.command} exited with code ${result.exitCode}`;
      throw new Error(`Install step failed: ${step.title}. ${detail}`);
    }
  }

  return { dryRun: false, plan, results };
}

function runStep(step: InstallStep, captureOutput: boolean): Promise<InstallStepResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "inherit"
    });

    let stdout = "";
    let stderr = "";

    if (captureOutput) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString();
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        id: step.id,
        title: step.title,
        command: step.command,
        args: step.args,
        exitCode: code ?? 1,
        ...(captureOutput ? { stdout, stderr } : {})
      });
    });
  });
}
