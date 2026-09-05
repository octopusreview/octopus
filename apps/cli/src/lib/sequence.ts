/**
 * Which wizard steps apply for the answers so far. Pure so it can be unit
 * tested without a TTY.
 *
 *  - Before the provider step has been passed this session, only the
 *    Ollama setup tab is hidden (we do not know the provider yet).
 *  - No provider (Cloud "use org default", or Esc): reviews use the
 *    server-side org default, so model / key / validate / Ollama are moot.
 *  - Ollama: its setup step replaces model / key / validate.
 *  - Provider with a model already chosen (the recommended pair): skip the
 *    model picker.
 */
export type WizardAnswers = {
  provider?: string;
  model?: string;
  providerConfirmed: boolean;
};

export function buildSequence<K extends string>(all: readonly K[], answers: WizardAnswers): K[] {
  const drop = new Set<string>();
  if (!answers.providerConfirmed) {
    drop.add("ollama-setup");
  } else if (!answers.provider) {
    for (const k of ["model", "byok", "validate", "ollama-setup"]) drop.add(k);
  } else if (answers.provider === "ollama") {
    for (const k of ["model", "byok", "validate"]) drop.add(k);
  } else {
    drop.add("ollama-setup");
    if (answers.model) drop.add("model");
  }
  return all.filter((k) => !drop.has(k));
}
