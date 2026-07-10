import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { DashboardScreen } from "@/components/dashboard-screen";
import type { DiscoveredDevice } from "@/src/discovery/device-discovery";
import { findDiscoveredDevice } from "@/src/discovery/device-discovery";
import { nativeDeviceDiscovery } from "@/src/discovery/native-device-discovery";
import { isDebugDeviceModeEnabled } from "@/src/debug-device-mode";
import { ApiClientError } from "@/src/networking/api-client-error";
import {
  debugDeviceIdentity,
  debugSelectedDevice,
} from "@/src/networking/debug-device-api-client";
import { createDeviceApiClient } from "@/src/networking/expo-device-api-client";
import {
  authenticateAndSave,
  inspectDevice,
  restoreSelectedDevice,
  type PairingCandidate,
  type PairingClientFactory,
} from "@/src/pairing/pairing-service";
import { selectedDeviceRepository } from "@/src/storage/secure-selected-device-repository";
import type { SelectedDevice } from "@/src/storage/selected-device-repository";

const DISCOVERY_TIMEOUT_MS = 8_000;
const createPairingClient: PairingClientFactory = (options) =>
  createDeviceApiClient(options);

type PairedDevice = {
  candidate: PairingCandidate;
  message: string;
  selectedDevice: SelectedDevice;
};

export function PairingScreen() {
  if (isDebugDeviceModeEnabled()) {
    return <DebugPairingScreen />;
  }

  return <RealPairingScreen />;
}

function DebugPairingScreen() {
  return (
    <DashboardScreen
      deviceName={debugDeviceIdentity.name}
      initialNote="Debug device mode is enabled. Discovery, authentication, and ESP32 requests are bypassed."
      onForget={() => undefined}
      selectedDevice={debugSelectedDevice}
    />
  );
}

function RealPairingScreen() {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [selected, setSelected] = useState<PairingCandidate | null>(null);
  const [paired, setPaired] = useState<PairedDevice | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("Checking for a saved machine…");
  const [busy, setBusy] = useState(true);
  const [scanning, setScanning] = useState(false);
  const stopScan = useRef<(() => void) | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeOperation = useRef<AbortController | null>(null);

  const addDevice = useCallback((device: DiscoveredDevice) => {
    setDevices((current) => {
      const remaining = current.filter((item) => item.deviceId !== device.deviceId);
      return [...remaining, device].sort((left, right) => left.name.localeCompare(right.name));
    });
  }, []);

  const stopBrowsing = useCallback(() => {
    stopScan.current?.();
    stopScan.current = null;
    if (scanTimer.current !== null) {
      clearTimeout(scanTimer.current);
      scanTimer.current = null;
    }
    setScanning(false);
  }, []);

  const startBrowsing = useCallback(() => {
    stopBrowsing();
    let foundAny = false;
    setScanning(true);
    setMessage("Searching your local network for Philcoino machines…");

    stopScan.current = nativeDeviceDiscovery.scan({
      onDevice: (device) => {
        foundAny = true;
        addDevice(device);
        setMessage("Select a machine to review its identity before entering a token.");
      },
      onError: () => {
        stopBrowsing();
        setMessage(automaticDiscoveryUnavailableMessage());
      },
    });

    scanTimer.current = setTimeout(() => {
      stopBrowsing();
      if (!foundAny) {
        setMessage(noMachinesFoundMessage());
      }
    }, DISCOVERY_TIMEOUT_MS);
  }, [addDevice, stopBrowsing]);

  useEffect(() => {
    const controller = new AbortController();
    activeOperation.current = controller;

    void restoreSelectedDevice(
      {
        createClient: createPairingClient,
        findDeviceById: (deviceId, options) =>
          findDiscoveredDevice(nativeDeviceDiscovery, deviceId, {
            ...options,
            timeoutMs: DISCOVERY_TIMEOUT_MS,
          }),
        repository: selectedDeviceRepository,
      },
      { onDevice: addDevice, signal: controller.signal },
    )
      .then((result) => {
        if (controller.signal.aborted) {
          return;
        }
        if (result.status === "connected") {
          setPaired({
            candidate: result.candidate,
            message: result.recoveredAddress
              ? "The saved machine was found at its new address and the secure record was updated."
              : "The saved machine was authenticated at its cached address.",
            selectedDevice: result.selected,
          });
          setMessage("");
          return;
        }
        if (result.status === "not-found") {
          setMessage(
            "The saved machine did not answer at its cached address and was not rediscovered. Pair it again when it is available.",
          );
        }
        startBrowsing();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setMessage(errorMessage(error));
          startBrowsing();
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
        }
      });

    return () => {
      controller.abort();
      activeOperation.current?.abort();
      stopBrowsing();
    };
  }, [addDevice, startBrowsing, stopBrowsing]);

  const selectDevice = (device: PairingCandidate) => {
    stopBrowsing();
    setSelected(device);
    setToken("");
    setMessage("Confirm these identity details, then enter the bearer token.");
  };

  const inspectManualAddress = async () => {
    activeOperation.current?.abort();
    const controller = new AbortController();
    activeOperation.current = controller;
    stopBrowsing();
    setBusy(true);
    setMessage("Checking the manual address…");

    try {
      const candidate = await inspectDevice(
        manualAddress,
        createPairingClient,
        controller.signal,
      );
      setSelected(candidate);
      setToken("");
      setMessage("The address returned a valid Philcoino identity. Enter its bearer token.");
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(errorMessage(error));
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  };

  const pairSelectedDevice = async () => {
    if (selected === null) {
      return;
    }
    activeOperation.current?.abort();
    const controller = new AbortController();
    activeOperation.current = controller;
    setBusy(true);
    setMessage("Verifying the token with the machine…");

    try {
      const selectedDevice = await authenticateAndSave(
        selected,
        token,
        {
          createClient: createPairingClient,
          repository: selectedDeviceRepository,
        },
        controller.signal,
      );
      setPaired({
        candidate: selected,
        message: "Authentication succeeded and this machine was saved securely.",
        selectedDevice,
      });
      setToken("");
      setMessage("");
    } catch (error) {
      if (!controller.signal.aborted) {
        setMessage(errorMessage(error));
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  };

  const forgetDevice = async () => {
    setBusy(true);
    await selectedDeviceRepository.clear();
    setPaired(null);
    setSelected(null);
    setDevices([]);
    setManualAddress("");
    setToken("");
    setBusy(false);
    startBrowsing();
  };

  const chooseAnotherDevice = () => {
    setSelected(null);
    setToken("");
    startBrowsing();
  };
  const tokenSubmitDisabled = busy || token.trim().length === 0;

  if (paired !== null) {
    return (
      <DashboardScreen
        deviceName={paired.candidate.name}
        initialNote={paired.message}
        onForget={() => void forgetDevice()}
        selectedDevice={paired.selectedDevice}
      />
    );
  }

  return (
    <>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        style={styles.screen}
        contentContainerStyle={styles.content}>
        <View style={styles.pageHeader}>
          <Text selectable style={styles.pageTitle}>Pair machine</Text>
        </View>
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>LOCAL ESPRESSO CONTROL</Text>
          <Text selectable style={styles.lead}>
            Choose the machine on this Wi-Fi or connect directly with its local address.
          </Text>
        </View>

        {selected !== null ? (
          <View style={styles.card}>
            <Text selectable style={styles.sectionTitle}>Confirm machine identity</Text>
            <IdentityDetails candidate={selected} />
            <View style={styles.fieldGroup}>
              <Text selectable style={styles.label}>Bearer token</Text>
              <TextInput
                accessibilityLabel="Bearer token"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                onChangeText={setToken}
                onSubmitEditing={() => void pairSelectedDevice()}
                placeholder="Enter the token from the device setup"
                returnKeyType="done"
                secureTextEntry
                style={styles.input}
                value={token}
              />
            </View>
            <ActionButton
              disabled={tokenSubmitDisabled}
              label={busy ? "Verifying…" : "Verify and save"}
              onPress={() => void pairSelectedDevice()}
            />
            <ActionButton
              disabled={busy}
              label="Choose another machine"
              onPress={chooseAnotherDevice}
              secondary
            />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.sectionHeading}>
                <Text selectable style={styles.sectionTitle}>Nearby machines</Text>
                {scanning ? <ActivityIndicator accessibilityLabel="Searching" /> : null}
              </View>
              {devices.map((device) => (
                <Pressable
                  accessibilityHint="Shows identity details and token entry"
                  accessibilityRole="button"
                  key={device.deviceId}
                  onPress={() => selectDevice(device)}
                  style={({ pressed }) => [styles.device, pressed && styles.pressed]}>
                  <Text selectable style={styles.deviceName}>{device.name}</Text>
                  <Text selectable style={styles.metadata}>
                    {device.model} · API {device.apiVersion} · firmware {device.firmwareVersion}
                  </Text>
                  <Text selectable style={styles.metadata}>{device.deviceId}</Text>
                  <Text selectable style={styles.address}>{device.address}</Text>
                </Pressable>
              ))}
              {!scanning ? (
                <ActionButton label="Search again" onPress={startBrowsing} secondary />
              ) : null}
            </View>

            <View style={styles.card}>
              <Text selectable style={styles.sectionTitle}>Enter address manually</Text>
              <Text selectable style={styles.help}>
                Use the machine’s IPv4 address or local hostname. A simulator may include a port.
              </Text>
              <TextInput
                accessibilityLabel="Machine address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                keyboardType="url"
                onChangeText={setManualAddress}
                onSubmitEditing={() => void inspectManualAddress()}
                placeholder="192.168.1.20"
                returnKeyType="go"
                style={styles.input}
                value={manualAddress}
              />
              <ActionButton
                disabled={busy || manualAddress.trim().length === 0}
                label={busy ? "Checking…" : "Review this machine"}
                onPress={() => void inspectManualAddress()}
              />
            </View>
          </>
        )}

        {message.length > 0 ? (
          <View accessibilityLiveRegion="polite" style={styles.notice}>
            {busy ? <ActivityIndicator accessibilityLabel="Working" size="small" /> : null}
            <Text selectable style={styles.noticeText}>{message}</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

function IdentityDetails({ candidate }: { candidate: PairingCandidate }) {
  return (
    <View style={styles.details}>
      <Detail label="Name" value={candidate.name} />
      <Detail label="Device ID" value={candidate.deviceId} />
      <Detail label="Model" value={candidate.model} />
      <Detail label="API version" value={candidate.apiVersion} />
      <Detail label="Firmware" value={candidate.firmwareVersion} />
      <Detail label="Address" value={candidate.address} />
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text selectable style={styles.detailLabel}>{label}</Text>
      <Text selectable style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function ActionButton({
  disabled = false,
  label,
  onPress,
  secondary = false,
}: {
  disabled?: boolean;
  label: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.secondaryButton,
        disabled && styles.disabledButton,
        pressed && !disabled && styles.pressed,
      ]}>
      <Text style={[styles.buttonText, secondary && styles.secondaryButtonText]}>{label}</Text>
    </Pressable>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    switch (error.kind) {
      case "unauthorized":
        return "The token was rejected. Nothing was saved; check the token and try again.";
      case "not-found":
        return "No Philcoino API was found at that address.";
      case "protocol":
        return "The address answered, but its response was not a valid Philcoino response.";
      case "timeout":
      case "offline":
        return "The machine could not be reached. Check its power, address, and local Wi-Fi connection.";
      case "cancelled":
        return "The request was cancelled.";
      case "http":
      case "invalid-request":
        return error.message;
    }
  }
  return error instanceof Error ? error.message : "The operation could not be completed.";
}

function automaticDiscoveryUnavailableMessage(): string {
  if (Platform.OS === "android") {
    return "Automatic discovery is unavailable. Use a physical Android phone on the same Wi-Fi, check local network and Wi-Fi permissions, then try again or enter the address manually.";
  }
  if (Platform.OS === "ios") {
    return "Automatic discovery is unavailable. Allow Local Network access in iPhone Settings, then try again. You can also enter the address manually.";
  }
  return "Automatic discovery is unavailable on this platform. Enter the device address manually.";
}

function noMachinesFoundMessage(): string {
  if (Platform.OS === "android") {
    return "No machines were found. Use a physical Android phone, confirm the machine and phone are on the same Wi-Fi, then retry or enter the address manually.";
  }
  if (Platform.OS === "ios") {
    return "No machines were found. Confirm the machine and iPhone are on the same Wi-Fi, then retry or enter the address manually.";
  }
  return "No machines were found. Confirm the local network, then retry or enter the address manually.";
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F4F0E8", flex: 1 },
  content: {
    backgroundColor: "#F4F0E8",
    flexGrow: 1,
    gap: 18,
    padding: 20,
    paddingBottom: 44,
    paddingTop: 72,
  },
  pageHeader: { alignItems: "center", minHeight: 34 },
  pageTitle: { color: "#241B17", fontSize: 22, fontWeight: "800" },
  intro: { gap: 7, paddingHorizontal: 2, paddingTop: 8 },
  eyebrow: { color: "#8B3A2B", fontSize: 12, fontWeight: "800", letterSpacing: 1.5 },
  lead: { color: "#332A25", fontSize: 17, lineHeight: 24 },
  card: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 18,
  },
  sectionHeading: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  sectionTitle: { color: "#241B17", fontSize: 21, fontWeight: "700" },
  device: {
    backgroundColor: "#F5EEE5",
    borderCurve: "continuous",
    borderRadius: 14,
    gap: 4,
    padding: 14,
  },
  deviceName: { color: "#241B17", fontSize: 17, fontWeight: "700" },
  metadata: { color: "#62544B", fontSize: 13, lineHeight: 18 },
  address: { color: "#8B3A2B", fontSize: 13, fontWeight: "600" },
  fieldGroup: { gap: 7 },
  label: { color: "#4A3E37", fontSize: 14, fontWeight: "600" },
  help: { color: "#62544B", fontSize: 14, lineHeight: 20 },
  input: {
    backgroundColor: "#FFFFFF",
    borderColor: "#BBAEA1",
    borderCurve: "continuous",
    borderRadius: 13,
    borderWidth: 1,
    color: "#241B17",
    fontSize: 16,
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  button: {
    alignItems: "center",
    backgroundColor: "#8B3A2B",
    borderColor: "#8B3A2B",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: 18,
  },
  buttonText: { color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  secondaryButton: { backgroundColor: "transparent", borderColor: "#8B3A2B" },
  secondaryButtonText: { color: "#8B3A2B" },
  disabledButton: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
  details: { gap: 9 },
  detailRow: { gap: 3 },
  detailLabel: { color: "#76675D", fontSize: 12, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  detailValue: { color: "#241B17", fontSize: 15, lineHeight: 21 },
  notice: {
    alignItems: "flex-start",
    backgroundColor: "#E9E0D4",
    borderCurve: "continuous",
    borderRadius: 15,
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  noticeText: { color: "#4A3E37", flex: 1, fontSize: 14, lineHeight: 20 },
});
