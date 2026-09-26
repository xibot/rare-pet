import { isAddress, zeroAddress, type Address } from 'viem';
declare const __RAREPET_CONTRACT__: string;
// Injected by the build, never accepted from a URL or browser storage.
const value = typeof __RAREPET_CONTRACT__ === 'string' ? __RAREPET_CONTRACT__ : '';
export const careContract: Address | null = isAddress(value) && value.toLowerCase() !== zeroAddress ? value : null;
declare const __RAREPET_LAUNCHPAD__: string;
declare const __RAREPET_LAUNCH_STORAGE__: boolean;
const launch = typeof __RAREPET_LAUNCHPAD__ === 'string' ? __RAREPET_LAUNCHPAD__ : '';
export const launchpadContract: Address | null = isAddress(launch) && launch.toLowerCase() !== zeroAddress ? launch : null;
export const launchStorageReady = typeof __RAREPET_LAUNCH_STORAGE__ === 'boolean' && __RAREPET_LAUNCH_STORAGE__;

// User-confirmed launch recipient. The live adapter also verifies the deployed policy.
export const launchTreasury = '0xCa88efc94b567A5185FEA63599aD895c3e514FBc' as const;
