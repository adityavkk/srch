export interface CliSuccessResult {
  command: string[];
  kind: string;
  data: unknown;
  text: string;
}

export interface EmitOptions {
  asJson: boolean;
  outPath?: string;
}
