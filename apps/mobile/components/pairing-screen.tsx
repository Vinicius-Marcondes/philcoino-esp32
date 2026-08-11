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
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DashboardScreen } from "@/components/dashboard-screen";
import type {
  DeviceDiscovery,
  DiscoveredDevice,
} from "@/src/discovery/device-discovery";
import { findDiscoveredDevice } from "@/src/discovery/device-discovery";
import { nativeDeviceDiscovery } from "@/src/discovery/native-device-discovery";
import { isDebugDeviceModeEnabled } from "@/src/debug-device-mode";
import { translate } from "@/src/localization/i18n";
import { mobileLayoutMode } from "@/src/layout/responsive-layout";
import { ApiClientError } from "@/src/networking/api-client-error";
import {
  createDebugPairingClient,
  DEBUG_DISCOVERY_TIMEOUT_MS,
  debugDeviceDiscovery,
  debugSelectedDeviceRepository,
} from "@/src/pairing/debug-pairing-dependencies";
import { createNativePairingClient } from "@/src/pairing/native-pairing-client";
import {
  pairingLog,
  pairingLogSnapshot,
  safePairingErrorDetails,
  subscribePairingLog,
  type PairingLogEntry,
} from "@/src/pairing/pairing-log";
import {
  authenticateAndSave,
  inspectDevice,
  restoreSelectedDevice,
  type PairingError,
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
const createPairingClient: PairingClientFactory = createNativePairingClient;

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
  const [pairingCode, setPairingCode] = useState("");
  const [message, setMessage] = useState(() => translate("pairing.checkingSaved"));
  const [busy, setBusy] = useState(true);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [pairingDiagnostics, setPairingDiagnostics] = useState<
    readonly PairingLogEntry[]
  >(pairingLogSnapshot);
  const windowSize = useWindowDimensions();
  const safeAreaInsets = useSafeAreaInsets();
  const landscape = mobileLayoutMode(windowSize) === "landscape";
  const stopScan = useRef<(() => void) | null>(null);
  const scanTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeOperation = useRef<AbortController | null>(null);
  const scrollView = useRef<ScrollView>(null);
  const focusedInput = useRef<"manual-address" | "pairing-code" | null>(null);

  useEffect(() => {
    const unsubscribe = subscribePairingLog(setPairingDiagnostics);
    pairingLog("connection", "success", { operation: "diagnostics-active-v3" });
    return unsubscribe;
  }, []);

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
    pairingLog("connection", "start", { operation: "discovery-scan" });
    setScanning(true);
    setMessage(translate("pairing.searching"));

    stopScan.current = discovery.scan({
      onDevice: (device) => {
        foundAny = true;
        pairingLog("connection", "success", { operation: "discovery-device" });
        addDevice(device);
        setMessage(translate("pairing.selectMachine"));
      },
      onError: (error) => {
        pairingLog("connection", "failure", {
          operation: "discovery-scan",
          ...safePairingErrorDetails(error),
        });
        stopBrowsing();
        setMessage(automaticDiscoveryUnavailableMessage());
      },
    });

    scanTimer.current = setTimeout(() => {
      stopBrowsing();
      if (!foundAny) {
        pairingLog("connection", "failure", {
          operation: "discovery-timeout",
        });
        setMessage(noMachinesFoundMessage());
      }
    }, discoveryTimeoutMs);
  }, [addDevice, discovery, discoveryTimeoutMs, stopBrowsing]);

  useEffect(() => {
    const controller = new AbortController();
    activeOperation.current = controller;
    pairingLog("connection", "start", { operation: "restore-selected-device" });

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
          pairingLog("connection", "success", {
            operation: "restore-selected-device",
            state: "connected",
          });
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
        if (result.status === "pairing-required") {
          pairingLog("connection", "success", {
            operation: "restore-selected-device",
            state: "pairing-required",
          });
          setSelected(result.candidate);
          setMessage(translate("pairing.pairingRequired"));
          return;
        }
        if (result.status === "not-found") {
          pairingLog("connection", "success", {
            operation: "restore-selected-device",
            state: "not-found",
          });
          setMessage(
            translate("pairing.savedNotFound"),
          );
        }
        if (result.status === "empty") {
          pairingLog("connection", "success", {
            operation: "restore-selected-device",
            state: "empty",
          });
        }
        startBrowsing();
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          pairingLog("connection", "failure", {
            operation: "restore-selected-device",
            ...safePairingErrorDetails(error),
          });
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
    pairingLog("connection", "success", { operation: "device-selected" });
    stopBrowsing();
    setSelected(device);
    setPairingCode("");
    setMessage(translate("pairing.confirmIdentityMessage"));
  };

  const inspectManualAddress = async () => {
    pairingLog("connection", "start", { operation: "manual-address-review" });
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
      pairingLog("connection", "success", { operation: "manual-address-review" });
      setPairingCode("");
      setMessage(translate("pairing.enterPairingCode"));
    } catch (error) {
      if (!controller.signal.aborted) {
        pairingLog("connection", "failure", {
          operation: "manual-address-review",
          ...safePairingErrorDetails(error),
        });
        setMessage(errorMessage(error));
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  };

  const pairSelectedDevice = async () => {
    pairingLog("srp-start", "start", {
      operation: "pair-button-pressed",
      state: selected === null ? "no-selection" : "selection-present",
    });
    if (selected === null) {
      pairingLog("srp-start", "failure", {
        operation: "pair-button-pressed",
        state: "no-selection",
      });
      return;
    }
    activeOperation.current?.abort();
    const controller = new AbortController();
    activeOperation.current = controller;
    setBusy(true);
    setMessage(translate("pairing.verifyingPairingCode"));

    try {
      const selectedDevice = await authenticateAndSave(
        selected,
        pairingCode,
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
      setPairingCode("");
      pairingLog("authenticated-state", "success", {
        operation: "pair-button-finished",
      });
      setMessage("");
    } catch (error) {
      if (!controller.signal.aborted) {
        pairingLog("srp-start", "failure", {
          operation: "pair-button-finished",
          ...safePairingErrorDetails(error),
        });
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
    setPairingCode("");
    setBusy(false);
    startBrowsing();
  };

  const chooseAnotherDevice = () => {
    setSelected(null);
    setPairingCode("");
    startBrowsing();
  };
  const pairingSubmitDisabled = busy || pairingCode.replaceAll(" ", "").length !== 8;

  useEffect(() => {
    pairingLog("srp-start", "success", {
      operation: "pair-ui-state",
      state: [
        selected === null ? "unselected" : "selected",
        busy ? "busy" : "idle",
        `code-length-${pairingCode.replaceAll(" ", "").length}`,
        pairingSubmitDisabled ? "button-disabled" : "button-enabled",
      ].join(","),
    });
  }, [busy, pairingCode, pairingSubmitDisabled, selected]);

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
          landscape && styles.contentLandscape,
          {
            paddingBottom:
              CONTENT_BOTTOM_PADDING + keyboardHeight + safeAreaInsets.bottom,
            paddingLeft: Math.max(20, safeAreaInsets.left + 12),
            paddingRight: Math.max(20, safeAreaInsets.right + 12),
          },
        ]}>
        <View style={styles.pageHeader}>
          <Text selectable style={styles.pageTitle}>{translate("pairing.title")}</Text>
        </View>
        <View
          style={[
            styles.pairingLayout,
            landscape && styles.pairingLayoutLandscape,
          ]}>
          <View
            style={[
              styles.pairingIntroColumn,
              landscape && styles.pairingIntroColumnLandscape,
            ]}>
            <View style={styles.intro}>
              <Text selectable style={styles.eyebrow}>{translate("pairing.eyebrow")}</Text>
              <Text selectable style={styles.lead}>
                {translate("pairing.lead")}
              </Text>
            </View>

            {message.length > 0 ? (
              <View accessibilityLiveRegion="polite" style={styles.notice}>
                {busy ? <ActivityIndicator accessibilityLabel={translate("pairing.working")} size="small" /> : null}
                <Text selectable style={styles.noticeText}>{message}</Text>
              </View>
            ) : null}
          </View>

          <View
            style={[
              styles.pairingActionColumn,
              landscape && styles.pairingActionColumnLandscape,
            ]}>

        {selected !== null ? (
          <View style={styles.card}>
            <Text selectable style={styles.sectionTitle}>{translate("pairing.confirmIdentity")}</Text>
            <IdentityDetails candidate={selected} />
            <View style={styles.fieldGroup}>
              <Text selectable style={styles.label}>{translate("pairing.pairingCode")}</Text>
              <TextInput
                accessibilityLabel={translate("pairing.pairingCode")}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                keyboardType="number-pad"
                maxLength={9}
                onChangeText={(value) => setPairingCode(formatPairingCode(value))}
                onBlur={() => {
                  focusedInput.current = null;
                }}
                onFocus={() => {
                  focusedInput.current = "pairing-code";
                  const visibleKeyboardHeight = Keyboard.metrics()?.height ?? 0;
                  if (visibleKeyboardHeight > 0) {
                    setKeyboardHeight(visibleKeyboardHeight);
                  }
                  scrollFocusedActionsIntoView();
                }}
                onSubmitEditing={() => void pairSelectedDevice()}
                placeholder={translate("pairing.pairingCodePlaceholder")}
                returnKeyType="done"
                style={styles.input}
                value={pairingCode}
              />
            </View>
            <ActionButton
              disabled={pairingSubmitDisabled}
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
          </View>
        </View>
        <View style={styles.diagnostics}>
          <Text selectable style={styles.diagnosticsTitle}>
            PAIRING DIAGNOSTICS · UI v3
          </Text>
          {pairingDiagnostics.length === 0 ? (
            <Text selectable style={styles.diagnosticsText}>No pairing events yet.</Text>
          ) : pairingDiagnostics.map((entry) => (
            <Text key={entry.sequence} selectable style={styles.diagnosticsText}>
              {formatPairingLogEntry(entry)}
            </Text>
          ))}
        </View>
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
  const pairingError = readPairingError(error);
  if (pairingError !== null) {
    let message: string;
    switch (pairingError.code) {
      case "invalid_pairing_code_format":
        message = translate("pairing.errors.invalidPairingCodeFormat");
        break;
      case "invalid_pairing_code":
        message = translate("pairing.errors.invalidPairingCode");
        break;
      case "connection_failed":
        message = translate("pairing.errors.connection");
        break;
      case "srp_start_failed":
        message = translate("pairing.errors.srpStart");
        break;
      case "client_proof_failed":
        message = translate("pairing.errors.clientProof");
        break;
      case "invalid_server_proof":
        message = translate("pairing.errors.serverProof");
        break;
      case "invalid_certificate_binding":
        message = translate("pairing.errors.certificateBinding");
        break;
      case "token_issue_failed":
        message = translate("pairing.errors.tokenIssue");
        break;
      case "authenticated_state_failed":
        message = translate("pairing.errors.authenticatedState");
        break;
      case "secure_store_failed":
        message = translate("pairing.errors.secureSave");
        break;
      case "certificate_changed":
        message = translate("pairing.errors.certificateChanged");
        break;
      case "identity_changed":
        message = translate("pairing.errors.identityChanged");
        break;
    }
    return `${message} [${pairingError.stage}/${pairingError.code}]`;
  }
  if (error instanceof ApiClientError) {
    switch (error.kind) {
      case "unauthorized":
        return translate("pairing.errors.unauthorized");
      case "certificate-changed":
        return translate("pairing.errors.certificateChanged");
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

function readPairingError(
  error: unknown,
): Pick<PairingError, "code" | "stage"> | null {
  if (typeof error !== "object" || error === null) return null;
  const value = error as { code?: unknown; stage?: unknown };
  const codes = new Set<string>([
    "certificate_changed",
    "connection_failed",
    "identity_changed",
    "invalid_pairing_code_format",
    "invalid_pairing_code",
    "invalid_server_proof",
    "invalid_certificate_binding",
    "srp_start_failed",
    "client_proof_failed",
    "token_issue_failed",
    "authenticated_state_failed",
    "secure_store_failed",
  ] satisfies PairingError["code"][]);
  const stages = new Set<string>([
    "connection",
    "srp-start",
    "client-proof",
    "server-proof",
    "certificate-binding",
    "token-issue",
    "authenticated-state",
    "secure-save",
  ] satisfies PairingError["stage"][]);
  if (typeof value.code !== "string" || !codes.has(value.code) ||
      typeof value.stage !== "string" || !stages.has(value.stage)) {
    return null;
  }
  return value as Pick<PairingError, "code" | "stage">;
}

function formatPairingCode(value: string): string {
  const digits = value.replace(/\D/gu, "").slice(0, 8);
  return digits.length <= 4 ? digits : `${digits.slice(0, 4)} ${digits.slice(4)}`;
}

function formatPairingLogEntry(entry: PairingLogEntry): string {
  const details = [
    entry.operation,
    entry.state === undefined ? undefined : `state=${entry.state}`,
    entry.errorCode === undefined ? undefined : `native=${entry.errorCode}`,
    entry.errorName === undefined ? undefined : `name=${entry.errorName}`,
    entry.transportKind === undefined ? undefined : `transport=${entry.transportKind}`,
    entry.httpStatus === undefined ? undefined : `http=${entry.httpStatus}`,
    entry.apiCode === undefined ? undefined : `api=${entry.apiCode}`,
  ].filter((value): value is string => value !== undefined);
  return `#${entry.sequence} ${entry.stage}/${entry.event}${
    details.length === 0 ? "" : ` · ${details.join(" · ")}`
  }`;
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
  contentLandscape: { paddingTop: 16 },
  pairingLayout: { gap: 18 },
  pairingLayoutLandscape: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  pairingIntroColumn: { gap: 18 },
  pairingIntroColumnLandscape: {
    flex: 0.8,
    minWidth: 220,
  },
  pairingActionColumn: { gap: 18 },
  pairingActionColumnLandscape: { flex: 1.2, minWidth: 320 },
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
  diagnostics: {
    backgroundColor: "#241B17",
    borderRadius: 14,
    gap: 5,
    padding: 12,
  },
  diagnosticsText: {
    color: "#F4F0E8",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 11,
    lineHeight: 16,
  },
  diagnosticsTitle: {
    color: "#F1A58E",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
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
