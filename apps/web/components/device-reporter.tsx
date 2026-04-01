"use client";

import { useEffect } from "react";
import { reportDevice } from "@/lib/device-reporter";

export function DeviceReporter() {
  useEffect(() => {
    reportDevice();
  }, []);

  return null;
}
