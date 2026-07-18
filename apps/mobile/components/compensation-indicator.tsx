import type { CompensationState } from "@philcoino/protocol";
import { StyleSheet, Text, View } from "react-native";

import { translate } from "@/src/localization/i18n";

export function CompensationIndicator({
  compensation,
}: {
  compensation: CompensationState;
}) {
  const active = compensation.status === "active";

  return (
    <View
      accessibilityLabel={translate(
        active
          ? "dashboard.compensationActiveAccessibility"
          : "dashboard.compensationInactiveAccessibility",
      )}
      accessibilityLiveRegion="polite"
      accessible
      style={[styles.indicator, active && styles.activeIndicator]}>
      <View
        style={[styles.dot, active ? styles.activeDot : styles.inactiveDot]}
      />
      <Text selectable style={[styles.label, active && styles.activeLabel]}>
        {translate(
          active
            ? "dashboard.compensationActive"
            : "dashboard.compensationInactive",
        )}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#EAE2D7",
    borderColor: "#D8C9BA",
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  activeIndicator: {
    backgroundColor: "#E5F1E8",
    borderColor: "#A9C9B0",
  },
  dot: { borderRadius: 999, height: 7, width: 7 },
  activeDot: { backgroundColor: "#2D7547" },
  inactiveDot: { backgroundColor: "#76675D" },
  label: {
    color: "#5D5048",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  activeLabel: { color: "#245F3A" },
});
