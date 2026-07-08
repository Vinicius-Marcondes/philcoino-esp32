export const DEBUG_DEVICE_MODE_ENV = "EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE";

export function isDebugDeviceModeEnabled(
  value = process.env.EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE,
): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}
