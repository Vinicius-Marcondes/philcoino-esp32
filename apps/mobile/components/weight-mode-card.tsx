import type { ScaleState, WeightControl } from "@philcoino/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { translate } from "@/src/localization/i18n";
import {
  currentScaleWeightDecigrams,
  formatDecigrams,
  formatWeightReadout,
} from "@/src/telemetry/telemetry-readouts";

export function WeightModeCard({
  compact = false,
  disabled,
  embedded = false,
  mode,
  onModeChange,
  onWeightChange,
  scale,
  startPending,
  value,
}: {
  compact?: boolean;
  disabled: boolean;
  embedded?: boolean;
  mode: "timed" | "weight";
  onModeChange: (mode: "timed" | "weight") => void;
  onWeightChange: (value: WeightControl) => void;
  scale: ScaleState | null;
  startPending: boolean;
  value: WeightControl;
}) {
  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
        embedded && styles.cardEmbedded,
      ]}>
      <Text selectable style={styles.cardLabel}>
        {translate("scale.brewControl")}
      </Text>
      <View
        style={[
          styles.modeRow,
          embedded && styles.modeRowEmbedded,
        ]}>
        {(["timed", "weight"] as const).map((option) => (
          <Pressable
            accessibilityRole="radio"
            accessibilityState={{ checked: mode === option, disabled }}
            disabled={disabled}
            key={option}
            onPress={() => onModeChange(option)}
            style={[
              styles.modeButton,
              embedded && styles.modeButtonEmbedded,
              mode === option && styles.modeButtonActive,
            ]}>
            <Text
              style={[
                styles.modeButtonText,
                mode === option && styles.modeButtonTextActive,
              ]}>
              {translate(`scale.mode.${option}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      {mode === "weight" ? (
        <>
          <View
            style={[
              styles.readinessNotice,
              (scale?.calibrationStatus !== "calibrated" ||
                scale.availability !== "ready") &&
                styles.readinessNoticeError,
            ]}>
            <Text
              accessibilityLiveRegion="polite"
              selectable
              style={[
                styles.readinessText,
                (scale?.calibrationStatus !== "calibrated" ||
                  scale.availability !== "ready") &&
                  styles.readinessError,
              ]}>
              {scale === null
                ? translate("scale.readinessLoading")
                : scale.calibrationStatus !== "calibrated"
                  ? translate("scale.readinessCalibration")
                  : scale.availability !== "ready"
                    ? translate("scale.readinessUnavailable", {
                        status: scale.availability,
                      })
                    : translate("scale.readinessReady")}
            </Text>
            <Text selectable style={styles.readinessText}>
              {translate("scale.placeCup")}
            </Text>
          </View>
          <WeightControlEditor
            disabled={disabled}
            onChange={onWeightChange}
            value={value}
          />
          <Text selectable style={styles.cutoffText}>
            {translate("scale.cutoff", {
              weight: formatDecigrams(
                value.targetWeightDecigrams - value.compensationDecigrams,
              ),
            })}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            selectable
            style={styles.liveWeight}>
            {startPending
              ? translate("mutation.weightedExtractionStartPending")
              : translate("scale.liveWeight", {
                  weight: formatWeightReadout(
                    currentScaleWeightDecigrams(scale),
                  ),
                })}
          </Text>
        </>
      ) : null}
    </View>
  );
}

export function WeightControlEditor({
  disabled,
  onChange,
  value,
}: {
  disabled: boolean;
  onChange: (value: WeightControl) => void;
  value: WeightControl;
}) {
  return (
    <View style={styles.editorRow}>
      <ScaleNumberInput
        disabled={disabled}
        label={translate("scale.target")}
        maximum={1000}
        minimum={50}
        onChange={(targetWeightDecigrams) =>
          onChange({ ...value, targetWeightDecigrams })
        }
        value={value.targetWeightDecigrams}
      />
      <ScaleNumberInput
        disabled={disabled}
        label={translate("scale.compensation")}
        maximum={Math.min(100, value.targetWeightDecigrams - 1)}
        minimum={0}
        onChange={(compensationDecigrams) =>
          onChange({ ...value, compensationDecigrams })
        }
        value={value.compensationDecigrams}
      />
    </View>
  );
}

function ScaleNumberInput({
  disabled,
  label,
  maximum,
  minimum,
  onChange,
  value,
}: {
  disabled: boolean;
  label: string;
  maximum: number;
  minimum: number;
  onChange: (value: number) => void;
  value: number;
}) {
  const [draft, setDraft] = useState(() => formatDecigrams(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) {
      setDraft(formatDecigrams(value));
    }
  }, [value]);
  const commit = useCallback(() => {
    const normalized = draft.trim().replace(",", ".");
    const parsed = normalized.length === 0 ? Number.NaN : Number(normalized);
    if (!Number.isFinite(parsed)) {
      setDraft(formatDecigrams(value));
      return;
    }
    const next = Math.max(
      minimum,
      Math.min(maximum, Math.round(parsed * 10)),
    );
    setDraft(formatDecigrams(next));
    if (next !== value) {
      onChange(next);
    }
  }, [draft, maximum, minimum, onChange, value]);
  return (
    <View style={styles.inputGroup}>
      <Text selectable style={styles.cardLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        editable={!disabled}
        inputMode="decimal"
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onChangeText={setDraft}
        onFocus={() => {
          focused.current = true;
        }}
        onSubmitEditing={commit}
        selectTextOnFocus
        style={styles.input}
        value={draft}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#FFFCF7",
    borderColor: "#DDD3C7",
    borderCurve: "continuous",
    borderRadius: 18,
    borderWidth: 1,
    gap: 8,
    padding: 17,
  },
  cardCompact: { gap: 6, padding: 12 },
  cardEmbedded: {
    backgroundColor: "transparent",
    borderRadius: 0,
    borderWidth: 0,
    padding: 0,
  },
  cardLabel: {
    color: "#CDBFB5",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.3,
  },
  cutoffText: { color: "#5D5048", fontSize: 14, lineHeight: 20 },
  editorRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  input: {
    backgroundColor: "#F4F0E8",
    borderColor: "#CDBFB2",
    borderRadius: 12,
    borderWidth: 1,
    color: "#241B17",
    fontSize: 20,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    minHeight: 46,
    paddingHorizontal: 12,
  },
  inputGroup: { flex: 1, gap: 5, minWidth: 130 },
  liveWeight: {
    color: "#2D7547",
    fontSize: 20,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
  },
  modeButton: {
    alignItems: "center",
    borderColor: "#8B3A2B",
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 15,
  },
  modeButtonActive: { backgroundColor: "#8B3A2B" },
  modeButtonEmbedded: {
    backgroundColor: "#FFF9F3",
    borderCurve: "continuous",
    borderRadius: 12,
    flex: 1,
    minWidth: 0,
  },
  modeButtonText: { color: "#5D2D22", fontSize: 14, fontWeight: "800" },
  modeButtonTextActive: { color: "#FFFFFF" },
  modeRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  modeRowEmbedded: {
    backgroundColor: "#FFF9F3",
    borderColor: "#D3B9A7",
    borderCurve: "continuous",
    borderRadius: 16,
    borderWidth: 1,
    flexWrap: "nowrap",
    gap: 4,
    padding: 4,
  },
  readinessError: {
    color: "#8C2F24",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
  readinessNotice: {
    backgroundColor: "#E5F1E8",
    borderColor: "#A9C9B0",
    borderCurve: "continuous",
    borderRadius: 14,
    borderWidth: 1,
    gap: 4,
    padding: 10,
  },
  readinessNoticeError: {
    backgroundColor: "#FFF0D8",
    borderColor: "#C66A24",
  },
  readinessText: {
    color: "#3E4E42",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 18,
  },
});
