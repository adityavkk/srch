import { copyFileSync, mkdirSync } from "node:fs";

const destination = new URL("../dist/lib/flights/", import.meta.url);
mkdirSync(destination, { recursive: true });
copyFileSync(
  new URL("../src/lib/flights/fli-bridge.py", import.meta.url),
  new URL("fli-bridge.py", destination)
);
