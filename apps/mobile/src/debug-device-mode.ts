export const DEBUG_DEVICE_MODE_ENV = "EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE";

export function isDebugDeviceModeEnabled(
  value?: string,
): boolean {
  const resolved =
    arguments.length === 0
      ? process.env.EXPO_PUBLIC_PHILCOINO_DEBUG_DEVICE
      : value;
  return resolved === "1" || resolved?.toLowerCase() === "true";
}
