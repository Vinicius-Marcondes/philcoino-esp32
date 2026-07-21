import * as ScreenOrientation from "expo-screen-orientation";
import { useEffect, useState } from "react";

import type { LandscapeDirection } from "@/src/layout/navigation-rail-inset";

function landscapeDirection(
  orientation: ScreenOrientation.Orientation,
): LandscapeDirection {
  switch (orientation) {
    case ScreenOrientation.Orientation.LANDSCAPE_LEFT:
      return "left";
    case ScreenOrientation.Orientation.LANDSCAPE_RIGHT:
      return "right";
    default:
      return null;
  }
}

export function useLandscapeDirection(): LandscapeDirection {
  const [direction, setDirection] = useState<LandscapeDirection>(null);

  useEffect(() => {
    let mounted = true;

    void ScreenOrientation.getOrientationAsync()
      .then((orientation) => {
        if (mounted) {
          setDirection(landscapeDirection(orientation));
        }
      })
      .catch(() => {
        if (mounted) {
          setDirection(null);
        }
      });

    const subscription = ScreenOrientation.addOrientationChangeListener(
      ({ orientationInfo }) => {
        setDirection(landscapeDirection(orientationInfo.orientation));
      },
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return direction;
}
