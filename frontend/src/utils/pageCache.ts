let cachedInitialData: any = null;
let cachedAdminData: any = null;

const clone = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
};

export const getCachedInitialData = () => (cachedInitialData ? clone(cachedInitialData) : null);
export const setCachedInitialData = (data: any) => { cachedInitialData = data ? clone(data) : null; };
export const clearCachedInitialData = () => { cachedInitialData = null; };

export const getCachedAdminData = () => (cachedAdminData ? clone(cachedAdminData) : null);
export const setCachedAdminData = (data: any) => { cachedAdminData = data ? clone(data) : null; };
export const clearCachedAdminData = () => { cachedAdminData = null; };