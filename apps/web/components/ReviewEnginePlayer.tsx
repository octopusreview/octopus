"use client";

import { Player } from "@remotion/player";
import { ReviewEnginePipeline } from "./ReviewEnginePipeline";

export const ReviewEnginePlayer: React.FC<{
  autoPlay?: boolean;
  loop?: boolean;
  showControls?: boolean;
  style?: React.CSSProperties;
}> = ({ autoPlay = true, loop = false, showControls = true, style }) => {
  return (
    <Player
      component={ReviewEnginePipeline}
      compositionWidth={1920}
      compositionHeight={1080}
      durationInFrames={1500}
      fps={30}
      autoPlay={autoPlay}
      loop={loop}
      controls={showControls}
      style={{
        width: "100%",
        borderRadius: 12,
        overflow: "hidden",
        ...style,
      }}
    />
  );
};
