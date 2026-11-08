import { spawn } from "node:child_process";
import { FLI_MANAGED_PYTHON, FLI_REQUIREMENT, FLI_RUNTIME_DIR } from "../flights/runtime.js";

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
    const python = process.env.SRCH_FLI_PYTHON?.trim();
    if (python) {
      steps.push({
        id: "fli-python-version",
        title: "check Fli Python version",
        command: python,
        args: ["-c", "import sys; sys.exit('Fli requires Python 3.10+. Unset SRCH_FLI_PYTHON to use the managed runtime.') if sys.version_info < (3, 10) else None"]
      });
      steps.push({
        id: "fli-python-sdk",
        title: "install pinned Fli Python SDK",
        command: python,
        args: ["-m", "pip", "install", FLI_REQUIREMENT]
      });
    } else {
      steps.push({
        id: "fli-python-runtime",
        title: "create isolated Fli Python 3.12 runtime",
        command: "uv",
        args: ["venv", "--python", "3.12", "--allow-existing", FLI_RUNTIME_DIR]
      });
      steps.push({
        id: "fli-python-sdk",
        title: "install pinned Fli Python SDK",
        command: "uv",
        args: ["pip", "install", "--python", FLI_MANAGED_PYTHON, FLI_REQUIREMENT]
      });
    }
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

    child.on("error", (error) => reject(new Error(
      step.command === "uv"
        ? `The managed flights runtime requires uv on PATH. ${error.message}`
        : error.message
    )));
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
