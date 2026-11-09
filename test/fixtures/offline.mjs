// Tests must provide responses explicitly. A missing mock must never use the web.
globalThis.fetch = async () => {
  throw new Error("Unexpected network request in offline tests");
};
