import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanResponder, StyleSheet, View } from "react-native";

import { moveBox, resizeBox, type Box } from "../lib/placement";

type Props = {
  box: Box;
  onChange: (box: Box) => void;
  /** Size of the area the box lives in, in points; the box itself is stored as 0..1 fractions. */
  frame: { width: number; height: number };
  children?: ReactNode;
};

/** A box the user drags to move and resizes from its bottom-right handle. */
export function PlacementBox({ box, onChange, frame, children }: Props) {
  // The gesture handlers are created once and read the latest props through this ref,
  // which is only touched in effects and gesture callbacks, never while rendering.
  const latest = useRef({ box, onChange, frame });
  useEffect(() => {
    latest.current = { box, onChange, frame };
  });
  const start = useRef(box);

  const responder = (apply: typeof moveBox) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start.current = latest.current.box;
      },
      onPanResponderMove: (_e, g) => {
        const { width, height } = latest.current.frame;
        latest.current.onChange(apply(start.current, g.dx / width, g.dy / height));
      },
    });
  // The handlers read the refs only inside gesture callbacks, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [move] = useState(() => responder(moveBox));
  // eslint-disable-next-line react-hooks/refs
  const [resize] = useState(() => responder(resizeBox));

  return (
    <View
      {...move.panHandlers}
      style={[
        styles.box,
        {
          left: box.left * frame.width,
          top: box.top * frame.height,
          width: box.width * frame.width,
          height: box.height * frame.height,
        },
      ]}
    >
      {children}
      <View {...resize.panHandlers} style={styles.handle} hitSlop={16} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#ffffff",
    borderStyle: "dashed",
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  handle: {
    position: "absolute",
    right: -12,
    bottom: -12,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#ff7a2e",
    borderWidth: 3,
    borderColor: "#ffffff",
  },
});
