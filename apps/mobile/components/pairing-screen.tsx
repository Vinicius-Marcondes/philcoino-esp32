import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { DashboardScreen } from "@/components/dashboard-screen";
import type {
  DeviceDiscovery,
  DiscoveredDevice,
} from "@/src/discovery/device-discovery";
import { findDiscoveredDevice } from "@/src/discovery/device-discovery";
import { nativeDeviceDiscovery } from "@/src/discovery/native-device-discovery";
import { isDebugDeviceModeEnabled } from "@/src/debug-device-mode";
import { translate } from "@/src/localization/i18n";
import { ApiClientError } from "@/src/networking/api-client-error";
import { createDeviceApiClient } from "@/src/networking/expo-device-api-client";
import {
  createDebugPairingClient,
  DEBUG_DISCOVERY_TIMEOUT_MS,
  debugDeviceDiscovery,
  debugSelectedDeviceRepository,
} from "@/src/pairing/debug-pairing-dependencies";
import {
  authenticateAndSave,
  inspectDevice,
  restoreSelectedDevice,
  type PairingCandidate,
  type PairingClientFactory,
} from "@/src/pairing/pairing-service";
import { selectedDeviceRepository } from "@/src/storage/secure-selected-device-repository";
import {
  SelectedDeviceRepository,
  type SelectedDevice,
} from "@/src/storage/selected-device-repository";

const DISCOVERY_TIMEOUT_MS = 8_000;
const CONTENT_BOTTOM_PADDING = 44;
const createPairingClient: PairingClientFactory = (options) =>
  createDeviceApiClient(options);

type PairedDevice = {
  candidate: PairingCandidate;
  messageKey: string;
  selectedDevice: SelectedDevice;
};

export function PairingScreen() {
  if (isDebugDeviceModeEnabled()) {
    return (
      <PairingFlowScreen
        createClient={createDebugPairingClient}
        discovery={debugDeviceDiscovery}
        discoveryTimeoutMs={DEBUG_DISCOVERY_TIMEOUT_MS}
        repository={debugSelectedDeviceRepository}
      />
    );
  }

  return (
    <PairingFlowScreen
      createClient={createPairingClient}
      discovery={nativeDeviceDiscovery}
      discoveryTimeoutMs={DISCOVERY_TIMEOUT_MS}
      repository={selectedDeviceRepository}
    />
  );
}

function PairingFlowScreen({
  createClient,
  discovery,
  discoveryTimeoutMs,
  repository,
}: {
  createClient: PairingClientFactory;
  discovery: DeviceDiscovery;
  discoveryTimeoutMs: number;
  repository: SelectedDeviceRepository;
}) {
  const [devices, setDevices] = useState<DiscoveredDevice[]>([]);
  const [selected, setSelected] = useState<PairingCandidate | null>(null);
  const [paired, setPaired] = useState<PairedDevice | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const [token, setToken] = useState("");
  const [message, setMessage] = useState(() => translate("pairing.checkingSaved"));
  const [busy, setBusy] = useState(true);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [scanning, setScanning] = useState(false);
  const stopScan = useRef<(() => void) | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeOperation = useRef<AbortController | null>(null);
  const scrollView = useRef<ScrollView>(null);
  const focusedInput = useRef<"manual-address" | "token" | null>(null);

  const scrollFocusedActionsIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      scrollView.current?.scrollToEnd({ animated: false });
    });
  }, []);

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
    setMessage(translate("pairing.searching"));

    stopScan.current = discovery.scan({
      onDevice: (device) => {
        foundAny = true;
        addDevice(device);
        setMessage(translate("pairing.selectMachine"));
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
    }, discoveryTimeoutMs);
  }, [addDevice, discovery, discoveryTimeoutMs, stopBrowsing]);

  useEffect(() => {
    const controller = new AbortController();
    activeOperation.current = controller;

    void restoreSelectedDevice(
      {
        createClient,
        findDeviceById: (deviceId, options) =>
          findDiscoveredDevice(discovery, deviceId, {
            ...options,
            timeoutMs: discoveryTimeoutMs,
          }),
        repository,
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
            messageKey: result.recoveredAddress
              ? "pairing.recoveredAddress"
              : "pairing.cachedAddress",
            selectedDevice: result.selected,
          });
          setMessage("");
          return;
        }
        if (result.status === "not-found") {
          setMessage(
            translate("pairing.savedNotFound"),
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
  }, [addDevice, createClient, discovery, discoveryTimeoutMs, repository, startBrowsing, stopBrowsing]);

  useEffect(() => {
    const keyboardShownEvent = Platform.OS === "ios"
      ? "keyboardWillChangeFrame"
      : "keyboardDidShow";
    const keyboardHiddenEvent = Platform.OS === "ios"
      ? "keyboardWillHide"
      : "keyboardDidHide";
    const shownSubscription = Keyboard.addListener(keyboardShownEvent, (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardHeight(event.endCoordinates.height);
      if (focusedInput.current !== null) {
        scrollFocusedActionsIntoView();
      }
    });
    const hiddenSubscription = Keyboard.addListener(keyboardHiddenEvent, (event) => {
      Keyboard.scheduleLayoutAnimation(event);
      setKeyboardHeight(0);
    });

    return () => {
      shownSubscription.remove();
      hiddenSubscription.remove();
    };
  }, [scrollFocusedActionsIntoView]);

  const selectDevice = (device: PairingCandidate) => {
    stopBrowsing();
    setSelected(device);
    setToken("");
    setMessage(translate("pairing.confirmIdentityMessage"));
  };

  const inspectManualAddress = async () => {
    activeOperation.current?.abort();
    const controller = new AbortController();
    activeOperation.current = controller;
    stopBrowsing();
    setBusy(true);
    setMessage(translate("pairing.checkingAddress"));

    try {
      const candidate = await inspectDevice(
        manualAddress,
        createClient,
        controller.signal,
      );
      setSelected(candidate);
      setToken("");
      setMessage(translate("pairing.validIdentity"));
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
    setMessage(translate("pairing.verifyingToken"));

    try {
      const selectedDevice = await authenticateAndSave(
        selected,
        token,
        {
          createClient,
          repository,
        },
        controller.signal,
      );
      setPaired({
        candidate: selected,
        messageKey: "pairing.authenticationSucceeded",
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
    await repository.clear();
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
        initialNote={translate(paired.messageKey)}
        onForget={() => void forgetDevice()}
        selectedDevice={paired.selectedDevice}
      />
    );
  }

  return (
    <>
      <ScrollView
        contentInsetAdjustmentBehavior="never"
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ref={scrollView}
        style={styles.screen}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: CONTENT_BOTTOM_PADDING + keyboardHeight },
        ]}>
        <View style={styles.pageHeader}>
          <Text selectable style={styles.pageTitle}>{translate("pairing.title")}</Text>
        </View>
        <View style={styles.intro}>
          <Text selectable style={styles.eyebrow}>{translate("pairing.eyebrow")}</Text>
          <Text selectable style={styles.lead}>
            {translate("pairing.lead")}
          </Text>
        </View>

        {selected !== null ? (
          <View style={styles.card}>
            <Text selectable style={styles.sectionTitle}>{translate("pairing.confirmIdentity")}</Text>
            <IdentityDetails candidate={selected} />
            <View style={styles.fieldGroup}>
              <Text selectable style={styles.label}>{translate("pairing.bearerToken")}</Text>
              <TextInput
                accessibilityLabel={translate("pairing.bearerToken")}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                onChangeText={setToken}
                onBlur={() => {
                  focusedInput.current = null;
                }}
                onFocus={() => {
                  focusedInput.current = "token";
                  const visibleKeyboardHeight = Keyboard.metrics()?.height ?? 0;
                  if (visibleKeyboardHeight > 0) {
                    setKeyboardHeight(visibleKeyboardHeight);
                  }
                  scrollFocusedActionsIntoView();
                }}
                onSubmitEditing={() => void pairSelectedDevice()}
                placeholder={translate("pairing.tokenPlaceholder")}
                returnKeyType="done"
                secureTextEntry
                style={styles.input}
                value={token}
              />
            </View>
            <ActionButton
              disabled={tokenSubmitDisabled}
              label={busy ? translate("pairing.verifying") : translate("pairing.verifyAndSave")}
              onPress={() => void pairSelectedDevice()}
            />
            <ActionButton
              disabled={busy}
              label={translate("pairing.chooseAnother")}
              onPress={chooseAnotherDevice}
              secondary
            />
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={styles.sectionHeading}>
                <Text selectable style={styles.sectionTitle}>{translate("pairing.nearbyMachines")}</Text>
                {scanning ? <ActivityIndicator accessibilityLabel={translate("pairing.searchingLabel")} /> : null}
              </View>
              {devices.map((device) => (
                <Pressable
                  accessibilityHint={translate("pairing.deviceHint")}
                  accessibilityRole="button"
                  key={device.deviceId}
                  onPress={() => selectDevice(device)}
                  style={({ pressed }) => [styles.device, pressed && styles.pressed]}>
                  <Text selectable style={styles.deviceName}>{device.name}</Text>
                  <Text selectable style={styles.metadata}>
                    {translate("pairing.deviceMetadata", device)}
                  </Text>
                  <Text selectable style={styles.metadata}>{device.deviceId}</Text>
                  <Text selectable style={styles.address}>{device.address}</Text>
                </Pressable>
              ))}
              {!scanning ? (
                <ActionButton label={translate("pairing.searchAgain")} onPress={startBrowsing} secondary />
              ) : null}
            </View>

            <View style={styles.card}>
              <Text selectable style={styles.sectionTitle}>{translate("pairing.enterAddress")}</Text>
              <Text selectable style={styles.help}>
                {translate("pairing.addressHelp")}
              </Text>
              <TextInput
                accessibilityLabel={translate("pairing.machineAddress")}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                keyboardType="url"
                onChangeText={setManualAddress}
                onBlur={() => {
                  focusedInput.current = null;
                }}
                onFocus={() => {
                  focusedInput.current = "manual-address";
                  const visibleKeyboardHeight = Keyboard.metrics()?.height ?? 0;
                  if (visibleKeyboardHeight > 0) {
                    setKeyboardHeight(visibleKeyboardHeight);
                  }
                  scrollFocusedActionsIntoView();
                }}
                onSubmitEditing={() => void inspectManualAddress()}
                placeholder="192.168.1.20"
                returnKeyType="go"
                style={styles.input}
                value={manualAddress}
              />
              <ActionButton
                disabled={busy || manualAddress.trim().length === 0}
                label={busy ? translate("pairing.checking") : translate("pairing.reviewMachine")}
                onPress={() => void inspectManualAddress()}
              />
            </View>
          </>
        )}

        {message.length > 0 ? (
          <View accessibilityLiveRegion="polite" style={styles.notice}>
            {busy ? <ActivityIndicator accessibilityLabel={translate("pairing.working")} size="small" /> : null}
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
      <Detail label={translate("pairing.details.name")} value={candidate.name} />
      <Detail label={translate("pairing.details.deviceId")} value={candidate.deviceId} />
      <Detail label={translate("pairing.details.model")} value={candidate.model} />
      <Detail label={translate("pairing.details.apiVersion")} value={candidate.apiVersion} />
      <Detail label={translate("pairing.details.firmware")} value={candidate.firmwareVersion} />
      <Detail label={translate("pairing.details.address")} value={candidate.address} />
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
        return translate("pairing.errors.unauthorized");
      case "not-found":
        return translate("pairing.errors.notFound");
      case "protocol":
        return translate("pairing.errors.protocol");
      case "timeout":
      case "offline":
        return translate("pairing.errors.unreachable");
      case "cancelled":
        return translate("pairing.errors.cancelled");
      case "http":
        return translate("pairing.errors.generic");
      case "invalid-request":
        return translate("pairing.errors.generic");
    }
  }
  return translate("pairing.errors.generic");
}

function automaticDiscoveryUnavailableMessage(): string {
  if (Platform.OS === "android") {
    return translate("pairing.discovery.unavailableAndroid");
  }
  if (Platform.OS === "ios") {
    return translate("pairing.discovery.unavailableIos");
  }
  return translate("pairing.discovery.unavailableOther");
}

function noMachinesFoundMessage(): string {
  if (Platform.OS === "android") {
    return translate("pairing.discovery.noneAndroid");
  }
  if (Platform.OS === "ios") {
    return translate("pairing.discovery.noneIos");
  }
  return translate("pairing.discovery.noneOther");
}

const styles = StyleSheet.create({
  screen: { backgroundColor: "#F4F0E8", flex: 1 },
  content: {
    backgroundColor: "#F4F0E8",
    flexGrow: 1,
    gap: 18,
    padding: 20,
    paddingBottom: CONTENT_BOTTOM_PADDING,
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
