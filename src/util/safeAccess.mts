export const accessProperty = <T, K extends keyof T>(o: T, k: K): T[K] | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

export const deleteProperty = <T, K extends keyof T>(o: T, k: K) => {
  if (Object.prototype.hasOwnProperty.call(o, k)) {
    delete o[k];
  }
};
