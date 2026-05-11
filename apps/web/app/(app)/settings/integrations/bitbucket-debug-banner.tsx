"use client";

export function BitbucketDebugBanner({
  debugJson,
  title = "Bitbucket Connect Debug",
}: { debugJson: string; title?: string }) {
  let steps: string[] = [];
  try {
    steps = JSON.parse(decodeURIComponent(debugJson));
  } catch {
    steps = ["Failed to parse debug info"];
  }

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm font-mono dark:border-blue-800 dark:bg-blue-950">
      <p className="mb-2 font-semibold text-blue-800 dark:text-blue-200">
        {title}
      </p>
      <ul className="space-y-1 text-blue-700 dark:text-blue-300">
        {steps.map((step, i) => (
          <li key={i}>
            {step.includes("FAILED") ? "❌" : "✓"} {step}
          </li>
        ))}
      </ul>
    </div>
  );
}
