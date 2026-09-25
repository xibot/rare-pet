import { isAddress, zeroAddress, type Address } from 'viem';
declare const __RAREPET_CONTRACT__: string;
// Injected by the build, never accepted from a URL or browser storage.
const value = typeof __RAREPET_CONTRACT__ === 'string' ? __RAREPET_CONTRACT__ : '';
export const careContract: Address | null = isAddress(value) && value.toLowerCase() !== zeroAddress ? value : null;
