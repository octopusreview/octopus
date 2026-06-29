import React from "react";
import { Box, Text } from "ink";

export type HeaderProps = {
  steps: { key: string; label: string }[];
  activeKey: string;
};

/**
 * Single-row numbered breadcrumb. Active step is bold + cyan; others gray.
 * Skipped or future steps look identical — the wizard owns sequencing.
 */
export function Header({ steps, activeKey }: HeaderProps) {
  return (
    <Box marginBottom={1}>
      {steps.map((step, i) => {
        const isActive = step.key === activeKey;
        return (
          <Text
            key={step.key}
            color={isActive ? "cyan" : "gray"}
            bold={isActive}
          >
            {`${i + 1}. ${step.label}`}
            {i < steps.length - 1 ? "   " : ""}
          </Text>
        );
      })}
    </Box>
  );
}
