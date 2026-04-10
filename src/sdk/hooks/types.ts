export type HookAdapter = {
  name: string;
  detect: () => boolean;
  install: (config: HookInstallConfig) => void;
  uninstall: (marker: string) => void;
  isInstalled: (marker: string) => boolean;
};

export type HookInstallConfig = {
  marker: string;
  command: string;
  timeoutSeconds: number;
};
