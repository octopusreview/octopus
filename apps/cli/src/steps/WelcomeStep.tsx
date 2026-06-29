import React from "react";
import { Box, Text, useInput } from "ink";

export type WelcomeStepProps = {
  onNext: () => void;
};

export function WelcomeStep({ onNext }: WelcomeStepProps) {
  useInput((_input, key) => {
    if (key.return) onNext();
  });

  return (
    <Box flexDirection="column">
      <Text bold>Welcome to Octopus 🐙</Text>
      <Text> </Text>
      <Text>
        Octopus is an AI code reviewer that runs on every pull request — using the
      </Text>
      <Text>AI provider and model you pick. This wizard takes about a minute.</Text>
      <Text> </Text>
      <Text dimColor>Press Enter to continue · Ctrl+C to quit</Text>
    </Box>
  );
}
